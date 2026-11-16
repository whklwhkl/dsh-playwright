/**
 * Session-isolation self-test (no DSH needed).
 *
 * Simulates two DSH sessions the way the harness presents them to a tool:
 * execute(args, { agent }) where agent is the live Agent handle (id + a
 * scoped ctx whose effect() unwinds on disposal). Verifies:
 *   1. launch mode: each session forks its OWN Chromium; markers set in one
 *      session's page are invisible to the other; disposing one session's
 *      agent closes only its browser;
 *   2. per-session serialization: parallel calls within one session settle
 *      in order (open then eval sees the opened page);
 *   3. attach mode: two sessions attaching to ONE debuggable Chrome drive
 *      different tabs; an explicit page= takeover transfers the tab and the
 *      displaced session re-picks a free/new tab on its next call;
 *   4. PW_BROWSER_SCOPE=shared restores the legacy one-browser-for-all.
 *
 * Run: node scripts/test-session-isolation.mjs
 * Needs a playwright-core Chromium in the ms-playwright cache (see README).
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

// ── 1 + 2: launch mode, one browser per session ─────────────────────────────
{
  const { call, teardown } = mount()
  const A = fakeAgent('aaaa1111-session-a')
  const B = fakeAgent('bbbb2222-session-b')

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

// ── 3: attach mode — one shared Chrome, one tab per session ─────────────────
{
  const shared = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--remote-debugging-port=9333'],
  })
  // a real user's Chrome always has at least one tab
  await shared.newPage()
  try {
    const { call, teardown } = mount()
    const A = fakeAgent('cccc3333-session-a')
    const B = fakeAgent('dddd4444-session-b')
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

// ── 4: PW_BROWSER_SCOPE=shared (legacy behavior, separate process) ──────────
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

console.log('All session-isolation tests passed.')