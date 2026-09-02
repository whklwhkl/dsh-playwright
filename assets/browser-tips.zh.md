# 浏览器操作技巧（playwright-browser）

当 browser_* 工具失败或返回为空，或需要自动化搜索引擎、登录流程时，按本技巧操作。

## 通用技巧

- 选择器失效或元素 "not visible"：先用 `browser_eval` 检查 DOM（例如 `document.querySelectorAll('input').length`），根据实际结构重选选择器；不要连续盲猜。
- 点击或按键后页面需要稳定时间：先 `browser_wait` 800–1500ms 再 `browser_extract`；抓取为空时等待后重试一次。
- 长页面抓取为空：先滚动再抓取（`browser_eval` 执行 `window.scrollTo(0, document.body.scrollHeight)`），懒加载内容只在滚动后渲染。
- 抓正文用 `browser_extract`；需要页面结构时用 `browser_html`；`browser_eval` 只作诊断手段，不用它替代前两者。
- 每次导航后用 `browser_status` 确认当前 URL 和标题，再执行后续动作。

## 站点备注

| 站点 | 行为 | 对策 |
|---|---|---|
| Bing | 搜索全流程可用（填充 → 回车 → 抓取结果） | 搜索类任务优先用 Bing |
| 百度 | headless 下首页搜索输入框不可见（反自动化） | 改用 Bing，或请用户设置 `PW_HEADLESS=false` 后重启 DSH |
| Google | 搜索触发验证码 | 不要重试，直接换 Bing |

## 反自动化边界

验证码、隐藏元素、滑块都是目标站点的防御机制，不是插件故障。同一动作失败不要重试超过两次；向用户报告限制并给出替代方案（换站点、设 `PW_HEADLESS=false`、请用户人工完成）。
