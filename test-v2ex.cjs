// 测试 V2EX 页面内容提取
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

async function fetchV2EX() {
	const proxyUrl = 'http://127.0.0.1:7897';
	const url = 'https://www.v2ex.com/t/883213';

	console.log('正在获取 V2EX 页面...');
	console.log('URL:', url);
	console.log('代理:', proxyUrl);

	const options = {
		method: 'GET',
		host: 'www.v2ex.com',
		path: '/t/883213',
		rejectUnauthorized: false,
		timeout: 15000,
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
			'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
		}
	};

	try {
		const agent = new HttpsProxyAgent(proxyUrl);
		options.agent = agent;

		const result = await new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				console.log('状态码:', res.statusCode);
				console.log('响应头:', JSON.stringify(res.headers, null, 2));

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
				console.error('请求错误:', error.message);
				reject(error);
			});

			req.on('timeout', () => {
				console.error('请求超时');
				req.destroy();
				reject(new Error('Timeout'));
			});

			req.end();
		});

		// 保存原始 HTML 到文件
		const fs = require('fs');
		fs.writeFileSync('v2ex-response.html', result, 'utf8');
		console.log('HTML 已保存到 v2ex-response.html');

		// 尝试提取标题
		const titleMatch = result.match(/<title[^>]*>([^<]+)<\/title>/i);
		console.log('\n标题:', titleMatch ? titleMatch[1] : '未找到');

		// 尝试查找主要内容区域
		const patterns = [
			{ name: 'article', pattern: /<article[^>]*>([\s\S]*?)<\/article>/i },
			{ name: 'main', pattern: /<main[^>]*>([\s\S]*?)<\/main>/i },
			{ name: 'content class', pattern: /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i },
			{ name: 'content id', pattern: /<div[^>]*id=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i },
			{ name: 'body', pattern: /<body[^>]*>([\s\S]*?)<\/body>/i },
		];

		for (const { name, pattern } of patterns) {
			const match = result.match(pattern);
			if (match) {
				const content = match[1];
				console.log(`\n找到 ${name} 标签，内容长度:`, content.length);
				console.log(`前 200 字符:`, content.substring(0, 200));
			}
		}

		return result;
	} catch (error) {
		console.error('获取失败:', error.message);
		throw error;
	}
}

fetchV2EX().catch(console.error);
