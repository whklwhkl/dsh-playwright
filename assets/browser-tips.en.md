# Browser automation tips (playwright-browser)

Apply these when browser_* tools fail or return empty, or when automating search engines and login flows.

## General tactics

- Selector failed or element "not visible": inspect the DOM with `browser_eval` first (e.g. `document.querySelectorAll('input').length`), then pick a selector from what you saw; never guess twice in a row.
- After a click or key press the page needs settle time: `browser_wait` 800–1500ms before `browser_extract`; if an extract comes back empty, wait once and retry.
- Long page but empty extract: scroll before extracting (`browser_eval` with `window.scrollTo(0, document.body.scrollHeight)`); lazy-loaded content renders only after scrolling.
- Prefer `browser_extract` for text, `browser_html` when structure matters, and `browser_eval` only as the diagnostic fallback.
- After each navigation, confirm the current URL and title with `browser_status` before acting.

## Site notes

| Site | Behavior | Tactic |
|---|---|---|
| Bing | Search works end to end (fill → press Enter → extract results) | Prefer Bing for search tasks |
| Baidu | Home search input invisible under headless (anti-automation) | Switch to Bing, or ask the user to set `PW_HEADLESS=false` and restart DSH |
| Google | Search triggers CAPTCHA | Do not retry; switch to Bing |

## Anti-automation boundary

CAPTCHAs, hidden elements, and sliders are the target site's defenses, not plugin faults. Never retry the same failed action more than twice; report the limitation and offer alternatives (another site, `PW_HEADLESS=false`, or manual completion by the user).
