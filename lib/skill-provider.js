/**
 * playwright-browser-tips — bundled skill provider.
 *
 * Registers a `playwright-browser-tips` skill on ctx.skills so the agent can
 * load site tactics and recovery patterns on demand instead of carrying them
 * in every request. The body ships with the package
 * (assets/browser-tips.<lang>.md) and follows the same PW_LANG switch as the
 * tool copy.
 *
 * Requires a profile that provides the `skills` service — every base-backed
 * profile (web, headless, acp, sdk-app). On profiles without one the entry
 * stays unsatisfied and the boot reports it; see README.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url))
const LANG = process.env.PW_LANG === 'en' ? 'en' : 'zh'
// Mirrors @deepseek-ai/dsh-skill BUNDLED_SKILL_RANK (600) without importing
// the harness package: same precedence layer as other packaged providers,
// still overridable by same-name project/user skills.
const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }
const DESCRIPTION = 'Operational tips for the playwright-browser browser_* tools: site tactics (search engines, anti-automation behavior) and recovery patterns for failed selectors, invisible elements, and empty extracts. Use when a browser_* tool fails or returns empty, when automating search or login flows, or before retrying a failed page action.'

const CANDIDATE = {
  name: 'playwright-browser-tips',
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: 'playwright-browser-tips',
  source: 'bundled',
  resourceBase: { kind: 'directory', path: ASSETS_DIR },
  rank: RANK,
  locator: new URL(`../assets/browser-tips.${LANG}.md`, import.meta.url),
}

const provider = {
  name: 'playwright-browser-tips',
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate) {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: CANDIDATE.resourceBase,
      content: await readFile(CANDIDATE.locator, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'playwright-browser-tips'
/** Service required by the skill registry. */
export const inject = ['skills']

/** Register the tips provider on ctx.skills. */
export function apply(ctx) {
  ctx.skills.registerProvider(() => provider)
}
