import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { DEFAULT_API_URL } from '@/lib/cloud-api'
import type { CommandFlags } from '@/ui/app'
import { confirm } from '@/lib/confirm'

// Where the canonical skill is served (frontmatter-first text/markdown). The web
// base is overridable via LAYERBASE_API_URL; LAYERBASE_SKILL_URL overrides the
// whole URL for testing.
function skillUrl(): string {
  return (
    process.env.LAYERBASE_SKILL_URL ?? `${DEFAULT_API_URL}/skill.md`
  )
}

// The copy bundled in the npm tarball (shipped separately). It has a short
// leading HTML comment BEFORE the frontmatter; strict skill parsers want `---`
// on line 1, so strip a leading <!-- ... --> block when installing from it.
function bundledSkillPath(): string {
  return fileURLToPath(new URL('../../skills/layerbase/SKILL.md', import.meta.url))
}

function stripLeadingHtmlComment(content: string): string {
  return content.replace(/^\uFEFF?\s*<!--[\s\S]*?-->\s*\r?\n/, '')
}

async function fetchSkill(): Promise<string | null> {
  try {
    const response = await fetch(skillUrl(), {
      headers: { 'user-agent': 'layerbase-cli agent-init' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

async function readBundledSkill(): Promise<string | null> {
  try {
    const raw = await readFile(bundledSkillPath(), 'utf8')
    return stripLeadingHtmlComment(raw)
  } catch {
    return null
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const AGENTS_SNIPPET = `
Add this to your AGENTS.md so Codex and other agents can use Layerbase:

  ## Layerbase
  The \`layerbase\` CLI (npm i -g layerbase) manages local and cloud databases.
  Set LAYERBASE_API_KEY for headless cloud access: create, branch, and delete
  transient databases in CI without a browser.
  Capabilities, live prices, and migration sources: https://layerbase.com/agents.md
  Full skill: read .claude/skills/layerbase/SKILL.md
`

// `layerbase agent init [--global] [--force]`: install the Layerbase skill for
// coding agents. Fetches the canonical skill, falling back to the bundled copy
// offline. Never overwrites without consent (--force in non-TTY).
export async function runAgentInit(options: {
  flags: CommandFlags
}): Promise<number> {
  const global = options.flags.global ?? false
  const force = options.flags.force ?? false

  const baseDir = global
    ? join(homedir(), '.claude', 'skills', 'layerbase')
    : join(process.cwd(), '.claude', 'skills', 'layerbase')
  const target = join(baseDir, 'SKILL.md')

  if (await fileExists(target)) {
    if (!force) {
      if (!process.stdin.isTTY) {
        process.stderr.write(
          `${target} already exists. Pass --force to overwrite.\n`,
        )
        return 1
      }
      const ok = await confirm(`Overwrite existing skill at ${target}?`)
      if (!ok) {
        process.stdout.write('Aborted.\n')
        return 1
      }
    }
  }

  let content = await fetchSkill()
  let source = 'layerbase.com'
  if (content == null) {
    content = await readBundledSkill()
    source = 'bundled copy'
  }
  if (content == null) {
    process.stderr.write(
      'Could not fetch the Layerbase skill from ' +
        `${skillUrl()} and no bundled copy is available. ` +
        'Check your network connection or reinstall the layerbase package.\n',
    )
    return 1
  }

  try {
    await mkdir(baseDir, { recursive: true })
    await writeFile(target, content, { mode: 0o644 })
  } catch (error) {
    process.stderr.write(
      `Could not write ${target}: ${(error as Error).message}\n`,
    )
    return 1
  }

  process.stdout.write(`Installed the Layerbase skill (${source}) to:\n`)
  process.stdout.write(`  ${target}\n`)
  process.stdout.write(AGENTS_SNIPPET)
  return 0
}
