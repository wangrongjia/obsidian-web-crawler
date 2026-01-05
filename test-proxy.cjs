// 测试代理连接脚本
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

async function testProxy(proxyUrl) {
	console.log('正在测试代理:', proxyUrl);

	const options = {
		method: 'GET',
		hostname: 'www.google.com',
		path: '/',
		rejectUnauthorized: false,
		timeout: 10000,
	};

	try {
		// 创建代理 Agent
		const agent = new HttpsProxyAgent(proxyUrl);
		options.agent = agent;

		console.log('代理 Agent 已创建');

		const result = await new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				console.log('响应状态码:', res.statusCode);
				req.destroy();
				if (res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302) {
					resolve(true);
				} else {
					resolve(false);
				}
			});

			req.on('error', (error) => {
				console.error('请求错误:', error.message);
				req.destroy();
				reject(error);
			});

			req.on('timeout', () => {
				console.error('请求超时');
				req.destroy();
				reject(new Error('Timeout'));
			});

			req.end();
		});

		return result;
	} catch (error) {
		console.error('测试失败:', error.message);
		return false;
	}
}

// 测试不同的代理配置
async function main() {
	const proxies = [
		'http://127.0.0.1:7897',
		'http://127.0.0.1:7890',
	];

	for (const proxy of proxies) {
		console.log('\n====================');
		const success = await testProxy(proxy);
		console.log(`结果: ${success ? '✅ 成功' : '❌ 失败'}`);
	}
}

main().catch(console.error);
