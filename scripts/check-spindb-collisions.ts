// Drift guard: the bare command namespace belongs to spindb. This runs
// `spindb --help`, parses every command name + alias, and fails if any
// registered layerbase bare verb (the SINGLE SOURCE OF TRUTH in
// src/lib/commands.ts) collides with one. New cloud functionality must live
// under `lbase cloud <verb>`, not steal a bare spindb verb.
//
// Runs in the `check` chain. If spindb is not installed we cannot verify, so we
// SKIP (exit 0) with a notice rather than failing environments without spindb.

import { spawnSync } from 'node:child_process'
import { registeredCommandNames } from '../src/lib/commands.ts'

// `help` intentionally overlaps spindb's `help`: layerbase owns the top-level
// help token and renders its own unified help, while spindb's help stays
// reachable via `lbase spindb help` or `lbase <cmd> --help`. Not a real steal.
const INTENTIONAL_OVERLAPS = new Set(['help'])

// Parse the "Commands:" block of `spindb --help`. Each command line looks like
//   "  create [options] [name]   Create a new database container"
//   "  list|ls [options]         List all containers"
// so the first whitespace-delimited token, split on `|`, gives name + aliases.
function parseSpindbCommands(help: string): Set<string> {
  const names = new Set<string>()
  const lines = help.split('\n')
  let inCommands = false
  for (const line of lines) {
    if (/^commands:/i.test(line.trim())) {
      inCommands = true
      continue
    }
    if (!inCommands) continue
    // The commands block is indented; a non-indented line ends it.
    if (!/^\s/.test(line)) break
    const trimmed = line.trim()
    if (!trimmed) continue
    const token = trimmed.split(/\s+/)[0]
    if (!token) continue
    for (const part of token.split('|')) {
      if (part) names.add(part.toLowerCase())
    }
  }
  return names
}

function main(): void {
  const result = spawnSync('spindb', ['--help'], { encoding: 'utf8' })

  if (result.error || typeof result.stdout !== 'string') {
    process.stdout.write(
      'check-spindb-collisions: spindb not found on PATH, skipping.\n',
    )
    process.exit(0)
  }

  const spindbCommands = parseSpindbCommands(result.stdout)
  if (spindbCommands.size === 0) {
    process.stdout.write(
      'check-spindb-collisions: could not parse `spindb --help`, skipping.\n',
    )
    process.exit(0)
  }

  const registered = registeredCommandNames()
  const collisions = registered.filter(
    (name) => spindbCommands.has(name) && !INTENTIONAL_OVERLAPS.has(name),
  )

  if (collisions.length > 0) {
    process.stderr.write(
      'check-spindb-collisions: FAIL - registered layerbase verbs collide ' +
        `with spindb commands: ${collisions.join(', ')}\n` +
        'Move the functionality under `lbase cloud <verb>`, or prove the verb ' +
        'is collision-free against `spindb --help` (aliases included).\n',
    )
    process.exit(1)
  }

  process.stdout.write(
    `check-spindb-collisions: OK - ${registered.length} registered verbs, ` +
      `no collisions against ${spindbCommands.size} spindb commands.\n`,
  )
  process.exit(0)
}

main()
