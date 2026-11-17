# 故障排查手册 (Troubleshooting)

本文档汇总了 `playwright-browser` 插件在安装、启动、挂载及网页自动化过程中常见的问题现象、原因分析与解决方案。

---

## 目录
- [一、插件安装与 DSH 运行时](#一插件安装与-dsh-运行时)
- [二、自建浏览器启动与环境](#二自建浏览器启动与环境)
- [三、CDP 挂载与连接异常](#三cdp-挂载与连接异常)
- [四、网页自动化与交互问题](#四网页自动化与交互问题)

---

## 一、插件安装与 DSH 运行时

### 1. DSH 报告插件版本不兼容 (`incompatible-version`)
- **现象**：在 DSH 插件管理中看到插件被拒绝加载，报 `incompatible-version`。
- **原因**：DSH 从 0.2.0-rc.2 起引入了插件兼容闸门机制，严格校验插件的 `peerDependencies` 中的 `@deepseek-ai/dsh` 版本。本插件声明了 `@deepseek-ai/dsh: ^0.2.0-rc.2`。如果运行时的 DSH 版本升到了 0.3.x 或其他未被覆盖的主版本，闸门会拦截该插件。
- **解决办法**：
  - 更新插件到兼容当前 DSH 的版本；
  - 或者在确认无破坏性 API 变更的前提下，使用 DSH 命令强制放行：
    ```bash
    dsh plugin allow-version playwright-browser@<插件版本> --dsh-version <当前DSH版本> --accept-risk
    ```

### 2. 报 `Cannot find package 'playwright-core'` 且工具未出现
- **现象**：使用 `dsh plugin add link:/path/to/dsh-playwright` 本地调试时，DSH 启动报错找不到 `playwright-core`，`browser_*` 相关工具未加载。
- **原因**：通过 `link:` 软链接方式安装时，插件自身的依赖不会自动被装入 profile 目录。
- **解决办法**：在插件源码目录（`dsh-playwright` 检出目录）下手动执行一次安装命令：
  ```bash
  pnpm install   # 或 npm install
  ```
  安装完成后重启 DSH。

### 3. 工具重装后消失
- **现象**：之前工具可用，但在重新安装或升级插件后，`browser_*` 工具消失。
- **原因**：宿主插件在 DSH 中不会自动热重载，若加载过程发生短暂异常也不会自动轮询重试。
- **解决办法**：直接重启 DSH 进程。

### 4. 报错前缀从中文变成 `Error: ...`
- **现象**：之前版本工具执行失败返回 `错误：...`，新版本返回 `Error: ...`。
- **说明**：这是 0.5.0 起的规范化调整。工具出错时直接向 DSH 抛出异常，由 DSH 框架统一渲染为带有 `isError: true` 标记的标准失败响应。模型应通过 `isError` 判断成败，而非通过匹配文本前缀。

---

## 二、自建浏览器启动与环境

### 1. 报 `Executable doesn't exist ... ms-playwright`
- **现象**：调用 `browser_open` 时报错提示找不到 Chromium 可执行文件。
- **原因**：插件依赖的 `playwright-core` 默认不会自动下载浏览器内核。
- **解决办法**：在系统终端运行以下命令下载 Chromium：
  ```bash
  npx playwright-core install chromium
  ```
  （下载文件会保存在系统默认缓存：macOS 为 `~/Library/Caches/ms-playwright`，Linux 为 `~/.cache/ms-playwright`）。

### 2. 下载 Chromium 时连接中断或超时
- **现象**：执行 `npx playwright-core install` 时在大文件下载阶段卡死或超时报错（国内或特定代理环境下常见）。
- **解决办法**：无需下载 Playwright 内核，直接配置环境变量复用系统自带的 Chrome 或 Edge：
  ```bash
  # macOS 示例：
  export PW_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  # Linux 示例：
  export PW_CHROMIUM_PATH="/usr/bin/google-chrome"
  ```

### 3. 截图只返回了文件路径，对话中没有直接展示图片
- **现象**：调用 `browser_screenshot` 成功生成了 PNG 文件并返回了绝对路径，但模型界面上只有文字没有显示画面。
- **原因与排查**：
  1. 当前使用的 profile 未启用 `attachment` 附件服务（基于 `dsh-base` 的常见 profile 均已默认启用）；
  2. 截图大小超过了模型单次输入的上限限制；
  3. 当前对话使用的模型本身是纯文本模型，不具备多模态识图能力（此时 DSH 会自动退化为占位提示文本）。
- **解决办法**：这不影响正常使用，图片已安全保存在返回的绝对路径中，纯文本模型后续可通过 `read_image` 或外部图像工具按需读取。

---

## 三、CDP 挂载与连接异常

### 1. `Could not connect to chrome: DevToolsActivePort file not found`
- **现象**：挂载时提示找不到 `DevToolsActivePort`。
- **原因**：目标 Chrome 浏览器未开启远程调试功能。
- **解决办法**：
  - 打开 Chrome，访问 `chrome://inspect/#remote-debugging`，勾选 **Allow remote debugging for this browser instance**；
  - 或者使用专属 `--user-data-dir` 和 `--remote-debugging-port=9222` 启动 Chrome（详见 [CDP Attach 指南](./cdp-attach.md)）。

### 2. 访问 `http://127.0.0.1:9222` 报 `Unexpected status 404 ... /json/version/`
- **现象**：挂载 `9222` 端口时提示 404 错误。
- **原因**：目标 Chrome 是通过 `chrome://inspect` 调试开关启动的。通过该开关启动的 Chrome 仅提供 WebSocket 连接通道，**不提供 HTTP 发现接口**。
- **解决办法**：将端点改为 channel 名称：
  ```bash
  export PW_CDP_ENDPOINT=chrome
  # 或在对话中调用：browser_attach({ endpoint: "chrome" })
  ```

### 3. 报 `connect ECONNREFUSED 127.0.0.1:9222`
- **现象**：连接被拒绝。
- **原因**：目标 Chrome 尚未启动，或者未指定该调试端口。
- **解决办法**：确认目标 Chrome 启动参数中包含 `--remote-debugging-port=9222`，并在终端执行 `curl http://127.0.0.1:9222/json/version` 确认有正常的 JSON 输出。

### 4. 挂载报 `Timeout ... exceeded`，提示“WS 握手一直未完成”
- **现象**：挂载操作卡住数秒至数十秒，最终抛出连接超时。
- **原因**：**Chrome 正在等待你点击授权弹窗！**（Chrome 136+ 的安全策略，每次新建 CDP 连接都会弹窗确认）。在点击前，连接握手会被静默挂起。
- **解决办法**：
  - 切换到 Chrome 窗口，寻找弹出的「要允许远程调试吗？」系统弹窗，点击**「允许」**；
  - 点击后在对话中重新调用一次 `browser_attach` 即可秒连（后续操作会复用该连接，不再弹窗）；
  - 若弹窗提示被其他窗口遮挡导致超时，可增大连接预算：`export PW_CDP_TIMEOUT=120000`。

### 5. 挂载报 `Timeout ... exceeded`，提示“WS 握手完成，但初始化一直没结束”
- **现象**：超时信息显示 WebSocket 握手成功，但后续操作卡住。
- **原因**：**不是授权弹窗问题**。由于挂载需要枚举初始化所有已有标签页，如果浏览器中存在死循环、未完成渲染、断点暂停或卡死的页面，初始化流程会被阻塞。另外，如果刚刚经历过电脑意外重启或 Chrome 崩溃后的“会话恢复”，挂起的未加载标签也可能导致此现象。
- **解决办法**：
  - 检查 Chrome 中是否有标签页显示为“页面无响应”或处于 DevTools 断点状态，关掉卡住的标签页；
  - 关掉那些异常恢复后未正常加载的陈旧标签页；
  - 或者临时调用 `browser_attach({ endpoint: "launch" })` 切换回自建模式绕过。

### 6. `browser_tabs` 中某个标签页标题显示为 `(无响应)`
- **说明**：该标签页的渲染进程卡死。插件内置了单次往返预算（`PW_RTT_TIMEOUT`，默认 1500ms），在规定时间内若目标标签无法返回标题，会自动将其降级标记为 `(无响应)`，以保护整个调用不被挂死。
- **解决办法**：在 Chrome 中直接关闭该异常标签即可。

### 7. 每次调用 `browser_attach` 都重复弹出授权对话框
- **原因**：中间发生了连接断开（例如调用了 `browser_close`、DSH 发生重载或插件重启）。正常情况下只要连接存续，重复调用同一端点的 `browser_attach` 会自动复用连接。
- **解决办法**：日常使用中无需频繁调用 `browser_close`；如果需要彻底摆脱授权弹窗，可采用 `--remote-debugging-port=9222 --user-data-dir=...` 方式启动 Chrome。

### 8. 挂载模式下 `browser_open` 覆盖了我正在查看的标签页
- **说明**：属于预期行为。挂载模式下 `browser_open` 会在当前选中的标签页中发起导航。
- **解决办法**：导航前先调用 `browser_tabs` 切换到新建的空白标签，或使用 `PW_CDP_PAGE` 环境变量预先锁定要操作的目标标签。

---

## 四、网页自动化与交互问题

### 1. 遇到 `net::ERR_CONNECTION_CLOSED`
- **原因**：目标站点网络波动，或站点安全策略对当前 IP 触发了反爬连接阻断。
- **解决办法**：检查本地网络连通性，或稍后重试。

### 2. 遇到验证码滑块 / Headless 下输入框不可见
- **说明**：目标站点的反自动化检测机制（Bot Detection）。
- **处置原则**：
  - 严禁尝试在插件或脚本中破解、绕过验证码；
  - 自动化搜索类任务优先推荐使用对自动化友好的搜索引擎（如必应 Bing，详见内置 `playwright-browser-tips` skill）；
  - 必须进行的人工验证操作，可设置 `export PW_HEADLESS=false` 在可见窗口中由用户手动完成验证。

### 3. 报错元素 `not visible` 或找不到选择器
- **原因**：网页动态渲染未完成，或者页面改版导致 CSS 选择器失效。
- **解决办法**：让模型调用 `browser_eval` 或 `browser_html` 检查当前页面的实际 DOM 结构，重新确认选择器；对于延时出现的组件可配合 `browser_wait`。

### 4. 导航失败后后续页面全部报错 `interrupted by another navigation to chrome-error://...`
- **说明**：早期版本中，导航失败留下的错误页可能堵塞后续该标签的导航队列。
- **处置**：0.5.0 及以上版本已内置自动恢复策略（自建模式下自动重开该 page，挂载模式下安全新建标签替换），该问题已在底层自动修复。
