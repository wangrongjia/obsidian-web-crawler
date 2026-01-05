import { Notice } from 'obsidian';
import { LoginConfig, WebCrawlerPluginSettings } from './settings';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';

// 导入turndown
import TurndownService from 'turndown';

export class WebCrawler {
	private turndownService: TurndownService;

	constructor() {
		if (!TurndownService) {
			throw new Error('TurndownService未加载，请确保已安装turndown依赖');
		}
		this.turndownService = new TurndownService({
			headingStyle: 'atx',
			codeBlockStyle: 'fenced',
			fence: '```',
			bulletListMarker: '-',
			emDelimiter: '*',
			strongDelimiter: '**',
		});

		// 配置turndown规则
		this.turndownService.addRule('strikethrough', {
			filter: ['del', 's'],
			replacement: (content) => {
				return '~~' + content + '~~';
			}
		});
	}

	/**
	 * 检查URL是否匹配配置的模式
	 */
	private matchesPattern(url: string, pattern: string): boolean {
		if (!pattern) return false;
		
		// 将通配符模式转换为正则表达式
		const regexPattern = pattern
			.replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // 转义特殊字符
			.replace(/\*/g, '.*');  // 将*转换为.*
		
		const regex = new RegExp('^' + regexPattern + '$');
		return regex.test(url);
	}

	/**
	 * 查找匹配的登录配置
	 */
	private findLoginConfig(url: string, loginConfigs: LoginConfig[]): LoginConfig | undefined {
		return loginConfigs.find(config => this.matchesPattern(url, config.urlPattern));
	}

	/**
	 * 解析Cookie字符串为对象
	 */
	private parseCookies(cookieString: string): Record<string, string> {
		const cookies: Record<string, string> = {};
		if (!cookieString) return cookies;

		cookieString.split(';').forEach(cookie => {
			const [key, value] = cookie.trim().split('=');
			if (key && value) {
				cookies[key] = value;
			}
		});

		return cookies;
	}

	/**
	 * 将Cookie对象转换为字符串
	 */
	private formatCookies(cookies: Record<string, string>): string {
		return Object.entries(cookies)
			.map(([key, value]) => `${key}=${value}`)
			.join('; ');
	}

	/**
	 * 获取Electron的代理设置
	 */
	private async getElectronProxy(url: string): Promise<string | null> {
		try {
			const electron = (window as any).require?.('electron');
			if (electron && electron.session) {
				const session = electron.session.defaultSession;
				if (session && session.resolveProxy) {
					return new Promise((resolve) => {
						session.resolveProxy(url, (proxy: string) => {
							// proxy格式可能是 "PROXY 127.0.0.1:7890" 或 "DIRECT"
							if (proxy && proxy !== 'DIRECT' && proxy.startsWith('PROXY')) {
								const proxyMatch = proxy.match(/PROXY\s+([^\s]+)/);
								if (proxyMatch && proxyMatch[1]) {
									resolve(`http://${proxyMatch[1]}`);
								} else {
									resolve(null);
								}
							} else {
								resolve(null);
							}
						});
					});
				}
			}
		} catch (error) {
			console.error('获取代理设置失败:', error);
		}
		return null;
	}

	/**
	 * 使用Electron的net模块获取网页内容（支持系统代理）
	 */
	private async fetchWithElectronNet(urlString: string, headers: Record<string, string>, settings: WebCrawlerPluginSettings): Promise<string> {
		// 尝试使用Electron的net模块，它会自动使用系统代理
		const electron = (window as any).require?.('electron');
		if (electron && electron.net) {
			return new Promise((resolve, reject) => {
				try {
					const request = electron.net.request({
						method: 'GET',
						url: urlString,
						headers: headers,
						useSessionCookies: true, // 使用会话cookie
					});

					let timeoutId: NodeJS.Timeout | null = null;
					
					request.on('response', (response: any) => {
						// 清除超时
						if (timeoutId) {
							clearTimeout(timeoutId);
						}

						// 处理重定向
						if (response.statusCode >= 300 && response.statusCode < 400) {
							const location = response.headers.location;
							if (location) {
								const redirectUrl = location.startsWith('http') ? location : new URL(location, urlString).href;
								return resolve(this.fetchWithElectronNet(redirectUrl, headers, settings));
							}
						}

						if (response.statusCode >= 400) {
							reject(new Error(`HTTP错误: ${response.statusCode}`));
							return;
						}

						let data = '';
						response.on('data', (chunk: Buffer) => {
							data += chunk.toString('utf8');
						});

						response.on('end', () => {
							resolve(data);
						});

						response.on('error', (error: Error) => {
							reject(error);
						});
					});

					request.on('error', (error: Error) => {
						if (timeoutId) {
							clearTimeout(timeoutId);
						}
						reject(error);
					});

					// 设置超时
					timeoutId = setTimeout(() => {
						request.abort();
						reject(new Error('请求超时'));
					}, 60000); // 60秒超时

					request.end();
				} catch (error) {
					reject(error);
				}
			});
		}

		// 如果Electron net不可用，回退到Node.js http/https（尝试使用系统代理）
		return this.fetchWithNode(urlString, headers, settings);
	}

	/**
	 * 使用Node.js http/https模块获取网页内容（尝试使用系统代理）
	 */
	private async fetchWithNode(urlString: string, headers: Record<string, string>, settings: WebCrawlerPluginSettings): Promise<string> {
		return new Promise(async (resolve, reject) => {
			try {
				const urlObj = new URL(urlString);
				const isHttps = urlObj.protocol === 'https:';
				const httpModule = isHttps ? https : http;

				// 确定要使用的代理
				// 优先级：手动配置的代理 > Electron系统代理 > 环境变量代理
				let proxyUrl: string | null = null;

				if (settings.proxyUrl) {
					// 如果手动配置了代理，优先使用
					proxyUrl = settings.proxyUrl;
					console.log('使用手动配置的代理:', proxyUrl);
				} else if (settings.useSystemProxy) {
					// 否则尝试从系统获取代理
					proxyUrl = await this.getElectronProxy(urlString);
					if (!proxyUrl) {
						// 如果Electron代理获取失败，尝试环境变量
						const envProxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy;
						proxyUrl = envProxy || null;
					}
					if (proxyUrl) {
						console.log('使用系统/环境变量代理:', proxyUrl);
					}
				}

				if (!proxyUrl) {
					console.log('警告: 未检测到代理配置，请求可能会失败');
				}

				const options: any = {
					method: 'GET',
					headers: headers,
					rejectUnauthorized: false, // 允许自签名证书
					timeout: 60000, // 60秒超时
				};

				// 如果配置了代理，使用代理Agent
				if (proxyUrl) {
					try {
						// 根据目标URL协议选择合适的agent
						if (isHttps) {
							const agent = new HttpsProxyAgent(proxyUrl);
							options.agent = agent;
						} else {
							const agent = new HttpProxyAgent(proxyUrl);
							options.agent = agent;
						}
						console.log('已创建代理Agent，目标URL:', urlString, '代理:', proxyUrl);
					} catch (error) {
						console.error('创建代理Agent失败:', error);
					}
				}

				const req = httpModule.request(urlString, options, (res) => {
					// 处理重定向
					if (res.statusCode && (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)) {
						const location = res.headers.location;
						if (location) {
							// 处理相对路径重定向
							const redirectUrl = location.startsWith('http') ? location : new URL(location, urlString).href;
							return resolve(this.fetchWithNode(redirectUrl, headers, settings));
						}
					}

					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(`HTTP错误: ${res.statusCode} ${res.statusMessage || ''}`));
						return;
					}

					let data = '';
					res.setEncoding('utf8');
					res.on('data', (chunk) => {
						data += chunk;
					});
					res.on('end', () => {
						resolve(data);
					});
				});

				req.on('error', (error) => {
					reject(error);
				});

				req.on('timeout', () => {
					req.destroy();
					reject(new Error('请求超时'));
				});

				req.end();
			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * 爬取网页内容
	 */
	async fetchWebContent(url: string, loginConfigs: LoginConfig[], settings: WebCrawlerPluginSettings): Promise<{ title: string; content: string; html: string }> {
		try {
			const loginConfig = this.findLoginConfig(url, loginConfigs);
			
			// 构建请求头
			const headers: Record<string, string> = {
				'User-Agent': loginConfig?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
				'Connection': 'keep-alive',
				'Upgrade-Insecure-Requests': '1',
			};

			// 添加Cookie
			if (loginConfig?.cookies) {
				headers['Cookie'] = loginConfig.cookies;
			}

			// 优先使用Electron的net模块（支持系统代理），否则使用Node.js http/https
			const html = await this.fetchWithElectronNet(url, headers, settings);
			
			// 解析HTML获取标题和内容
			const { title, content } = this.extractContent(html, url);

			// 将HTML转换为Markdown
			const markdown = this.turndownService.turndown(content || html);

			return {
				title: title || '未命名',
				content: markdown,
				html: html
			};
		} catch (error) {
			console.error('爬取网页失败:', error);
			throw new Error(`爬取失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * 从HTML中提取标题和主要内容
	 */
	private extractContent(html: string, url: string): { title: string; content: string } {
		// 使用简单的DOM解析（在Electron环境中可以使用DOMParser）
		// 但由于Obsidian可能没有完整的DOM API，我们使用正则表达式提取

		// 提取标题
		let title = '';
		const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
		if (titleMatch && titleMatch[1]) {
			title = this.stripHtmlTags(titleMatch[1]).trim();
		}

		// 如果没有title标签，尝试从h1获取
		if (!title) {
			const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
			if (h1Match && h1Match[1]) {
				title = this.stripHtmlTags(h1Match[1]).trim();
			}
		}

		// 提取主要内容 - 尝试找到main、article或content相关的标签
		let content = html;
		
		// 尝试提取article标签
		const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
		if (articleMatch && articleMatch[1]) {
			content = articleMatch[1];
		} else {
			// 尝试提取main标签
			const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
			if (mainMatch && mainMatch[1]) {
				content = mainMatch[1];
			} else {
				// 尝试提取id或class包含content的div
				const contentDivMatch = html.match(/<div[^>]*(?:id|class)=["'](?:[^"']*content[^"']*)["'][^>]*>([\s\S]*?)<\/div>/i);
				if (contentDivMatch && contentDivMatch[1]) {
					content = contentDivMatch[1];
				} else {
					// 尝试提取body标签内容
					const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
					if (bodyMatch && bodyMatch[1]) {
						content = bodyMatch[1];
					}
				}
			}
		}

		// 移除script和style标签
		content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
		content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
		content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

		return { title, content };
	}

	/**
	 * 移除HTML标签（简单版本）
	 */
	private stripHtmlTags(html: string): string {
		return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
			.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'");
	}

	/**
	 * 生成文件名（基于标题）
	 */
	generateFileName(title: string): string {
		// 移除非法字符
		let fileName = title
			.replace(/[<>:"/\\|?*]/g, '')  // 移除Windows非法字符
			.replace(/\s+/g, ' ')  // 合并多个空格
			.trim();

		// 限制长度
		if (fileName.length > 100) {
			fileName = fileName.substring(0, 100);
		}

		// 如果文件名为空，使用时间戳
		if (!fileName) {
			fileName = `网页内容_${Date.now()}`;
		}

		return fileName;
	}
}

