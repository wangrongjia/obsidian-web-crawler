// 测试 Twitter 图片和文件名功能
const http = require('http');
const fs = require('fs');

const tweetUrl = 'https://x.com/yfx0202/status/1740390649730310230';
const proxyUrl = 'http://127.0.0.1:7897';

console.log('========================================');
console.log('测试 Twitter 图片和文件名功能');
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
				const html = result.html;

				console.log('');
				console.log('========================================');
				console.log('✓ 爬取成功！');
				console.log('========================================');

				// 测试图片提取
				console.log('');
				console.log('1. 测试图片提取：');
				const imageMatches = html.matchAll(/<img[^>]*src=["']([^"']*pbs\.twimg\.com\/media\/[^"']*)["'][^>]*>/gi);
				const images = [];
				const seenUrls = new Set();

				for (const match of imageMatches) {
					if (match[1]) {
						let imageUrl = match[1].replace(/&amp;/g, '&');
						const baseUrl = imageUrl.split('?')[0];

						if (baseUrl && !seenUrls.has(baseUrl)) {
							seenUrls.add(baseUrl);
							const largeUrl = imageUrl.replace(/name=\w+/, 'name=4096x4096');
							images.push(largeUrl);
						}
					}
				}

				console.log(`找到 ${images.length} 张图片：`);
				images.forEach((url, i) => {
					console.log(`  ${i + 1}. ${url}`);
				});

				// 测试文本提取和文件名
				console.log('');
				console.log('2. 测试文件名生成：');
				const tweetTextMatch = html.match(/<div[^>]*data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/div>/i);
				let tweetText = '';
				if (tweetTextMatch && tweetTextMatch[1]) {
					tweetText = tweetTextMatch[1].replace(/<[^>]+>/g, '').trim();
				}

				if (tweetText) {
					const lines = tweetText.split('\n');
					const firstLine = lines[0] ? lines[0].trim() : '';
					const shortTitle = firstLine.length > 30 ? firstLine.substring(0, 30) : firstLine;
					const fileName = shortTitle.replace(/[<>:"/\\|?*]/g, '').trim();

					console.log(`推文第一行: "${firstLine}"`);
					console.log(`生成的文件名: "${fileName}.md"`);
				} else {
					console.log('未找到推文文本');
				}

				// 保存测试文件
				console.log('');
				console.log('3. 保存测试文件：');

				// 提取作者
				const authorMatch = html.match(/<span[^>]*class=["'][^"']*username[^"']*["'][^>]*>[\s\S]*?<span[^>]*>(@[^<]+)<\/span>/i);
				const author = authorMatch ? authorMatch[1] : '';

				const displayNameMatch = html.match(/<span[^>]*class=["'][^"']*css-901oao[^"']*["'][^>]*>([^<]+)<\/span>\s*<span[^>]*class=["'][^"']*username[^"']*["']/i);
				const displayName = displayNameMatch && displayNameMatch[1] ? displayNameMatch[1].trim() : '';

				const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
				const time = timeMatch ? timeMatch[1] : '';

				// 生成文件名
				let fileName = 'Twitter 帖子';
				if (tweetText) {
					const lines = tweetText.split('\n');
					const firstLine = lines[0] ? lines[0].trim() : '';
					const shortTitle = firstLine.length > 30 ? firstLine.substring(0, 30) : firstLine;
					fileName = shortTitle.replace(/[<>:"/\\|?*]/g, '').trim() || (displayName && author ? `${displayName} ${author}` : 'Twitter 帖子');
				}

				// 构建 Markdown
				let markdown = `# ${fileName}\n\n`;
				if (displayName) markdown += `**作者:** ${displayName}\n\n`;
				if (author) markdown += `**用户名:** ${author}\n\n`;
				if (time) markdown += `**发布时间:** ${time}\n\n`;
				markdown += `---\n\n${tweetText}\n\n`;

				if (images.length > 0) {
					markdown += `## 图片\n\n`;
					images.forEach((url, i) => {
						markdown += `![图片${i + 1}](${url})\n\n`;
					});
				}

				const outputFile = `test-twitter-${Date.now()}.md`;
				fs.writeFileSync(outputFile, markdown, 'utf8');
				console.log(`✓ 已保存到: ${outputFile}`);

				console.log('');
				console.log('========================================');
				console.log('🎉 测试完成！');
				console.log('========================================');
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

req.on('timeout', () => {
	req.destroy();
	console.error('✗ 请求超时');
});

req.write(postData);
req.end();
