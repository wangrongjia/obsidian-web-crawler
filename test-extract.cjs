// 测试内容提取逻辑
const fs = require('fs');

const html = fs.readFileSync('v2ex-response.html', 'utf8');

// 测试提取逻辑
const v2exMatch = html.match(/<div[^>]*class=["'][^"']*topic_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

if (v2exMatch) {
	console.log('✓ 找到 topic_content');
	console.log('内容:', v2exMatch[1]);
} else {
	console.log('✗ 未找到 topic_content');
}

// 也测试回复提取
const replyMatches = html.matchAll(/<div[^>]*class=["']reply_content["'][^>]*>([\s\S]*?)<\/div>/gi);
const replies = [];
for (const match of replyMatches) {
	replies.push(match[1].trim());
}

console.log('\n找到', replies.length, '条回复');
if (replies.length > 0) {
	console.log('前3条回复:');
	replies.slice(0, 3).forEach((reply, i) => {
		console.log(`\n回复 ${i + 1}:`, reply);
	});
}
