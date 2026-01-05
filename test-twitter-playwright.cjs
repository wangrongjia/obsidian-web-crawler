// 测试 Twitter/X 爬取功能
const { WebCrawler } = require('./main.js');

async function testTwitterCrawl() {
	const tweetUrl = 'https://x.com/yfx0202/status/1740390649730310230';

	console.log('========================================');
	console.log('测试 Twitter/X 爬取功能');
	console.log('========================================');
	console.log('URL:', tweetUrl);
	console.log('');

	const crawler = new WebCrawler();

	// 模拟设置（包含代理）
	const settings = {
		proxyUrl: 'http://127.0.0.1:7897',  // Clash Verge 代理
		useSystemProxy: false,
		includeReplies: false,
		savePath: 'WebCrawler'
	};

	const loginConfigs = [];

	try {
		console.log('开始爬取...');
		const result = await crawler.fetchWebContent(tweetUrl, loginConfigs, settings);

		console.log('');
		console.log('========================================');
		console.log('爬取成功！');
		console.log('========================================');
		console.log('标题:', result.title);
		console.log('内容长度:', result.content.length);
		console.log('');
		console.log('内容预览（前500字符）:');
		console.log(result.content.substring(0, 500));
		console.log('');

		// 保存到文件
		const fs = require('fs');
		const fileName = `twitter-test-${Date.now()}.md`;
		const fileContent = `# ${result.title}\n\n${result.content}`;
		fs.writeFileSync(fileName, fileContent, 'utf8');
		console.log('✓ 已保存到:', fileName);

	} catch (error) {
		console.error('');
		console.error('========================================');
		console.error('爬取失败！');
		console.error('========================================');
		console.error('错误:', error.message);
		console.error('');
		console.error('提示:');
		console.error('1. 确保已安装 playwright: npm install playwright');
		console.error('2. 确保代理运行在 http://127.0.0.1:7897');
		console.error('3. 尝试手动访问该 URL 确认可访问');
	}
}

testTwitterCrawl().catch(console.error);
