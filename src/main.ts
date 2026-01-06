import {App, Editor, MarkdownView, Modal, Notice, Plugin, TFile} from 'obsidian';
import {DEFAULT_SETTINGS, WebCrawlerPluginSettings, WebCrawlerSettingTab} from "./settings";
import {WebCrawler} from "./webCrawler";

export default class WebCrawlerPlugin extends Plugin {
	settings: WebCrawlerPluginSettings;
	private webCrawler: WebCrawler;

	async onload() {
		await this.loadSettings();
		this.webCrawler = new WebCrawler();

		// 添加左侧图标
		this.addRibbonIcon('link', '爬取网页', (evt: MouseEvent) => {
			new UrlInputModal(this.app, this).open();
		});

		// 添加命令
		this.addCommand({
			id: 'crawl-webpage',
			name: '爬取网页内容',
			callback: () => {
				new UrlInputModal(this.app, this).open();
			}
		});

		// 添加编辑器命令（仅在编辑器中可用）
		this.addCommand({
			id: 'crawl-webpage-editor',
			name: '爬取网页内容并插入链接',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new UrlInputModal(this.app, this, editor, view).open();
			}
		});

		// 添加设置标签页
		this.addSettingTab(new WebCrawlerSettingTab(this.app, this));
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<WebCrawlerPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * 爬取网页并创建文件
	 */
	async crawlAndCreateFile(url: string, editor?: Editor, view?: MarkdownView): Promise<void> {
		try {
			new Notice('开始爬取网页...');

			// 爬取网页内容
			const { title, content } = await this.webCrawler.fetchWebContent(url, this.settings.loginConfigs, this.settings);

			// 生成文件名
			const fileName = this.webCrawler.generateFileName(title);
			const filePath = `${this.settings.savePath}/${fileName}.md`;

			// 确保目录存在
			const folderPath = this.settings.savePath;
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				await this.app.vault.createFolder(folderPath);
			}

			// 创建文件内容（使用 Obsidian Properties 格式）
			const now = new Date();
			const dateStr = now.toISOString().slice(0, 19).replace('T', ' '); // 格式：2024-01-06 12:30:45
			const fileContent = `---
来源: ${url}
时间: ${dateStr}
---

${content}`;

			// 创建文件
			let file: TFile;
			const existingFile = this.app.vault.getAbstractFileByPath(filePath);
			if (existingFile instanceof TFile) {
				// 如果文件已存在，更新内容
				await this.app.vault.modify(existingFile, fileContent);
				file = existingFile;
				new Notice(`文件已更新: ${filePath}`);
			} else {
				// 创建新文件
				file = await this.app.vault.create(filePath, fileContent);
				new Notice(`文件已创建: ${filePath}`);
			}

			// 尝试插入链接到当前编辑器
			// 优先使用传入的editor，否则尝试获取当前活动的编辑器
			let activeEditor = editor;
			let activeView = view;

			if (!activeEditor || !activeView) {
				const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeMarkdownView) {
					activeEditor = activeMarkdownView.editor;
					activeView = activeMarkdownView;
				}
			}

			if (activeEditor && activeView) {
				const linkText = `[[${title}]]`;
				activeEditor.replaceSelection(linkText);
				new Notice('链接已插入到当前文件');
			} else {
				new Notice('未找到活动的编辑器，文件已保存');
			}

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`爬取失败: ${errorMessage}`, 5000);
			console.error('爬取失败:', error);
		}
	}
}

class UrlInputModal extends Modal {
	private plugin: WebCrawlerPlugin;
	private editor?: Editor;
	private view?: MarkdownView;

	constructor(app: App, plugin: WebCrawlerPlugin, editor?: Editor, view?: MarkdownView) {
		super(app);
		this.plugin = plugin;
		this.editor = editor;
		this.view = view;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl('h2', {text: '爬取网页内容'});

		const inputContainer = contentEl.createDiv();
		inputContainer.style.marginBottom = '1rem';

		const urlInput = inputContainer.createEl('input', {
			type: 'text',
			placeholder: '请输入网页URL，例如: https://example.com/article',
			attr: { style: 'width: 100%; padding: 0.5rem;' }
		});

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '0.5rem';
		buttonContainer.style.justifyContent = 'flex-end';

		const crawlButton = buttonContainer.createEl('button', {
			text: '爬取',
			attr: { style: 'margin-top: 1rem;' }
		});
		crawlButton.addClass('mod-cta');

		const cancelButton = buttonContainer.createEl('button', {
			text: '取消'
		});

		// 回车键提交
		urlInput.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') {
				evt.preventDefault();
				crawlButton.click();
			}
		});

		// 爬取按钮点击事件
		crawlButton.addEventListener('click', async () => {
			const url = urlInput.value.trim();
			if (!url) {
				new Notice('请输入有效的URL');
				return;
			}

			// 验证URL格式
			try {
				new URL(url);
			} catch (e) {
				new Notice('URL格式不正确，请包含协议（http://或https://）');
				return;
			}

			this.close();
			await this.plugin.crawlAndCreateFile(url, this.editor, this.view);
		});

		// 取消按钮
		cancelButton.addEventListener('click', () => {
			this.close();
		});

		// 自动聚焦输入框
		urlInput.focus();
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}
