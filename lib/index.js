/**
 * playwright-browser — host plugin.
 *
 * A normal Node module (unlike a dynamic plugin), so it imports playwright-core
 * directly and owns a Chromium instance in-process. Registers the same
 * browser_* tool set through ctx.tools.register; the browser launches lazily on
 * the first call and is closed when the plugin tears down (ctx.effect).
 *
 * i18n: tool descriptions, parameter docs and result text are bilingual.
 * Set PW_LANG=en for English; the default is zh (backwards compatible).
 *
 * Browser discovery is portable:
 *   - default: playwright-core auto-discovers its matching Chromium in the
 *     standard ms-playwright cache (see README "安装浏览器" / "Installing the
 *     browser" on how to fetch it);
 *   - override PW_CHROMIUM_PATH to reuse any Chrome/Edge/Chromium binary,
 *     e.g. a system Chrome, without downloading anything.
 *
 * Reusing an already-running browser (attach mode): set PW_CDP_ENDPOINT to a
 * CDP endpoint — an http/ws URL such as http://127.0.0.1:9222, or a channel
 * name such as `chrome`/`msedge` (resolved via the browser's
 * DevToolsActivePort file, which Chrome writes once the user enables
 * "Allow remote debugging for this browser instance" at
 * chrome://inspect/#remote-debugging). In attach mode the plugin drives the
 * tabs you already have open — logins, cookies and extensions included — and
 * browser_close only DISCONNECTS; it never quits your browser.
 *
 * Screenshots are written under the plugin shots dir by default; override with
 * the PW_SHOT_DIR env var. PW_HEADLESS=false runs a visible window.
 */
import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOT_DIR = process.env.PW_SHOT_DIR || path.join(__dirname, '..', 'shots')
// undefined → playwright-core auto-discovery; set to reuse an existing binary
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || undefined
// 'auto' | 'chrome' | 'http://127.0.0.1:9222' | comma-separated fallbacks.
// When set, the plugin attaches to an existing browser instead of launching.
const CDP_ENDPOINT = process.env.PW_CDP_ENDPOINT || undefined
// Optional substring (URL or title) picking which open tab to drive on attach.
const CDP_PAGE = process.env.PW_CDP_PAGE || undefined
// CDP 握手的等待预算。注意它不是"网络超时"：从 Chrome 136 起，通过
// chrome://inspect 的「允许远程调试」开关打开的服务，对于每一条新的 CDP
// 连接都会弹一个「要允许远程调试吗？」的授权框，在你点「允许」之前 WS 升级
// 握手一直被挂起。所以默认值要留够"人看到弹窗并点一下"的时间，太小就会
// 表现为莫名其妙的 Timeout（连不上、也没有任何线索）。
const CONNECT_TIMEOUT_MS =
  Number(process.env.PW_CDP_TIMEOUT) > 0 ? Number(process.env.PW_CDP_TIMEOUT) : 90000
// 端口探测等快速失败场景的超时
const FAST_TIMEOUT_MS = 3000
// 单次页面往返（取标题、置前）的预算。Playwright 的 Frame.title()、
// Page.bringToFront()、Page.close() 全都是 kNoTimeout（timeout: 0）：只要那个
// 标签的渲染进程不执行 JS——死循环、Chrome 的「页面无响应」、DevTools 里断点
// 暂停——调用就永不返回。而"顺手带上的标题"要遍历所有标签，一个这样的标签
// 足以把整次 browser_tabs 挂死，所以任何非必要的往返都必须有预算。
// 取不到标题不是错误，只是少一条信息；挂死整轮对话才是。
const RTT_BUDGET_MS =
  Number(process.env.PW_RTT_TIMEOUT) > 0 ? Number(process.env.PW_RTT_TIMEOUT) : 1500
// 关闭标签页同样不能无限等（渲染进程卡住时 close 也不会回）
const CLOSE_BUDGET_MS = 10000
const LANG = process.env.PW_LANG === 'en' ? 'en' : 'zh'

/**
 * 浏览器默认 profile 目录（channel 名的解析依据）。
 * 只有 Chrome/Edge 会把 DevToolsActivePort 写在这里。
 */
function channelProfileDirs(channel) {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    if (channel === 'chrome') return [path.join(home, 'Library/Application Support/Google/Chrome')]
    if (channel === 'msedge') return [path.join(home, 'Library/Application Support/Microsoft Edge')]
  } else if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local')
    if (channel === 'chrome') return [path.join(local, 'Google/Chrome/User Data')]
    if (channel === 'msedge') return [path.join(local, 'Microsoft/Edge/User Data')]
  } else {
    if (channel === 'chrome') return [path.join(home, '.config/google-chrome'), path.join(home, '.config/chromium')]
    if (channel === 'msedge') return [path.join(home, '.config/microsoft-edge')]
  }
  return []
}

/**
 * 读 DevToolsActivePort，拼出浏览器级 WS 端点。
 *
 * 这是 channel 名解析的正确做法，也是 `/json/version` 返回 404 时的唯一出路：
 * Chrome 153 起，经 chrome://inspect「允许远程调试」开关打开的服务只暴露 WS
 * 端点，`/json`、`/json/version`、`/json/list` 一律 404（实测），因此任何
 * "GET /json/version 拿 webSocketDebuggerUrl" 的发现流程都会死。
 *
 * Playwright 内置的 channel 解析在这里是不对的：它读同一个文件却只取第 1 行
 * 端口，拼成 `ws://localhost:<port>/devtools/browser`，把第 2 行的 GUID 路径
 * 丢了（见 playwright-core resolveChannelEndpoint），在 153 上必然连不上。
 */
function readDevToolsActivePort(channel) {
  for (const dir of channelProfileDirs(channel)) {
    const file = path.join(dir, 'DevToolsActivePort')
    let raw
    try {
      raw = fs.readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const lines = raw.split('\n')
    const port = Number.parseInt(String(lines[0] || '').trim(), 10)
    if (!Number.isInteger(port) || port <= 0) continue
    // 第 2 行可能是 `/devtools/browser/<guid>`，也可能只有 `/devtools/browser`
    let wsPath = String(lines[1] || '').trim()
    if (wsPath && !wsPath.startsWith('/')) wsPath = `/${wsPath}`
    return { dir, file, port, wsPath }
  }
  return null
}

/** channel 名（chrome/msedge）→ 可直接连的 ws:// 端点。 */
function channelWsEndpoint(channel) {
  const info = readDevToolsActivePort(channel)
  if (!info) {
    const dirs = channelProfileDirs(channel).join(', ') || '(unsupported platform)'
    throw new Error(
      LANG === 'en'
        ? `Could not connect to ${channel}: DevToolsActivePort not found under ${dirs}. Open chrome://inspect/#remote-debugging and turn on "Allow remote debugging for this browser instance".`
        : `无法挂载 ${channel}：在 ${dirs} 下没找到 DevToolsActivePort。请打开 chrome://inspect/#remote-debugging，打开「允许远程调试」开关。`,
    )
  }
  return `ws://127.0.0.1:${info.port}${info.wsPath}`
}

/** 端口是否真的有人监听（用来区分"端点写错"和"在等授权"）。 */
function portLive(port, host = '127.0.0.1', timeout = 400) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host })
    const done = (v) => {
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(timeout)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

/** 从 WS 端点里取端口；取不到就是 null。 */
function wsPortOf(endpoint) {
  try {
    const u = new URL(endpoint)
    if (u.port) return Number(u.port)
    return u.protocol === 'wss:' ? 443 : 80
  } catch {
    return null
  }
}

async function httpStatus(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(FAST_TIMEOUT_MS) })
    return resp.status
  } catch {
    return null
  }
}

/**
 * 给任意 promise 加预算：超时或出错都返回 fallback。
 * 原 promise 继续挂着即可——它不会再挡住任何后续调用。
 */
function withBudget(promise, ms, fallback) {
  let timer
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([Promise.resolve(promise).then((v) => v, () => fallback), expired]).finally(() =>
    clearTimeout(timer),
  )
}

/**
 * 取标签标题（带预算）。unresponsive=true 表示该标签在预算内没回话，
 * 即它的渲染进程没有执行 JS（或标签刚好被关掉）。
 * 这是插件里唯一允许对页面做"非必要往返"的地方，所以只有它能拿到标题。
 */
async function titleOf(p, budget = RTT_BUDGET_MS) {
  let timer
  let timedOut = false
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      resolve('')
    }, budget)
  })
  try {
    const title = await Promise.race([p.title().then((v) => String(v || ''), () => ''), expired])
    return { title, unresponsive: timedOut }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 尽力列出页面标签，给"哪个标签卡住了"提供线索。
 * 走的是浏览器侧的缓存元数据（不依赖渲染进程），所以即使标签已经卡死也能列出来。
 * Chrome 153 起经 chrome://inspect 打开的服务只暴露 WS 端点（/json/* 一律 404），
 * 那种端点下这里返回 null，属于正常降级。
 */
async function listTargetsForDiagnosis(endpoint) {
  let base = null
  if (/^https?:\/\//i.test(endpoint)) base = endpoint.replace(/\/+$/, '')
  else if (/^wss?:\/\//i.test(endpoint)) {
    const port = wsPortOf(endpoint)
    if (port) base = `http://127.0.0.1:${port}`
  }
  if (!base) return null
  try {
    const resp = await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(FAST_TIMEOUT_MS) })
    if (!resp.ok) return null
    const list = await resp.json()
    const pages = (Array.isArray(list) ? list : []).filter((t) => t.type === 'page')
    if (!pages.length) return null
    return pages.map((t) => `${t.title || '(untitled)'} — ${t.url}`)
  } catch {
    return null
  }
}

export const name = 'playwright-browser'

export const inject = ['tools']

export function apply(ctx) {
  fs.mkdirSync(SHOT_DIR, { recursive: true })

  let browser = null
  let page = null
  let context = null
  let mode = 'none' // 'none' | 'launched' | 'attached'
  let attachedEndpoint = null
  // 运行时端点覆盖，让 browser_attach 不必重启 DSH 就能换浏览器：
  //   undefined → 跟随 PW_CDP_ENDPOINT；字符串 → 挂载到该端点；null → 强制自建实例
  let endpointOverride

  // 候选 CDP 端点：auto = 先试本机默认 profile 的 chrome，再试经典 9222 端口
  // 每个 channel 名都在这里立刻解析成 ws:// 端点（读 DevToolsActivePort），
  // 不交给 Playwright 的 channel 解析——它在 Chrome 153 上会丢掉 GUID 路径。
  function cdpCandidates(endpoint) {
    if (!endpoint) return []
    const list = endpoint === 'auto' ? ['chrome', 'http://127.0.0.1:9222'] : endpoint.split(',')
    const out = []
    for (const item of list) {
      const s = item.trim()
      if (!s) continue
      if (s === 'chrome' || s === 'msedge') {
        try {
          out.push(channelWsEndpoint(s))
        } catch {
          // 没开远程调试 / 文件不在：跳过该 channel，让后面的候选继续
        }
        continue
      }
      out.push(s)
    }
    return out
  }

  /** 当前生效的端点；null 表示使用插件自建实例。 */
  function resolveEndpoint() {
    return (endpointOverride !== undefined ? endpointOverride : CDP_ENDPOINT) || null
  }

  // 在已连接的浏览器里挑一个页面来驱动：
  // 指定的 page 子串 / PW_CDP_PAGE 命中 URL·标题优先 → 最后一个 http(s) 页面 → 最后一个页面
  // strict + hint = 命中不到就报错（browser_attach 的显式选择），不做静默回退
  // 选页时命中的子串（WeakMap，不往 Playwright 的 page 对象上挂属性）
  const matchedHints = new WeakMap()

  async function pickAttachedPage(ctx, hint, strict) {
    const needle = hint || CDP_PAGE
    const pages = ctx.pages().filter((p) => !p.isClosed())
    if (!pages.length) return null
    // title() 要发一次 CDP 调用；后台标签可能迟迟不回，逐个 await 会把整个
    // 挂载拖死——共享的 titleOf 给每个标签页的标题一份很短的预算（RTT_BUDGET_MS）。
    if (needle) {
      let unresponsive = 0
      for (const p of pages) {
        const { title, unresponsive: stuck } = await titleOf(p)
        if (stuck) unresponsive++
        if (`${p.url()} ${title}`.includes(needle)) {
          matchedHints.set(p, needle)
          return p
        }
      }
      if (strict && hint) {
        throw new Error(
          (LANG === 'en' ? `no tab matching: ${hint}` : `没有匹配的标签页：${hint}`) +
            (unresponsive
              ? LANG === 'en'
                ? ` (${unresponsive} tab(s) did not respond, so a match cannot be ruled out)`
                : `（有 ${unresponsive} 个标签没有响应，无法确认是否匹配）`
              : ''),
        )
      }
    }
    const web = pages.filter((p) => /^https?:/.test(p.url()))
    const pool = web.length ? web : pages
    return pool[pool.length - 1]
  }

  /** 断开当前连接：挂载的浏览器只断开，自建实例才真正关闭。返回断开前的模式。 */
  async function disconnect() {
    const b = browser
    const was = mode
    browser = null
    page = null
    context = null
    mode = 'none'
    attachedEndpoint = null
    if (b) await b.close().catch(() => {})
    return was
  }

  /**
   * 挂载失败时收集线索——只报 "Timeout 15000ms exceeded" 是没法排查的。
   * 返回 { blob, consent }: blob 是给人看的诊断文本，consent 表示"端点活着，
   * 大概率是在等用户在授权框上点允许"（这种情况要给出明确的、可操作的提示）。
   */
  async function diagnoseEndpoint(endpoint, err) {
    const full = String(err && err.message ? err.message : err)
    const first = full.split('\n')[0]
    // Playwright 的调用日志留在完整 message 里：出现 <ws connected> 说明握手已经
    // 完成，超时发生在之后的初始化阶段——这和"在等授权框"是两件完全不同的事，
    // 报错却长得一模一样，所以必须分开判。（日志文案是 Playwright 内部格式，
    // 认不出来就退回到原来的授权提示，不会更糟。）
    const handshakeDone = /<ws connected>/.test(full)
    const lines = [first]
    const isWs = /^wss?:\/\//i.test(endpoint)
    const port = isWs ? wsPortOf(endpoint) : Number(new URL(endpoint).port || 80)
    let listening = false
    if (port) {
      listening = await portLive(port)
      lines.push(
        LANG === 'en'
          ? `port ${port}: ${listening ? 'listening' : 'NOT listening'}`
          : `端口 ${port}：${listening ? '在监听' : '没有监听'}`,
      )
    }
    if (!isWs) {
      const probe = `${endpoint.replace(/\/+$/, '')}/json/version`
      const status = await httpStatus(probe)
      lines.push(
        LANG === 'en'
          ? `${probe} → HTTP ${status === null ? 'no response' : status}`
          : `${probe} → HTTP ${status === null ? '无响应' : status}`,
      )
    }
    // DevToolsActivePort：既解释 channel 解析失败，也是 /json/version 404 时的正解
    for (const channel of ['chrome', 'msedge']) {
      const info = readDevToolsActivePort(channel)
      if (info) {
        lines.push(
          LANG === 'en'
            ? `DevToolsActivePort(${channel}): ${info.dir} → port ${info.port}, path ${info.wsPath || '(none)'}`
            : `DevToolsActivePort(${channel})：${info.dir} → 端口 ${info.port}，路径 ${info.wsPath || '(无)'}`,
        )
      }
    }
    if (listening && /timeout|timed out/i.test(first)) {
      if (handshakeDone) {
        // 握手完成 → 不是授权问题。挂载会等所有已存在的标签页初始化完，所以
        // 一个渲染进程不响应的标签就足以让它一直卡到超时。
        lines.push(
          LANG === 'en'
            ? 'HINT: the WebSocket handshake completed, but initialization never finished — this is NOT a consent dialog. Attaching waits for EVERY existing tab to finish initializing, so the likely cause is a tab whose renderer is not responding (infinite loop, Chrome\'s "Page unresponsive", or a paused debugger). Close that tab and retry; lower PW_CDP_TIMEOUT to fail fast.'
            : '提示：WS 握手已经完成，但初始化一直没结束——这不是在等授权框。挂载要等所有已存在的标签页初始化完，所以最可能的原因是某个标签的渲染进程不响应（死循环、Chrome 的「页面无响应」、DevTools 里断点暂停）。请检查并在浏览器里关掉那个标签页后重试；想快速失败可调小 PW_CDP_TIMEOUT。',
        )
        const pages = await listTargetsForDiagnosis(endpoint)
        if (pages) {
          lines.push(
            LANG === 'en'
              ? `current page targets (to spot the stuck one):\n  ${pages.join('\n  ')}`
              : `当前页面标签（帮你找那个卡住的）：\n  ${pages.join('\n  ')}`,
          )
        }
      } else {
        lines.push(
          LANG === 'en'
            ? 'HINT: the port is listening but the WebSocket handshake never completed. Chrome 136+ asks you to Allow remote debugging for EVERY new CDP connection — look for the "Allow remote debugging?" dialog in Chrome and click Allow, then call browser_attach again. Raise PW_CDP_TIMEOUT if you need more time to click.'
            : '提示：端口在监听但 WS 握手一直没完成。Chrome 136+ 对每一条新的 CDP 连接都会弹「要允许远程调试吗？」，请到 Chrome 窗口点「允许」，然后再调一次 browser_attach。需要更长时间点它就把 PW_CDP_TIMEOUT 调大。',
        )
      }
    }
    // 端点活着却超时：换下一个候选只会再等一遍（要么再弹一个授权框，要么还是
    // 那个卡住的标签），所以停下来把诊断交给用户。
    return { blob: lines.join('\n'), stopRetrying: listening }
  }

  async function attachBrowser(endpoint, hint, strict) {
    const candidates = cdpCandidates(endpoint)
    if (!candidates.length) {
      throw new Error(
        LANG === 'en'
          ? `No usable CDP endpoint from ${endpoint}. For a channel name, open chrome://inspect/#remote-debugging and enable "Allow remote debugging for this browser instance" first.`
          : `从 ${endpoint} 得不到可用的 CDP 端点。若用的是 channel 名（chrome/msedge），请先打开 chrome://inspect/#remote-debugging 并启用「允许远程调试」。`,
      )
    }
    const tried = []
    for (const candidate of candidates) {
      let b
      try {
        b = await chromium.connectOverCDP(candidate, { timeout: CONNECT_TIMEOUT_MS })
      } catch (err) {
        const { blob, stopRetrying } = await diagnoseEndpoint(candidate, err)
        tried.push(`${candidate}:\n${blob}`)
        // 端点活着 = 要么在等用户点授权框，要么某个标签卡住了。两种情况换下一个
        // 候选都只会再等一遍，所以直接停下来，把诊断交给用户。
        if (stopRetrying) break
        continue
      }
      browser = b
      mode = 'attached'
      attachedEndpoint = candidate
      context = b.contexts()[0] || (await b.newContext().catch(() => null))
      if (!context) {
        await disconnect().catch(() => {})
        tried.push(`${candidate}:\n${LANG === 'en' ? 'connected but no browser context' : '连上了但拿不到浏览器上下文'}`)
        continue
      }
      // 连接已成功：标签页选择失败要如实抛出，不再包装成"挂载失败"
      page = await pickAttachedPage(context, hint, strict)
      return page
    }
    const head = LANG === 'en' ? 'CDP attach failed' : 'CDP 挂载失败'
    const tail = LANG === 'en' ? `tried ${tried.length} endpoint(s)` : `已尝试 ${tried.length} 个端点`
    throw new Error(`${head} (${tail}):\n${tried.join('\n')}`)
  }

  async function launchBrowser() {
    const launchOptions = {
      headless: process.env.PW_HEADLESS !== 'false',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }
    if (CHROMIUM_PATH) launchOptions.executablePath = CHROMIUM_PATH
    browser = await chromium.launch(launchOptions)
    mode = 'launched'
    attachedEndpoint = null
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: LANG === 'en' ? 'en-US' : 'zh-CN',
    })
    page = await context.newPage()
    return page
  }

  async function ensurePage() {
    if (browser && browser.isConnected()) {
      if (page && !page.isClosed()) return page
      // 挂载模式下用户可能关掉了我们跟踪的标签，重新挑一个
      if (mode === 'attached' && context) {
        const next = await pickAttachedPage(context)
        if (next) {
          page = next
          return page
        }
      } else if (mode === 'launched' && context) {
        page = await context.newPage()
        return page
      }
    }
    const endpoint = resolveEndpoint()
    return endpoint ? attachBrowser(endpoint) : launchBrowser()
  }

  // 插件停止/更新时释放资源。挂载模式下 close() 只断开 CDP 连接，不会关闭用户的浏览器。
  ctx.effect(() => () => {
    disconnect().catch(() => {})
  })

  const ops = {
    async open(args) {
      const p = await ensurePage()
      await p.goto(String(args.url), {
        waitUntil: args.waitUntil || 'domcontentloaded',
        timeout: args.timeout || 30000,
      })
      const t = await titleOf(p)
      return { url: p.url(), title: t.title, unresponsive: t.unresponsive }
    },
    async status() {
      // 只读查询绝不主动建连接：Chrome 136+ 里每一条新 CDP 连接都会弹一次
      // 授权框，一个"你连上了吗"的查询值得让用户点一次弹窗是不可接受的。
      if (!browser || !browser.isConnected()) {
        return { open: false, mode, endpoint: attachedEndpoint, needAttach: !!resolveEndpoint() }
      }
      // 跟踪的标签页被关掉了：如实说明，让下一次调用重挑一个；以前这里会直接抛
      // "page.title: Target page, context or browser has been closed"。
      if (!page || page.isClosed()) {
        return {
          open: false,
          stalePage: true,
          mode,
          endpoint: attachedEndpoint,
          tabs: context ? context.pages().filter((p) => !p.isClosed()).length : 0,
        }
      }
      const { title, unresponsive } = await titleOf(page)
      return {
        open: true,
        mode,
        endpoint: mode === 'attached' ? attachedEndpoint : null,
        matched: matchedHints.get(page) || null,
        url: page.url(),
        title,
        unresponsive,
        tabs: context ? context.pages().filter((p) => !p.isClosed()).length : 1,
      }
    },
    async attach(args) {
      const raw = args && args.endpoint !== undefined ? String(args.endpoint).trim() : ''
      // endpoint:'launch' = 不再挂载，改用插件自建的干净浏览器（忽略环境变量）
      if (raw === 'launch' || raw === 'off' || raw === 'local') {
        await disconnect()
        endpointOverride = null
        return { launched: true }
      }
      const endpoint = raw || (mode === 'attached' && attachedEndpoint ? attachedEndpoint : CDP_ENDPOINT || 'auto')
      endpointOverride = endpoint
      const hint = args && args.page !== undefined ? String(args.page) : undefined
      // 同一个端点已连上就复用，绝不 b.close() + 重连：在 Chrome 136+ 下那等于
      // 让用户再点一次「允许远程调试」弹窗。
      const same = mode === 'attached' && browser && browser.isConnected() && cdpCandidates(endpoint).includes(attachedEndpoint)
      if (same) {
        // 同一端点：不重连，只按 page 子串重选标签页
        const next = await pickAttachedPage(context, hint, true)
        if (next) {
          page = next
          await withBudget(page.bringToFront(), RTT_BUDGET_MS * 2, undefined)
        }
      } else {
        await disconnect()
        await attachBrowser(endpoint, hint, hint !== undefined)
      }
      const t = page ? await titleOf(page) : { title: '', unresponsive: false }
      return {
        attached: true,
        endpoint: attachedEndpoint,
        matched: page ? matchedHints.get(page) || null : null,
        url: page ? page.url() : '',
        title: t.title,
        unresponsive: t.unresponsive,
        tabs: context ? context.pages().filter((p) => !p.isClosed()).length : 0,
      }
    },
    async tabs(args) {
      await ensurePage()
      const pages = context.pages().filter((x) => !x.isClosed())
      if (args && (args.index !== undefined || args.url)) {
        let target = null
        let unresponsive = 0
        if (args.index !== undefined) {
          target = pages[Number(args.index)] || null
          if (!target) throw new Error(`tab index out of range: ${args.index} (0-${pages.length - 1})`)
        } else {
          // 按 index 顺序取第一个命中（URL 或标题子串）。URL 是本地字段、零成本，
          // 所以只给"第一个 URL 命中之前的那些标签"取标题——命中项之后的标签不可能
          // 更靠前，再取标题纯属浪费（正常情况下一个 CDP 调用都不用发）。
          const needle = String(args.url)
          const firstUrlHit = pages.findIndex((x) => x.url().includes(needle))
          const scanEnd = firstUrlHit >= 0 ? firstUrlHit + 1 : pages.length
          const titled = await Promise.all(pages.slice(0, scanEnd).map((x) => titleOf(x)))
          unresponsive = titled.filter((t) => t.unresponsive).length
          const hit = pages.slice(0, scanEnd).findIndex((x, i) => `${x.url()} ${titled[i].title}`.includes(needle))
          target = hit >= 0 ? pages[hit] : null
          if (!target) {
            // 有标签没回话时不能说"就是没有匹配"——那是我们查不到，不是它不存在
            throw new Error(
              `no tab matching: ${args.url}` +
                (unresponsive
                  ? LANG === 'en'
                    ? ` (${unresponsive} tab(s) did not respond, so a match cannot be ruled out)`
                    : `（有 ${unresponsive} 个标签没有响应，无法确认是否匹配）`
                  : ''),
            )
          }
        }
        if (args.close) {
          if (target === page) page = null
          let closeErr = null
          const outcome = await withBudget(
            target.close().then(
              () => 'closed',
              (e) => {
                closeErr = e
                return 'error'
              },
            ),
            CLOSE_BUDGET_MS,
            'timeout',
          )
          if (outcome === 'closed') return { text: null, closed: true }
          if (outcome === 'timeout') return { text: null, closeTimedOut: true }
          return { text: null, closeFailed: closeErr ? String(closeErr.message || closeErr) : 'unknown' }
        }
        page = target
        await withBudget(page.bringToFront(), RTT_BUDGET_MS * 2, undefined)
        const { title, unresponsive: stuck } = await titleOf(page)
        return { switched: true, url: page.url(), title, unresponsive: stuck }
      }
      // 列表：并发取标题，每个标签一份预算——任何一个标签不响应都不会拖住整张
      // 列表，也不会把手上的连接坐死（这是 browser_tabs 原先卡住的直接原因）。
      const titled = await Promise.all(pages.map((x) => titleOf(x)))
      const rows = pages.map((x, i) => ({
        index: i,
        url: x.url(),
        title: titled[i].title,
        unresponsive: titled[i].unresponsive,
        current: x === page,
      }))
      return { tabs: rows }
    },
    async click(args) {
      const p = await ensurePage()
      await p.click(String(args.selector), { timeout: args.timeout || 10000 })
      return { ok: true }
    },
    async type(args) {
      const p = await ensurePage()
      await p.click(String(args.selector), { timeout: args.timeout || 10000 })
      await p.type(String(args.selector), String(args.text), { delay: args.delay || 0 })
      return { ok: true }
    },
    async fill(args) {
      const p = await ensurePage()
      await p.fill(String(args.selector), String(args.text), { timeout: args.timeout || 10000 })
      return { ok: true }
    },
    async press(args) {
      const p = await ensurePage()
      await p.keyboard.press(String(args.key))
      return { ok: true }
    },
    async wait(args) {
      const p = await ensurePage()
      await p.waitForTimeout(Number(args.ms || 1000))
      return { ok: true }
    },
    async extract(args) {
      const p = await ensurePage()
      let text
      if (args.selector) {
        const el = await p.$(String(args.selector))
        if (!el) throw new Error(`selector not found: ${args.selector}`)
        text = (await el.innerText()) || ''
      } else {
        text = await p.evaluate(() => (document.body ? document.body.innerText : ''))
      }
      return { text: String(text).slice(0, Number(args.limit || 20000)) }
    },
    async html(args) {
      const p = await ensurePage()
      let html
      if (args.selector) {
        const el = await p.$(String(args.selector))
        if (!el) throw new Error(`selector not found: ${args.selector}`)
        html = await el.evaluate((n) => n.outerHTML)
      } else {
        html = await p.content()
      }
      return { html: String(html).slice(0, Number(args.limit || 50000)) }
    },
    async eval(args) {
      const p = await ensurePage()
      const value = await p.evaluate(String(args.expression))
      if (value !== null && typeof value === 'object') return { value: JSON.stringify(value) }
      return { value: String(value) }
    },
    async screenshot(args) {
      const p = await ensurePage()
      const name = args.filename || `shot-${Date.now()}.png`
      const abs = path.isAbsolute(name) ? name : path.join(SHOT_DIR, name)
      await p.screenshot({ path: abs, fullPage: !!args.fullPage })
      return { path: abs }
    },
    async close() {
      const was = await disconnect()
      return { ok: true, detached: was === 'attached' }
    },
  }

  // ── i18n strings ──────────────────────────────────────────────────────────
  const STR = {
    zh: {
      empty: '(空结果)',
      errPrefix: '错误：',
      titleLabel: (r) => (r.unresponsive ? '(无响应)' : '(无标题)'),
      tabsHint: (n) =>
        `\n注意：有 ${n} 个标签页没有响应（渲染进程卡住了，例如死循环、Chrome 的「页面无响应」、或 DevTools 里断点暂停）。` +
        `它们的标题和页面操作都取不到，不要再驱动这些标签页；要恢复请在浏览器里关掉它们。`,
      opened: (r) => `已打开页面：${r.url}\n页面标题：${r.title || s.titleLabel(r)}`,
      online: (r) =>
        `浏览器在线（${r.mode === 'attached' ? `已挂载你正在使用的浏览器：${r.endpoint}` : '插件自建实例'}）\n当前 URL：${r.url}\n页面标题：${r.title || s.titleLabel(r)}\n标签页数：${r.tabs}` +
        (r.matched ? `\n（按“${r.matched}”选中的标签页）` : ''),
      offline: '浏览器未打开，挂载模式下的只读查询不会主动建连；需要驱动浏览器时调用 browser_attach',
      needAttach: (r) =>
        `尚未挂载浏览器（端点：${r.endpoint || '未配置'}）。\n查询状态不会主动建立 CDP 连接，因为 Chrome 136+ 对每条新连接都会弹「要允许远程调试吗？」授权框。\n需要驱动浏览器时调用 browser_attach，并在 Chrome 弹出授权框时点「允许」。`,
      stalePage: (r) =>
        `浏览器仍在线，但当前跟踪的标签页已经关闭（共 ${r.tabs} 个标签页）。\n` +
        `调用任意 browser_* 工具都会自动改挑一个标签页；也可以用 browser_attach 的 page 参数指定要接手的页面。`,
      shot: (r) => `截图已保存：${r.path}`,
      ok: (op) => `操作成功：${op}`,
      okClosed: '浏览器实例已关闭（下次操作会重新启动）',
      okDetached: '已断开与现有浏览器的连接（未关闭它，浏览器继续运行）',
      attached: (r) =>
        `已挂载浏览器\n端点：${r.endpoint}\n当前 URL：${r.url}\n页面标题：${r.title || s.titleLabel(r)}\n标签页数：${r.tabs}`,
      attachLaunched: '已改为使用插件自建的浏览器（下次操作时启动，与你现在用的浏览器互不影响）',
      tabs: (rows) => {
        const stuck = rows.filter((t) => t.unresponsive).length
        return (
          `共 ${rows.length} 个标签页（* = 当前操作页）：\n` +
          rows
            .map(
              (t) =>
                `[${t.index}]${t.current ? '*' : ' '} ${t.title || (t.unresponsive ? '(无响应)' : '(无标题)')} — ${t.url}`,
            )
            .join('\n') +
          (stuck ? s.tabsHint(stuck) : '')
        )
      },
      tabSwitched: (r) => `已切换当前操作页：${r.url}\n页面标题：${r.title || s.titleLabel(r)}`,
      tabClosed: '标签页已关闭',
      tabCloseTimedOut: '标签页关闭超时（渲染进程可能无响应），它可能仍然开着',
      tabCloseFailed: (r) => `关闭标签页失败：${r.closeFailed}`,
    },
    en: {
      empty: '(empty result)',
      errPrefix: 'Error: ',
      titleLabel: (r) => (r.unresponsive ? '(not responding)' : '(untitled)'),
      tabsHint: (n) =>
        `\nNote: ${n} tab(s) did not respond (their renderer is stuck — e.g. an infinite loop, Chrome's "Page unresponsive", or a paused debugger). ` +
        `Their titles and page operations are unavailable; do not drive those tabs. Close them in the browser to recover.`,
      opened: (r) => `Page opened: ${r.url}\nPage title: ${r.title || s.titleLabel(r)}`,
      online: (r) =>
        `Browser online (${r.mode === 'attached' ? `attached to your running browser: ${r.endpoint}` : 'plugin-launched instance'})\nCurrent URL: ${r.url}\nPage title: ${r.title || s.titleLabel(r)}\nTabs: ${r.tabs}` +
        (r.matched ? `\n(tab selected by "${r.matched}")` : ''),
      offline: 'Browser is not open; in attach mode a status query will not create a connection — call browser_attach when you need to drive the browser',
      needAttach: (r) =>
        `Not attached yet (endpoint: ${r.endpoint || 'not configured'}).\nA status query deliberately does NOT open a CDP connection, because Chrome 136+ asks for permission on every new connection.\nCall browser_attach to drive the browser, and click Allow in Chrome's "Allow remote debugging?" dialog.`,
      stalePage: (r) =>
        `The browser is still online, but the tab it was tracking has been closed (${r.tabs} tab(s) open).\n` +
        `Any browser_* tool will pick a tab again automatically; browser_attach's page argument pins a specific one.`,
      shot: (r) => `Screenshot saved: ${r.path}`,
      ok: (op) => `OK: ${op}`,
      okClosed: 'Browser instance closed (the next action starts it again)',
      okDetached: 'Disconnected from your browser (it was NOT closed and keeps running)',
      attached: (r) =>
        `Attached to browser\nEndpoint: ${r.endpoint}\nCurrent URL: ${r.url}\nPage title: ${r.title || s.titleLabel(r)}\nTabs: ${r.tabs}`,
      attachLaunched: 'Switched to a plugin-launched browser (starts on the next action; your own browser is untouched)',
      tabs: (rows) => {
        const stuck = rows.filter((t) => t.unresponsive).length
        return (
          `${rows.length} open tab(s) (* = current):\n` +
          rows
            .map(
              (t) =>
                `[${t.index}]${t.current ? '*' : ' '} ${t.title || (t.unresponsive ? '(not responding)' : '(untitled)')} — ${t.url}`,
            )
            .join('\n') +
          (stuck ? s.tabsHint(stuck) : '')
        )
      },
      tabSwitched: (r) => `Current tab switched: ${r.url}\nPage title: ${r.title || s.titleLabel(r)}`,
      tabClosed: 'Tab closed',
      tabCloseTimedOut: 'Closing the tab timed out (its renderer may be unresponsive); it may still be open',
      tabCloseFailed: (r) => `Failed to close the tab: ${r.closeFailed}`,
    },
  }
  const s = STR[LANG]

  // 工具描述与参数描述：{ zh, en } 双语对
  const D = {
    open: {
      zh: '打开一个 URL 并等待页面加载，返回最终地址和页面标题。参数 url 必填；waitUntil 可选（domcontentloaded|load|networkidle，默认 domcontentloaded）；timeout 为加载超时毫秒，默认 30000。',
      en: 'Open a URL and wait for the page to load; returns the final address and page title. url is required; waitUntil is optional (domcontentloaded|load|networkidle, default domcontentloaded); timeout is the load timeout in ms, default 30000.',
    },
    status: {
      zh: '查询浏览器与当前页面状态：是否在线、是否挂载了你正在使用的浏览器、当前 URL、页面标题、标签页数量。无需参数。',
      en: 'Query the browser and current page state: online status, whether it is attached to your running browser, current URL, page title, tab count. No arguments.',
    },
    tabs: {
      zh: '管理已打开的标签页。无参数时列出全部标签页（* 标记当前操作页）；传 index 或 url（子串匹配）则把该标签页切换为当前操作页并置前；再加 close:true 则关闭该标签页。挂载模式下用于接手你手动打开的页面。某个标签页的渲染进程卡住时，它会被标记为 (无响应)，本次调用仍会在约 PW_RTT_TIMEOUT 毫秒（默认 1500）内返回，不会挂住；此时按标题匹配可能落空，报错里会说明。',
      en: 'Manage open tabs. With no arguments, lists all tabs (* marks the current one); pass index or url (substring match) to make that tab the current one and bring it to front; add close:true to close it. In attach mode this is how the agent takes over a page you opened by hand. A tab whose renderer is stuck is marked (not responding); the call still returns within about PW_RTT_TIMEOUT ms (default 1500) instead of hanging, and a title-based match that misses says so in the error.',
    },
    attach: {
      zh: '挂载到一个已经在运行的浏览器（CDP），复用它的登录态、Cookie、扩展和已打开标签页——无需重启 DSH。endpoint 缺省时：已挂载就保持当前端点，否则用 PW_CDP_ENDPOINT（未设置则 auto）。',
      en: 'Attach to an already-running browser over CDP, reusing its logins, cookies, extensions and open tabs — no DSH restart needed. Without endpoint: keep the current endpoint if already attached, else use PW_CDP_ENDPOINT (auto when unset).',
    },
    click: {
      zh: '在页面上点击一个元素。selector 支持 CSS 选择器或 Playwright 文本选择器（如 text=登录）。',
      en: 'Click an element on the page. selector accepts a CSS selector or a Playwright text selector (e.g. text=Login).',
    },
    type: {
      zh: '先点击元素再逐字输入文本，适合输入框打字（可选 delay 模拟真人输入速度）。',
      en: 'Click the element first, then type text character by character — good for input fields (optional delay simulates human typing speed).',
    },
    fill: {
      zh: '直接填充输入框文本（比 type 快，一次写入，不模拟逐字输入）。',
      en: 'Fill an input field directly (faster than type; writes once, no per-character simulation).',
    },
    press: {
      zh: '在页面上按一个键盘键，如 Enter、Tab、Escape。',
      en: 'Press a keyboard key on the page, e.g. Enter, Tab, Escape.',
    },
    wait: {
      zh: '等待指定毫秒数（如等页面跳转、动画完成）。',
      en: 'Wait for the given number of milliseconds (e.g. for navigation or animations to finish).',
    },
    extract: {
      zh: '抓取页面正文文本。selector 缺省时抓取整个 body 的 innerText；指定 selector 则抓取该元素的文本。',
      en: "Extract text from the page. Without selector, grabs the whole body's innerText; with selector, grabs that element's text.",
    },
    html: {
      zh: '抓取页面 HTML。selector 缺省时抓取整个页面；指定则抓取该元素的外层 HTML。',
      en: "Extract HTML from the page. Without selector, grabs the whole page; with selector, grabs that element's outer HTML.",
    },
    eval: {
      zh: '在页面上下文执行一段 JavaScript 表达式并返回结果（用于诊断 DOM、检查元素可见性等）。',
      en: 'Execute a JavaScript expression in the page context and return the result (for DOM diagnostics, visibility checks, etc.).',
    },
    screenshot: {
      zh: '对当前页面截图保存为 PNG，返回文件绝对路径（可用 read_image 查看）。',
      en: 'Take a screenshot of the current page as PNG and return the absolute file path (view with read_image).',
    },
    close: {
      zh: '关闭浏览器实例释放资源（下次调用 browser_open 会自动重新启动）。挂载模式下只断开连接，不会关闭你正在使用的浏览器。',
      en: 'Close the browser instance to free resources (the next browser_open restarts it automatically). In attach mode this only disconnects; it never closes your browser.',
    },
  }

  const P = {
    url: { zh: '要打开的完整 URL（含协议，如 https://www.baidu.com）', en: 'Full URL to open (with protocol, e.g. https://www.baidu.com)' },
    waitUntil: { zh: '等待策略：domcontentloaded / load / networkidle', en: 'Wait strategy: domcontentloaded / load / networkidle' },
    timeout: { zh: '加载超时毫秒，默认 30000', en: 'Load timeout in ms, default 30000' },
    timeoutClick: { zh: '等待元素超时毫秒，默认 10000', en: 'Element wait timeout in ms, default 10000' },
    selector: { zh: 'CSS 选择器或 text= 文本选择器', en: 'CSS selector or text= selector' },
    selectorInput: { zh: '输入框的 CSS 选择器', en: 'CSS selector of the input field' },
    text: { zh: '要输入的文本', en: 'Text to input' },
    textFill: { zh: '要填写的文本', en: 'Text to fill' },
    delay: { zh: '每字间隔毫秒，默认 0', en: 'Delay between keystrokes in ms, default 0' },
    key: { zh: '按键名，如 Enter / Tab / Escape / ArrowDown', en: 'Key name, e.g. Enter / Tab / Escape / ArrowDown' },
    ms: { zh: '等待毫秒数，默认 1000', en: 'Milliseconds to wait, default 1000' },
    selectorOpt: { zh: '可选 CSS 选择器；缺省抓取整页正文', en: 'Optional CSS selector; defaults to whole-page text' },
    limitText: { zh: '返回文本最大字符数，默认 20000', en: 'Max characters of returned text, default 20000' },
    selectorHtml: { zh: '可选 CSS 选择器', en: 'Optional CSS selector' },
    limitHtml: { zh: '返回 HTML 最大字符数，默认 50000', en: 'Max characters of returned HTML, default 50000' },
    expression: { zh: '要执行的 JS 表达式，如 document.title 或一个 IIFE', en: 'JS expression to evaluate, e.g. document.title or an IIFE' },
    filename: { zh: '可选文件名；缺省自动命名 shot-<时间戳>.png，保存在插件 shots 目录', en: 'Optional filename; defaults to shot-<timestamp>.png in the plugin shots dir' },
    fullPage: { zh: '是否整页截图，默认只截视口', en: 'Whether to capture the full page; default is viewport only' },
    tabIndex: { zh: '标签页序号（browser_tabs 列表中的 index）', en: 'Tab index (as listed by browser_tabs)' },
    tabUrl: { zh: '按 URL 或标题子串匹配标签页', en: 'Match a tab by URL or title substring' },
    tabClose: { zh: '配合 index/url 使用：关闭该标签页而非切换（慎用）', en: 'With index/url: close that tab instead of switching to it (destructive)' },
    cdpEndpoint: {
      zh: 'CDP 端点：channel 名（chrome / msedge）、http://127.0.0.1:9222、ws://…，逗号分隔可做回退，auto = 先 chrome 再 9222；特殊值 launch 表示改用插件自建的浏览器',
      en: 'CDP endpoint: a channel name (chrome / msedge), http://127.0.0.1:9222, ws://…; comma-separate for fallbacks, auto = chrome then 9222; the special value launch switches back to a plugin-launched browser',
    },
    cdpPage: {
      zh: '按 URL 或标题子串选择要接手的标签页（覆盖 PW_CDP_PAGE）；命中不到会直接报错而不是随便挑一个',
      en: 'Pick the tab to drive by URL or title substring (overrides PW_CDP_PAGE); a miss is an error rather than an arbitrary pick',
    },
  }
  const t = (pair) => pair[LANG]

  function formatResult(op, result) {
    if (result === null || result === undefined) return s.empty
    switch (op) {
      case 'open':
        return s.opened(result)
      case 'status':
        if (result.error) return `${s.errPrefix}${result.error}`
        if (result.open) return s.online(result)
        if (result.stalePage) return s.stalePage(result)
        return result.needAttach ? s.needAttach(result) : s.offline
      case 'attach':
        return result.attached ? s.attached(result) : s.attachLaunched
      case 'tabs':
        if (result.tabs) return s.tabs(result.tabs)
        if (result.closed) return s.tabClosed
        if (result.closeTimedOut) return s.tabCloseTimedOut
        if (result.closeFailed) return s.tabCloseFailed(result)
        return s.tabSwitched(result)
      case 'extract':
        return String(result.text || '')
      case 'html':
        return String(result.html || '')
      case 'screenshot':
        return s.shot(result)
      case 'eval':
        return String(result.value || '')
      case 'click':
      case 'type':
      case 'fill':
      case 'press':
      case 'wait':
        return s.ok(op)
      case 'close':
        return result.detached ? s.okDetached : s.okClosed
      default:
        return JSON.stringify(result)
    }
  }

  // 与 dsh-jina 相同的注册路径：ctx.tools.register 直接接受完整 JSON Schema
  // 参数对象（type:object + properties + required + additionalProperties），
  // 而不是 defineTool 风格的 per-property map。
  function registerTool(op, desc, props, required) {
    const properties = {}
    for (const [key, spec] of Object.entries(props || {})) {
      properties[key] = { ...spec, description: t(spec.description) }
    }
    ctx.tools.register({
      name: `browser_${op}`,
      description: t(desc),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties,
        required: required || [],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args) {
        try {
          const result = await ops[op](args || {})
          return formatResult(op, result)
        } catch (err) {
          return `${s.errPrefix}${err && err.message ? err.message : String(err)}`
        }
      },
    })
  }

  registerTool('open', D.open, {
    url: { type: 'string', description: P.url },
    waitUntil: { type: 'string', description: P.waitUntil },
    timeout: { type: 'number', description: P.timeout },
  }, ['url'])
  registerTool('status', D.status, {})
  registerTool('attach', D.attach, {
    endpoint: { type: 'string', description: P.cdpEndpoint },
    page: { type: 'string', description: P.cdpPage },
  })
  registerTool('tabs', D.tabs, {
    index: { type: 'number', description: P.tabIndex },
    url: { type: 'string', description: P.tabUrl },
    close: { type: 'boolean', description: P.tabClose },
  })
  registerTool('click', D.click, {
    selector: { type: 'string', description: P.selector },
    timeout: { type: 'number', description: P.timeoutClick },
  }, ['selector'])
  registerTool('type', D.type, {
    selector: { type: 'string', description: P.selectorInput },
    text: { type: 'string', description: P.text },
    delay: { type: 'number', description: P.delay },
  }, ['selector', 'text'])
  registerTool('fill', D.fill, {
    selector: { type: 'string', description: P.selectorInput },
    text: { type: 'string', description: P.textFill },
  }, ['selector', 'text'])
  registerTool('press', D.press, {
    key: { type: 'string', description: P.key },
  }, ['key'])
  registerTool('wait', D.wait, {
    ms: { type: 'number', description: P.ms },
  })
  registerTool('extract', D.extract, {
    selector: { type: 'string', description: P.selectorOpt },
    limit: { type: 'number', description: P.limitText },
  })
  registerTool('html', D.html, {
    selector: { type: 'string', description: P.selectorHtml },
    limit: { type: 'number', description: P.limitHtml },
  })
  registerTool('eval', D.eval, {
    expression: { type: 'string', description: P.expression },
  }, ['expression'])
  registerTool('screenshot', D.screenshot, {
    filename: { type: 'string', description: P.filename },
    fullPage: { type: 'boolean', description: P.fullPage },
  })
  registerTool('close', D.close, {})
}
