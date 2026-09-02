#!/usr/bin/env node
/**
 * Validate assets/site-map.json against SITE-MAP-SPEC.md and prove the skill
 * renders for both languages. Exit code 0 with a summary, or 1 with the list
 * of violations. Run before committing map changes:
 *
 *   node scripts/validate-site-map.js
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const errors = []
const dates = []

function checkField(label, field, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${label}: "${field}" must be a non-empty string`)
    return false
  }
  return true
}

const raw = await readFile(new URL('../assets/site-map.json', import.meta.url), 'utf8')
let map
try {
  map = JSON.parse(raw)
} catch (error) {
  console.error(`site-map: invalid JSON: ${error.message}`)
  process.exit(1)
}

if (map.version !== 1) errors.push(`"version" must be 1, got ${JSON.stringify(map.version)}`)
if (!Array.isArray(map.sites) || map.sites.length === 0) {
  errors.push('"sites" must be a non-empty array')
} else {
  const seen = new Set()
  for (const [index, site] of map.sites.entries()) {
    const label = `sites[${index}]`
    for (const field of ['domain', 'site', 'task', 'behavior', 'tactic']) {
      checkField(label, field, site[field])
    }
    if (typeof site.domain === 'string' && !/^[a-z0-9.-]+$/.test(site.domain)) {
      errors.push(`${label}: "domain" must be a bare hostname like "example.com" (lowercase, no scheme or path), got ${JSON.stringify(site.domain)}`)
    }
    if (typeof site.lastVerified !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(site.lastVerified)) {
      errors.push(`${label}: "lastVerified" must be an ISO date "YYYY-MM-DD", got ${JSON.stringify(site.lastVerified)}`)
    } else if (Number.isNaN(Date.parse(site.lastVerified))) {
      errors.push(`${label}: "lastVerified" is not a real date: ${site.lastVerified}`)
    } else {
      dates.push(site.lastVerified)
    }
    if (site.verifiedBy !== undefined) checkField(label, 'verifiedBy', site.verifiedBy)
    if (site.manualIntervention !== undefined && site.manualIntervention !== true) {
      errors.push(`${label}: "manualIntervention" must be true when present, got ${JSON.stringify(site.manualIntervention)}`)
    }
    if (typeof site.domain === 'string' && typeof site.task === 'string') {
      const key = `${site.domain}/${site.task}`
      if (seen.has(key)) errors.push(`${label}: duplicate domain+task "${key}"`)
      seen.add(key)
    }
  }
}

// Render both languages end to end so a schema-passing map cannot break the skill.
for (const lang of ['zh', 'en']) {
  process.env.PW_LANG = lang
  try {
    // The query string busts the ESM module cache so each pass re-reads PW_LANG.
    const mod = await import(`../lib/skill-provider.js?lang=${lang}`)
    const providers = []
    mod.apply({
      skills: {
        registerProvider: (create) => {
          providers.push(create({ signal: new AbortController().signal, invalidate: () => {} }))
          return () => {}
        },
      },
    })
    const candidate = (await providers[0].list())[0]
    const def = await providers[0].get(candidate)
    if (typeof def.content !== 'string' || def.content.length === 0 || !def.content.includes('|')) {
      errors.push(`render (${lang}): skill body is empty or the site table did not render`)
    }
  } catch (error) {
    errors.push(`render (${lang}): ${error.message}`)
  }
}
process.env.PW_LANG = 'zh'

if (errors.length > 0) {
  console.error(`site-map: ${errors.length} violation(s):`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
const count = map.sites.length
console.log(`site-map OK: ${count} site${count === 1 ? '' : 's'}, schema valid, renders in zh and en`)
