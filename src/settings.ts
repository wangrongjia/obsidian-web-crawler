import {App, PluginSettingTab, Setting} from "obsidian";
import WebCrawlerPlugin from "./main";

export interface LoginConfig {
	urlPattern: string;  // URL匹配模式，如 "https://example.com/*"
	username?: string;
	password?: string;
	cookies?: string;    // Cookie字符串，格式: "key1=value1; key2=value2"
	userAgent?: string;  // 自定义User-Agent
}

export interface WebCrawlerPluginSettings {
	savePath: string;  // 保存文件的路径，相对于vault根目录
	loginConfigs: LoginConfig[];  // 登录配置列表
	proxyUrl: string;  // 代理URL，例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080
	useSystemProxy: boolean;  // 是否自动使用系统代理
}

export const DEFAULT_SETTINGS: WebCrawlerPluginSettings = {
	savePath: 'WebCrawler',
	loginConfigs: [],
	proxyUrl: '',
	useSystemProxy: true
}

export class WebCrawlerSettingTab extends PluginSettingTab {
	plugin: WebCrawlerPlugin;

	constructor(app: App, plugin: WebCrawlerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: '网页爬取设置'});

		// 代理设置
		new Setting(containerEl)
			.setName('使用系统代理')
			.setDesc('自动使用系统或浏览器的代理设置（适用于 Electron 环境）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useSystemProxy)
				.onChange(async (value) => {
					this.plugin.settings.useSystemProxy = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('代理服务器')
			.setDesc('手动配置代理服务器。格式：http://127.0.0.1:7890 或 socks5://127.0.0.1:1080。如果设置此项，将优先使用此代理而不是系统代理')
			.addText(text => text
				.setPlaceholder('http://127.0.0.1:7890')
				.setValue(this.plugin.settings.proxyUrl)
				.onChange(async (value) => {
					this.plugin.settings.proxyUrl = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('hr');

		// 保存路径设置
		new Setting(containerEl)
			.setName('保存路径')
			.setDesc('爬取的内容将保存到此路径（相对于vault根目录）')
			.addText(text => text
				.setPlaceholder('WebCrawler')
				.setValue(this.plugin.settings.savePath)
				.onChange(async (value) => {
					this.plugin.settings.savePath = value || 'WebCrawler';
					await this.plugin.saveSettings();
				}));

		// 登录配置区域
		containerEl.createEl('h3', {text: '登录配置'});
		containerEl.createEl('p', {
			text: '为需要登录的网站配置登录信息。URL模式支持通配符，如 "https://example.com/*"',
			cls: 'setting-item-description'
		});

		// 显示现有配置
		this.plugin.settings.loginConfigs.forEach((config, index) => {
			this.renderLoginConfig(containerEl, config, index);
		});

		// 添加新配置按钮
		new Setting(containerEl)
			.addButton(button => button
				.setButtonText('添加登录配置')
				.setCta()
				.onClick(() => {
					const newConfig: LoginConfig = {
						urlPattern: '',
						username: '',
						password: '',
						cookies: '',
						userAgent: ''
					};
					this.plugin.settings.loginConfigs.push(newConfig);
					this.plugin.saveSettings();
					this.display(); // 重新渲染
				}));
	}

	renderLoginConfig(containerEl: HTMLElement, config: LoginConfig, index: number): void {
		const configContainer = containerEl.createDiv('login-config-container');
		configContainer.style.border = '1px solid var(--background-modifier-border)';
		configContainer.style.padding = '1rem';
		configContainer.style.marginBottom = '1rem';
		configContainer.style.borderRadius = '4px';

		const header = configContainer.createDiv();
		header.style.display = 'flex';
		header.style.justifyContent = 'space-between';
		header.style.alignItems = 'center';
		header.style.marginBottom = '0.5rem';
		
		header.createEl('h4', {text: `配置 #${index + 1}`});
		
		const deleteButton = header.createEl('button', {text: '删除'});
		deleteButton.style.marginLeft = 'auto';
		deleteButton.onclick = () => {
			this.plugin.settings.loginConfigs.splice(index, 1);
			this.plugin.saveSettings();
			this.display();
		};

		new Setting(configContainer)
			.setName('URL模式')
			.setDesc('匹配的URL模式，如 "https://example.com/*"')
			.addText(text => text
				.setPlaceholder('https://example.com/*')
				.setValue(config.urlPattern)
				.onChange(async (value) => {
					config.urlPattern = value;
					await this.plugin.saveSettings();
				}));

		new Setting(configContainer)
			.setName('用户名')
			.setDesc('登录用户名（可选）')
			.addText(text => text
				.setPlaceholder('username')
				.setValue(config.username || '')
				.onChange(async (value) => {
					config.username = value;
					await this.plugin.saveSettings();
				}));

		new Setting(configContainer)
			.setName('密码')
			.setDesc('登录密码（可选）')
			.addText(text => {
				text.setPlaceholder('password')
					.setValue(config.password || '');
				text.inputEl.type = 'password';
				text.onChange(async (value) => {
					config.password = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(configContainer)
			.setName('Cookies')
			.setDesc('Cookie字符串，格式: "key1=value1; key2=value2"（可选）')
			.addTextArea(text => text
				.setPlaceholder('key1=value1; key2=value2')
				.setValue(config.cookies || '')
				.onChange(async (value) => {
					config.cookies = value;
					await this.plugin.saveSettings();
				}));

		new Setting(configContainer)
			.setName('User-Agent')
			.setDesc('自定义User-Agent（可选）')
			.addText(text => text
				.setPlaceholder('Mozilla/5.0...')
				.setValue(config.userAgent || '')
				.onChange(async (value) => {
					config.userAgent = value;
					await this.plugin.saveSettings();
				}));
	}
}
