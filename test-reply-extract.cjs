// 测试回复提取
const fs = require('fs');

const html = fs.readFileSync('v2ex-response.html', 'utf8');

// 测试新的正则
const replyBlockPattern = /<div[^>]*id=["']r_\d+["'][^>]*class=["'][^"']*cell[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

let match;
let count = 0;
while ((match = replyBlockPattern.exec(html)) !== null) {
	count++;
	console.log(`\n========== 回复 ${count} ==========`);
	const block = match[1];

	// 提取用户名
	const authorMatch = block.match(/<strong><a[^>]*href=["']\/member\/([^"']+)["'][^>]*class=["'][^"']*dark[^"']*["'][^>]*>([^<]*)<\/a><\/strong>/i);
	if (authorMatch) {
		console.log('用户名:', authorMatch[2] || authorMatch[1]);
	}

	// 提取内容
	const contentMatch = block.match(/<div[^>]*class=["'][^"']*reply_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
	if (contentMatch) {
		console.log('内容:', contentMatch[1].substring(0, 50));
	}

	// 提取点赞
	const likeMatch = block.match(/<span class="small fade"[^>]*>[\s\S]*?<img[^>]*alt=["']❤️["'][^>]*>\s*(\d+)/);
	if (likeMatch) {
		console.log('点赞数:', likeMatch[1]);
	}

	if (count > 10) break; // 只显示前10条
}

console.log('\n总共找到:', count, '条回复');

// 查找所有的 id="r_" 开头的div
const allDivs = html.match(/id="r_\d+"/g) || [];
console.log('页面中的回复div数量:', allDivs.length);
