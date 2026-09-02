# playwright-browser

[![Release](https://img.shields.io/github/v/release/whklwhkl/dsh-playwright)](https://github.com/whklwhkl/dsh-playwright/releases)
[![License: MIT](https://img.shields.io/github/license/whklwhkl/dsh-playwright)](./LICENSE)

DSH (DeepSeek Harness) 浏览器自动化插件：给智能体提供一套 `browser_*` 模型工具，用 Playwright 驱动 Chromium 真实操作网页——打开页面、点击、填表、抓取 DOM、截图。

> 兼容性：对 [dsh 0.1.2-alpha.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5) 实测通过。

- 宿主进程内直接 `require('playwright-core')`，无需外部桥服务或端口
- 浏览器按需懒启动，插件卸载时自动关闭
- 只依赖 `playwright-core`，无其他运行时依赖
- 工具描述/参数文档/输出文案支持中英双语（`PW_LANG=en` 切换，默认中文）— [English README](./README.en.md)

## 功能一览

| 工具 | 作用 |
|---|---|
| `browser_open` | 打开 URL，返回最终地址与页面标题 |
| `browser_status` | 查询浏览器/当前页面状态（URL、标题） |
| `browser_click` | 点击元素（CSS 或 `text=` 选择器） |
| `browser_type` | 逐字输入（可设 `delay` 模拟真人） |
| `browser_fill` | 快速填充输入框 |
| `browser_press` | 按键（Enter / Tab / Escape …） |
| `browser_wait` | 等待若干毫秒 |
| `browser_extract` | 抓取页面或指定元素的文本 |
| `browser_html` | 抓取页面或指定元素的 HTML |
| `browser_eval` | 在页面上下文执行 JS 表达式（诊断 DOM 等） |
| `browser_screenshot` | 截图保存为 PNG，返回绝对路径 |
| `browser_close` | 关闭浏览器释放资源 |

## 安装到 DSH profile

在任意目录执行一条命令（`dsh` 自行定位 profile 目录，首次使用会自动初始化）：

```bash
# 示例：装进 web profile
dsh plugin --profile web add git+https://github.com/whklwhkl/dsh-playwright.git
```

`dsh plugin` 把 `add` 之后的参数原样转发给 profile 目录里的 pnpm，安装完成后自动把声明了 `dsh.bundle` 的依赖追加进 `dsh.profile.bundles`——无需手改 `package.json`。registry 包名、`github:<user>/<repo>`、本地路径等 pnpm 支持的安装源均可。

本地开发时指向 checkout 目录，加 `link:` 前缀以符号链接安装，改动后无需重新安装（重启 DSH 生效）：

```bash
dsh plugin --profile web add link:/path/to/dsh-playwright
```

**重启 DSH：** bundle 列表在启动时读取，重启后 `browser_*` 工具对 profile 下所有会话自动可用。

> 旧版 dsh 没有 `plugin` 子命令时：手动把 `playwright-browser` 加入 profile `package.json` 的 dependencies，并追加进 `dsh.profile.bundles`，再在 profile 目录执行 `pnpm install`。

## 准备浏览器

`playwright-core` **不会**自动下载浏览器，首次使用前需要准备 Chromium，二选一：

### 方式 A：让 playwright-core 自动下载（推荐，零配置）

```bash
# 任选其一（等价）：
npx playwright-core install chromium
# 或安装完整版 playwright 借其下载器：
npm i -D playwright && npx playwright install chromium
```

下载的浏览器会进入系统标准缓存（macOS 为 `~/Library/Caches/ms-playwright`，Linux 为 `~/.cache/ms-playwright`），插件启动时自动发现。

### 方式 B：复用系统已有的 Chrome/Edge/Chromium（免下载）

给运行 DSH 的进程设置环境变量，指向任意现成浏览器可执行文件：

```bash
export PW_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Linux 示例：export PW_CHROMIUM_PATH="/usr/bin/google-chrome"
```

> 版本提示：自动发现依赖 playwright-core 与其期望的 Chromium build 号匹配（`npx playwright-core install chromium` 总是安装匹配版本）。用 `PW_CHROMIUM_PATH` 指向任意 Chromium 系浏览器则无版本要求。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PW_LANG` | `zh` | 设为 `en` 切换工具描述与输出为英文 |
| `PW_CHROMIUM_PATH` | 自动发现 | 复用指定浏览器可执行文件 |
| `PW_HEADLESS` | `true` | 设为 `false` 弹出可见窗口 |
| `PW_SHOT_DIR` | 插件目录下 `shots/` | 截图保存目录 |

## 内置 skill：playwright-browser-tips

bundle 同时携带一个 `playwright-browser-tips` skill：常见站点对策与失败恢复技巧（选择器失效、元素不可见、抓取为空、反自动化边界），中英双语跟随 `PW_LANG`。模型在 browser_* 工具失败或自动化搜索/登录流程时按需加载；用户也可以直接输入 `/playwright-browser-tips` 调用。

skill 需要带 skill 注册表的 profile——web、headless、acp、sdk-app 等基于 `dsh-base` 的 profile 均满足。同名项目或用户目录 skill 优先级更高，可本地覆盖插件内置版本。

## 使用示例（对智能体说的话）

- "用浏览器打开 https://example.com，抓取正文给我"
- "打开百度，搜索「playwright」，把第一条结果标题告诉我"
- "打开这个页面 https://…，点击「登录」，截个图"

## 故障排查

| 现象 | 处理 |
|---|---|
| `Executable doesn't exist ... ms-playwright` | 浏览器未下载，执行 `npx playwright-core install chromium` |
| 下载 Chromium 时连接中断/超时（代理环境常见） | 大文件经代理易被中断；改用方式 B 的 `PW_CHROMIUM_PATH` 指向系统 Chrome，免下载 |
| `net::ERR_CONNECTION_CLOSED` | 目标站点网络问题或反爬，换个站点/稍后重试 |
| 站点弹验证码（如百度滑块）、headless 下输入框不可见 | 反自动化机制，非插件问题；实测 Bing 全流程可用，可优先换 Bing，或设 `PW_HEADLESS=false` 用有头模式 |
| 元素"not visible" | 页面改版或选择器过时，用 `browser_eval` 检查 DOM 再选选择器 |
| 当前模型看不了截图 | `browser_screenshot` 只保存文件；需要支持图片输入的视觉模型才能"看"图 |

## 本地开发 / 快速自测

```bash
# 不启动 DSH，直接验证模块加载与工具注册：
node --input-type=module -e "
import { apply } from './lib/index.js'
const tools = []
apply({ tools: { register: (d) => tools.push(d) }, effect: () => () => {} })
console.log(tools.map((t) => t.name).join('\n'))
"
```

## 社区与支持

本插件是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）生态插件，按官方[社区支持指南](https://github.com/deepseek-ai/deepseek-harness#community-and-support)添加了 `dsh-plugin` topic 以便被发现。

- 插件问题、功能建议：在本仓库提 [Issues](https://github.com/whklwhkl/dsh-playwright/issues) 或 [Discussions](https://github.com/whklwhkl/dsh-playwright/discussions)
- DSH 框架问题与反馈：提交到 [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- 加入 DeepSeek Harness Discord 社区（见官方 README）

## License

MIT
