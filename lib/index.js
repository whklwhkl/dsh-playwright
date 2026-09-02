/**
 * playwright-browser — host plugin.
 *
 * A normal Node module (unlike a dynamic plugin), so it imports playwright-core
 * directly and owns a Chromium instance in-process. Registers the same
 * browser_* tool set through ctx.tools.register; the browser launches lazily on
 * the first call and is closed when the plugin tears down (ctx.effect).
 *
 * Browser discovery is portable:
 *   - default: playwright-core auto-discovers its matching Chromium in the
 *     standard ms-playwright cache (see README "安装浏览器" on how to fetch it);
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
      locale: 'zh-CN',
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

  function formatResult(op, result) {
    if (result === null || result === undefined) return '(空结果)'
    switch (op) {
      case 'open':
        return `已打开页面：${result.url}\n页面标题：${result.title || ''}`
      case 'status':
        return result.open
          ? `浏览器在线\n当前 URL：${result.url}\n页面标题：${result.title || ''}`
          : '浏览器未打开，请先调用 browser_open'
      case 'extract':
        return String(result.text || '')
      case 'html':
        return String(result.html || '')
      case 'screenshot':
        return `截图已保存：${result.path}`
      case 'eval':
        return String(result.value || '')
      case 'click':
      case 'type':
      case 'fill':
      case 'press':
      case 'wait':
      case 'close':
        return `操作成功：${op}`
      default:
        return JSON.stringify(result)
    }
  }

  // 与 dsh-jina 相同的注册路径：ctx.tools.register 直接接受完整 JSON Schema
  // 参数对象（type:object + properties + required + additionalProperties），
  // 而不是 defineTool 风格的 per-property map。
  function registerTool(op, description, properties, required) {
    ctx.tools.register({
      name: `browser_${op}`,
      description,
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
          return `错误：${err && err.message ? err.message : String(err)}`
        }
      },
    })
  }

  registerTool(
    'open',
    '打开一个 URL 并等待页面加载，返回最终地址和页面标题。参数 url 必填；waitUntil 可选（domcontentloaded|load|networkidle，默认 domcontentloaded）；timeout 为加载超时毫秒，默认 30000。',
    {
      url: { type: 'string', description: '要打开的完整 URL（含协议，如 https://www.baidu.com）' },
      waitUntil: { type: 'string', description: '等待策略：domcontentloaded / load / networkidle' },
      timeout: { type: 'number', description: '加载超时毫秒，默认 30000' },
    },
    ['url'],
  )
  registerTool('status', '查询浏览器与当前页面状态：是否在线、当前 URL、页面标题。无需参数。', {})
  registerTool('click', '在页面上点击一个元素。selector 支持 CSS 选择器或 Playwright 文本选择器（如 text=登录）。', {
    selector: { type: 'string', description: 'CSS 选择器或 text= 文本选择器' },
    timeout: { type: 'number', description: '等待元素超时毫秒，默认 10000' },
  }, ['selector'])
  registerTool('type', '先点击元素再逐字输入文本，适合输入框打字（可选 delay 模拟真人输入速度）。', {
    selector: { type: 'string', description: '输入框的 CSS 选择器' },
    text: { type: 'string', description: '要输入的文本' },
    delay: { type: 'number', description: '每字间隔毫秒，默认 0' },
  }, ['selector', 'text'])
  registerTool('fill', '直接填充输入框文本（比 type 快，一次写入，不模拟逐字输入）。', {
    selector: { type: 'string', description: '输入框的 CSS 选择器' },
    text: { type: 'string', description: '要填写的文本' },
  }, ['selector', 'text'])
  registerTool('press', '在页面上按一个键盘键，如 Enter、Tab、Escape。', {
    key: { type: 'string', description: '按键名，如 Enter / Tab / Escape / ArrowDown' },
  }, ['key'])
  registerTool('wait', '等待指定毫秒数（如等页面跳转、动画完成）。', {
    ms: { type: 'number', description: '等待毫秒数，默认 1000' },
  })
  registerTool('extract', '抓取页面正文文本。selector 缺省时抓取整个 body 的 innerText；指定 selector 则抓取该元素的文本。', {
    selector: { type: 'string', description: '可选 CSS 选择器；缺省抓取整页正文' },
    limit: { type: 'number', description: '返回文本最大字符数，默认 20000' },
  })
  registerTool('html', '抓取页面 HTML。selector 缺省时抓取整个页面；指定则抓取该元素的外层 HTML。', {
    selector: { type: 'string', description: '可选 CSS 选择器' },
    limit: { type: 'number', description: '返回 HTML 最大字符数，默认 50000' },
  })
  registerTool('eval', '在页面上下文执行一段 JavaScript 表达式并返回结果（用于诊断 DOM、检查元素可见性等）。', {
    expression: { type: 'string', description: '要执行的 JS 表达式，如 document.title 或一个 IIFE' },
  }, ['expression'])
  registerTool('screenshot', '对当前页面截图保存为 PNG，返回文件绝对路径（可用 read_image 查看）。', {
    filename: { type: 'string', description: '可选文件名；缺省自动命名 shot-<时间戳>.png，保存在插件 shots 目录' },
    fullPage: { type: 'boolean', description: '是否整页截图，默认只截视口' },
  })
  registerTool('close', '关闭浏览器实例释放资源（下次调用 browser_open 会自动重新启动）。', {})
}
