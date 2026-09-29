# playwright-browser

[![Release](https://img.shields.io/github/v/release/whklwhkl/dsh-playwright)](https://github.com/whklwhkl/dsh-playwright/releases)
[![License: MIT](https://img.shields.io/github/license/whklwhkl/dsh-playwright)](./LICENSE)

Browser automation plugin for DSH (DeepSeek Harness): gives agents a set of `browser_*` model tools that drive a real Chromium via Playwright — open pages, click, fill forms, extract the DOM, take screenshots.

> Compatibility: tested against [dsh 0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2) — tool registration and real browser driving, the bundled skill, and bundle composition were all exercised on that version.
>
> Since dsh 0.2.0-rc.2 there is a **plugin compatibility gate**: dsh reads a plugin's `peerDependencies` and **denies** any row whose `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` semver range does not satisfy the running runtime (the plugin manager reports `incompatible-version`); the row only loads after `dsh plugin allow-version <package>@<version> --dsh-version <version> --accept-risk`. This plugin therefore declares `@deepseek-ai/dsh: ^0.2.0-rc.2` (the whole 0.2.x line) and mirrors it in `engines.dsh`. When you move to dsh 0.3 or later, update this plugin too, or the gate will hold it back.
>
> That peer is marked `optional`: dsh writes `autoInstallPeers: false` into every profile, and the runtime dsh is supplied by the installation rather than installed into the profile — optional only avoids pnpm's "unmet peer" warning. The gate reads `peerDependencies` itself and ignores `peerDependenciesMeta`.

- Requires `playwright-core` directly inside the host process — no external bridge service or ports of its own
- The browser launches lazily on first use and is closed automatically when the plugin is unloaded
- Optionally **attaches to an already-open browser** (CDP attach): take over the Chrome/Edge you are using, logins, cookies, extensions and open tabs included (see below)
- Only dependency: `playwright-core`
- **Cancel means cancel**: `exec.signal` is forwarded — `goto`/`click`/`fill`/`type`/`press`/`innerText`/`screenshot` hand the signal to Playwright (the in-flight operation is really aborted), and the calls Playwright cannot cancel (`connectOverCDP`, `launch`, `evaluate`, `waitForTimeout`, …) still settle immediately, so an interrupted turn never hangs on the browser
- **A failure is a failure**: a failing op throws, so dsh renders the canonical failed result (`isError`, text `Error: …`) instead of a "successful" call whose text happens to start with an error prefix — retry/self-correction policies and the session log can see it
- **Screenshots are visible**: `browser_screenshot` hands the PNG to the profile's attachment service and returns an image block beside the path, so a model that accepts image input sees the page directly (otherwise dsh substitutes placeholder text and the path still works with `read_image`)

Language: tool descriptions, parameter docs and result text are bilingual. Set `PW_LANG=en` for English; the default is `zh`. See [中文版 README](./README.md).

## Tools

| Tool | What it does |
|---|---|
| `browser_open` | Open a URL; returns the final address and page title |
| `browser_status` | Query browser / current page state (attach mode, endpoint, URL, title, tab count) |
| `browser_attach` | Attach to / switch to an already-running browser at runtime (no DSH restart) |
| `browser_tabs` | List / switch / close open tabs (how the agent takes over your page in attach mode) |
| `browser_click` | Click an element (CSS or `text=` selector) |
| `browser_type` | Type text character by character (optional `delay`) |
| `browser_fill` | Fill an input field quickly |
| `browser_press` | Press a key (Enter / Tab / Escape …) |
| `browser_wait` | Wait for a number of milliseconds |
| `browser_extract` | Extract text from the page or an element |
| `browser_html` | Extract HTML from the page or an element |
| `browser_eval` | Run a JS expression in the page context (DOM diagnostics etc.) |
| `browser_screenshot` | Save a screenshot as PNG and return the absolute path; a model that accepts image input also sees the image |
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

> A `link:` install is a symlink, so **the plugin's own dependencies are not installed into the profile**: run `pnpm install` in this checkout once (it installs `playwright-core`), or dsh will fail to load the plugin with `Cannot find package 'playwright-core'` and the `browser_*` tools simply disappear. The `pnpm-workspace.yaml` in this repo (`autoInstallPeers: false`) exists for the same reason — it is exactly what dsh writes into every profile, and it stops pnpm from following `peerDependencies` into pulling the whole `@deepseek-ai/dsh` runtime tree into this checkout.
>
> If the tools worked and then vanished after a plugin reinstall, restart dsh: a host plugin that failed to load is not retried automatically.

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

> ⚠️ **Chrome asks "Allow remote debugging?" for EVERY new CDP connection** (measured on Chrome 153; it is the aggressive security policy of the `chrome://inspect` toggle and cannot be configured to remember the answer). Until you click Allow, the WebSocket upgrade handshake is **silently parked**, which looks exactly like "cannot connect / unexplained timeout".
> So: **for the first attach, watch the Chrome window and click Allow once**. Afterwards the plugin reuses that single connection — a repeated `browser_attach` on the same endpoint, `browser_tabs`, `browser_open` and friends never reconnect. `browser_close`, a plugin reload or a DSH restart drop it, and you approve once again next time.

For the port form (`http://127.0.0.1:9222`) note that since Chrome 136 `--remote-debugging-port` is ignored for the **default data directory**: you must also pass a dedicated directory, and that Chrome has to be fully quit first:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.chrome-debug"
```

> This path **never shows the consent dialog** (it does not go through the `chrome://inspect` toggle) and `/json/version` answers normally. The trade-off is that the dedicated directory is new: log in once to the sites you need there. Best for unattended / long-running automation; use channel name `chrome` when you want your existing sessions.

Attach-mode contract:

- `browser_status` does **not** connect (a new connection means another consent dialog); when not attached it tells you to call `browser_attach`;
- a repeated `browser_attach` on the same endpoint **reuses the live connection** (it only re-picks the tab by `page` substring) instead of disconnecting and asking you to approve again;
- `browser_tabs` lists every tab (`*` = current one); pass `index` or a `url` substring to switch to it (and bring it to front), add `close:true` to close it;
- incidental round-trips such as reading a title are **budgeted**: when a tab's renderer is stuck (infinite loop, Chrome's "Page unresponsive", a paused debugger) it is marked `(not responding)` and the call still returns within about `PW_RTT_TIMEOUT` ms instead of wedging the whole turn;
- `browser_open` navigates **the currently tracked tab** — don't point it at a page you want to keep; call `browser_tabs` first;
- `browser_close` **only disconnects and never closes your browser** (only a plugin-launched instance is really closed);
- `PW_CDP_PAGE` pins the tab to take over, by URL/title substring;
- a failed attach reports diagnostics — whether the port is listening, the `/json/version` HTTP status, the `DevToolsActivePort` contents — and distinguishes "the WebSocket handshake never completed" (= waiting for you to click Allow) from "the handshake completed but initialization never finished" (= a tab's renderer is not responding; the message lists the tabs to help you spot it);
- the connect budget is `PW_CDP_TIMEOUT` (default 90s, enough to notice the dialog and click it); a port with nobody listening still fails in milliseconds;
- `PW_HEADLESS` and `PW_CHROMIUM_PATH` do not apply (you started that browser yourself).

> The two forms are not interchangeable (measured): a browser debugged through the `chrome://inspect` toggle serves **only the WebSocket endpoint and does not answer the HTTP discovery API** (`http://127.0.0.1:9222/json/version` returns 404), so such an instance must be addressed by channel name `chrome`; a browser started with `--remote-debugging-port` accepts either form.
> The plugin now resolves the `chrome` channel itself by reading `DevToolsActivePort` (port on line 1, GUID path on line 2) instead of using Playwright's built-in channel resolution, which keeps only the port, drops the GUID path, and therefore cannot connect on Chrome 153.

**Attach without restarting DSH:** have the agent call `browser_attach` (or just say "attach to my Chrome"). It takes the same values as `PW_CDP_ENDPOINT`:

| Call | Effect |
|---|---|
| `browser_attach` | Default endpoint: stays on the current one if already attached, else `PW_CDP_ENDPOINT` (`auto` when unset) |
| `browser_attach({ endpoint: "chrome" })` | Attach to that endpoint (channel name / `http://…` / `ws://…` / `auto` / comma-separated fallbacks) |
| `browser_attach({ page: "portal" })` | Keep the browser, just switch the tracked tab by URL/title substring; a miss is an error |
| `browser_attach({ endpoint: "launch" })` | Stop attaching and go back to a plugin-launched browser (ignores the env var) |

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
| `PW_CDP_TIMEOUT` | `90000` | Attach connect budget in ms. It doubles as the window for clicking Allow in Chrome's consent dialog; a port with nobody listening still fails in milliseconds |
| `PW_RTT_TIMEOUT` | `1500` | Budget in ms for a single page round-trip (title, bring-to-front). It is what turns a stuck renderer into a fast `(not responding)` marker instead of a wedged call |

## Bundled skill: playwright-browser-tips

The bundle also carries a `playwright-browser-tips` skill whose body is a **site map**: per-site observed behavior and tactics under automation (search defaults to Bing), plus general recovery patterns. Bilingual following `PW_LANG`; the model loads it on demand when browser_* tools fail or when automating search/login flows, and users can invoke it directly with `/playwright-browser-tips`.

The map welcomes contributions — humans and agents alike can submit entries per [SITE-MAP-SPEC.md](./SITE-MAP-SPEC.md) (touch only `assets/site-map.json`), running `node scripts/validate-site-map.js` first and attaching its output to the PR. The framework text — including the anti-automation boundary (CAPTCHAs are always completed manually by the user) — is code-owned and does not change with map data.

The skill needs a profile with the skill registry — every `dsh-base`-backed profile (web, headless, acp, sdk-app) provides one. Same-name project or user-directory skills take precedence and can override the bundled version locally.

## Usage examples (what to tell the agent)

- "Open https://example.com with the browser and give me the page text"
- "Open Baidu, search for 'playwright', and tell me the first result title"
- "Open https://…, click 'Sign in', and take a screenshot"
- "Attach to my Chrome and extract the text of the current tab" (the agent calls `browser_attach`, or set `PW_CDP_ENDPOINT`)
- "List the tabs in my browser, switch to the XXX page, then click Sign in" (same)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Executable doesn't exist ... ms-playwright` | Browser not downloaded; run `npx playwright-core install chromium` |
| Chromium download drops / times out (common behind proxies) | Large transfers through a proxy are prone to interruption; use Option B's `PW_CHROMIUM_PATH` pointing at a system Chrome instead |
| `Could not connect to chrome: DevToolsActivePort file not found` | The target browser has debugging off: enable it at `chrome://inspect/#remote-debugging`, or switch to `PW_CDP_ENDPOINT=http://127.0.0.1:9222` and start Chrome with a dedicated `--user-data-dir` |
| `http://127.0.0.1:9222` fails with `Unexpected status 404 ... /json/version/` | The browser on that port was enabled via the `chrome://inspect` toggle: it serves no HTTP discovery API; address it by channel name `chrome` instead (or `browser_attach({endpoint:"chrome"})`) |
| `connect ECONNREFUSED 127.0.0.1:9222` | The target browser isn't running or the port is wrong: confirm it started with `--remote-debugging-port=9222` and that `curl http://127.0.0.1:9222/json/version` answers |
| `CDP attach failed (tried N endpoint(s))` | Wrong endpoint or debugging is off; the message now lists per-endpoint reasons plus whether the port is listening, the `/json/version` status and the `DevToolsActivePort` contents |
| Attach fails with `Timeout ... exceeded` plus "port is listening but the WebSocket handshake never completed" | **Chrome is waiting for you to approve**: switch to Chrome and click Allow in the "Allow remote debugging?" dialog, then call `browser_attach` again. If you cannot find the dialog, check other/minimized Chrome windows; raise `PW_CDP_TIMEOUT` if you need longer |
| Attach fails with `Timeout ... exceeded` plus "the WebSocket handshake completed, but initialization never finished" | **Not a consent problem**: a tab's renderer is not responding (attaching waits for every existing tab to finish initializing). The message lists the current tabs — close the stuck one (Chrome usually shows "Page unresponsive") and retry; lower `PW_CDP_TIMEOUT` to fail fast |
| A `browser_tabs` row shows `(not responding)` as its title | That tab's renderer is stuck (infinite loop, Chrome's "Page unresponsive", a paused debugger). Its title and page operations are unavailable, so don't drive it; close it in the browser to recover. A plain `(untitled)` just means the page has no title |
| `browser_tabs` / `browser_status` hang forever | 0.4.0 and earlier wedged the whole call on a non-responding tab's title. From 0.4.1 every round-trip is budgeted (`PW_RTT_TIMEOUT`, default 1500ms), so the worst case is a `(not responding)` marker |
| Every `browser_attach` pops the consent dialog again | Something disconnected in between (`browser_close`, plugin reload, DSH restart). A repeated `browser_attach` on the same endpoint now reuses the connection; to get rid of the dialog entirely use the port form with a dedicated `--user-data-dir` (see Option C) |
| In attach mode `browser_open` overwrote the page I was reading | Expected — it navigates the currently tracked tab; call `browser_tabs` first, or pin a tab with `PW_CDP_PAGE` |
| `net::ERR_CONNECTION_CLOSED` | Network issue or anti-bot on the target site; try another site / retry later |
| CAPTCHA popup (e.g. Baidu slider), input box invisible under headless | Anti-automation, not a plugin problem; Bing worked end to end in testing — prefer Bing, or set `PW_HEADLESS=false` for headed mode |
| Element "not visible" | Page changed or selector outdated; use `browser_eval` to inspect the DOM and pick a new selector |
| The screenshot returns only a path, no image | Three causes: no attachment service is mounted (every `dsh-base`-backed profile mounts one), the image exceeds the deployment's limits, or the current model does not accept image input. The latter two are harmless — the path is still returned and `read_image` can view it |
| After `browser_open` fails with `net::ERR_*`, every later page load fails with `... is interrupted by another navigation to chrome-error://...` | Pre-0.5.0 behaviour: a failed navigation leaves a pending error-page navigation in that tab and blocks every later navigation in it (a reload cannot recover). From 0.5.0 `browser_open` detects these failures and swaps the page out (launched mode closes and recreates it; attach mode opens a new tab and **does not close yours**) |
| Failed results changed from `错误：…` to `Error: …` | From 0.5.0 errors are thrown to dsh, which renders the canonical failed result (`isError`); the prefix is dsh's, hence English. Test `isError`, not the text |

## Local development / quick self-test

```bash
# verify module loading and tool registration without starting DSH:
node --input-type=module -e "
import { apply } from './lib/index.js'
const tools = []
apply({ tools: { register: (d) => tools.push(d) }, effect: () => () => {} })
console.log(tools.map((t) => t.name).join('\n'))
"

# attach-mode smoke test (start a debuggable Chrome per Option C first);
# no PW_CDP_ENDPOINT needed — browser_attach takes the endpoint at runtime
node --input-type=module -e "
const { apply } = await import('./lib/index.js')
const m = new Map()
apply({ tools: { register: (d) => m.set(d.name, d) }, effect: () => () => {} })
const call = (n, a = {}) => m.get('browser_' + n).execute(a)
console.log(await call('attach', { endpoint: 'http://127.0.0.1:9222' }))  // attach
console.log(await call('tabs'))                                          // list existing tabs
console.log(await call('attach', { endpoint: 'launch' }))                // back to our own browser
console.log(await call('open', { url: 'https://example.com' }))
console.log(await call('close'))                                         // closes our own instance
"
```

## Community & Support

This plugin is part of the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) ecosystem and carries the official `dsh-plugin` topic for discoverability, per the [community support guide](https://github.com/deepseek-ai/deepseek-harness#community-and-support).

- Plugin issues / feature requests: open an [Issue](https://github.com/whklwhkl/dsh-playwright/issues) or start a [Discussion](https://github.com/whklwhkl/dsh-playwright/discussions) here
- DSH framework feedback & bug reports: submit to [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- Join the DeepSeek Harness Discord community (see the official README)

## License

MIT
