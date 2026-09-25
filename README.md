# playwright-browser

[![Release](https://img.shields.io/github/v/release/whklwhkl/dsh-playwright)](https://github.com/whklwhkl/dsh-playwright/releases)
[![License: MIT](https://img.shields.io/github/license/whklwhkl/dsh-playwright)](./LICENSE)

DSH (DeepSeek Harness) 浏览器自动化插件：给智能体提供一套 `browser_*` 模型工具，用 Playwright 驱动 Chromium 真实操作网页——打开页面、点击、填表、抓取 DOM、截图。

> 兼容性：对 [dsh 0.1.2-alpha.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5) 实测通过。

- 宿主进程内直接 `require('playwright-core')`，自建模式下无需外部桥服务或端口
- 浏览器按需懒启动，插件卸载时自动关闭
- 可选**挂载已经打开的浏览器**（CDP attach）：直接接管你正在用的 Chrome/Edge，登录态、Cookie、扩展、已开标签页全都在（见下文）
- 只依赖 `playwright-core`，无其他运行时依赖
- 工具描述/参数文档/输出文案支持中英双语（`PW_LANG=en` 切换，默认中文）— [English README](./README.en.md)

## 功能一览

| 工具 | 作用 |
|---|---|
| `browser_open` | 打开 URL，返回最终地址与页面标题 |
| `browser_status` | 查询浏览器/当前页面状态（是否挂载、端点、URL、标题、标签页数） |
| `browser_attach` | 运行时挂载/切换到一个已在运行的浏览器（无需重启 DSH） |
| `browser_tabs` | 列出/切换/关闭已打开的标签页（挂载模式下的"接手"入口） |
| `browser_click` | 点击元素（CSS 或 `text=` 选择器） |
| `browser_type` | 逐字输入（可设 `delay` 模拟真人） |
| `browser_fill` | 快速填充输入框 |
| `browser_press` | 按键（Enter / Tab / Escape …） |
| `browser_wait` | 等待若干毫秒 |
| `browser_extract` | 抓取页面或指定元素的文本 |
| `browser_html` | 抓取页面或指定元素的 HTML |
| `browser_eval` | 在页面上下文执行 JS 表达式（诊断 DOM 等） |
| `browser_screenshot` | 截图保存为 PNG，返回绝对路径 |
| `browser_close` | 关闭浏览器释放资源（挂载模式下只断开连接） |

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

### 方式 C：挂载已经打开的浏览器（复用登录态）

上面 A/B 两种方式都是让插件**新起**一个干净浏览器——没有登录态、没有扩展、没有你手动打开的标签页。若要让智能体直接在你**正在使用的** Chrome 里干活，用挂载模式：

```bash
export PW_CDP_ENDPOINT=chrome        # 真实默认 profile，推荐
# 或 export PW_CDP_ENDPOINT=http://127.0.0.1:9222   # 指定调试端口
# 或 export PW_CDP_ENDPOINT=auto      # 先试 chrome，再试 9222
```

`chrome` 这个取法要求你在目标浏览器里开启一次远程调试开关（Chrome 136+ 的安全策略，默认关闭）：

1. 地址栏打开 `chrome://inspect/#remote-debugging`
2. 勾选 **Allow remote debugging for this browser instance**

之后插件即可挂载你的默认 profile：Cookie、登录态、扩展、已打开的标签页全都在。

> ⚠️ **每次新建 CDP 连接，Chrome 都会弹一次「要允许远程调试吗？」**（实测 Chrome 153，这是 `chrome://inspect` 开关的激进安全策略，无法配置成"记住授权"）。在你点「允许」之前，WebSocket 升级握手一直被**静默挂起**，所以表现就像"连不上/无缘无故超时"。
> 因此：**第一次挂载请留意 Chrome 窗口，点一次「允许」**；之后插件会复用这一条连接，不再弹框（`browser_attach` 同一端点、`browser_tabs`、`browser_open` 等都不会重新建连）。`browser_close`/插件重载会断开，下次挂载需要再点一次。

想改用端口方式（`http://127.0.0.1:9222`）时注意：Chrome 136 起 `--remote-debugging-port` 对**默认数据目录**不再生效，必须同时指定一个专属目录，并且该 Chrome 需先完全退出：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-debug"
```

> 这条路子**完全不弹授权框**（不走 `chrome://inspect` 开关），`/json/version` 也正常，代价是那个专属目录是新的：需要在那里登录一次你要用的站点。适合无人值守/长期自动化；想直接用现有登录态就用上面的 channel 名 `chrome`。

> 两种取法不能混用（实测）：用 `chrome://inspect` 开关启动的浏览器**只提供 WebSocket 端点，不响应 HTTP 发现接口**（`http://127.0.0.1:9222/json/version` 返回 404），所以对这类实例只能写 channel 名 `chrome`；反过来，用 `--remote-debugging-port` 起的实例两种写法都行。
> 插件现在自己读 `DevToolsActivePort`（第 1 行端口 + 第 2 行 GUID 路径）来解析 `chrome`，**不再走 Playwright 内置的 channel 解析**——后者只取端口、丢掉 GUID 路径，在 Chrome 153 上必然连不上。

**不想重启 DSH 也能挂载：** 直接让智能体调用 `browser_attach`（也可以自己说"挂上我的 Chrome"）。它接受与 `PW_CDP_ENDPOINT` 相同的写法，并且：

| 调用 | 作用 |
|---|---|
| `browser_attach` | 缺省端点：已挂载就保持当前端点，否则用 `PW_CDP_ENDPOINT`（未设置则 `auto`） |
| `browser_attach({ endpoint: "chrome" })` | 挂到该端点（channel 名 / `http://…` / `ws://…` / `auto` / 逗号分隔回退） |
| `browser_attach({ page: "portal" })` | 不换浏览器，只按 URL/标题子串换要接手的标签页；命中不到会报错 |
| `browser_attach({ endpoint: "launch" })` | 不再挂载，切回插件自建的干净浏览器（忽略环境变量） |

挂载模式的行为约定：

- `browser_status` **不会**主动建立连接（一条新连接 = 一次授权弹窗，只读查询不值得让用户点框）；未挂载时它会告诉你去调 `browser_attach`；
- 同一端点上重复 `browser_attach` 会**复用现有连接**（只按 `page` 子串重选标签页），不会断开重连、不会又弹一个授权框；
- `browser_tabs` 列出全部标签页（`*` = 当前操作页），传 `index` 或 `url` 子串即可切换（会置前），加 `close:true` 关闭该标签页；
- `browser_open` 在**当前跟踪的标签页**里导航——别拿它去覆盖你不想丢的页面，可以先 `browser_tabs` 选一个；
- `browser_close` **只断开连接，绝不关闭你的浏览器**（自建实例模式下才是真的关闭）；
- `PW_CDP_PAGE` 可按 URL/标题子串固定要接手的标签页；
- 挂载失败时会打印诊断：端口是否在监听、`/json/version` 的 HTTP 状态、`DevToolsActivePort` 内容；若是"端口在监听但握手没完成"，会明确提示你去 Chrome 点「允许远程调试」；
- 连接预算由 `PW_CDP_TIMEOUT` 控制（默认 90 秒，留够看到弹窗并点一下的时间）；端口无人监听时仍然毫秒级快速失败，不会白等；
- 该模式下 `PW_HEADLESS`、`PW_CHROMIUM_PATH` 无效（浏览器是你自己起的）。

> 与 [webclaw3](https://github.com/fatmind/webclaw3) 的区别：webclaw3 走 Chrome 扩展桥接 + 本地服务，本插件走 Playwright 原生 CDP 挂载，不需要装扩展；代价是 CDP 看不到 `chrome://` 等特权页面（扩展桥接可以）。

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PW_LANG` | `zh` | 设为 `en` 切换工具描述与输出为英文 |
| `PW_CHROMIUM_PATH` | 自动发现 | 复用指定浏览器可执行文件 |
| `PW_HEADLESS` | `true` | 设为 `false` 弹出可见窗口（挂载模式下无效） |
| `PW_SHOT_DIR` | 插件目录下 `shots/` | 截图保存目录 |
| `PW_CDP_ENDPOINT` | 未设置 | 设置后进入挂载模式：`chrome` / `msedge` 等 channel 名、`http://127.0.0.1:9222`、`ws://…`，逗号分隔可做回退，`auto` = 先 chrome 再 9222 |
| `PW_CDP_PAGE` | 未设置 | 挂载时按 URL 或标题**子串**挑选要接手的标签页 |
| `PW_CDP_TIMEOUT` | `90000` | 挂载连接预算毫秒。它同时是"等你在授权框上点允许"的窗口；端口无人监听时仍毫秒级快速失败 |

## 内置 skill：playwright-browser-tips

bundle 同时携带一个 `playwright-browser-tips` skill，正文是一张**站点地图**：各站点在自动化下的实测行为与对策（搜索类任务默认 Bing），加上通用恢复手法。中英双语跟随 `PW_LANG`；模型在 browser_* 工具失败或自动化搜索/登录流程时按需加载，用户也可以直接输入 `/playwright-browser-tips` 调用。

地图欢迎共建——人和 agent 都可以按 [SITE-MAP-SPEC.md](./SITE-MAP-SPEC.md) 的规范提交条目（只改 `assets/site-map.json`），提交前运行 `node scripts/validate-site-map.js` 并把输出贴进 PR。框架文本（含反自动化边界：验证码一律由用户人工完成）由代码持有，不随地图数据变化。

skill 需要带 skill 注册表的 profile——web、headless、acp、sdk-app 等基于 `dsh-base` 的 profile 均满足。同名项目或用户目录 skill 优先级更高，可本地覆盖插件内置版本。

## 使用示例（对智能体说的话）

- "用浏览器打开 https://example.com，抓取正文给我"
- "打开百度，搜索「playwright」，把第一条结果标题告诉我"
- "打开这个页面 https://…，点击「登录」，截个图"
- "挂上我的 Chrome，把当前标签页的正文抓下来"（智能体调用 `browser_attach`，或设 `PW_CDP_ENDPOINT`）
- "看看我浏览器里都开了哪些标签页，切到那个 XXX 页面然后点登录"（同上）

## 故障排查

| 现象 | 处理 |
|---|---|
| `Executable doesn't exist ... ms-playwright` | 浏览器未下载，执行 `npx playwright-core install chromium` |
| 下载 Chromium 时连接中断/超时（代理环境常见） | 大文件经代理易被中断；改用方式 B 的 `PW_CHROMIUM_PATH` 指向系统 Chrome，免下载 |
| `Could not connect to chrome: DevToolsActivePort file not found` | 目标浏览器没开远程调试：去 `chrome://inspect/#remote-debugging` 勾选允许，或改用 `PW_CDP_ENDPOINT=http://127.0.0.1:9222` 并以专属 `--user-data-dir` 启动 Chrome |
| `http://127.0.0.1:9222` 报 `Unexpected status 404 ... /json/version/` | 该端口上的浏览器是用 `chrome://inspect` 开关开的：它不提供 HTTP 发现接口，改用 channel 名 `chrome`（或 `browser_attach({endpoint:"chrome"})`） |
| `connect ECONNREFUSED 127.0.0.1:9222` | 目标浏览器没起来或端口不对：确认它带 `--remote-debugging-port=9222` 启动，且 `curl http://127.0.0.1:9222/json/version` 有返回 |
| `CDP 挂载失败（已尝试 N 个端点）` | 端点不对或浏览器没开调试；报错里会逐个列出失败原因 + 端口是否在监听 + `/json/version` 状态 + `DevToolsActivePort` 内容，不用手工摸排 |
| 挂载报 `Timeout ... exceeded`，同时提示"端口在监听但 WS 握手一直没完成" | **Chrome 在等你点授权框**：切到 Chrome 窗口点「允许远程调试」的「允许」，再调一次 `browser_attach`。框没看到就翻一下其他窗口/最小化的 Chrome；点得慢就把 `PW_CDP_TIMEOUT` 调大 |
| 每调一次 `browser_attach` 都弹一次授权框 | 说明中间断开过（`browser_close`、插件重载、DSH 重启）。同一端点上重复 `browser_attach` 现在会复用连接；想彻底摆脱弹框就改用专属 `--user-data-dir` 的端口方式（见方式 C） |
| 挂载模式下 `browser_open` 覆盖了我正在看的页面 | 正常现象——它导航的是"当前跟踪的标签页"；先 `browser_tabs` 切到目标页，或用 `PW_CDP_PAGE` 固定 |
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

# 挂载模式冒烟测试（另开一个终端，先按"方式 C"起好可调试的 Chrome）：
# 不设 PW_CDP_ENDPOINT 也行——browser_attach 可以运行时指定端点
node --input-type=module -e "
const { apply } = await import('./lib/index.js')
const m = new Map()
apply({ tools: { register: (d) => m.set(d.name, d) }, effect: () => () => {} })
const call = (n, a = {}) => m.get('browser_' + n).execute(a)
console.log(await call('attach', { endpoint: 'http://127.0.0.1:9222' }))  // 挂载
console.log(await call('tabs'))                                          // 列出现有标签页
console.log(await call('attach', { endpoint: 'launch' }))                // 切回自建实例
console.log(await call('open', { url: 'https://example.com' }))
console.log(await call('close'))                                         // 关闭自建实例
"
```

## 社区与支持

本插件是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）生态插件，按官方[社区支持指南](https://github.com/deepseek-ai/deepseek-harness#community-and-support)添加了 `dsh-plugin` topic 以便被发现。

- 插件问题、功能建议：在本仓库提 [Issues](https://github.com/whklwhkl/dsh-playwright/issues) 或 [Discussions](https://github.com/whklwhkl/dsh-playwright/discussions)
- DSH 框架问题与反馈：提交到 [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- 加入 DeepSeek Harness Discord 社区（见官方 README）

## License

MIT
