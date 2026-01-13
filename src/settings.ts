import {App, Notice, PluginSettingTab, Setting} from "obsidian";
import WebCrawlerPlugin from "./main";

export interface LoginConfig {
	urlPattern: string;  // URL匹配模式，如 "https://example.com/*"
	cookies?: string;    // Cookie字符串，格式: "key1=value1; key2=value2"
	userAgent?: string;  // 自定义User-Agent
}

export interface WebCrawlerPluginSettings {
	savePath: string;  // 保存文件的路径，相对于vault根目录
	loginConfigs: LoginConfig[];  // 登录配置列表
	proxyUrl: string;  // 代理URL，例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:1080
	useSystemProxy: boolean;  // 是否自动使用系统代理
	includeReplies: boolean;  // 是否包含回复内容（适用于论坛类网站）
}

export const DEFAULT_SETTINGS: WebCrawlerPluginSettings = {
	savePath: 'WebCrawler',
	loginConfigs: [],
	proxyUrl: '',
	useSystemProxy: true,
	includeReplies: true  // 默认包含回复
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

		new Setting(containerEl)
			.setName('Web crawler')
			.setHeading();

		// 代理设置
		new Setting(containerEl)
			.setName('Proxy')
			.setHeading();

		new Setting(containerEl)
			.setName('Use system proxy')
			.setDesc('Automatically use system or browser proxy settings (for Electron environment)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useSystemProxy)
				.onChange(async (value) => {
					this.plugin.settings.useSystemProxy = value;
					await this.plugin.saveSettings();
				}));

		// 快捷选择常见代理
		new Setting(containerEl)
			.setName('Quick configure proxy')
			.setDesc('Select common proxy configurations (auto-fill into the proxy server address field below)')
			.addDropdown(dropdown => dropdown
				.addOption('custom', 'Custom')
				.addOption('clash_verge', 'Clash Verge - HTTP (127.0.0.1:7897)')
				.addOption('clash_http', 'Clash - HTTP (127.0.0.1:7890)')
				.addOption('clash_socks5', 'Clash - SOCKS5 (127.0.0.1:7891)')
				.addOption('v2ray_http', 'V2RayN - HTTP (127.0.0.1:10809)')
				.addOption('v2ray_socks5', 'V2RayN - SOCKS5 (127.0.0.1:10808)')
				.addOption('env', 'Use environment variable (HTTP_PROXY/HTTPS_PROXY)')
				.setValue('custom')
				.onChange(async (value) => {
					let proxyUrl = '';
					switch(value) {
						case 'clash_verge':
							proxyUrl = 'http://127.0.0.1:7897';
							break;
						case 'clash_http':
							proxyUrl = 'http://127.0.0.1:7890';
							break;
						case 'clash_socks5':
							proxyUrl = 'socks5://127.0.0.1:7891';
							break;
						case 'v2ray_http':
							proxyUrl = 'http://127.0.0.1:10809';
							break;
						case 'v2ray_socks5':
							proxyUrl = 'socks5://127.0.0.1:10808';
							break;
						case 'env': {
							// 使用环境变量
							const envProxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
							if (envProxy) {
								proxyUrl = envProxy;
								new Notice(`已从环境变量读取代理: ${envProxy}`);
							} else {
								new Notice('⚠️ 未找到环境变量 HTTP_PROXY 或 HTTPS_PROXY');
							}
							break;
						}
					}
					if (proxyUrl) {
						this.plugin.settings.proxyUrl = proxyUrl;
						await this.plugin.saveSettings();
						// 刷新界面以显示新值
						this.display();
					}
				}));

		new Setting(containerEl)
			.setName('Proxy server')
			.setDesc('Manually configure proxy server. Format: http://127.0.0.1:7890 or socks5://127.0.0.1:1080. If set, this proxy will be used instead of system proxy')
			.addText(text => text
				.setPlaceholder('http://127.0.0.1:7890')
				.setValue(this.plugin.settings.proxyUrl)
				.onChange(async (value) => {
					this.plugin.settings.proxyUrl = value;
					await this.plugin.saveSettings();
				}));

		// 代理测试按钮
		new Setting(containerEl)
			.setName('Test proxy connection')
			.setDesc('Test if current proxy configuration works (access google.com)')
			.addButton(button => button
				.setButtonText('Test proxy')
				.onClick(() => {
					void (async () => {
						const testButton = button;
						testButton.setDisabled(true);
						testButton.setButtonText('Testing...');

						try {
							const success = await this.testProxy(this.plugin.settings);
							if (success) {
								new Notice('✅ 代理连接成功！可以访问外网。');
							} else {
								new Notice('❌ 代理连接失败，请检查代理配置。');
							}
						} catch (error) {
							new Notice(`❌ 测试失败: ${error instanceof Error ? error.message : String(error)}`);
						} finally {
							testButton.setDisabled(false);
							testButton.setButtonText('Test proxy');
						}
					})();
				}));

		containerEl.createEl('hr');

		// 内容提取选项
		new Setting(containerEl)
			.setName('Include replies')
			.setDesc('For forum-like websites (e.g., V2EX), whether to include comment/reply content')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeReplies)
				.onChange(async (value) => {
					this.plugin.settings.includeReplies = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('hr');

		// 保存路径设置
		new Setting(containerEl)
			.setName('Save path')
			.setDesc('Crawled content will be saved to this path (relative to vault root)')
			.addText(text => text
				.setPlaceholder('WebCrawler')
				.setValue(this.plugin.settings.savePath)
				.onChange(async (value) => {
					this.plugin.settings.savePath = value || 'WebCrawler';
					await this.plugin.saveSettings();
				}));

		// 登录配置区域
		new Setting(containerEl)
			.setName('Login configuration')
			.setHeading();
		containerEl.createEl('p', {
			text: 'Configure login information for websites that require login. URL pattern supports wildcards, such as "https://example.com/*"',
			cls: 'setting-item-description'
		});

		// 显示现有配置
		this.plugin.settings.loginConfigs.forEach((config, index) => {
			this.renderLoginConfig(containerEl, config, index);
		});

		// 添加新配置按钮
		new Setting(containerEl)
			.addButton(button => button
				.setButtonText('Add login configuration')
				.setCta()
				.onClick(() => {
					const newConfig: LoginConfig = {
						urlPattern: '',
						cookies: '',
						userAgent: ''
					};
					this.plugin.settings.loginConfigs.push(newConfig);
					void this.plugin.saveSettings();
					this.display(); // 重新渲染
				}));
	}

	renderLoginConfig(containerEl: HTMLElement, config: LoginConfig, index: number): void {
		const configContainer = containerEl.createDiv('login-config-container');

		const header = configContainer.createDiv();
		header.addClass('login-config-header');

		const titleText = header.createEl('strong', {text: `Configuration #${index + 1}`});

		const deleteButton = header.createEl('button', {text: 'Delete'});
		deleteButton.addClass('login-config-delete-button');
		deleteButton.onclick = () => {
			this.plugin.settings.loginConfigs.splice(index, 1);
			void this.plugin.saveSettings();
			this.display();
		};

		new Setting(configContainer)
			.setName('URL pattern')
			.setDesc('Match URL pattern, e.g. "https://example.com/*"')
			.addText(text => text
				.setPlaceholder('https://example.com/*')
				.setValue(config.urlPattern)
				.onChange(async (value) => {
					config.urlPattern = value;
					await this.plugin.saveSettings();
				}));

		new Setting(configContainer)
			.setName('Cookies')
			.setDesc('Cookie string, format: "key1=value1; key2=value2" (optional)')
			.addTextArea(text => text
				.setPlaceholder('key1=value1; key2=value2')
				.setValue(config.cookies || '')
				.onChange(async (value) => {
					config.cookies = value;
					await this.plugin.saveSettings();
				}));

		new Setting(configContainer)
			.setName('User-Agent')
			.setDesc('Custom User-Agent (optional)')
			.addText(text => text
				.setPlaceholder('Mozilla/5.0...')
				.setValue(config.userAgent || '')
				.onChange(async (value) => {
					config.userAgent = value;
					await this.plugin.saveSettings();
				}));
	}

	/**
	 * 测试代理连接
	 */
	async testProxy(settings: WebCrawlerPluginSettings): Promise<boolean> {
		// Note: In Obsidian plugin environment, direct Node.js modules are not available
		// This is a simplified test using fetch API
		try {
			const testUrl = 'https://www.google.com';

			// Configure proxy using Electron's session if available
			const electron = (window as any).require?.('electron');
			if (electron && electron.session) {
				const session = electron.session.defaultSession;

				// Set proxy if configured
				if (settings.proxyUrl) {
					const proxyRules = settings.proxyUrl.replace(/^https?:\/\//, '').replace(/^socks5?:\/\//, '');
					await session.setProxy({ proxyRules: `${proxyRules}` });
				}
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 15000);

			const response = await fetch(testUrl, {
				method: 'HEAD',
				signal: controller.signal
			});
			clearTimeout(timeoutId);

			return response.ok || response.redirected || response.status >= 200 && response.status < 400;
		} catch (error) {
			console.error('Proxy test failed:', error);
			return false;
		}
	}
}
