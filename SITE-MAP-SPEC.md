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

## Content rules

1. **Behavioral, not structural.** Describe what the site does and what to do about it. Never include CSS selectors, XPaths, or DOM paths — they rot and then mislead the agent.
2. **No circumvention.** Tactics must not attempt to defeat anti-automation measures (CAPTCHA, sliders, hidden elements, bot detection). Where a site blocks automation: detect, stop retrying, switch to an alternative or hand off, and report honestly. CAPTCHAs are completed by the user, never by the agent.
3. **One observation, one entry.** A row claims "verified on date X". Re-verify before updating the date; delete entries that no longer hold.
4. **Keep it minimal.** One row per site+task. If a tactic needs three sentences, the entry is about the wrong granularity.

## Submitting

```bash
# after editing assets/site-map.json
node scripts/validate-site-map.js
```

The script checks the schema above and renders the skill in both languages. CI-less by design: the script is the gate, run it locally and include its output in the PR description. Agents submitting entries: follow this spec exactly, run the validator, and attach its output.
