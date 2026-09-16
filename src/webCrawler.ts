import { Notice, requestUrl } from 'obsidian';
import { LoginConfig, WebCrawlerPluginSettings } from './settings';
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
			console.debug(`Found login config: ${matchedConfig.urlPattern}`);
		} else {
			console.debug(`No matching login config found for URL: ${url}`);
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
	 * 使用 Obsidian 的 requestUrl API 获取网页内容（不受 CORS 限制）
	 */
	private async fetchWithElectronNet(urlString: string, headers: Record<string, string>, settings: WebCrawlerPluginSettings): Promise<string> {
		return this.fetchWithNode(urlString, headers, settings);
	}

	/**
	 * 使用 Obsidian 的 requestUrl API 获取网页内容（不受 CORS 限制）
	 */
	private async fetchWithNode(urlString: string, headers: Record<string, string>, settings: WebCrawlerPluginSettings): Promise<string> {
		try {
			const response = await requestUrl({
				url: urlString,
				method: 'GET',
				headers: headers,
			});
			return response.text;
		} catch (error) {
			// Obsidian 的 requestUrl 会在 HTTP 错误时抛出异常
			if (error instanceof Object && 'status' in error) {
				const err = error as { status: number; message: string };
				throw new Error(`HTTP error: ${err.status} ${err.message || ''}`);
			}
			throw error;
		}
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

			// 检查是否需要使用 Playwright（Twitter/X 等动态网页）
			const needsPlaywright = this.needsPlaywright(url);
			let html: string;

			if (needsPlaywright) {
				console.debug('Detected dynamic webpage, using Playwright (via local server)');
				html = await this.fetchWithPlaywright(url, headers, settings);
			} else {
				// 优先使用Electron的net模块（支持系统代理），否则使用 fetch API
				html = await this.fetchWithElectronNet(url, headers, settings);
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
					console.debug(`Showing ${replies.length} replies (${replies.filter(r => r.likes > 0).length} with likes)`);

					// 将回复构建为 HTML，然后统一转换为 Markdown
					let i = 0;
					const repliesHtml = replies.map((r) => {
						const likeBadge = r.likes > 0 ? ` <span style="color: #ff6b6b; font-weight: bold;">❤️ ${r.likes}</span>` : '';
						return `<h3> ${++i} ${r.author}${likeBadge}</h3>\n\n${r.content}`;
					}).join('\n\n<hr>\n\n');

					finalHtmlContent = content + `\n\n<h2>回复（${replies.length} 条）</h2>\n\n` + repliesHtml;
				} else {
					console.debug('No replies found');
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
			console.debug('V2EX post has no reply count info, no pagination needed');
			return firstPageHtml;
		}

		const totalReplies = parseInt(replyCountMatch[1]);
		console.debug(`V2EX post has ${totalReplies} replies total`);

		// 每页100条回复，计算需要多少页
		const repliesPerPage = 100;
		const totalPages = Math.ceil(totalReplies / repliesPerPage);

		if (totalPages < 2) {
			console.debug('Replies not超过 100, no pagination needed');
			return firstPageHtml;
		}

		console.debug(`Need to fetch ${totalPages} pages`);

		// 去掉 URL 中的 hash 部分（#replyxxx），并去掉已有的查询参数
		const urlWithoutHash = url.split('#')[0] || url;
		const baseUrl = urlWithoutHash.split('?')[0] || urlWithoutHash;

		// 获取所有分页的回复（只用 fetch API）
		for (let page = 2; page <= totalPages; page++) {
			try {
				const pageUrl = `${baseUrl}?p=${page}`;
				console.debug(`Fetching page ${page}/${totalPages}: ${pageUrl}`);

				// 使用 fetch API 获取分页
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
					console.debug(`Merged page ${page} replies`);
				} else {
					console.debug(`Page ${page} has no reply content`);
				}

				// 等待一下，避免请求过快
				await new Promise(resolve => setTimeout(resolve, 500));
			} catch (error) {
				console.error(`Failed to fetch page ${page}:`, error);
				// 继续获取下一页
			}
		}

		console.debug('Merged all paginated replies');
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
					console.debug(`Extracted reply: ${author} ❤️ ${likes}`);
				}
			}
		}

		console.debug(`Extracted ${replies.length} replies total, ${replies.filter(r => r.likes > 0).length} with likes`);
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
						console.debug('Extracted title from Reddit URL:', title);
					}
				}
			} catch (e) {
				console.debug('Failed to extract Reddit title from URL, trying other methods');
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
		// V2EX 结构：<div class="cell"><div class="topic_content">...</div></div>
		// 提取 cell 标签下的 topic_content
		let v2exMatch = html.match(/<div[^>]*class=["'][^"']*cell[^"']*["'][^>]*>\s*<div[^>]*class=["'][^"']*topic_content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
		if (v2exMatch && v2exMatch[1]) {
			// 检查是否包含登录提示，如果包含则跳过
			const hasLoginHint = v2exMatch[1].includes('需要登录') || v2exMatch[1].includes('登录后');
			if (!hasLoginHint) {
				content = v2exMatch[1];
				isV2EX = true;
				console.debug('Using V2EX cell > topic_content structure');
			} else {
				console.debug('Skipping topic_content with login hint');
			}
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
					console.debug('Using V2EX topic_content (normal structure)');
				} else {
					console.debug('Skipping topic_content with login hint');
				}
			}
		}

		// 2. 尝试提取 article 标签
		if (!content) {
			const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
			if (articleMatch && articleMatch[1]) {
				content = articleMatch[1];
				console.debug('Using article tag');
			}
		}

		// 3. 尝试提取 main 标签
		if (!content) {
			const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
			if (mainMatch && mainMatch[1]) {
				content = mainMatch[1];
				console.debug('Using main tag');
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
					console.debug('Using generic content pattern');
					break;
				}
			}
		}

		// 5. 最后尝试提取 body 标签内容（排除导航等）
		if (!content) {
			const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
			if (bodyMatch && bodyMatch[1]) {
				content = bodyMatch[1];
				console.debug('Using body tag, may include unrelated content');
			}
		}

		if (!content) {
			console.debug('Could not extract content, using original HTML');
			content = html;
		}

		// 移除script和style标签
		content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
		content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
		content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

		// 知乎图片特殊处理：将 data-actualsrc 转换为 src
		if (url.includes('zhihu.com')) {
			// 知乎使用懒加载，真实图片URL在 data-actualsrc 中
			content = content.replace(/<img[^>]*data-actualsrc=["']([^"']+)["'][^>]*>/gi, (_match, url: string) => {
				return `<img src="${url}" />`;
			});
			console.debug('Processed zhihu lazy-loaded images');
		}

		console.debug(`Extracted content length: ${content.length}`);

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
		// 查找匹配的登录配置（获取cookies）
		let cookies: string | undefined;
		for (const config of settings.loginConfigs) {
			try {
				const pattern = config.urlPattern.replace(/\*/g, '.*');
				const regex = new RegExp(pattern);
				if (regex.test(url) && config.cookies) {
					cookies = config.cookies;
					console.debug(`Found matching cookie config: ${config.urlPattern}`);
					break;
				}
			} catch (e) {
				// 忽略无效的正则表达式
			}
		}

		try {
			const postData = JSON.stringify({
				url: url,
				proxy: settings.proxyUrl || undefined,
				cookies: cookies
			});

			const response = await requestUrl({
				url: 'http://localhost:3737/crawl',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: postData,
			});

			const result = JSON.parse(response.text);
			if (result.success) {
				console.debug(`Local server returned content, length: ${result.html.length}`);
				return result.html;
			} else {
				throw new Error(result.error || '爬取失败');
			}
		} catch (error) {
			throw new Error(`Local server connection failed: ${error instanceof Error ? error.message : String(error)}\nPlease run: node server.js`);
		}
	}

	/**
	 * 使用Playwright获取动态网页内容（通过本地服务器）
	 */
	private async fetchWithPlaywright(url: string, headers: Record<string, string>, settings: WebCrawlerPluginSettings): Promise<string> {
		console.debug('Using Playwright (via local server) to crawl dynamic content...');

		try {
			// 尝试通过本地服务器
			return await this.fetchWithLocalServer(url, settings);
		} catch (error) {
			throw new Error(
				`Playwright server unavailable\n` +
				`Please run: node server.js\n` +
				`Error: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * 提取Twitter/X内容 - 手动解析版本
	 * 支持文字和图片交叉排列
	 */
	private extractTwitterContent(html: string): { title: string; content: string } {
		// 尝试旧的 tweetText 元素（向后兼容）
		let tweetTextMatch = html.match(/<div[^>]*data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/div>/i);

		if (tweetTextMatch && tweetTextMatch[1]) {
			// 旧结构：使用原来的逻辑
			const tweetText = tweetTextMatch[1].replace(/<[^>]+>/g, '').trim();
			return this.extractTwitterContentOld(html, tweetText);
		}

		// 新的 X 页面结构：文字和图片交叉排列
		// 找到第一个 tweet 元素
		const tweetPos = html.indexOf('data-testid="tweet"');
		if (tweetPos === -1) {
			return this.extractTwitterContentOld(html, '');
		}

		const afterAttrPos = tweetPos + 'data-testid="tweet"'.length;
		const tagEndPos = html.indexOf('>', afterAttrPos);
		if (tagEndPos === -1) {
			return this.extractTwitterContentOld(html, '');
		}

		const contentStart = tagEndPos + 1;
		// 扩大范围确保捕获完整推文
		const tweetSection = html.substring(contentStart, contentStart + 150000);

		// 步骤1：找到所有图片的位置
		const imagePositions: { url: string; pos: number }[] = [];
		const imgPattern = /<img[^>]*src=["']([^"']*pbs\.twimg\.com\/media\/[^"']*)["'][^>]*>/gi;
		let imgMatch: RegExpExecArray | null;
		while ((imgMatch = imgPattern.exec(tweetSection)) !== null) {
			if (imgMatch[1]) {
				let imageUrl = imgMatch[1].replace(/&amp;/g, '&');
				// 去重（提取基础URL）
				const baseUrl = imageUrl.split('?')[0];
				if (baseUrl && !imagePositions.some(img => img.url.split('?')[0] === baseUrl)) {
					imagePositions.push({ url: imageUrl, pos: imgMatch.index });
				}
			}
		}

		// 步骤2：按图片位置分割，提取每段的文字
		type Checkpoint = { type: 'start'; pos: number } | { type: 'image'; pos: number; url: string; index: number } | { type: 'end'; pos: number };

		const checkpoints: Checkpoint[] = [
			{ type: 'start' as const, pos: 0 },
			...imagePositions.map((img, i) => ({ type: 'image' as const, pos: img.pos, url: img.url, index: i })),
			{ type: 'end' as const, pos: tweetSection.length }
		];

		interface ContentSegment {
			type: 'text' | 'image';
			content: string;
		}

		const segments: ContentSegment[] = [];

		for (let i = 0; i < checkpoints.length - 1; i++) {
			const current = checkpoints[i];
			const next = checkpoints[i + 1];
			if (!current || !next) continue;

			// 如果当前是图片，添加图片段
			if (current.type === 'image') {
				const largeUrl = current.url.replace(/name=\w+/, 'name=large');
				segments.push({ type: 'image', content: `![图片](${largeUrl})` });
			}

			// 提取两点之间的文字
			const segment = tweetSection.substring(current.pos, next.pos);

			// 清理HTML，提取纯文字
			const text = segment
				.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
				.replace(/<path[^>]*>/gi, '')
				.replace(/<svg[^>]*>/gi, '')
				.replace(/<\/svg>/gi, '')
				.replace(/<use[^>]*>/gi, '')
				.replace(/<g[^>]*>/gi, '')
				.replace(/<\/g>/gi, '')
				.replace(/d="[^"]*"/gi, '')
				.replace(/<img[^>]*>/gi, '')
				.replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
				.replace(/<time[^>]*>[\s\S]*?<\/time>/gi, '')
				.replace(/<section[^>]*>/gi, '')
				.replace(/<\/section>/gi, '')
				.replace(/<h2[^>]*>/gi, '\n\n## ')
				.replace(/<\/h2>/gi, '\n\n')
				.replace(/<div[^>]*>/gi, '')
				.replace(/<\/div>/gi, '')
				.replace(/<span[^>]*>/gi, '')
				.replace(/<\/span>/gi, '')
				.replace(/<a[^>]*>/gi, '')
				.replace(/<\/a>/gi, '')
				.replace(/<br\s*\/?>/gi, '\n')
				.replace(/http\S+/g, '')
				.replace(/&nbsp;/g, ' ')
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&quot;/g, '"')
				.replace(/\s+/g, ' ')
				.trim();

			// 只保留有意义的文字（包含中文或英文，且长度大于5）
			if (text.length > 5 && (/[\u4e00-\u9fa5]/.test(text) || /[a-zA-Z]{3,}/.test(text))) {
				segments.push({ type: 'text', content: text });
			}
		}

		// 步骤3：清理文字段，移除元数据
		// 找到实际内容的开始位置（跳过用户信息和统计数据）
		let contentStartIndex = 0;
		const statsPatterns = [
			/\d{1,3}[,\d]*\s+\d{1,3}\s+[\d,]+\s+\d+[万千KMB]/i,
			/\d{1,3}\s+\d{1,3}\s+[\d,]+/,
		];

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			if (!seg || seg.type !== 'text') continue;

			// 跳过用户信息段（包含@用户名）
			if (seg.content.includes('@') && seg.content.length < 50) {
				contentStartIndex = i + 1;
				continue;
			}

			// 检查是否包含统计数据
			let hasStats = false;
			for (const pattern of statsPatterns) {
				if (pattern.test(seg.content) && seg.content.length < 100) {
					contentStartIndex = i + 1;
					hasStats = true;
					break;
				}
			}
			if (!hasStats) {
				break;
			}
		}

		// 步骤4：处理引用推文的分割
		const finalSegments: ContentSegment[] = [];
		let inQuotedTweet = false;

		for (let i = contentStartIndex; i < segments.length; i++) {
			const seg = segments[i];
			if (!seg) continue;

			if (seg.type !== 'text') {
				finalSegments.push(seg);
				continue;
			}

			// 检查是否遇到引用推文作者信息
			const quoteAuthorPattern = /[\u4e00-\u9fa5\w\s]+@[a-zA-Z0-9_]+\s*·\s*/;
			const quoteMatch = seg.content.match(quoteAuthorPattern);

			if (quoteMatch && quoteMatch.index !== undefined && quoteMatch.index > 10) {
				// 在此处分割
				const beforeQuote = seg.content.substring(0, quoteMatch.index).trim();
				const afterQuote = seg.content.substring(quoteMatch.index + quoteMatch[0].length).trim();

				if (beforeQuote) {
					finalSegments.push({ type: 'text', content: beforeQuote });
				}

				// 添加分隔符
				finalSegments.push({ type: 'text', content: '\n\n--- 引用推文 ---\n' });

				// 清理引用内容开头可能的日期
				const datePattern = /^\d{1,2}月\d{1,2}日\s*/;
				const cleanedAfterQuote = afterQuote.replace(datePattern, '').trim();

				if (cleanedAfterQuote) {
					finalSegments.push({ type: 'text', content: cleanedAfterQuote });
				}

				inQuotedTweet = true;
			} else {
				finalSegments.push(seg);
			}
		}

		// 步骤5：构建最终内容
		let tweetText = finalSegments
			.map(seg => {
				if (seg.type === 'image') {
					return '\n\n' + seg.content + '\n\n';
				}
				return seg.content;
			})
			.join('')
			.trim();

		// 移除末尾的无用信息和残留的元数据
		const uselessPatterns = [
			/<br data-text="true">/g,
			/<article>/g,
			/<\/article>/g,
			/想发布自己的文章.*$/m,
			/升级为Premium.*$/m,
			/的新用户\?.*$/m,
			/立即注册.*$/m,
			/·\s*\d+\.?\d*[万千KMB]?\s*查看.*$/m,  // 匹配 "·29.5万 查看"
			/\s+查看$/m,
			/\d{1,2}:\d{2}\s*[AP]M.*$/m,
		];
		for (const pattern of uselessPatterns) {
			tweetText = tweetText.replace(pattern, '');
		}

		// 清理多余的空白
		tweetText = tweetText.replace(/\n{3,}/g, '\n\n').trim();

		return this.extractTwitterContentOld(html, tweetText);
	}

	/**
	 * 提取Twitter/X内容 - 旧版逻辑（用于构建最终输出）
	 */
	private extractTwitterContentOld(html: string, tweetText: string): { title: string; content: string } {

		// 尝试提取作者信息 - 支持新的X页面结构
		let author = '';
		let displayName = '';

		// 新方法：查找 data-testid="User-Name" 内的链接
		const userNameMatch = html.match(/data-testid="User-Name"[^>]*>[\s\S]*?<a[^>]*href="\/[^\/]+">[\s\S]*?@([a-zA-Z0-9_]+)/i);
		if (userNameMatch && userNameMatch[1]) {
			author = '@' + userNameMatch[1];
		} else {
			// 旧方法：查找 username class
			const oldAuthorMatch = html.match(/<span[^>]*class=["'][^"']*username[^"']*["'][^>]*>[\s\S]*?<span[^>]*>(@[^<]+)<\/span>/i);
			author = oldAuthorMatch && oldAuthorMatch[1] ? oldAuthorMatch[1] : '';
		}

		// 新方法：查找 User-Name 内的显示名称
		const nameMatch = html.match(/data-testid="User-Name"[^>]*>[\s\S]*?<a[^>]*href="\/[^\/]+"[^>]*>([\s\S]*?)<\/a>[\s\S]*?@/i);
		if (nameMatch && nameMatch[1]) {
			// 提取显示名称（去除标签）
			displayName = nameMatch[1].replace(/<[^>]+>/g, '').trim();
		} else {
			// 旧方法
			const oldDisplayNameMatch = html.match(/<span[^>]*class=["'][^"']*css-901oao[^"']*["'][^>]*>([^<]+)<\/span>\s*<span[^>]*class=["'][^"']*username[^"']*["']/i);
			displayName = oldDisplayNameMatch && oldDisplayNameMatch[1] ? oldDisplayNameMatch[1].trim() : '';
		}

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

		// 如果 tweetText 中已经包含图片（markdown 格式），则不再单独提取图片
		// 只有在 tweetText 不包含图片时才提取
		const hasImagesInText = tweetText.includes('![') && tweetText.includes('pbs.twimg.com');

		if (!hasImagesInText) {
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

