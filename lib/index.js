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
 * Screenshots are written under the plugin shots dir by default; override with
 * the PW_SHOT_DIR env var. PW_HEADLESS=false runs a visible window.
 */
import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOT_DIR = process.env.PW_SHOT_DIR || path.join(__dirname, '..', 'shots')
// undefined → playwright-core auto-discovery; set to reuse an existing binary
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH || undefined
const LANG = process.env.PW_LANG === 'en' ? 'en' : 'zh'

export const name = 'playwright-browser'

export const inject = ['tools']

export function apply(ctx) {
  fs.mkdirSync(SHOT_DIR, { recursive: true })

  let browser = null
  let page = null

  async function ensurePage() {
    if (browser && browser.isConnected() && page) return page
    const launchOptions = {
      headless: process.env.PW_HEADLESS !== 'false',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }
    if (CHROMIUM_PATH) launchOptions.executablePath = CHROMIUM_PATH
    browser = await chromium.launch(launchOptions)
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: LANG === 'en' ? 'en-US' : 'zh-CN',
    })
    page = await context.newPage()
    return page
  }

  // 插件停止/更新时关闭浏览器，释放资源
  ctx.effect(() => () => {
    if (browser) {
      const b = browser
      browser = null
      page = null
      b.close().catch(() => {})
    }
  })

  const ops = {
    async open(args) {
      const p = await ensurePage()
      await p.goto(String(args.url), {
        waitUntil: args.waitUntil || 'domcontentloaded',
        timeout: args.timeout || 30000,
      })
      return { url: p.url(), title: await p.title() }
    },
    async status() {
      if (!browser || !browser.isConnected() || !page) return { open: false }
      return { open: true, url: page.url(), title: await page.title() }
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
      if (browser) {
        const b = browser
        browser = null
        page = null
        await b.close()
      }
      return { ok: true }
    },
  }

  // ── i18n strings ──────────────────────────────────────────────────────────
  const STR = {
    zh: {
      empty: '(空结果)',
      errPrefix: '错误：',
      opened: (r) => `已打开页面：${r.url}\n页面标题：${r.title || ''}`,
      online: (r) => `浏览器在线\n当前 URL：${r.url}\n页面标题：${r.title || ''}`,
      offline: '浏览器未打开，请先调用 browser_open',
      shot: (r) => `截图已保存：${r.path}`,
      ok: (op) => `操作成功：${op}`,
    },
    en: {
      empty: '(empty result)',
      errPrefix: 'Error: ',
      opened: (r) => `Page opened: ${r.url}\nPage title: ${r.title || ''}`,
      online: (r) => `Browser online\nCurrent URL: ${r.url}\nPage title: ${r.title || ''}`,
      offline: 'Browser is not open; call browser_open first',
      shot: (r) => `Screenshot saved: ${r.path}`,
      ok: (op) => `OK: ${op}`,
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
      zh: '查询浏览器与当前页面状态：是否在线、当前 URL、页面标题。无需参数。',
      en: 'Query the browser and current page state: online status, current URL, page title. No arguments.',
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
      zh: '关闭浏览器实例释放资源（下次调用 browser_open 会自动重新启动）。',
      en: 'Close the browser instance to free resources (the next browser_open restarts it automatically).',
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
  }
  const t = (pair) => pair[LANG]

  function formatResult(op, result) {
    if (result === null || result === undefined) return s.empty
    switch (op) {
      case 'open':
        return s.opened(result)
      case 'status':
        return result.open ? s.online(result) : s.offline
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
      case 'close':
        return s.ok(op)
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
