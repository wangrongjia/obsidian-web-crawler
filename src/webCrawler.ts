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

		const regex = new RegExp('^' + regexPattern + '$', 'i');  // 添加 'i' 标志，忽略大小写
		const matched = regex.test(url);

		if (!matched) {
			// 尝试标准化 URL 后再匹配（处理 www 的问题）
			const normalizedPattern = pattern.replace('://www.', '://').replace('://', '://(www\\.)?');
			const normalizedRegex = new RegExp('^' + normalizedPattern + '$', 'i');
			return normalizedRegex.test(url);
		}

		return matched;
	}

	/**
	 * 查找匹配的登录配置
	 */
	private findLoginConfig(url: string, loginConfigs: LoginConfig[]): LoginConfig | undefined {
		const matchedConfig = loginConfigs.find(config => this.matchesPattern(url, config.urlPattern));

		if (matchedConfig) {
			console.log(`✓ 找到登录配置: ${matchedConfig.urlPattern}`);
		} else {
			console.log(`⚠️ 未找到匹配的登录配置，URL: ${url}`);
			console.log(`   可用配置: ${loginConfigs.map(c => c.urlPattern).join(', ')}`);
		}

		return matchedConfig;
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
				console.log(`✓ 已添加 Cookie，长度: ${loginConfig.cookies.length}`);
			} else {
				console.log(`⚠️ 未配置 Cookie`);
			}

			// 检查是否需要使用 Playwright（Twitter/X 等动态网页）
			const needsPlaywright = this.needsPlaywright(url);
			let html: string;

			if (needsPlaywright) {
				console.log('✓ 检测到动态网页，使用 Playwright（通过本地服务器）');
				html = await this.fetchWithPlaywright(url, headers, settings);
			} else {
				// 优先使用Electron的net模块（支持系统代理），否则使用Node.js http/https
				html = await this.fetchWithElectronNet(url, headers, settings);
			}

			// 调试：保存原始HTML到插件目录
			try {
				const fs = require('fs');
				const path = require('path');
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
				const debugFile = path.join(process.cwd(), `debug-${timestamp}.html`);
				fs.writeFileSync(debugFile, html, 'utf8');
				console.log(`✓ 已保存原始HTML到: ${debugFile}`);
			} catch (err) {
				console.log(`⚠️ 无法保存调试HTML: ${err instanceof Error ? err.message : String(err)}`);
			}

			// 如果是 V2EX 帖子，尝试获取所有分页的回复
			if (url.includes('v2ex.com/t/')) {
				html = await this.fetchAllV2EXPages(url, headers, settings, html);
			}

			// 解析HTML获取标题和内容
			let title: string;
			let content: string;

			// Twitter/X 使用特殊的内容提取
			if (url.includes('//x.com') || url.includes('twitter.com')) {
				const extracted = this.extractTwitterContent(html);
				title = extracted.title;
				content = extracted.content;
			} else {
				// 其他网站使用通用提取
				const extracted = this.extractContent(html, url);
				title = extracted.title;
				content = extracted.content;
			}

			// 检查是否为 V2EX 并提取回复
			let finalHtmlContent = content;
			if (settings.includeReplies && url.includes('v2ex.com')) {
				const replies = this.extractV2EXReplies(html);

				if (replies.length > 0) {
					console.log(`✓ 显示 ${replies.length} 条回复（其中 ${replies.filter(r => r.likes > 0).length} 条有点赞）`);

					// 将回复构建为 HTML，然后统一转换为 Markdown
					let i = 0;
					const repliesHtml = replies.map((r) => {
						const likeBadge = r.likes > 0 ? ` <span style="color: #ff6b6b; font-weight: bold;">❤️ ${r.likes}</span>` : '';
						return `<h3> ${++i} ${r.author}${likeBadge}</h3>\n\n${r.content}`;
					}).join('\n\n<hr>\n\n');

					finalHtmlContent = content + `\n\n<h2>回复（${replies.length} 条）</h2>\n\n` + repliesHtml;
				} else {
					console.log(`⚠️ 没有回复`);
				}
			}

			// 将HTML转换为Markdown
			// 注意：Twitter/X 的 content 已经是 Markdown 格式，不需要再转换
			let markdown: string;
			if (url.includes('//x.com') || url.includes('twitter.com')) {
				// Twitter 的内容已经手动格式化好了，直接使用
				markdown = content;
			} else {
				// 其他网站需要转换 HTML 为 Markdown
				markdown = this.turndownService.turndown(finalHtmlContent || html);
			}

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
	 * 获取 V2EX 帖子的所有分页回复
	 */
	private async fetchAllV2EXPages(url: string, headers: Record<string, string>, settings: WebCrawlerPluginSettings, firstPageHtml: string): Promise<string> {
		// 从"XX 条回复"或"XX replies"中提取总回复数（支持中英文）
		const replyCountMatch = firstPageHtml.match(/(\d+)\s*(条回复|replies|reply)/i);
		if (!replyCountMatch || !replyCountMatch[1]) {
			console.log('✓ V2EX 帖子无回复数信息，无需分页');
			return firstPageHtml;
		}

		const totalReplies = parseInt(replyCountMatch[1]);
		console.log(`✓ V2EX 帖子共有 ${totalReplies} 条回复`);

		// 每页100条回复，计算需要多少页
		const repliesPerPage = 100;
		const totalPages = Math.ceil(totalReplies / repliesPerPage);

		if (totalPages < 2) {
			console.log('✓ 回复未超过100条，无需分页');
			return firstPageHtml;
		}

		console.log(`✓ 需要拉取 ${totalPages} 页内容`);

		// 去掉 URL 中的 hash 部分（#replyxxx），并去掉已有的查询参数
		const urlWithoutHash = url.split('#')[0] || url;
		const baseUrl = urlWithoutHash.split('?')[0] || urlWithoutHash;
		console.log(`基础URL: ${baseUrl}`);

		// 获取所有分页的回复（只用 Node.js 方式，带代理）
		for (let page = 2; page <= totalPages; page++) {
			try {
				const pageUrl = `${baseUrl}?p=${page}`;
				console.log(`正在获取第 ${page}/${totalPages} 页: ${pageUrl}`);

				// 使用 Node.js 方式获取分页（带代理）
				const pageHtml = await this.fetchWithNode(pageUrl, headers, settings);

				// 提取所有回复 div（从第一个回复开始到 Bottom 之前）
				// 使用字符串查找而不是正则，更可靠
				const repliesStart = pageHtml.indexOf('<div id="r_');
				const bottomPos = pageHtml.indexOf('<div id="Bottom">');

				if (repliesStart !== -1 && bottomPos !== -1 && bottomPos > repliesStart) {
					// 提取所有回复内容
					const allReplies = pageHtml.substring(repliesStart, bottomPos);
					// 将回复插入到第一页的 <div id="Bottom"> 之前
					firstPageHtml = firstPageHtml.replace(/(<div id="Bottom">)/, allReplies + '\n$1');
					console.log(`✓ 已合并第 ${page} 页的回复`);
				} else {
					console.log(`⚠️ 第 ${page} 页未找到回复内容`);
				}

				// 等待一下，避免请求过快
				await new Promise(resolve => setTimeout(resolve, 500));
			} catch (error) {
				console.error(`获取第 ${page} 页失败:`, error);
				// 继续获取下一页
			}
		}

		console.log(`✓ 已合并所有分页的回复`);
		return firstPageHtml;
	}

	/**
	 * 提取 V2EX 回复内容
	 */
	private extractV2EXReplies(html: string): Array<{ author: string; content: string; likes: number }> {
		const replies: Array<{ author: string; content: string; likes: number }> = [];

		// 匹配每个回复区块 - 使用更简单的模式
		const replyBlockPattern = /<div[^>]*id=["']r_\d+["'][^>]*class=["'][^"']*cell[^"']*["'][^>]*>[\s\S]*?<\/table>[\s\S]*?<\/div>/gi;

		const authorPattern = /<strong><a[^>]*href=["']\/member\/([^"']+)["'][^>]*class=["'][^"']*dark[^"']*["'][^>]*>([^<]*)<\/a><\/strong>/i;
		const contentPattern = /<div[^>]*class=["'][^"']*reply_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
		// 匹配点赞信息：<span class="small fade"><img ... alt="❤️" /> 数字</span>
		const likePattern = /<span class=["']small fade["'][^>]*>[\s\S]*?<img[^>]*alt=["']❤️["'][^>]*>\s*(\d+)[\s\S]*?<\/span>/i;

		let match;
		while ((match = replyBlockPattern.exec(html)) !== null) {
			const block = match[0] || '';

			// 提取作者
			const authorMatch = block.match(authorPattern);
			let author = '匿名';
			if (authorMatch) {
				const authorName = authorMatch[2] && authorMatch[2].trim() ? authorMatch[2].trim() : authorMatch[1];
				author = authorName || '匿名';
			}

			// 提取内容
			const contentMatch = block.match(contentPattern);
			const content = contentMatch && contentMatch[1] ? contentMatch[1] : '';

			// 提取点赞数
			const likeMatch = block.match(likePattern);
			const likes = likeMatch && likeMatch[1] ? parseInt(likeMatch[1]) : 0;

			// 只保存有内容的回复
			if (content.trim()) {
				replies.push({
					author,
					content: content.trim(),
					likes
				});

				if (likes > 0) {
					console.log(`提取回复: ${author} ❤️ ${likes}`);
				}
			}
		}

		console.log(`✓ 总共提取 ${replies.length} 条回复，其中 ${replies.filter(r => r.likes > 0).length} 条有点赞`);
		return replies;
	}

	/**
	 * 从HTML中提取标题和主要内容
	 */
	private extractContent(html: string, url: string): { title: string; content: string } {
		// 使用简单的DOM解析（在Electron环境中可以使用DOMParser）
		// 但由于Obsidian可能没有完整的DOM API，我们使用正则表达式提取

		// 提取标题
		let title = '';

		// Reddit 特殊处理：从 URL 中直接提取标题
		if (url.includes('reddit.com')) {
			try {
				// Reddit URL 格式: https://www.reddit.com/r/subreddit/comments/post_id/title/
				const urlParts = url.split('/').filter(part => part.length > 0);
				// 找到 comments 部分，之后的部分就是 post_id 和 title
				const commentsIndex = urlParts.findIndex(part => part === 'comments');
				if (commentsIndex !== -1 && commentsIndex + 2 < urlParts.length) {
					// title 在 comments 后面的第二个位置
					const encodedTitle = urlParts[commentsIndex + 2];
					if (encodedTitle) {
						// URL decode
						title = decodeURIComponent(encodedTitle).replace(/_/g, ' ');
						console.log('✓ 从 Reddit URL 提取标题:', title);
					}
				}
			} catch (e) {
				console.log('⚠️ 从 URL 提取 Reddit 标题失败，尝试其他方法');
			}
		}

		// 通用标题提取
		if (!title) {
			const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
			if (titleMatch && titleMatch[1]) {
				title = this.stripHtmlTags(titleMatch[1]).trim();
			}
		}

		// 如果没有title标签，尝试从h1获取
		if (!title) {
			const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
			if (h1Match && h1Match[1]) {
				title = this.stripHtmlTags(h1Match[1]).trim();
			}
		}

		// 提取主要内容 - 按优先级尝试不同的匹配方式
		let content = '';
		let isV2EX = false;

		// 1. 优先尝试 V2EX 特定的 topic_content（处理需要登录的情况）
		// 先尝试匹配嵌套结构的正文内容：<div class="topic_content"><div class="markdown_body">
		let v2exMatch = html.match(/<div[^>]*class=["'][^"']*topic_content[^"']*["'][^>]*>\s*<div[^>]*class=["'][^"']*markdown_body[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
		if (v2exMatch && v2exMatch[1]) {
			content = v2exMatch[1];
			isV2EX = true;
			console.log('✓ 使用 V2EX topic_content (嵌套结构) 提取');
		}

		// 如果没找到，尝试匹配普通结构：<div class="topic_content">内容</div>
		if (!content) {
			v2exMatch = html.match(/<div[^>]*class=["'][^"']*topic_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
			if (v2exMatch && v2exMatch[1]) {
				// 检查是否包含登录提示，如果包含则跳过
				const hasLoginHint = v2exMatch[1].includes('需要登录') || v2exMatch[1].includes('登录后');
				if (!hasLoginHint) {
					content = v2exMatch[1];
					isV2EX = true;
					console.log('✓ 使用 V2EX topic_content (普通结构) 提取');
				} else {
					console.log('⚠️ 跳过包含登录提示的 topic_content');
				}
			}
		}

		// 2. 尝试提取 article 标签
		if (!content) {
			const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
			if (articleMatch && articleMatch[1]) {
				content = articleMatch[1];
				console.log('✓ 使用 article 标签提取');
			}
		}

		// 3. 尝试提取 main 标签
		if (!content) {
			const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
			if (mainMatch && mainMatch[1]) {
				content = mainMatch[1];
				console.log('✓ 使用 main 标签提取');
			}
		}

		// 4. 尝试提取特定的高质量内容选择器
		if (!content) {
			// 尝试多种常见的文章内容 class/id 模式
			const patterns = [
				/<div[^>]*class=["'][^"']*post[-_]?content[^"']*["'][^>]*>([\s\S]{100,2000})<\/div>/i,
				/<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
				/<div[^>]*class=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
				/<div[^>]*itemprop=["']articleBody["'][^>]*>([\s\S]*?)<\/div>/i,
			];

			for (const pattern of patterns) {
				const match = html.match(pattern);
				if (match && match[1] && match[1].length > 50) {
					content = match[1];
					console.log('✓ 使用通用内容模式提取');
					break;
				}
			}
		}

		// 5. 最后尝试提取 body 标签内容（排除导航等）
		if (!content) {
			const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
			if (bodyMatch && bodyMatch[1]) {
				content = bodyMatch[1];
				console.log('⚠ 使用 body 标签提取，可能包含无关内容');
			}
		}

		if (!content) {
			console.log('⚠ 未能提取到内容，使用原始 HTML');
			content = html;
		}

		// 移除script和style标签
		content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
		content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
		content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

		// 知乎图片特殊处理：将 data-actualsrc 转换为 src
		if (url.includes('zhihu.com')) {
			// 知乎使用懒加载，真实图片URL在 data-actualsrc 中
			content = content.replace(/<img[^>]*data-actualsrc=["']([^"']+)["'][^>]*>/gi, (match, url) => {
				return `<img src="${url}" />`;
			});
			console.log('✓ 已处理知乎懒加载图片');
		}

		console.log('提取的内容长度:', content.length);

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

	/**
	 * 检测URL是否需要使用Playwright（动态网页）
	 */
	private needsPlaywright(url: string): boolean {
		const playwrightPatterns = [
			/\/\/x\.com/,
			/twitter\.com/,
		];

		return playwrightPatterns.some(pattern => pattern.test(url));
	}

	/**
	 * 通过本地服务器使用 Playwright
	 */
	private async fetchWithLocalServer(url: string, settings: WebCrawlerPluginSettings): Promise<string> {
		const http = require('http');

		// 查找匹配的登录配置（获取cookies）
		let cookies: string | undefined;
		for (const config of settings.loginConfigs) {
			try {
				const pattern = config.urlPattern.replace(/\*/g, '.*');
				const regex = new RegExp(pattern);
				if (regex.test(url) && config.cookies) {
					cookies = config.cookies;
					console.log(`✓ 找到匹配的Cookie配置: ${config.urlPattern}`);
					break;
				}
			} catch (e) {
				// 忽略无效的正则表达式
			}
		}

		return new Promise((resolve, reject) => {
			const postData = JSON.stringify({
				url: url,
				proxy: settings.proxyUrl || undefined,
				cookies: cookies
			});

			const options = {
				hostname: 'localhost',
				port: 3737,
				path: '/crawl',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postData)
				},
				timeout: 90000 // 90秒超时
			};

			const req = http.request(options, (res: any) => {
				let data = '';

				res.on('data', (chunk: any) => {
					data += chunk;
				});

				res.on('end', () => {
					try {
						const result = JSON.parse(data);
						if (result.success) {
							console.log(`✓ 本地服务器返回内容，长度: ${result.html.length}`);
							resolve(result.html);
						} else {
							reject(new Error(result.error || '爬取失败'));
						}
					} catch (e) {
						reject(new Error(`解析响应失败: ${e instanceof Error ? e.message : String(e)}`));
					}
				});
			});

			req.on('error', (error: Error) => {
				reject(new Error(`本地服务器连接失败: ${error.message}\n请先运行: node server.js`));
			});

			req.on('timeout', () => {
				req.destroy();
				reject(new Error('请求超时'));
			});

			req.write(postData);
			req.end();
		});
	}

	/**
	 * 使用Playwright获取动态网页内容（通过本地服务器）
	 */
	private async fetchWithPlaywright(url: string, headers: Record<string, string>, settings: WebCrawlerPluginSettings): Promise<string> {
		console.log('使用 Playwright（通过本地服务器）爬取动态内容...');

		try {
			// 尝试通过本地服务器
			return await this.fetchWithLocalServer(url, settings);
		} catch (error) {
			throw new Error(
				`Playwright 服务器不可用\n` +
				`请先运行: node server.js\n` +
				`错误: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * 提取Twitter/X内容
	 */
	private extractTwitterContent(html: string): { title: string; content: string } {
		// 提取推文文本
		const tweetTextMatch = html.match(/<div[^>]*data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/div>/i);
		let tweetText = '';
		if (tweetTextMatch && tweetTextMatch[1]) {
			// 移除HTML标签获取纯文本
			tweetText = tweetTextMatch[1].replace(/<[^>]+>/g, '').trim();
		}

		// 尝试提取作者信息
		const authorMatch = html.match(/<span[^>]*class=["'][^"']*username[^"']*["'][^>]*>[\s\S]*?<span[^>]*>(@[^<]+)<\/span>/i);
		const author = authorMatch ? authorMatch[1] : '';

		// 尝试提取作者显示名称
		const displayNameMatch = html.match(/<span[^>]*class=["'][^"']*css-901oao[^"']*["'][^>]*>([^<]+)<\/span>\s*<span[^>]*class=["'][^"']*username[^"']*["']/i);
		const displayName = displayNameMatch && displayNameMatch[1] ? displayNameMatch[1].trim() : '';

		// 尝试提取时间
		const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
		const time = timeMatch ? timeMatch[1] : '';

		// 构建标题（用于文件名）
		let title = 'Twitter/X 帖子';
		if (displayName && author) {
			title = `${displayName} ${author}`;
		} else if (author) {
			title = `${author} 的推文`;
		}

		// 构建内容（包含元数据）
		let content = '';
		if (displayName) {
			content += `<p><strong>作者:</strong> ${displayName}</p>\n`;
		}
		if (author) {
			content += `<p><strong>用户名:</strong> ${author}</p>\n`;
		}
		if (time) {
			content += `<p><strong>发布时间:</strong> ${time}</p>\n`;
		}
		content += `<hr>\n\n`;

		if (tweetText) {
			content += `<div>${tweetText}</div>`;
		}

		// 提取图片（Twitter 的推文图片在 media/ 路径下）
		// 注意：HTML 中的 & 会被编码为 &amp;
		const imageMatches = html.matchAll(/<img[^>]*src=["']([^"']*pbs\.twimg\.com\/media\/[^"']*)["'][^>]*>/gi);
		const images: string[] = [];
		const seenUrls = new Set<string>(); // 去重

		for (const match of imageMatches) {
			if (match[1]) {
				// 转换 HTML 实体（&amp; -> &）
				let imageUrl = match[1].replace(/&amp;/g, '&');

				// 去重（同一张图片可能有多个尺寸）
				// 提取基础 URL（移除尺寸参数）
				const baseUrl = imageUrl.split('?')[0];

				if (baseUrl && !seenUrls.has(baseUrl)) {
					seenUrls.add(baseUrl);

					// 尝试获取原图（使用 large 或 4096x4096）
					const largeUrl = imageUrl.replace(/name=\w+/, 'name=4096x4096');
					images.push(`![图片](${largeUrl})`);
				}
			}
		}

		if (images.length > 0) {
			content += '\n\n## 图片\n\n' + images.join('\n\n');
		}

		// 如果有推文文本，尝试从中提取标题（用于文件名）
		if (tweetText) {
			// 获取第一行或前30个字符
			const lines = tweetText.split('\n');
			const firstLine = lines[0] ? lines[0].trim() : '';
			const shortTitle = firstLine.length > 30 ? firstLine.substring(0, 30) : firstLine;

			// 移除非法字符
			title = shortTitle.replace(/[<>:"/\\|?*]/g, '').trim();

			// 如果标题为空，使用作者名
			if (!title) {
				title = displayName && author ? `${displayName} ${author}` :
					author ? `${author} 的推文` :
					'Twitter/X 帖子';
			}
		}

		return { title, content };
	}

}

