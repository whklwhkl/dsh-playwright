/**
 * Session-isolation self-test (no DSH needed).
 *
 * Simulates two DSH sessions the way the harness presents them to a tool:
 * execute(args, { agent }) where agent is the live Agent handle (id + a
 * scoped ctx whose effect() unwinds on disposal). Verifies:
 *   1. launch mode: each session forks its OWN Chromium; markers set in one
 *      session's page are invisible to the other; disposing one session's
 *      agent closes only its browser; parallel calls within one session are
 *      serialized (open then eval sees the opened page);
 *   2. attach mode: two sessions attaching to ONE debuggable Chrome drive
 *      different tabs; an explicit page= takeover transfers the tab and the
 *      displaced session re-picks a free/new tab on its next call;
 *   3. PW_BROWSER_SCOPE=shared restores the legacy one-browser-for-all;
 *   4. browser_status always names the calling session (short label from the
 *      real `session-<uuid>` id shape) and explains what the next action does.
 *
 * Run: node scripts/test-session-isolation.mjs
 * Reuses PW_CHROMIUM_PATH when set (system Chrome), otherwise needs a
 * playwright-core Chromium in the ms-playwright cache (see README).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

// The host env may configure attach mode (PW_CDP_ENDPOINT); the launch-mode
// tests must start from a clean slate, so clear it BEFORE importing the plugin
// (module constants are read at load time).
delete process.env.PW_CDP_ENDPOINT
delete process.env.PW_CDP_PAGE
const { apply } = await import('../lib/index.js')

const dataUrl = (title) => `data:text/html,<title>${title}</title><body>${title}</body>`

function fakeAgent(id) {
  const cleanups = []
  return {
    id,
    ctx: { effect: (cb) => cleanups.push(cb()) },
    async dispose() {
      for (const c of cleanups.reverse()) await c()
    },
  }
}

function mount() {
  const tools = new Map()
  const pluginCleanups = []
  apply({
    tools: { register: (d) => tools.set(d.name, d) },
    effect: (cb) => pluginCleanups.push(cb()),
    get: () => undefined,
  })
  return {
    call: (name, args = {}, agent = undefined) =>
      tools.get(`browser_${name}`).execute(args, agent ? { agent } : undefined),
    async teardown() {
      for (const c of pluginCleanups.reverse()) await c()
    },
  }
}

// ── 1: launch mode — one browser per session + in-session serialization ─────
{
  const { call, teardown } = mount()
  // 真实的 DSH 会话 id 长这样：session-<uuid>。标签不能截成所有人共用的 "session-"。
  const A = fakeAgent('session-aaaa1111-53de-4c17-945f-bb7d7a457a29')
  const B = fakeAgent('session-bbbb2222-53de-4c17-945f-bb7d7a457a29')

  // status 在任何状态下（这里还没启动浏览器）都要标明调用方会话
  assert.match(await call('status', {}, A), /aaaa1111/, 'status names the session before launch')

  await call('open', { url: dataUrl('page-a') }, A)
  await call('open', { url: dataUrl('page-b') }, B)

  // separate browsers: a marker set in A's page must not exist in B's
  await call('eval', { expression: "window.__marker = 'A'" }, A)
  const seen = await call('eval', { expression: 'String(window.__marker)' }, B)
  assert.equal(seen, 'undefined', 'session B must not see session A\'s page')

  const statusA = await call('status', {}, A)
  const statusB = await call('status', {}, B)
  assert.match(statusA, /page-a/)
  assert.match(statusB, /page-b/)
  assert.match(statusA, /aaaa1111/, 'status names the owning session')
  assert.match(statusB, /bbbb2222/)

  // per-session serialization: parallel open+eval within A settles in order
  const [, title] = await Promise.all([
    call('open', { url: dataUrl('page-a2') }, A),
    call('eval', { expression: 'document.title' }, A),
  ])
  assert.equal(title, 'page-a2', 'queued eval must run after the queued open')

  // closing / disposing one session leaves the other untouched
  await call('close', {}, A)
  assert.match(await call('status', {}, A), /未打开|not open/)
  assert.equal(await call('eval', { expression: 'document.title' }, B), 'page-b')
  await A.dispose()
  await B.dispose() // agent disposal unwinds its browser via owner.ctx.effect
  assert.match(await call('status', {}, B), /未打开|not open/)

  // fallback owner (no exec.agent) still works
  await call('open', { url: dataUrl('fallback') })
  assert.equal(await call('eval', { expression: 'document.title' }), 'fallback')
  await teardown()
  // plugin teardown released the fallback session's browser too
  assert.match(await call('status', {}), /未打开|not open/)
  console.log('PASS 1: launch mode — per-session browsers, serialization, disposal cleanup')
}

// ── 2: attach mode — one shared Chrome, one tab per session ─────────────────
{
  const shared = await chromium.launch({
    headless: true,
    // 和插件一样优先复用系统 Chrome（PW_CHROMIUM_PATH）；没有时才回落
    // playwright-core 自带的那份（需要 ms-playwright 缓存已下载）。
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--remote-debugging-port=9333'],
  })
  // a real user's Chrome always has at least one tab
  await shared.newPage()
  try {
    const { call, teardown } = mount()
    const A = fakeAgent('session-cccc3333-53de-4c17-945f-bb7d7a457a29')
    const B = fakeAgent('session-dddd4444-53de-4c17-945f-bb7d7a457a29')
    const endpoint = 'http://127.0.0.1:9333'

    await call('attach', { endpoint }, A)
    await call('open', { url: dataUrl('tab-a') }, A)
    await call('attach', { endpoint }, B) // A's tab is claimed → B gets a fresh tab
    await call('open', { url: dataUrl('tab-b') }, B)

    // ground truth from the browser itself: the original Playwright connection
    // does not auto-attach to tabs created by another CDP client
    const list = await (await fetch(`${endpoint}/json/list`)).json()
    const targets = list.filter((t) => t.type === 'page')
    assert.equal(targets.length, 2, 'each attached session should own a distinct tab')
    assert.match(await call('status', {}, A), /tab-a/)
    assert.match(await call('status', {}, A), /cccc3333/, 'attach mode also names the session')
    assert.match(await call('status', {}, B), /tab-b/)

    // explicit takeover: B pins A's tab; A must re-pick on its next call
    await call('attach', { endpoint, page: 'tab-a' }, B)
    assert.match(await call('status', {}, B), /tab-a/)
    await call('eval', { expression: '1' }, A) // triggers re-pick
    assert.match(await call('status', {}, A), /about:blank/, 'displaced session opens its own tab')

    await A.dispose() // attached: disconnect only, never closes the user's browser
    await B.dispose()
    assert.ok(shared.isConnected(), 'attach-mode disposal must NOT close the shared browser')
    await teardown()
    console.log('PASS 2: attach mode — per-session tabs, claim takeover, disconnect-only cleanup')
  } finally {
    await shared.close()
  }
}

// ── 3: PW_BROWSER_SCOPE=shared (legacy behavior, separate process) ──────────
{
  const code = `
    import { apply } from ${JSON.stringify(new URL('../lib/index.js', import.meta.url).href)}
    const tools = new Map()
    apply({ tools: { register: (d) => tools.set(d.name, d) }, effect: () => () => {}, get: () => undefined })
    const call = (n, a, agent) => tools.get('browser_' + n).execute(a, { agent })
    const mk = (id) => ({ id, ctx: { effect: () => {} } })
    const A = mk('eeee5555'), B = mk('ffff6666')
    await call('open', { url: 'data:text/html,<title>shared</title>' }, A)
    await call('eval', { expression: "window.__marker = 'S'" }, A)
    const seen = await call('eval', { expression: 'String(window.__marker)' }, B)
    await call('close', {}, A)
    console.log(seen === 'S' ? 'SHARED-OK' : 'SHARED-BROKEN')
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    env: { ...process.env, PW_BROWSER_SCOPE: 'shared', PW_CDP_ENDPOINT: '', PW_CDP_PAGE: '' },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /SHARED-OK/, 'shared scope must keep one browser for all sessions')
  console.log('PASS 3: PW_BROWSER_SCOPE=shared restores the legacy single browser')
}

// ── 4: status names the session and explains the next action (regression) ───
{
  // 两个曾经的 bug：needAttach 文案没拼会话（README 却承诺 status 一定标明），
  // 以及 attach({endpoint:'launch'}) 之后仍说"未配置 CDP 端点"。
  // 端点故意指向没人监听的端口——status 只读，绝不会去连它。
  const code = `
    import { apply } from ${JSON.stringify(new URL('../lib/index.js', import.meta.url).href)}
    const tools = new Map()
    apply({ tools: { register: (d) => tools.set(d.name, d) }, effect: () => () => {}, get: () => undefined })
    const agent = { id: 'session-1234abcd-53de-4c17-945f-bb7d7a457a29', ctx: { effect: () => {} } }
    const call = (n, a = {}) => tools.get('browser_' + n).execute(a, { agent })
    const flat = (t) => String(t).replace(/\\s*\\n\\s*/g, ' | ')
    console.log('NEED:' + flat(await call('status')))
    await call('attach', { endpoint: 'launch' })
    console.log('FORCED:' + flat(await call('status')))
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    env: { ...process.env, PW_CDP_ENDPOINT: 'http://127.0.0.1:9999', PW_CDP_PAGE: '', PW_BROWSER_SCOPE: '' },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /NEED:[^\n]*1234abcd/, 'not-yet-attached status must name the session')
  assert.match(r.stdout, /NEED:[^\n]*127\.0\.0\.1:9999/, 'status must name the configured endpoint')
  assert.match(
    r.stdout,
    /FORCED:[^\n]*(?:自建模式|pinned to the plugin's own browser)/,
    'after attach({endpoint:"launch"}) status must not claim "no endpoint configured"',
  )
  console.log('PASS 4: status names the session and explains the next action before attaching')
}

// ── 5: JS dialog guard — auto-dismissed dialogs are recorded, never crash ───
{
  // 曾经的崩溃：插件不注册任何 dialog listener 时，playwright 自动 dismiss 走
  // `dialog._close().then(() => {})`（无 .catch()）；dialog 转眼消失时
  // Page.handleJavaScriptDialog 抛 "No dialog is showing"，unhandled rejection
  // 直接杀掉整个 DSH 进程。守卫注册后由插件负责 dismiss 并吞掉竞态错误，
  // 且 browser_status 会记录最近一次自动处理的弹窗。
  const { call, teardown } = mount()
  const A = fakeAgent('session-eeee7777-53de-4c17-945f-bb7d7a457a29')
  await call(
    'open',
    {
      url:
        'data:text/html,<title>dlg</title><script>setTimeout(function(){alert("crash-test-dialog")},80)</script>',
    },
    A,
  )
  // 等 alert 弹出并被守卫处理
  await new Promise((r) => setTimeout(r, 700))
  const st = await call('status', {}, A)
  assert.match(st, /crash-test-dialog/, 'status must record the auto-handled dialog')
  assert.match(st, /eeee7777/, 'dialog note must not displace the session label')
  // 进程还活着（测试能继续）且页面可用 = 守卫正常工作
  assert.equal(await call('eval', { expression: 'document.title' }, A), 'dlg')
  await teardown()
  console.log('PASS 5: JS dialogs are auto-dismissed by the plugin guard and shown in status')
}

console.log('All session-isolation tests passed.')
