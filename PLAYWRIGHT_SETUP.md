# Twitter/X 爬取功能使用说明

## 📋 概述

由于 Obsidian 插件运行在沙盒环境中，无法直接使用 Playwright。因此采用了**本地服务器方案**：

```
Obsidian 插件 → HTTP 请求 → 本地服务器 (Playwright) → Twitter
```

## 🚀 快速开始

### 1. 启动本地服务器

**Windows:**
```bash
# 双击运行
start-server.bat

# 或在命令行中运行
node server.cjs
```

**Mac/Linux:**
```bash
node server.cjs
```

服务器会启动在 `http://localhost:3737`

### 2. 在 Obsidian 中使用

1. 确保**本地服务器正在运行**
2. 在 Obsidian 插件中输入 Twitter/X URL（如 `https://x.com/user/status/xxx`）
3. 插件会自动检测 Twitter URL，通过本地服务器使用 Playwright 爬取

## 📦 已安装的组件

- ✅ `playwright` - 浏览器自动化
- ✅ `playwright-chromium` - Chromium 浏览器
- ✅ Obsidian 插件（已编译）
- ✅ 本地服务器（`server.cjs`）

## 🔧 配置代理

在插件设置中配置代理：
- **Clash Verge**: `http://127.0.0.1:7897`
- **Clash**: `http://127.0.0.1:7890`
- **V2RayN**: `http://127.0.0.1:10809`

本地服务器会自动使用插件配置的代理。

## 🧪 测试

测试本地服务器是否正常工作：

```bash
node test-local-server.cjs
```

如果看到 "✓ 爬取成功！" 说明一切正常。

## ❓ 常见问题

### Q: 提示 "本地服务器连接失败"
**A:** 本地服务器没有启动，请先运行 `start-server.bat` 或 `node server.cjs`

### Q: 爬取超时
**A:** 检查网络连接和代理配置，确保可以访问 Twitter

### Q: 服务器启动失败
**A:** 确保已安装 Playwright: `npm install playwright`

## 📝 工作原理

1. **本地服务器** (`server.cjs`)
   - 监听 `http://localhost:3737`
   - 接收插件发送的爬取请求
   - 使用 Playwright 启动 Chromium 浏览器
   - 返回渲染后的 HTML

2. **Obsidian 插件**
   - 检测 Twitter/X URL
   - 通过 HTTP 请求调用本地服务器
   - 接收 HTML 并提取内容
   - 保存为 Markdown 文件

## 🛑 停止服务器

在服务器窗口按 `Ctrl+C` 即可停止。

## 💡 提示

- 本地服务器需要**一直运行**才能使用 Twitter 爬取功能
- 可以创建一个快捷方式到桌面，方便启动
- 服务器启动后会在后台运行，最小化即可
