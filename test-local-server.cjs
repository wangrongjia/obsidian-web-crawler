// 测试本地服务器 + Obsidian 插件的完整流程
const http = require('http');

const tweetUrl = 'https://x.com/yfx0202/status/1740390649730310230';
const proxyUrl = 'http://127.0.0.1:7897';

console.log('========================================');
console.log('测试本地服务器');
console.log('========================================');
console.log('URL:', tweetUrl);
console.log('代理:', proxyUrl);
console.log('');

// 测试本地服务器是否运行
const testOptions = {
	hostname: 'localhost',
	port: 3737,
	path: '/',
	method: 'GET',
	timeout: 5000
};

const testReq = http.request(testOptions, (res) => {
	console.log('✓ 本地服务器正在运行');
	console.log('');

	// 发送爬取请求
	crawlTwitter();
});

testReq.on('error', (error) => {
	console.error('✗ 本地服务器未运行！');
	console.error('');
	console.error('请先启动本地服务器：');
	console.error('  Windows: 双击 start-server.bat');
	console.error('  或运行: node server.js');
	console.error('');
});

testReq.end();

function crawlTwitter() {
	console.log('========================================');
	console.log('发送爬取请求...');
	console.log('========================================');

	const postData = JSON.stringify({
		url: tweetUrl,
		proxy: proxyUrl
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
		timeout: 90000
	};

	const req = http.request(options, (res) => {
		let data = '';

		res.on('data', (chunk) => {
			data += chunk;
		});

		res.on('end', () => {
			try {
				const result = JSON.parse(data);

				if (result.success) {
					console.log('');
					console.log('========================================');
					console.log('✓ 爬取成功！');
					console.log('========================================');
					console.log('HTML 长度:', result.html.length);

					// 简单提取推文文本
					const tweetMatch = result.html.match(/<div[^>]*data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/div>/i);
					if (tweetMatch && tweetMatch[1]) {
						const tweetText = tweetMatch[1].replace(/<[^>]+>/g, '').trim();
						console.log('');
						console.log('推文内容预览：');
						console.log(tweetText.substring(0, 200) + '...');
					}

					// 保存 HTML
					const fs = require('fs');
					const fileName = `test-server-${Date.now()}.html`;
					fs.writeFileSync(fileName, result.html, 'utf8');
					console.log('');
					console.log('✓ 已保存 HTML 到:', fileName);

					console.log('');
					console.log('========================================');
					console.log('🎉 测试完成！');
					console.log('========================================');
					console.log('');
					console.log('现在可以在 Obsidian 中使用 Twitter 爬取功能了！');
					console.log('确保本地服务器（start-server.bat）一直运行。');
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
	});

	req.on('timeout', () => {
		req.destroy();
		console.error('✗ 请求超时');
	});

	req.write(postData);
	req.end();
}
