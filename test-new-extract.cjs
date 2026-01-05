// 测试新的回复提取逻辑
const fs = require('fs');

const html = fs.readFileSync('v2ex-response.html', 'utf8');

// 使用新的正则
const replyBlockPattern = /<div[^>]*id=["']r_\d+["'][^>]*class=["'][^"']*cell[^"']*["'][^>]*>[\s\S]*?<\/table>[\s\S]*?<\/div>/gi;

const authorPattern = /<strong><a[^>]*href=["']\/member\/([^"']+)["'][^>]*class=["'][^"']*dark[^"']*["'][^>]*>([^<]*)<\/a><\/strong>/i;
const contentPattern = /<div[^>]*class=["'][^"']*reply_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
const likePattern = /<span class=["']small fade["'][^>]*>[\s\S]*?<img[^>]*alt=["']❤️["'][^>]*>\s*(\d+)[\s\S]*?<\/span>/i;

let match;
const replies = [];
while ((match = replyBlockPattern.exec(html)) !== null) {
	const block = match[0] || '';

	// 提取作者
	const authorMatch = block.match(authorPattern);
	let author = '匿名';
	if (authorMatch) {
		const authorName = authorMatch[2] && authorMatch[2].trim() ? authorMatch[2].trim() : authorMatch[1];
		author = authorName || '匿名';
	}

	// 提取内容
	const contentMatch = block.match(contentPattern);
	const content = contentMatch && contentMatch[1] ? contentMatch[1] : '';

	// 提取点赞数
	const likeMatch = block.match(likePattern);
	const likes = likeMatch && likeMatch[1] ? parseInt(likeMatch[1]) : 0;

	if (content.trim()) {
		replies.push({
			author,
			content: content.trim(),
			likes
		});
	}
}

console.log(`总共提取 ${replies.length} 条回复`);
console.log(`其中 ${replies.filter(r => r.likes > 0).length} 条有点赞`);

// 显示有点赞的回复
const likedReplies = replies.filter(r => r.likes > 0).sort((a, b) => b.likes - a.likes);
console.log('\n有点赞的回复（按点赞数排序）:');
likedReplies.forEach((r, i) => {
	console.log(`\n${i + 1}. ${r.author} ❤️ ${r.likes}`);
	console.log(`   ${r.content.substring(0, 50)}...`);
});
