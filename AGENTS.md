# AGENTS.md — 在这个仓库上工作

给所有 agent（以及人）的工作约定。DSH 的 agent-instructions 会读取工作目录下的 `AGENTS.md`，改完即时生效。

## 这是什么

`playwright-browser`：DSH host 插件，注册 `browser_*` 工具 + 一个 `playwright-browser-tips` skill provider。无构建步骤——`lib/index.js` 就是源码（没有 `src/`，也不要引入打包）。

| 路径 | 作用 |
|---|---|
| `lib/index.js` | 全部工具实现：浏览器生命周期、会话注册表、CDP 挂载、中英文文案 |
| `lib/skill-provider.js` | 打包 `playwright-browser-tips` skill |
| `assets/site-map.json`、`assets/skill-template.*.md` | 站点 tips 数据与渲染模板 |
| `scripts/test-session-isolation.mjs` | 会话隔离自测（`npm test`） |
| `scripts/validate-site-map.js` | site map 校验 |
| `cordis.patch.yml` | bundle 的两行插入：插件 + skill provider |

## 本地运行事实（改代码前先知道）

- **host 插件不会热重载**：改完 `lib/` 要重启 `dsh web`，否则 GUI 里跑的还是旧代码。profile 的 patch/user layer 会 reload，但 `link:` 进来的插件源码不会。自测可以直接 `node` 跑，不必起 DSH。
- 浏览器优先级：`PW_CHROMIUM_PATH`（本机指向系统 Chrome）→ ms-playwright 缓存。本机**没有**下载 playwright 自带 Chromium，所以测试里别写死 `chromium.launch()` 而不传 `executablePath`。
- 挂载模式：`PW_CDP_ENDPOINT=chrome` 时，Chrome 136+ 对**每条新 CDP 连接**都会弹"允许远程调试"。所以状态查询绝不建连，同一端点也绝不 `close()` + 重连。
- 截图落在 `shots/`（已 gitignore），`PW_SHOT_DIR` 可改；文件名带会话标记。
- `PW_BROWSER_SCOPE=shared` 是 0.6 之前的老行为，改会话相关逻辑时别把它弄坏。

## 测试

```bash
npm test        # = node scripts/test-session-isolation.mjs
```

真起 Chromium（约 20–40 秒），4 个 PASS：launch 隔离 + 同会话串行、attach 分页/抢占、shared 回退、status 契约。改了会话隔离、状态文案、挂载逻辑**必须**跑。没有单测框架，断言用 `node:assert/strict`。

## 提交

- Conventional Commits，沿用现有 scope：`fix(status):`、`feat(session):`、`test:`、`docs:`、`chore: release x.y.z`。
- 一个 commit 一件事；**测试和它保护的实现放同一个 commit**，拆开会产生红的中间态。
- 发布单独一次 `chore: release x.y.z`（只改 `package.json` 的 version），不与修复混在一起。
- 提交前：`npm test` 全绿 + `git diff --check` 干净。

## 代码审查协议（外部模型审查 + 本地 agent 修改）

固定流程，换机器也一样。

**角色**：审查方只对 `git diff` 说话；修改方（agent）逐条判定、落地、跑测试；人拍板范围与优先级。

**审查方输出格式**（缺一不成立）：

```
P0   必须修：bug / 违背 README 或工具描述的契约 / 破坏性操作
P1   应该修：健壮性、边界、可测性
nit  可选：风格、措辞、注释
```

每条给：`file:line` + 3–5 行代码片段 + 一句话问题 + 建议改法（能直接给 patch 最好）。已修复的标 `done`，后续轮次不再重复提；不要引用整份文件，行号容易漂移。

**审查必查项：**

1. 行为是否兑现 README / 工具描述里的承诺（契约优先于风格）；
2. 会话隔离边界：别的会话、子代理、挂载中的用户浏览器会不会被影响；
3. 破坏性操作：关浏览器、抢标签、覆盖用户页面、写文件；
4. 新增分支有没有测试覆盖，尤其"只影响显示"的状态文案；
5. 运行环境假设：本机没 ms-playwright、host 不热重载、attach 会弹授权框。

**修改方回执**：采纳（改了什么 + 由哪个 PASS/断言保护）/ 不采纳（等价、超出范围或与事实不符）/ 未决（需要人拍板）。

**闸门**：`npm test` 全绿 + `git diff --check` 干净才能提交；"review 说 OK"不算通过。

## 已知坑

- 会话标记取 `session-<uuid>` 去掉前缀后的前 8 位（如 `90b1706a`）。别再退回 `id.slice(0, 8)`——那会让所有会话都得到 `session-`。
- 标签归属按 CDP `targetId` 记账（`pageClaims`），会话销毁或断开时必须 `releaseClaims()`，否则标签会被已结束的会话占着。
- `browser_status` 是只读的：任何分支都不要在里面建立连接。
