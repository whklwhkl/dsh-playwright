# playwright-browser

[![Release](https://img.shields.io/github/v/release/whklwhkl/dsh-playwright)](https://github.com/whklwhkl/dsh-playwright/releases)
[![License: MIT](https://img.shields.io/github/license/whklwhkl/dsh-playwright)](./LICENSE)

DSH (DeepSeek Harness) browser automation plugin: provides agents with a suite of `browser_*` model tools to drive Chromium via Playwright — open pages, click, fill forms, extract DOM, and take screenshots.

> **Compatibility**: Verified on [dsh 0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2) and above (`^0.2.0-rc.2`).

- ⚡️ **Lightweight & Service-Free**: Loads `playwright-core` directly in the host process; no external bridge services or ports needed in launched mode.
- 🔀 **Native Per-Session Isolation**: Each session / sub-agent lazily starts an isolated browser instance, preventing page conflicts. Resources are cleaned up automatically when the session ends.
- 🔑 **Seamless Login-State Reuse**: Connects via CDP to attach to your existing Chrome / Edge, preserving all cookies, extensions, and open tabs.
- 🛑 **True Cancellation & Standard Failures**: Forwarded cancellation signals abort underlying operations immediately; errors throw standard `isError` payloads for autonomous agent recovery.
- 📸 **Vision-Ready Screenshots**: `browser_screenshot` generates PNG files and inlines them directly for vision-capable models.
- 🌐 **Bilingual Support**: Tool descriptions and prompt messages adjust automatically based on `PW_LANG` (defaults to `zh`) — [中文 README](./README.md).

---

## Quick Start

### 1. Install Plugin into DSH Profile

Run a single command from any directory (using the `web` profile as an example):

```bash
dsh plugin --profile web add git+https://github.com/whklwhkl/dsh-playwright.git
```

> **Local Development**: Point to your local checkout with the `link:` prefix (run `pnpm install` in this repo first to install local dependencies):
> ```bash
> dsh plugin --profile web add link:/path/to/dsh-playwright
> ```

**Restart DSH** after installation; the `browser_*` tools will be available to all sessions under that profile.

### 2. Prepare Browser (Pick One)

`playwright-core` does not bundle browser binaries out of the box. Choose one of the following before first use:

- **Option A: Auto-download Chromium (Recommended, zero-config)**
  ```bash
  npx playwright-core install chromium
  ```
- **Option B: Reuse existing system Chrome / Edge (No download required)**
  ```bash
  export PW_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  # Linux: export PW_CHROMIUM_PATH="/usr/bin/google-chrome"
  ```
- **Option C: Attach to an already running Chrome (Reuse login state)**
  In Chrome, visit `chrome://inspect/#remote-debugging` and check the remote debugging box, then configure:
  ```bash
  export PW_CDP_ENDPOINT=chrome
  ```
  *(See [CDP Attach Guide](./docs/cdp-attach.md) for details on authorization dialogs and tab management)*

### 3. Talk to the Agent

Prompt the agent with natural language commands:
- *"Open https://example.com and extract the main article for me"*
- *"Go to Bing, search for 'playwright', and tell me the top result title"*
- *"Attach to my Chrome and extract the text from the current active tab"*
- *"Check what tabs are open in my browser, switch to the console tab, and refresh it"*

---

## Tool Reference

| Tool | Purpose |
|---|---|
| `browser_open` | Navigates to a URL and returns the final URL and page title |
| `browser_status` | Checks current session browser/page status (attached state, endpoint, URL, tab count, session ID) |
| `browser_attach` | Dynamically attaches or switches to a running browser at runtime (switches endpoint or tab) |
| `browser_tabs` | Lists, switches (brings to front), or closes open browser tabs |
| `browser_click` | Clicks an element matching a CSS or text selector |
| `browser_type` | Types characters sequentially with optional key delay |
| `browser_fill` | Fast-fills an input form field |
| `browser_press` | Triggers key presses (Enter, Tab, Escape, etc.) |
| `browser_wait` | Waits for a specified duration in milliseconds |
| `browser_extract` | Extracts text from the entire page or a targeted element |
| `browser_html` | Retrieves full HTML of the page or a targeted container |
| `browser_eval` | Evaluates a custom JavaScript expression in the page context |
| `browser_screenshot` | Takes a screenshot, saves as PNG, and inlines it for multimodal models |
| `browser_close` | Closes the session's launched browser (in attach mode, only disconnects safely) |

---

## Built-in Skill: playwright-browser-tips

The plugin bundles a `playwright-browser-tips` skill containing verified behaviors and tactical workarounds for major websites (such as defaulting to Bing for search tasks). The agent loads it autonomously on error or login barriers; users can also trigger it manually with `/playwright-browser-tips`.

- Community contributions to site rules are welcome! See [SITE-MAP-SPEC.md](./SITE-MAP-SPEC.md).

---

## Guides & Documentation

Detailed technical documentation is organized under the `docs/` directory:

- 📖 **[Chrome Attach & Login State Guide (CDP Attach)](./docs/cdp-attach.md)**
  Explains how to attach to local Chrome, manage Chrome 136+ authorization dialogs, configure dedicated debugging ports, and handle multi-session tab claims.
- ⚙️ **[Configuration & Session Isolation Manual](./docs/configuration.md)**
  Comprehensive environment variable list (timeouts, languages, screenshot paths) and architecture details for per-session isolation.
- 🛠️ **[Troubleshooting Handbook](./docs/troubleshooting.md)**
  Categorized guide for common issues (compatibility gates, browser downloads, CDP timeouts, bot detection).
- 💻 **[Developer & Agent Guidelines (AGENTS.md)](./AGENTS.md)**
  Local test runs, host reloading facts, review handoff protocol, and known pitfalls.

---

## Community & Support

This is an ecosystem plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

- Plugin issues & feature requests: [GitHub Issues](https://github.com/whklwhkl/dsh-playwright/issues) or [Discussions](https://github.com/whklwhkl/dsh-playwright/discussions)
- DSH framework discussions: [DeepSeek Harness Community](https://github.com/deepseek-ai/deepseek-harness)

## License

[MIT](./LICENSE)
