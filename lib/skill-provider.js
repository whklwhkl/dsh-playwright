/**
 * playwright-browser-tips — bundled site-map skill provider.
 *
 * Registers a `playwright-browser-tips` skill on ctx.skills. The body is
 * rendered at load time: a fixed per-language framework (assets/
 * skill-template.<lang>.md) plus a site table generated from the
 * community-maintained map (assets/site-map.json, schema in
 * SITE-MAP-SPEC.md). The framework text — including the anti-automation
 * boundary — is code-owned; contributions extend the map, never the boundary.
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
const DESCRIPTION = 'Site map for the playwright-browser browser_* tools: per-site facts and tactics maintained from real testing (search engines, anti-automation behavior), plus recovery patterns for failed selectors and empty extracts. Use before automating a site for the first time, when a browser_* tool fails or returns empty, or when automating search or login flows.'

const TABLE_HEADERS = {
  zh: ['站点', '场景', '行为', '对策', '验证'],
  en: ['Site', 'Task', 'Behavior', 'Tactic', 'Verified'],
}

/** Escape one pipe-table cell. */
function cell(text) {
  return text.replace(/\|/g, '\\|')
}

/** Render the site map entries as one markdown table; JSON order is priority order. */
function renderSiteTable(sites, lang) {
  const headers = TABLE_HEADERS[lang]
  const rows = sites.map(site =>
    `| ${cell(site.site)} | ${cell(site.task)} | ${cell(site.behavior)} | ${cell(site.tactic)} | ${cell(site.lastVerified)} |`,
  )
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows,
  ].join('\n')
}

const CANDIDATE = {
  name: 'playwright-browser-tips',
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: 'playwright-browser-tips',
  source: 'bundled',
  resourceBase: { kind: 'directory', path: ASSETS_DIR },
  rank: RANK,
  locator: new URL(`../assets/skill-template.${LANG}.md`, import.meta.url),
}

/** Render the skill body: language template with the site table injected. */
async function renderBody() {
  const [template, map] = await Promise.all([
    readFile(CANDIDATE.locator, 'utf8'),
    readFile(new URL('../assets/site-map.json', import.meta.url), 'utf8'),
  ])
  const sites = JSON.parse(map).sites
  // Function replacement: tactic text may contain `$` patterns replace() would otherwise interpret.
  return template.replace('{{SITE_MAP}}', () => renderSiteTable(sites, LANG))
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
      content: await renderBody(),
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
