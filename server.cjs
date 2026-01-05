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
				const { url, proxy } = JSON.parse(body);

				if (!url) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: '缺少 URL 参数' }));
					return;
				}

				console.log(`[${new Date().toLocaleTimeString()}] 收到请求: ${url}`);
				if (proxy) console.log(`代理: ${proxy}`);

				// 使用 Playwright 爬取
				const result = await crawlWithPlaywright(url, proxy);

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
async function crawlWithPlaywright(url, proxyUrl) {
	const browser = await chromium.launch({
		headless: true,
	});

	try {
		const contextOptions = {
			userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
			viewport: { width: 1920, height: 1080 }
		};

		// 配置代理
		if (proxyUrl) {
			contextOptions.proxy = { server: proxyUrl };
		}

		const context = await browser.newContext(contextOptions);
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
			} catch (e) {
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
