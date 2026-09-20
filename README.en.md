# playwright-browser

[![Release](https://img.shields.io/github/v/release/whklwhkl/dsh-playwright)](https://github.com/whklwhkl/dsh-playwright/releases)
[![License: MIT](https://img.shields.io/github/license/whklwhkl/dsh-playwright)](./LICENSE)

Browser automation plugin for DSH (DeepSeek Harness): gives agents a set of `browser_*` model tools that drive a real Chromium via Playwright — open pages, click, fill forms, extract the DOM, take screenshots.

> Compatibility: tested against [dsh 0.1.2-alpha.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.5).

- Requires `playwright-core` directly inside the host process — no external bridge service or ports of its own
- The browser launches lazily on first use and is closed automatically when the plugin is unloaded
- Optionally **attaches to an already-open browser** (CDP attach): take over the Chrome/Edge you are using, logins, cookies, extensions and open tabs included (see below)
- Only dependency: `playwright-core`

Language: tool descriptions, parameter docs and result text are bilingual. Set `PW_LANG=en` for English; the default is `zh`. See [中文版 README](./README.md).

## Tools

| Tool | What it does |
|---|---|
| `browser_open` | Open a URL; returns the final address and page title |
| `browser_status` | Query browser / current page state (attach mode, URL, title, tab count) |
| `browser_tabs` | List / switch / close open tabs (how the agent takes over your page in attach mode) |
| `browser_click` | Click an element (CSS or `text=` selector) |
| `browser_type` | Type text character by character (optional `delay`) |
| `browser_fill` | Fill an input field quickly |
| `browser_press` | Press a key (Enter / Tab / Escape …) |
| `browser_wait` | Wait for a number of milliseconds |
| `browser_extract` | Extract text from the page or an element |
| `browser_html` | Extract HTML from the page or an element |
| `browser_eval` | Run a JS expression in the page context (DOM diagnostics etc.) |
| `browser_screenshot` | Save a screenshot as PNG; returns the absolute path |
| `browser_close` | Close the browser and free resources (attach mode: disconnect only) |

## Installing into a DSH profile

One command from any directory (`dsh` locates the profile directory itself and initializes it on first use):

```bash
# example: install into the web profile
dsh plugin --profile web add git+https://github.com/whklwhkl/dsh-playwright.git
```

`dsh plugin` forwards everything after `add` to pnpm inside the profile directory, then automatically appends dependencies that declare `dsh.bundle` to `dsh.profile.bundles` — no manual `package.json` editing. Any pnpm install source works: registry names, `github:<user>/<repo>`, local paths.

For local development, point at your checkout with a `link:` prefix to install as a symlink, so edits need no reinstall (a DSH restart picks them up):

```bash
dsh plugin --profile web add link:/path/to/dsh-playwright
```

**Restart DSH:** bundles are read at startup. After the restart, the `browser_*` tools are available to every session under this profile.

> On dsh versions without the `plugin` subcommand: add `playwright-browser` to the profile `package.json` dependencies, append `playwright-browser` to `dsh.profile.bundles`, and run `pnpm install` inside the profile directory.

## Preparing the browser

`playwright-core` does **not** download a browser by itself. Before first use, pick one of these two options:

### Option A: let playwright-core download Chromium (recommended, zero config)

```bash
# any of the following (equivalent):
npx playwright-core install chromium
# or borrow the full-playwright installer:
npm i -D playwright && npx playwright install chromium
```

The browser lands in the standard cache (`~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux); the plugin auto-discovers it at launch.

### Option B: reuse an existing Chrome / Edge / Chromium (no download)

Set an environment variable for the DSH process, pointing at any browser executable:

```bash
export PW_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Linux example: export PW_CHROMIUM_PATH="/usr/bin/google-chrome"
```

> Version note: auto-discovery requires the playwright-core Chromium build to match (`npx playwright-core install chromium` always installs the matching build). Pointing `PW_CHROMIUM_PATH` at any Chromium-family binary has no version requirement.

### Option C: attach to a browser that is already open (reuse your logins)

Options A/B both start a **fresh, clean** browser — no logins, no extensions, none of the tabs you have open. To have the agent work inside the Chrome you are **already using**, turn on attach mode:

```bash
export PW_CDP_ENDPOINT=chrome        # your real default profile (recommended)
# or export PW_CDP_ENDPOINT=http://127.0.0.1:9222   # explicit debugging port
# or export PW_CDP_ENDPOINT=auto      # try chrome, then 9222
```

The `chrome` form requires a one-time opt-in in the target browser (a Chrome 136+ security default):

1. Open `chrome://inspect/#remote-debugging`
2. Tick **Allow remote debugging for this browser instance**

The plugin then attaches to your default profile: cookies, sessions, extensions and open tabs all included.

For the port form (`http://127.0.0.1:9222`) note that since Chrome 136 `--remote-debugging-port` is ignored for the **default data directory**: you must also pass a dedicated directory, and that Chrome has to be fully quit first:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-debug"
```

Attach-mode contract:

- `browser_status` connects on demand and tells you which page and how many tabs you got;
- `browser_tabs` lists every tab (`*` = current one); pass `index` or a `url` substring to switch to it (and bring it to front), add `close:true` to close it;
- `browser_open` navigates **the currently tracked tab** — don't point it at a page you want to keep; call `browser_tabs` first;
- `browser_close` **only disconnects and never closes your browser** (only a plugin-launched instance is really closed);
- `PW_CDP_PAGE` pins the tab to take over, by URL/title substring;
- `PW_HEADLESS` and `PW_CHROMIUM_PATH` do not apply (you started that browser yourself).

> Difference from [webclaw3](https://github.com/fatmind/webclaw3): webclaw3 bridges through a Chrome extension plus a local service; this plugin attaches natively over CDP, so no extension is needed. The trade-off is that CDP cannot see privileged pages such as `chrome://…` (the extension bridge can).

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `PW_LANG` | `zh` | `en` for English tool descriptions and output |
| `PW_CHROMIUM_PATH` | auto-discovery | Reuse a specific browser executable |
| `PW_HEADLESS` | `true` | Set to `false` to show a visible window (no effect in attach mode) |
| `PW_SHOT_DIR` | `shots/` under the plugin dir | Directory for screenshots |
| `PW_CDP_ENDPOINT` | unset | Set to enable attach mode: a channel name (`chrome`, `msedge`, …), `http://127.0.0.1:9222`, `ws://…`; comma-separate for fallbacks, or `auto` (= chrome, then 9222) |
| `PW_CDP_PAGE` | unset | On attach, pick the tab to drive by URL or title **substring** |

## Bundled skill: playwright-browser-tips

The bundle also carries a `playwright-browser-tips` skill whose body is a **site map**: per-site observed behavior and tactics under automation (search defaults to Bing), plus general recovery patterns. Bilingual following `PW_LANG`; the model loads it on demand when browser_* tools fail or when automating search/login flows, and users can invoke it directly with `/playwright-browser-tips`.

The map welcomes contributions — humans and agents alike can submit entries per [SITE-MAP-SPEC.md](./SITE-MAP-SPEC.md) (touch only `assets/site-map.json`), running `node scripts/validate-site-map.js` first and attaching its output to the PR. The framework text — including the anti-automation boundary (CAPTCHAs are always completed manually by the user) — is code-owned and does not change with map data.

The skill needs a profile with the skill registry — every `dsh-base`-backed profile (web, headless, acp, sdk-app) provides one. Same-name project or user-directory skills take precedence and can override the bundled version locally.

## Usage examples (what to tell the agent)

- "Open https://example.com with the browser and give me the page text"
- "Open Baidu, search for 'playwright', and tell me the first result title"
- "Open https://…, click 'Sign in', and take a screenshot"
- "Attach to my Chrome and extract the text of the current tab" (needs `PW_CDP_ENDPOINT`)
- "List the tabs in my browser, switch to the XXX page, then click Sign in" (needs `PW_CDP_ENDPOINT`)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Executable doesn't exist ... ms-playwright` | Browser not downloaded; run `npx playwright-core install chromium` |
| Chromium download drops / times out (common behind proxies) | Large transfers through a proxy are prone to interruption; use Option B's `PW_CHROMIUM_PATH` pointing at a system Chrome instead |
| `Could not connect to chrome: DevToolsActivePort file not found` | Attach mode found no debug endpoint: enable remote debugging at `chrome://inspect/#remote-debugging`, or switch to `PW_CDP_ENDPOINT=http://127.0.0.1:9222` and start Chrome with a dedicated `--user-data-dir` |
| `connect ECONNREFUSED 127.0.0.1:9222` | The target browser isn't running or the port is wrong: confirm it started with `--remote-debugging-port=9222` and that `curl http://127.0.0.1:9222/json/version` answers |
| In attach mode `browser_open` overwrote the page I was reading | Expected — it navigates the currently tracked tab; call `browser_tabs` first, or pin a tab with `PW_CDP_PAGE` |
| `net::ERR_CONNECTION_CLOSED` | Network issue or anti-bot on the target site; try another site / retry later |
| CAPTCHA popup (e.g. Baidu slider), input box invisible under headless | Anti-automation, not a plugin problem; Bing worked end to end in testing — prefer Bing, or set `PW_HEADLESS=false` for headed mode |
| Element "not visible" | Page changed or selector outdated; use `browser_eval` to inspect the DOM and pick a new selector |
| The current model can't view screenshots | `browser_screenshot` only saves a file; a vision-capable model is needed to "see" the image |

## Local development / quick self-test

```bash
# verify module loading and tool registration without starting DSH:
node --input-type=module -e "
import { apply } from './lib/index.js'
const tools = []
apply({ tools: { register: (d) => tools.push(d) }, effect: () => () => {} })
console.log(tools.map((t) => t.name).join('\n'))
"

# attach-mode smoke test (start a debuggable Chrome per Option C first):
PW_CDP_ENDPOINT=http://127.0.0.1:9222 node --input-type=module -e "
process.env.PW_CDP_ENDPOINT ||= 'http://127.0.0.1:9222'
const { apply } = await import('./lib/index.js')
const m = new Map()
apply({ tools: { register: (d) => m.set(d.name, d) }, effect: () => () => {} })
const call = (n, a = {}) => m.get('browser_' + n).execute(a)
console.log(await call('status'))   // should say it attached to your running browser
console.log(await call('tabs'))     // lists your existing tabs
console.log(await call('close'))    // disconnect only: Chrome must still be running
"
```

## Community & Support

This plugin is part of the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) ecosystem and carries the official `dsh-plugin` topic for discoverability, per the [community support guide](https://github.com/deepseek-ai/deepseek-harness#community-and-support).

- Plugin issues / feature requests: open an [Issue](https://github.com/whklwhkl/dsh-playwright/issues) or start a [Discussion](https://github.com/whklwhkl/dsh-playwright/discussions) here
- DSH framework feedback & bug reports: submit to [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- Join the DeepSeek Harness Discord community (see the official README)

## License

MIT
