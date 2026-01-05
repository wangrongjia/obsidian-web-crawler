// 快速测试图片链接
const http = require('http');
const fs = require('fs');

const tweetUrl = 'https://x.com/yfx0202/status/1740390649730310230';
const proxyUrl = 'http://127.0.0.1:7897';

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
	res.on('data', (chunk) => { data += chunk; });
	res.on('end', () => {
		const result = JSON.parse(data);
		if (result.success) {
			const html = result.html;

			// 提取推文文本
			const tweetTextMatch = html.match(/<div[^>]*data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/div>/i);
			let tweetText = '';
			if (tweetTextMatch && tweetTextMatch[1]) {
				tweetText = tweetTextMatch[1].replace(/<[^>]+>/g, '').trim();
			}

			// 提取图片
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

			// 生成文件名
			let fileName = 'Twitter 帖子';
			if (tweetText) {
				const lines = tweetText.split('\n');
				const firstLine = lines[0] ? lines[0].trim() : '';
				const shortTitle = firstLine.length > 30 ? firstLine.substring(0, 30) : firstLine;
				fileName = shortTitle.replace(/[<>:"/\\|?*]/g, '').trim() || 'Twitter 帖子';
			}

			// 构建 Markdown
			let markdown = `# ${fileName}\n\n`;
			markdown += `**来源:** [${tweetUrl}](${tweetUrl})\n\n`;
			markdown += `---\n\n`;
			markdown += tweetText + '\n\n';

			if (images.length > 0) {
				markdown += `## 图片\n\n`;
				images.forEach((url, i) => {
					markdown += `![图片${i + 1}](${url})\n\n`;
				});
			}

			// 保存文件
			const outputFile = `test-final-${Date.now()}.md`;
			fs.writeFileSync(outputFile, markdown, 'utf8');

			console.log('✓ 已保存到:', outputFile);
			console.log('');
			console.log('图片数量:', images.length);
			console.log('文件名:', fileName);
			console.log('');
			console.log('检查图片链接格式：');
			console.log(markdown.match(/!\[.*?\]\(.*?\)/g)?.slice(0, 3));
		}
	});
});

req.on('error', (error) => {
	console.error('✗ 请求失败:', error.message);
	console.error('请先启动服务器: node server.cjs');
});

req.write(postData);
req.end();
