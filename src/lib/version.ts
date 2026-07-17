import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// The CLI version, read from package.json (the single source of truth) so no
// version string is ever hardcoded. Used for `--version`, the help header, and
// the `layerbase-cli/<version>` User-Agent on cloud API requests. Resolved
// relative to this module: src/lib/version.ts (dev) and dist/lib/version.js
// (published) both sit two levels below the package.json.
let cached: string | null = null

export function getVersion(): string {
  if (cached) return cached
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkgPath = join(here, '..', '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
    cached = pkg.version
  } catch {
    // Never let a missing/unreadable package.json break the CLI (e.g. the
    // spindb fallthrough path). Degrade the reported version instead.
    cached = 'unknown'
  }
  return cached
}
