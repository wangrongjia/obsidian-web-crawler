# Web Crawler Plugin

[![Release](https://img.shields.io/badge/dynamic/json?color=blue&label=Release&prefix=v&query=%24.version&url=https%3A%2F%2Fraw.githubusercontent.com%2F[USERNAME]%2Fobsidian-web-crawler%2Fmain%2Fmanifest.json)](https://github.com/[USERNAME]/obsidian-web-crawler/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?color=success&label=Downloads&query=%24.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fplugin-updates.json)](https://obsidian.md/plugins?id=obsidian-web-crawler)
[![License](https://img.shields.io/badge/license-BSD%200--Clause-blue.svg)](LICENSE)

An Obsidian plugin that crawls web pages and converts them to Markdown files. Supports websites that require authentication via cookies, including Twitter/X, Reddit, Zhihu, and more.

## 🌟 Features

- **One-Click Crawling**: Crawl any web page and save it as a Markdown file with a single click
- **Smart Content Extraction**: Automatically extracts title, main content, images, and metadata
- **Login Support**: Configure cookies for websites that require authentication
- **Proxy Support**: Built-in proxy configuration for accessing international websites
- **Dynamic Content**: Uses Playwright for JavaScript-heavy sites (Twitter/X, etc.)
- **Specialized Optimizations**: Custom extractors for popular platforms:
  - Twitter/X: Tweets with images and author info
  - Reddit: Posts with automatic title extraction from URL
  - Zhihu: Q&A content with image lazy-loading support
  - V2EX: Forum posts with replies
- **Obsidian Properties**: Saves source URL and timestamp as file properties
- **Auto Link Insertion**: Optionally inserts links to the created file in your current editor

## 📸 Usage

### Basic Usage

1. **Via Command Palette** (Ctrl/Cmd+P)
   - Type `Web Crawler: 爬取网页内容`
   - Enter the URL
   - The plugin will crawl and save the page

2. **Via Ribbon Icon**
   - Click the link icon in the left ribbon
   - Enter the URL
   - The content will be saved to your vault

3. **From Editor**
   - Use `Web Crawler: 爬取网页内容并插入链接`
   - The plugin will insert a link to the created file in your current editor position

### Configuration

#### Proxy Settings

Go to `Settings → Community Plugins → Web Crawler Plugin → Options`:

1. **Use System Proxy**: Enable if your system has a proxy configured
2. **Proxy Server**: Manually configure proxy (e.g., `http://127.0.0.1:7890`)
3. **Quick Setup**: Choose from presets:
   - Clash Verge - HTTP (127.0.0.1:7897)
   - Clash - HTTP (127.0.0.1:7890)
   - V2RayN - HTTP (127.0.0.1:10809)
   - And more...

#### Login Configuration (for websites requiring authentication)

For sites like Twitter/X, Zhihu, or private forums:

1. Scroll to "Login Configuration" section
2. Click "Add Login Configuration"
3. Fill in:
   - **URL Pattern**: Match pattern (e.g., `https://twitter.com/*`, `https://www.zhihu.com/*`)
   - **Cookies**: Your cookie string from browser DevTools
     - Open browser DevTools (F12) in your browser
     - Go to Network tab
     - Refresh the page
     - Find any request and copy the `Cookie` header value
     - Format: `key1=value1; key2=value2; key3=value3`
   - **User-Agent** (optional): Custom user agent string
4. Save settings

**Note**: Only cookies are supported. Username/password authentication is not available.

#### Save Path

Configure where to save crawled content (default: `WebCrawler` folder in your vault).

## 🚀 Advanced Features

### Twitter/X Support

For Twitter/X posts, the plugin uses a local Playwright server:

1. **Start the local server** (one-time setup):
   ```bash
   node server.cjs
   ```

2. **Configure proxy** in plugin settings (Twitter/X requires VPN)

3. **Crawl tweets**:
   - Extracts tweet text, author info, images
   - Generates filename from tweet content
   - Images saved in high resolution

### V2EX Forum

- Automatically detects and includes replies
- Clean formatting for forum discussions

### Custom Extractors

The plugin uses smart content detection:
- Article tags (`<article>`, `<main>`)
- Common content class names
- Fallback to body content

## 📦 Output Format

Crawled content is saved with Obsidian properties:

```markdown
---
来源: https://example.com/article
时间: 2026-01-06 10:30:45
---

# Article Title

Article content goes here...
```

## ⚙️ Settings

| Setting | Description |
|---------|-------------|
| **Save Path** | Folder to save crawled files (relative to vault root) |
| **Use System Proxy** | Use system/browser proxy settings |
| **Proxy Server** | Manual proxy configuration |
| **Include Replies** | Include forum replies (V2EX, etc.) |
| **Login Configs** | Cookie configurations for private websites |

## 🛠️ Development

### Building

```bash
npm install
npm run build
```

### Development Mode

```bash
npm run dev
```

### Linting

```bash
npm run lint
```

## 📝 Changelog

### Version 1.0.0
- Initial release
- Support for basic web crawling
- Twitter/X, Reddit, Zhihu, V2EX optimizations
- Proxy and login configuration
- Obsidian properties support

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

BSD 0-Clause License - see [LICENSE](LICENSE) for details.

Copyright (C) 2020-2025 by Dynalist Inc.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## 🙏 Acknowledgments

- Built with [Obsidian API](https://docs.obsidian.md)
- Uses [Turndown](https://github.com/mixmark-io/turndown) for HTML to Markdown conversion
- Uses [Playwright](https://playwright.dev/) for dynamic content

## 📧 Support

- Issues: [GitHub Issues](https://github.com/[USERNAME]/obsidian-web-crawler/issues)
- Discussions: [GitHub Discussions](https://github.com/[USERNAME]/obsidian-web-crawler/discussions)

---

**Note**: This plugin is not affiliated with or endorsed by Obsidian.
