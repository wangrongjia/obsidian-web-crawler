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
	 * 获取光标位置的标题层级路径
	 * @param editor 编辑器对象
	 * @returns 标题层级路径数组，例如 ['润学', '英国']，如果不在任何标题下则返回空数组
	 */
	getHeadingPath(editor: Editor): string[] {
		const cursor = editor.getCursor();
		const path: string[] = [];

		// 步骤1: 从光标位置向上查找最近的标题（这个标题"包含"了光标所在行）
		let nearestHeadingLine = -1;
		let nearestHeadingLevel = 0;
		let nearestHeadingTitle = '';

		for (let line = cursor.line; line >= 0; line--) {
			const lineContent = editor.getLine(line).trim();
			const headingMatch = lineContent.match(/^(#{1,6})\s+(.+)$/);

			if (headingMatch) {
				const level = headingMatch[1]?.length || 1;
				const title = headingMatch[2]?.trim() || '';
				const cleanTitle = title.replace(/\[.*?\]/g, '').trim();

				nearestHeadingLine = line;
				nearestHeadingLevel = level;
				nearestHeadingTitle = cleanTitle;
				break; // 找到最近的标题就停止
			}
		}

		// 如果没找到任何标题，返回空数组
		if (nearestHeadingLine === -1) {
			return [];
		}

		// 步骤2: 从这个最近的标题继续向上，找它的所有父标题（级别更小的）
		path.unshift(nearestHeadingTitle);
		let currentLevel = nearestHeadingLevel;

		for (let line = nearestHeadingLine - 1; line >= 0; line--) {
			const lineContent = editor.getLine(line).trim();
			const headingMatch = lineContent.match(/^(#{1,6})\s+(.+)$/);

			if (headingMatch) {
				const level = headingMatch[1]?.length || 1;
				const title = headingMatch[2]?.trim() || '';
				const cleanTitle = title.replace(/\[.*?\]/g, '').trim();

				// 只收集级别更小的标题（父标题）
				if (level < currentLevel) {
					path.unshift(cleanTitle);
					currentLevel = level;
				}
			}
		}

		return path;
	}

	/**
	 * 获取标题文本的级别（通过查找其在文件中的定义）
	 * 这个方法是辅助方法，用于比较标题级别
	 */
	private getHeadingLevel(editor: Editor, headingText: string): number {
		const lineCount = editor.lineCount();
		for (let i = 0; i < lineCount; i++) {
			const lineContent = editor.getLine(i).trim();
			const match = lineContent.match(/^#+\s+(.+)$/);
			if (match && match[2]?.trim() === headingText) {
				const hashMatch = lineContent.match(/^(#+)/);
				return hashMatch?.[1]?.length || 1;
			}
		}
		return 1;
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

			// 获取当前活动的编辑器，用于确定保存路径
			let activeEditor = editor;
			let activeView = view;

			if (!activeEditor || !activeView) {
				const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeMarkdownView) {
					activeEditor = activeMarkdownView.editor;
					activeView = activeMarkdownView;
				}
			}

			// 确定保存路径
			let folderPath = this.settings.savePath; // 默认路径
			if (activeEditor) {
				const headingPath = this.getHeadingPath(activeEditor);
				if (headingPath.length > 0) {
					// 如果光标在某个标题层级下，使用标题层级作为路径
					folderPath = headingPath.join('/');
				}
			}

			const filePath = `${folderPath}/${fileName}.md`;

			// 确保目录存在（递归创建）
			const pathParts = folderPath.split('/');
			let currentPath = '';
			for (const part of pathParts) {
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				const folder = this.app.vault.getAbstractFileByPath(currentPath);
				if (!folder) {
					await this.app.vault.createFolder(currentPath);
				}
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
		inputContainer.addClass('web-crawler-input-container');

		const urlInput = inputContainer.createEl('input', {
			type: 'text',
			placeholder: '请输入网页URL，例如: https://example.com/article',
		});
		urlInput.addClass('web-crawler-url-input');

		const buttonContainer = contentEl.createDiv();
		buttonContainer.addClass('web-crawler-button-container');

		const crawlButton = buttonContainer.createEl('button', {
			text: '爬取',
		});
		crawlButton.addClass('mod-cta');
		crawlButton.addClass('web-crawler-crawl-button');

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
		crawlButton.addEventListener('click', () => {
			void (async () => {
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
			})();
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
