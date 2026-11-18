// Refreshes the bundled offline skill (skills/layerbase/SKILL.md) from the
// served page, the single source of truth. `lbase agent init` fetches the
// served page first and falls back to this copy, so the two must say the same
// thing; editing the bundled file by hand is how they drifted before.
//
//   pnpm sync:skill          rewrite the bundled copy from the served page
//   pnpm sync:skill --check  exit 1 if the bundled copy differs (release check)
//
// LAYERBASE_SKILL_URL points it elsewhere (a preview deploy, before a web
// release reaches layerbase.com). Run it before every CLI release PR.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SKILL_URL =
  process.env.LAYERBASE_SKILL_URL ?? 'https://layerbase.com/skill.md'
const BUNDLED_PATH = fileURLToPath(
  new URL('../skills/layerbase/SKILL.md', import.meta.url),
)
const FETCH_TIMEOUT_MS = 15_000

// The served page appends this flag-gated section at serve time. It is not
// part of the skill file itself, so the offline copy never carries it.
const SERVED_ONLY_SECTION_HEADING = '## 6. When you need your own account'

function toBundledText(served: string): string {
  const cut = served.indexOf(SERVED_ONLY_SECTION_HEADING)
  const text = cut === -1 ? served : served.slice(0, cut)
  return `${text.trimEnd()}\n`
}

async function fetchServedSkill(): Promise<string> {
  const response = await fetch(SKILL_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `Fetching ${SKILL_URL} returned HTTP ${response.status}. Check the URL, or set LAYERBASE_SKILL_URL to a reachable deploy.`,
    )
  }
  return response.text()
}

async function main() {
  const isCheck = process.argv.includes('--check')
  const bundled = toBundledText(await fetchServedSkill())

  const unresolved = bundled.match(/\{\{layerbase\.[^}]+\}\}/g)
  if (unresolved) {
    throw new Error(
      `${SKILL_URL} served unresolved tokens (${unresolved.join(', ')}). Point LAYERBASE_SKILL_URL at the served /skill.md, not the raw lib/agents/skill.md file.`,
    )
  }

  const current = await readFile(BUNDLED_PATH, 'utf8')
  if (current === bundled) {
    console.log(`skills/layerbase/SKILL.md matches ${SKILL_URL}`)
    return
  }
  if (isCheck) {
    console.error(
      `skills/layerbase/SKILL.md differs from ${SKILL_URL}. Run \`pnpm sync:skill\` to refresh it.`,
    )
    process.exit(1)
  }
  await writeFile(BUNDLED_PATH, bundled)
  console.log(`skills/layerbase/SKILL.md refreshed from ${SKILL_URL}`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
