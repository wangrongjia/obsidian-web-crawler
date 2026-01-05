import {App, Notice, PluginSettingTab, Setting} from "obsidian";
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

		containerEl.createEl('h2', {text: '网页爬取设置'});

		// 代理设置
		containerEl.createEl('h3', {text: '代理设置'});

		new Setting(containerEl)
			.setName('使用系统代理')
			.setDesc('自动使用系统或浏览器的代理设置（适用于 Electron 环境）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useSystemProxy)
				.onChange(async (value) => {
					this.plugin.settings.useSystemProxy = value;
					await this.plugin.saveSettings();
				}));

		// 快捷选择常见代理
		new Setting(containerEl)
			.setName('快捷配置代理')
			.setDesc('选择常见的代理配置（自动填入下方代理服务器地址）')
			.addDropdown(dropdown => dropdown
				.addOption('custom', '自定义')
				.addOption('clash_verge', 'Clash Verge - HTTP (127.0.0.1:7897)')
				.addOption('clash_http', 'Clash - HTTP (127.0.0.1:7890)')
				.addOption('clash_socks5', 'Clash - SOCKS5 (127.0.0.1:7891)')
				.addOption('v2ray_http', 'V2RayN - HTTP (127.0.0.1:10809)')
				.addOption('v2ray_socks5', 'V2RayN - SOCKS5 (127.0.0.1:10808)')
				.addOption('env', '使用环境变量 (HTTP_PROXY/HTTPS_PROXY)')
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
						case 'env':
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
					if (proxyUrl) {
						this.plugin.settings.proxyUrl = proxyUrl;
						await this.plugin.saveSettings();
						// 刷新界面以显示新值
						this.display();
					}
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

		// 代理测试按钮
		new Setting(containerEl)
			.setName('测试代理连接')
			.setDesc('测试当前代理配置是否可用（访问 google.com）')
			.addButton(button => button
				.setButtonText('测试代理')
				.onClick(async () => {
					const testButton = button;
					testButton.setDisabled(true);
					testButton.setButtonText('测试中...');

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
						testButton.setButtonText('测试代理');
					}
				}));

		containerEl.createEl('hr');

		// 内容提取选项
		new Setting(containerEl)
			.setName('包含回复内容')
			.setDesc('对于论坛类网站（如 V2EX），是否包含评论/回复内容')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeReplies)
				.onChange(async (value) => {
					this.plugin.settings.includeReplies = value;
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

	/**
	 * 测试代理连接
	 */
	async testProxy(settings: WebCrawlerPluginSettings): Promise<boolean> {
		const https = require('https');
		const { HttpsProxyAgent } = require('https-proxy-agent');

		console.log('========== 开始测试代理 ==========');
		console.log('代理配置:', settings.proxyUrl);
		console.log('使用系统代理:', settings.useSystemProxy);

		return new Promise((resolve) => {
			try {
				const options: any = {
					method: 'GET',
					hostname: 'www.google.com',
					path: '/',
					rejectUnauthorized: false,
					timeout: 15000, // 增加超时时间到15秒
				};

				// 配置代理
				if (settings.proxyUrl) {
					try {
						const agent = new HttpsProxyAgent(settings.proxyUrl);
						options.agent = agent;
						console.log('✓ 代理Agent已创建:', settings.proxyUrl);
					} catch (error) {
						console.error('✗ 创建代理Agent失败:', error);
						resolve(false);
						return;
					}
				} else {
					console.log('⚠ 未配置代理URL');
					if (settings.useSystemProxy) {
						console.log('⚠ 仅启用了系统代理，但Obsidian中可能无法直接使用');
					}
				}

				console.log('开始发送请求到 google.com...');
				const req = https.request(options, (res: any) => {
					console.log('✓ 收到响应，状态码:', res.statusCode);
					req.destroy();
					if (res.statusCode && (res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302)) {
						console.log('✓ 代理测试成功！');
						resolve(true);
					} else {
						console.log('✗ 代理测试失败，状态码:', res.statusCode);
						resolve(false);
					}
				});

				req.on('error', (error: Error) => {
					req.destroy();
					console.error('✗ 请求错误:', error.message);
					console.error('✗ 错误堆栈:', error.stack);
					resolve(false);
				});

				req.on('timeout', () => {
					req.destroy();
					console.error('✗ 请求超时（15秒）');
					resolve(false);
				});

				req.end();
			} catch (error) {
				console.error('✗ 代理测试异常:', error);
				resolve(false);
			}
		});
	}
}
