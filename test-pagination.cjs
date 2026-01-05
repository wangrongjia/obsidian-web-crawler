// 测试分页逻辑
const fs = require('fs');

const html = fs.readFileSync('v2ex-response.html', 'utf8');

// 测试提取回复数
const replyCountMatch = html.match(/(\d+)\s*条回复/);
if (replyCountMatch) {
	const totalReplies = parseInt(replyCountMatch[1]);
	console.log('✓ 提取到回复数:', totalReplies);

	const repliesPerPage = 100;
	const totalPages = Math.ceil(totalReplies / repliesPerPage);
	console.log('✓ 每页100条，需要', totalPages, '页');

	if (totalPages < 2) {
		console.log('✓ 回复未超过100条，无需分页');
	} else {
		console.log('✓ 需要拉取', totalPages, '页内容');
	}
} else {
	console.log('✗ 未找到回复数');
}
