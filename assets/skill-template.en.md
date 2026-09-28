# Browser site map (playwright-browser)

Consult this map before automating a web task: site facts and tactics are maintained from real testing. Default search tasks to Bing.

## Site map

{{SITE_MAP}}

## General recovery tactics

- Selector failed or element invisible: inspect the DOM with `browser_eval` first, then pick a selector from the actual structure.
- Empty extract: wait about 1 second or scroll the page, then extract once more.
- After each navigation, confirm the current URL and title with `browser_status` before acting.
- If `browser_status` says it is attached to your running browser: `browser_open` navigates the **currently tracked tab**. Check `browser_tabs` first and switch to the page you want (or pin one with `PW_CDP_PAGE`) instead of overwriting a page the user is reading; and don't expect `browser_close` to close that browser — it only disconnects.
- When the task needs existing logins but you are on a fresh plugin-launched browser: call `browser_attach` to attach to the browser the user is already using (the user must first tick "Allow remote debugging for this browser instance" at `chrome://inspect/#remote-debugging`); switch back afterwards with `browser_attach({endpoint:"launch"})`.
- When an attach reports `Timeout`, first tell the two cases apart: "the WebSocket handshake never completed" means ask the user to click Allow in Chrome's "Allow remote debugging?" dialog (Chrome 136+ requires consent for **every new CDP connection** and parks the handshake silently — it is not a network problem); "the handshake completed, but initialization never finished" is NOT a consent problem — a tab's renderer is not responding, so ask the user to close that tab. Do not retry `browser_attach` in a loop; a second `browser_attach` on the same endpoint reuses the live connection. A read-only `browser_status` never connects on its own, so call `browser_attach` when it says you are not attached.
- When `browser_tabs` / `browser_status` shows `(not responding)` as a title: that tab's renderer is stuck (infinite loop, "Page unresponsive", a paused debugger) and neither its title nor its page operations are available. Do **not** keep driving it — switch to another tab (`browser_tabs({index:...})`) and tell the user to close it. A plain `(untitled)` is harmless: it only means the page has no title.

## Boundary

CAPTCHAs, sliders, and hidden elements are the target site's anti-automation defenses, not plugin faults: never retry the same action more than twice; CAPTCHAs are always completed manually by the user — switch sites, or stop and report what happened honestly in the final answer.
