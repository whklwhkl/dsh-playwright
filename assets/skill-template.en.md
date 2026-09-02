# Browser site map (playwright-browser)

Consult this map before automating a web task: site facts and tactics are maintained from real testing. Default search tasks to Bing.

## Site map

{{SITE_MAP}}

## General recovery tactics

- Selector failed or element invisible: inspect the DOM with `browser_eval` first, then pick a selector from the actual structure.
- Empty extract: wait about 1 second or scroll the page, then extract once more.
- After each navigation, confirm the current URL and title with `browser_status` before acting.

## Boundary

CAPTCHAs, sliders, and hidden elements are the target site's anti-automation defenses, not plugin faults: never retry the same action more than twice; CAPTCHAs are always completed manually by the user — switch sites, or stop and report what happened honestly in the final answer.
