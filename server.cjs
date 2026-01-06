/**
 * Playwright 本地服务器
 *
 * 用于在 Obsidian 插件无法运行 Playwright 的环境中提供 Twitter/X 爬取服务
 *
 * 启动方法：node server.js [端口号]
 * 默认端口：3737
 *
 * 使用方法：
 * POST http://localhost:3737/crawl
 * Body: { "url": "https://x.com/user/status/xxx", "proxy": "http://127.0.0.1:7897" }
 */

const http = require('http');
const { chromium } = require('playwright');

const PORT = process.argv[2] || 3737;

console.log('========================================');
console.log('Playwright 本地服务器');
console.log('========================================');
console.log(`端口: ${PORT}`);
console.log('');

// 创建服务器
const server = http.createServer(async (req, res) => {
	// 设置 CORS
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	// 处理 OPTIONS 预检请求
	if (req.method === 'OPTIONS') {
		res.writeHead(200);
		res.end();
		return;
	}

	// 只处理 POST 请求到 /crawl
	if (req.method === 'POST' && req.url === '/crawl') {
		let body = '';

		req.on('data', chunk => {
			body += chunk.toString();
		});

		req.on('end', async () => {
			try {
				const { url, proxy, cookies } = JSON.parse(body);

				if (!url) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: '缺少 URL 参数' }));
					return;
				}

				console.log(`[${new Date().toLocaleTimeString()}] 收到请求: ${url}`);
				if (proxy) console.log(`代理: ${proxy}`);
				if (cookies) console.log(`Cookie: ${cookies.substring(0, 50)}...`);

				// 使用 Playwright 爬取
				const result = await crawlWithPlaywright(url, proxy, cookies);

				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					success: true,
					...result
				}));

				console.log(`✓ 爬取成功，内容长度: ${result.html.length}`);
				console.log('');

			} catch (error) {
				console.error('✗ 爬取失败:', error.message);

				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({
					success: false,
					error: error.message
				}));
			}
		});

	} else {
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not Found' }));
	}
});

/**
 * 使用 Playwright 爬取网页
 */
async function crawlWithPlaywright(url, proxyUrl, cookies) {
	const browser = await chromium.launch({
		headless: true,
		args: [
			'--disable-blink-features=AutomationControlled'
		]
	});

	try {
		const contextOptions = {
			userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			viewport: { width: 1920, height: 1080 },
			locale: 'zh-CN',
			timezoneId: 'Asia/Shanghai',
			// 添加更多浏览器权限和特征
			permissions: ['geolocation', 'notifications'],
			// 禁用自动化检测
			javaScriptEnabled: true,
		};

		// 配置代理
		if (proxyUrl) {
			contextOptions.proxy = { server: proxyUrl };
		}

		const context = await browser.newContext(contextOptions);

		// 如果提供了 cookies，设置到浏览器上下文中
		if (cookies) {
			// 解析 cookie 字符串，格式: "key1=value1; key2=value2"
			const cookieArray = cookies.split(';').map(cookie => {
				const [name, value] = cookie.trim().split('=');
				return {
					name: name.trim(),
					value: value || '',
					domain: url.includes('zhihu.com') ? '.zhihu.com' : undefined,
					path: '/',
					httpOnly: true,
					secure: url.startsWith('https'),
					sameSite: 'Lax' as const
				};
			}).filter(cookie => cookie.name); // 过滤掉空的 cookie

			if (cookieArray.length > 0) {
				await context.addCookies(cookieArray);
				console.log(`✓ 已设置 ${cookieArray.length} 个 Cookie`);
			}
		}

		// 添加初始化脚本，隐藏 webdriver 特征
		await context.addInitScript(() => {
			Object.defineProperty(navigator, 'webdriver', {
				get: () => false,
			});

			Object.defineProperty(navigator, 'plugins', {
				get: () => [1, 2, 3, 4, 5],
			});

			Object.defineProperty(navigator, 'languages', {
				get: () => ['zh-CN', 'zh', 'en'],
			});

			window.chrome = {
				runtime: {},
			};
		});

		const page = await context.newPage();

		// 访问页面
		await page.goto(url, {
			waitUntil: 'domcontentloaded',
			timeout: 60000
		});

		// Twitter/X 特殊处理
		if (url.includes('x.com') || url.includes('twitter.com')) {
			try {
				await page.waitForSelector('[data-testid="tweetText"]', { timeout: 15000 });
				console.log('✓ 找到推文内容');
			} catch (e) {
				await page.waitForTimeout(3000);
			}
		} else if (url.includes('zhihu.com')) {
			// 知乎特殊处理
			try {
				// 等待知乎内容加载
				await page.waitForSelector('.Post-RichText, .RichContent-inner, .QuestionHeader-title', { timeout: 15000 });
				console.log('✓ 找到知乎内容');
			} catch (e) {
				console.log('⚠️ 未找到知乎内容选择器，继续...');
				await page.waitForTimeout(3000);
			}
		} else {
			await page.waitForTimeout(3000);
		}

		// 获取 HTML
		const html = await page.content();

		await context.close();
		return { html };
	} finally {
		await browser.close();
	}
}

// 启动服务器
server.listen(PORT, () => {
	console.log(`✓ 服务器已启动: http://localhost:${PORT}`);
	console.log('');
	console.log('使用方法:');
	console.log(`curl -X POST http://localhost:${PORT}/crawl \\`);
	console.log(`  -H "Content-Type: application/json" \\`);
	console.log(`  -d '{"url": "https://x.com/user/status/123", "proxy": "http://127.0.0.1:7897"}'`);
	console.log('');
	console.log('按 Ctrl+C 停止服务器');
	console.log('========================================');
});

// 优雅退出
process.on('SIGINT', () => {
	console.log('\n\n正在关闭服务器...');
	server.close(() => {
		console.log('✓ 服务器已关闭');
		process.exit(0);
	});
});
