# Chrome 挂载与登录态复用指南 (CDP Attach)

默认情况下，插件会启动一个全新的 Chromium 干净实例（自建模式）。该模式下没有登录态、Cookie 或浏览器扩展。

**挂载模式（Attach 模式）**允许插件通过 Chrome DevTools Protocol (CDP) 直接接管你正在使用的本地 Chrome 或 Edge 浏览器：
- 智能体直接复用你已经登录的各种网站（避免在自动化中处理复杂的登录和双因素认证）；
- 智能体能读取或操作你当前打开的标签页；
- 多个会话/子代理挂载同一个浏览器时，各自驱动独立的标签页，互不干扰。

---

## 一、接入方式对比与配置

挂载已有浏览器有两种主要方式，根据使用场景二选一：

| 接入方式 | 适用场景 | 授权弹窗 | 登录态 | 启动要求 |
|---|---|---|---|---|
| **方式 1：Channel 模式 (`chrome`)**（推荐） | 日常交互、直接复用默认浏览器 Profile | 每次首次建连 Chrome 会弹窗提醒 | 包含全部现有 Cookie、扩展与历史 | 仅需在已有 Chrome 中点一次调试开关 |
| **方式 2：专属端口模式 (`9222`)** | 无人值守、自动化长期脚本、排障 | 完全不弹授权框 | 独立 Profile（需单独登录一次） | 需带命令行参数启动独立 Chrome 实例 |

### 方式 1：Channel 模式（直接挂载默认 Profile）

Chrome 136+ 提供了基于内置开关的远程调试能力：

1. 打开目标 Chrome，在地址栏访问：`chrome://inspect/#remote-debugging`
2. 勾选 **Allow remote debugging for this browser instance**
3. 设置环境变量或直接让智能体挂载：
   ```bash
   export PW_CDP_ENDPOINT=chrome
   # 或设为 auto（先尝试 chrome，失败则回退至 9222 端口）：
   export PW_CDP_ENDPOINT=auto
   ```

> ⚠️ **关于 Chrome 136+ 授权弹窗的关键机制**：
> - 每次**新建** CDP 连接，Chrome 都会弹出一个系统级安全对话框：**「要允许远程调试吗？」**。
> - 在你点击「允许」之前，WebSocket 升级握手会被**静默挂起**，表现就像连接超时卡住。
> - **应对策略**：首次挂载时请观察 Chrome 窗口并点击一次「允许」。只要连接不主动断开（插件会复用连接），后续的 `browser_attach`、`browser_tabs`、`browser_open` 等操作均**不会**重复弹窗。
> - *底层原理*：插件自行读取本地的 `DevToolsActivePort`（第一行端口 + 第二行 GUID 路径）解析 WebSocket 地址，绕过了 Playwright 丢弃 GUID 路径导致无法连接的问题。

### 方式 2：专属调试端口模式（免弹窗）

如果你需要完全无人值守或避免任何弹窗，可以使用独立的 `--user-data-dir` 启动 Chrome：

```bash
# macOS 示例（需先退出所有已运行的 Chrome，或者使用全新 user-data-dir）：
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-debug"
```

配置环境变量：
```bash
export PW_CDP_ENDPOINT=http://127.0.0.1:9222
```

> **注意：**
> 1. Chrome 136 起，`--remote-debugging-port` 对**默认数据目录**已不再生效，必须显式指定专属目录 `--user-data-dir`。
> 2. 方式 1（`chrome://inspect`）启动的实例**不提供 HTTP 发现接口**（访问 `http://127.0.0.1:9222/json/version` 会报 404），因此方式 1 只能使用 channel 名 `chrome`，不能写成 HTTP 端口形式。

---

## 二、运行时工具操作（无需重启 DSH）

智能体或用户可以在会话过程中直接调用工具动态切换端点或标签页：

### 1. `browser_attach` 动态挂载
无需重启 DSH，直接对智能体说“挂上我的 Chrome”，或者调用：

| 调用方式 | 行为说明 |
|---|---|
| `browser_attach()` | 缺省端点：若当前会话已挂载则保持不变，否则尝试 `PW_CDP_ENDPOINT`（未设则为 `auto`） |
| `browser_attach({ endpoint: "chrome" })` | 挂载到指定端点（支持 `chrome`、`msedge`、`http://...`、`ws://...` 或逗号分隔的回退列表） |
| `browser_attach({ page: "github" })` | 不换浏览器，仅按 URL 或标题子串切换接手的标签页（找不到会报错） |
| `browser_attach({ endpoint: "launch" })` | 断开挂载，切回插件自建的干净 Chromium 实例 |

### 2. `browser_tabs` 标签页管理
挂载成功后，使用 `browser_tabs` 查看和管理当前浏览器的标签页：
- **查看标签页**：`browser_tabs()` 列出全部已打开的标签页（其中标记 `*` 的为当前会话正在操作的标签页）。
- **切换标签页**：`browser_tabs({ index: 2 })` 或 `browser_tabs({ url: "console" })` 切换并激活（置前）对应页面。
- **关闭标签页**：`browser_tabs({ index: 3, close: true })`。

---

## 三、挂载模式的核心约定与保护机制

1. **只读查询不建连**：
   - `browser_status` 始终是只读的，在未挂载状态下**绝不会**主动发起连接，避免无意义地触发 Chrome 授权弹窗。
2. **连接自动复用**：
   - 在同一端点重复调用 `browser_attach` 只会重选标签页，不会断开重建，保证操作平滑无弹窗。
3. **标签页防卡死预算 (`PW_RTT_TIMEOUT`)**：
   - 获取标签页标题和置前时设有单次往返预算（默认 1500ms）。若某个标签页渲染进程卡死（死循环、页面无响应弹窗、DevTools 断点暂停），它会被标记为 `(无响应)`，而不会卡死整个智能体对话。
4. **安全断开 (`browser_close`)**：
   - 挂载模式下调用 `browser_close` **只会断开当前会话的 CDP 连接，绝不会关闭用户的浏览器**。
5. **多会话标签页隔离**：
   - 当多个会话/子代理挂载同一浏览器时，各会话会认领属于自己的独立标签页（跳过已被其他存活会话占用的标签；若全被占用则自动新建标签）。
   - 显式接手（通过 `browser_attach({ page })` 或 `browser_tabs`）具有优先权；被挤掉的会话在下次操作时会自动挑取其他可用标签，不会陷入争抢死锁。
6. **导航行为**：
   - `browser_open` 会在当前选中的标签页进行导航。若不希望覆盖正在阅读的重要网页，请先使用 `browser_tabs` 切换到一个新标签或空白标签。

---

## 四、与类似方案（如 webclaw3）的对比

| 特性 | 本插件 (dsh-playwright) | webclaw3 类方案 |
|---|---|---|
| **接入机制** | 原生 CDP 协议挂载 | Chrome 浏览器扩展 + 本地中间桥接服务 |
| **前置准备** | 无需安装任何扩展，勾选开关即可 | 需要安装并配置专用浏览器扩展 |
| **特权页面访问** | 无法访问 `chrome://` 等特权页面（CDP 协议安全限制） | 可借由扩展特权访问部分内部页面 |
| **多会话支持** | 原生支持多会话隔离独立操作不同标签页 | 多会话共用同一桥服务可能产生竞争 |
