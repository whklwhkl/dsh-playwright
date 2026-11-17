# playwright-browser

[![Release](https://img.shields.io/github/v/release/whklwhkl/dsh-playwright)](https://github.com/whklwhkl/dsh-playwright/releases)
[![License: MIT](https://img.shields.io/github/license/whklwhkl/dsh-playwright)](./LICENSE)

DSH (DeepSeek Harness) 浏览器自动化插件：给智能体提供一组 `browser_*` 模型工具，用 Playwright 驱动 Chromium 真实操作网页——打开页面、点击、填表、抓取 DOM、截图。

> **兼容性**：实测支持 [dsh 0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2) 及以上版本（`^0.2.0-rc.2`）。

- ⚡️ **轻量免服务**：宿主进程内直接加载 `playwright-core`，自建模式下无需任何外部桥接服务或独立端口。
- 🔀 **按会话天然隔离**：每个会话/子代理懒启动独立的浏览器实例，互不抢页，生命周期随会话销毁自动清理。
- 🔑 **无缝复用登录态**：支持原生 CDP 挂载接管已有 Chrome/Edge，保留全部 Cookie、扩展与打开的标签页。
- 🛑 **真取消与规范报错**：取消信号直接下发中止底层操作；出错抛出规范失败结果（`isError`），便于模型自主纠错。
- 📸 **多模态截图**：`browser_screenshot` 自动生成图片并内联至对话，支持视觉输入的模型可直接看到网页画面。
- 🌐 **中英双语支持**：工具描述与输出文案随 `PW_LANG` 自动切换（默认中文）— [English README](./README.en.md)。

---

## 快速开始

### 1. 安装插件到 DSH Profile

在任意目录执行一条命令安装（以 `web` profile 为例）：

```bash
dsh plugin --profile web add git+https://github.com/whklwhkl/dsh-playwright.git
```

> **本地开发**：指向本地检出目录并使用 `link:` 前缀软链接安装（安装前需在插件根目录运行 `pnpm install` 安装依赖）：
> ```bash
> dsh plugin --profile web add link:/path/to/dsh-playwright
> ```

安装完成后**重启 DSH**，`browser_*` 工具即对该 profile 下的所有会话自动生效。

### 2. 准备浏览器（三选一）

`playwright-core` 本身不内置浏览器内核，首次使用前请选择以下任一方式：

- **方式 A：自动下载 Chromium（推荐，零配置）**
  ```bash
  npx playwright-core install chromium
  ```
- **方式 B：复用系统已安装的 Chrome / Edge（免下载）**
  ```bash
  export PW_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  # Linux: export PW_CHROMIUM_PATH="/usr/bin/google-chrome"
  ```
- **方式 C：挂载已有 Chrome 浏览器（复用登录态）**
  在目标 Chrome 中打开 `chrome://inspect/#remote-debugging` 并勾选允许，然后配置：
  ```bash
  export PW_CDP_ENDPOINT=chrome
  ```
  *(挂载机制、Chrome 136+ 授权弹窗应对与多标签接手详见 [CDP 挂载指南](./docs/cdp-attach.md))*

### 3. 与智能体对话

配置完成后即可在对话中直接让智能体操作网页：
- *"用浏览器打开 https://example.com，把正文抓取给我"*
- *"打开必应，搜索「playwright」，把第一条结果标题告诉我"*
- *"挂上我的 Chrome，把当前标签页的内容提取出来"*
- *"看看我浏览器里开了哪些标签页，切到控制台那个页面点一下刷新"*

---

## 功能清单速查

| 工具 | 作用 |
|---|---|
| `browser_open` | 打开指定 URL，返回最终地址与页面标题 |
| `browser_status` | 查询当前会话的浏览器/页面状态（挂载状态、端点、当前 URL、标签数、所属会话） |
| `browser_attach` | 运行时动态挂载/切换到一个正在运行的浏览器（支持换端点或换标签页） |
| `browser_tabs` | 列出、切换（置前）或关闭已打开的标签页 |
| `browser_click` | 点击指定选择器或文本匹配的元素 |
| `browser_type` | 逐字模拟真人键盘输入（支持设置输入延迟） |
| `browser_fill` | 快速填充表单输入框 |
| `browser_press` | 触发按键事件（Enter、Tab、Escape 等） |
| `browser_wait` | 页面等待指定毫秒数 |
| `browser_extract` | 提取当前页面或指定元素的文本内容 |
| `browser_html` | 抓取当前页面或指定容器的完整 HTML 结构 |
| `browser_eval` | 在页面上下文执行自定义 JavaScript 表达式（诊断 DOM 等） |
| `browser_screenshot` | 截图保存为 PNG，同时为支持图片输入的模型内联画面 |
| `browser_close` | 关闭当前会话的自建浏览器实例（挂载模式下仅安全断开连接） |

---

## 内置技能：playwright-browser-tips

插件内置了一个 `playwright-browser-tips` skill（包含主流站点在自动化环境下的实测表现与避坑对策，如搜索任务优先选择 Bing 等）。模型在操作报错或遇到登录墙时会自动加载，用户也可随时在对话框输入 `/playwright-browser-tips` 手动调用。

- 站点表现地图欢迎社区共建，详见 [SITE-MAP-SPEC.md](./SITE-MAP-SPEC.md)。

---

## 进阶指南与参考手册

为方便快速定位特定场景的技术细节，深入文档已移至 `docs/` 目录：

- 📖 **[Chrome 挂载与登录态复用指南 (CDP Attach)](./docs/cdp-attach.md)**
  详解如何接管本地 Chrome、Chrome 136+ 远程调试授权弹窗机制、专属端口模式对比以及多会话多标签页接手规则。
- ⚙️ **[配置与多会话机制手册 (Configuration & Sessions)](./docs/configuration.md)**
  完整环境变量列表（超时时间、语言、截图路径等）与底层 Per-Session Browser 隔离架构实现。
- 🛠️ **[故障排查手册 (Troubleshooting)](./docs/troubleshooting.md)**
  按分类整理的常见问题速查（DSH 兼容闸门、内核下载失败、CDP 挂载超时、页面卡死与反爬对抗）。
- 💻 **[面向开发者与 Agent 的工作约定 (AGENTS.md)](./AGENTS.md)**
  本地自测运行、无热重载事实、代码审查协议与已知开发陷阱。

---

## 社区与支持

本插件是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）生态插件。

- 插件问题与功能建议：提交至 [GitHub Issues](https://github.com/whklwhkl/dsh-playwright/issues) 或 [Discussions](https://github.com/whklwhkl/dsh-playwright/discussions)
- DSH 框架问题与交流：访问 [DeepSeek Harness 社区](https://github.com/deepseek-ai/deepseek-harness)

## License

[MIT](./LICENSE)
