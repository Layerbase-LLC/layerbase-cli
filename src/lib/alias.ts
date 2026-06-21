import { existsSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, delimiter, dirname } from 'node:path'

const isWin = process.platform === 'win32'

function findOnPath(name: string): string | null {
  const exts = isWin ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, `${name}${ext}`)
      if (existsSync(full)) return full
    }
  }
  return null
}

// `lb` is a grabby two-character name (e.g. Debian live-build ships `lb`), so
// we only ever claim it when it is genuinely free, and only next to our own
// `layerbase` bin. Everything keys off where `layerbase` itself resolves.
export type LbStatus =
  | { state: 'available'; binDir: string; layerbasePath: string }
  | { state: 'ours'; path: string }
  | { state: 'taken'; path: string }
  | { state: 'unknown' }

export function lbStatus(): LbStatus {
  const layerbasePath = findOnPath('layerbase')
  if (!layerbasePath) return { state: 'unknown' }

  const binDir = dirname(layerbasePath)
  const lbPath = findOnPath('lb')
  if (lbPath) {
    // Already ours if it lives next to layerbase; otherwise it belongs to
    // another tool and we leave it alone.
    return dirname(lbPath) === binDir
      ? { state: 'ours', path: lbPath }
      : { state: 'taken', path: lbPath }
  }
  return { state: 'available', binDir, layerbasePath }
}

export type SetupResult =
  | { ok: true; path: string }
  | { ok: false; reason: string }

export function setupLb(): SetupResult {
  const status = lbStatus()

  if (status.state === 'ours') {
    return { ok: true, path: status.path }
  }
  if (status.state === 'taken') {
    return {
      ok: false,
      reason: `\`lb\` is already used by ${status.path}, so I left it alone. Your other tool wins.`,
    }
  }
  if (status.state === 'unknown') {
    return {
      ok: false,
      reason:
        'Could not find a global `layerbase` on your PATH (running locally or via npx?). ' +
        'Add `alias lb=layerbase` to your shell profile instead.',
    }
  }

  const lbPath = join(status.binDir, isWin ? 'lb.cmd' : 'lb')
  try {
    if (isWin) {
      writeFileSync(lbPath, '@layerbase %*\r\n')
    } else {
      symlinkSync(status.layerbasePath, lbPath)
    }
    return { ok: true, path: lbPath }
  } catch (error) {
    return {
      ok: false,
      reason:
        `Could not create \`lb\` in ${status.binDir}: ${(error as Error).message}. ` +
        'Add `alias lb=layerbase` to your shell profile instead.',
    }
  }
}
