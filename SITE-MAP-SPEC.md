# Site map spec

The `playwright-browser-tips` skill renders its body from `assets/site-map.json`. Anyone — human or agent — can contribute a site entry with a pull request that touches only that file. This document is the contract for those entries.

English is the canonical entry language (the skill renders it for both locales; the model reads either).

## Entry schema (version 1)

`assets/site-map.json` is one object:

| Field | Type | Rules |
|---|---|---|
| `version` | number | Must be `1`. |
| `sites` | array | Non-empty. **Array order is priority order** — earlier rows win when several entries could apply. |

Each element of `sites`:

| Field | Type | Rules |
|---|---|---|
| `domain` | string | Bare hostname, lowercase, no scheme or path: `example.com`. |
| `site` | string | Display name: `Example`. |
| `task` | string | Scope the entry covers: `search`, `login`, `download`, … One entry per `domain`+`task`. |
| `behavior` | string | What the site actually does under automation, from real observation. Not a guess, not a complaint. |
| `tactic` | string | What the agent should do. Must stay inside the skill's boundary (see below). |
| `lastVerified` | string | ISO date `YYYY-MM-DD` of the last real check. |
| `verifiedBy` | string? | Optional provenance, e.g. `playwright-browser 0.2.0` or your GitHub handle. |
| `manualIntervention` | boolean? | `true` when completing the task needs a human step — CAPTCHA, login wall, or rate-limit wait. The `tactic` must say what the human does. Omit when the site works autonomously. |

## Content rules

1. **Behavioral, not structural.** Describe what the site does and what to do about it. Never include CSS selectors, XPaths, or DOM paths — they rot and then mislead the agent.
2. **No circumvention.** Tactics must not attempt to defeat anti-automation measures (CAPTCHA, sliders, hidden elements, bot detection). Where a site blocks automation: detect, stop retrying, switch to an alternative or hand off, and report honestly. CAPTCHAs are completed by the user, never by the agent.
3. **One observation, one entry.** A row claims "verified on date X". Re-verify before updating the date; delete entries that no longer hold.
4. **Keep it minimal.** One row per site+task. If a tactic needs three sentences, the entry is about the wrong granularity.

## Verification runbook (how to produce an entry)

Every entry must come from a real run against the live site, using the plugin's own launch configuration. The DuckDuckGo entry (2026-09-03) is the worked example of the full loop:

1. **Drive the real flow** with the plugin's launch config (its `playwright-core`, `PW_CHROMIUM_PATH` or auto-discovery, headless by default) and the task's natural steps. Expect the first attempt to fail sometimes — that is data, not noise.
2. **Characterize before concluding.** When something fails, rerun with diagnostics (page title, form controls present, full body text). A truncated 200-character body dump hid DuckDuckGo's challenge message; the full dump revealed it. Do not write an entry from a guess about the cause.
3. **Run a control.** Verify a site known to work (Bing for search) on the same network path in the same run. Without the control you cannot tell a site fact from an environment problem.
4. **Write the entry within the boundary**: observable behavior, tactic that switches/hands off rather than circumvents, today's date, provenance.
5. **Validate and submit** (`node scripts/validate-site-map.js`, output into the PR).

Minimal probe template for step 1 (adjust selectors and steps per task):

```bash
cd <plugin checkout> && node --input-type=module -e "
import { chromium } from 'playwright-core'
const b = await chromium.launch({
  headless: true,
  executablePath: process.env.PW_CHROMIUM_PATH,   // or omit for auto-discovery
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const p = await (await b.newContext()).newPage()
await p.goto('https://example.com', { waitUntil: 'domcontentloaded' })
console.log('title:', await p.title())
await b.close()
"
```

Agents submitting entries: include the probe output (or session transcript excerpts) and the control-run result in the PR description, not just the entry.

## Submitting

```bash
# after editing assets/site-map.json
node scripts/validate-site-map.js
```

The script checks the schema above and renders the skill in both languages. CI-less by design: the script is the gate, run it locally and include its output in the PR description. Agents submitting entries: follow this spec exactly, run the validator, and attach its output.
