// 简单测试 Twitter/X 爬取
const { chromium } = require('playwright');

async function testTwitter() {
	const tweetUrl = 'https://x.com/yfx0202/status/1740390649730310230';
	const proxyUrl = 'http://127.0.0.1:7897';

	console.log('========================================');
	console.log('测试 Twitter/X 爬取');
	console.log('========================================');
	console.log('URL:', tweetUrl);
	console.log('代理:', proxyUrl);
	console.log('');

	const browser = await chromium.launch({
		headless: true,
		proxy: { server: proxyUrl }
	});

	try {
		const context = await browser.newContext({
			userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
			viewport: { width: 1920, height: 1080 }
		});

		const page = await context.newPage();

		console.log('正在访问页面...');
		await page.goto(tweetUrl, {
			waitUntil: 'domcontentloaded',
			timeout: 60000
		});

		console.log('DOM 已加载，等待推文内容...');

		// 等待推文文本
		try {
			await page.waitForSelector('[data-testid="tweetText"]', { timeout: 15000 });
			console.log('✓ 找到推文内容');
		} catch (e) {
			console.log('⚠️ 未找到推文选择器，继续...');
			await page.waitForTimeout(3000);
		}

		// 提取推文内容
		const tweetText = await page.evaluate(() => {
			const tweetElement = document.querySelector('[data-testid="tweetText"]');
			return tweetElement ? tweetElement.innerText : '';
		});

		// 提取作者信息
		const authorInfo = await page.evaluate(() => {
			const usernameElement = document.querySelector('[data-testid="User-Names"] span');
			const username = usernameElement ? usernameElement.innerText : '';

			const handleElement = document.querySelector('[data-testid="User-Names"] [dir="ltr"]');
			const handle = handleElement ? handleElement.innerText : '';

			return { username, handle };
		});

		// 提取时间
		const timeInfo = await page.evaluate(() => {
			const timeElement = document.querySelector('time');
			return timeElement ? timeElement.getAttribute('datetime') : '';
		});

		// 提取图片
		const images = await page.evaluate(() => {
			const imgElements = document.querySelectorAll('img[src*="twimg.com"]');
			const urls = [];
			imgElements.forEach(img => {
				const src = img.getAttribute('src');
				if (src && !src.includes('profile_image') && !src.includes('emoji')) {
					urls.push(src);
				}
			});
			return urls;
		});

		console.log('');
		console.log('========================================');
		console.log('爬取成功！');
		console.log('========================================');
		console.log('作者:', authorInfo.username, authorInfo.handle);
		console.log('时间:', timeInfo);
		console.log('');
		console.log('推文内容:');
		console.log(tweetText);
		console.log('');
		console.log('图片数量:', images.length);

		// 保存为 Markdown
		const fs = require('fs');
		let markdown = `# ${authorInfo.username || 'Twitter 帖子'}\n\n`;
		if (authorInfo.username) markdown += `**作者:** ${authorInfo.username}\n\n`;
		if (authorInfo.handle) markdown += `**用户名:** ${authorInfo.handle}\n\n`;
		if (timeInfo) markdown += `**发布时间:** ${timeInfo}\n\n`;
		markdown += `---\n\n${tweetText}\n\n`;

		if (images.length > 0) {
			markdown += `## 图片\n\n`;
			images.forEach((img, i) => {
				markdown += `![图片${i + 1}](${img})\n\n`;
			});
		}

		const fileName = `twitter-${Date.now()}.md`;
		fs.writeFileSync(fileName, markdown, 'utf8');
		console.log('✓ 已保存到:', fileName);

		// 保存截图
		await page.screenshot({ path: `twitter-${Date.now()}.png`, fullPage: true });
		console.log('✓ 已保存截图');

		await context.close();
	} catch (error) {
		console.error('');
		console.error('爬取失败:', error.message);
		console.error('');
		console.error('提示:');
		console.error('1. 确保已安装 playwright: npm install playwright');
		console.error('2. 确保代理运行在 http://127.0.0.1:7897');
		console.error('3. 尝试手动访问该 URL 确认可访问');
	} finally {
		await browser.close();
	}
}

testTwitter().catch(console.error);
