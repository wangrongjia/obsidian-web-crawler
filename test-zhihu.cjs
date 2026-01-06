// 测试知乎爬取
const http = require('http');
const fs = require('fs');

const zhihuUrl = 'https://www.zhihu.com/question/299434830/answer/1329278982';
const proxyUrl = 'http://127.0.0.1:7897';
// 请在这里设置你的知乎 Cookie（从浏览器开发者工具中复制）
const zhihuCookies = ''; // 例如: 'SESSIONID=xxx; xxx=xxx'

console.log('========================================');
console.log('测试知乎爬取');
console.log('========================================');
console.log('URL:', zhihuUrl);
console.log('代理:', proxyUrl);
if (zhihuCookies) {
	console.log('Cookie:', zhihuCookies.substring(0, 50) + '...');
}
console.log('');

const requestData = {
	url: zhihuUrl,
	proxy: proxyUrl
};

// 如果设置了 Cookie，添加到请求中
if (zhihuCookies) {
	requestData.cookies = zhihuCookies;
}

const postData = JSON.stringify(requestData);

const options = {
	hostname: 'localhost',
	port: 3737,
	path: '/crawl',
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		'Content-Length': Buffer.byteLength(postData)
	},
	timeout: 90000
};

const req = http.request(options, (res) => {
	let data = '';
	res.on('data', (chunk) => { data += chunk; });
	res.on('end', () => {
		try {
			const result = JSON.parse(data);

			if (result.success) {
				const html = result.html;

				console.log('');
				console.log('========================================');
				console.log('✓ 爬取成功！');
				console.log('========================================');
				console.log('HTML 长度:', html.length);

				// 提取标题
				const titleMatch = html.match(/<h1[^>]*class=["'][^"']*QuestionHeader-title["'][^>]*>([^<]+)<\/h1>/i);
				const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : '未找到标题';

				console.log('标题:', title);

				// 提取问题
				const questionMatch = html.match(/<span[^>]*class=["'][^"']*QuestionRichText-questionTick["'][^>]*>([\s\S]*?)<\/span>/i);
				if (questionMatch && questionMatch[1]) {
					const question = questionMatch[1].replace(/<[^>]+>/g, '').trim();
					console.log('问题:', question.substring(0, 100) + '...');
				}

				// 保存 HTML
				const htmlFile = `zhihu-test-${Date.now()}.html`;
				fs.writeFileSync(htmlFile, html, 'utf8');
				console.log('');
				console.log('✓ 已保存 HTML 到:', htmlFile);

			} else {
				console.error('✗ 爬取失败:', result.error);
			}
		} catch (e) {
			console.error('✗ 解析响应失败:', e.message);
		}
	});
});

req.on('error', (error) => {
	console.error('✗ 请求失败:', error.message);
	console.error('');
	console.error('请先启动本地服务器: node server.cjs');
});

req.write(postData);
req.end();
