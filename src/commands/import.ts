import { readFileSync, statSync } from 'node:fs'
import {
  importFromR2,
  listDatabases,
  presignImport,
  resolveDatabaseId,
  uploadToPresignedUrl,
} from '@/lib/cloud-api'
import type { CloudDatabase, ImportFromR2Result } from '@/lib/cloud-api'
import { confirm, decideConfirmation } from '@/lib/confirm'
import { reportError, writeJson } from '@/lib/cli-output'
import type { CommandFlags } from '@/ui/app'

// Warn (not block) above this size; the cloud enforces its own hard cap and
// returns the authoritative maxBytes from the presign call.
const LARGE_FILE_WARN_BYTES = 50 * 1024 * 1024

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

// The shipped import path, factored out so `promote` restores through EXACTLY
// the same presign -> PUT -> restore sequence as `layerbase import` instead of
// growing a second one. The caller owns validation, confirmation, and output;
// `onProgress` is how it renders the two long steps.
export async function uploadAndImport(options: {
  filePath: string
  size: number
  targetId: string
  onProgress?: (message: string) => void
}): Promise<ImportFromR2Result> {
  const { filePath, size, targetId, onProgress } = options

  const presign = await presignImport(targetId)
  if (size > presign.maxBytes) {
    throw new Error(
      `File too large: ${formatBytes(size)}. Maximum import size is ${formatBytes(presign.maxBytes)}.`,
    )
  }

  onProgress?.('Uploading dump...')
  await uploadToPresignedUrl(presign.uploadUrl, readFileSync(filePath))

  onProgress?.('Restoring...')
  return importFromR2({ targetId, r2Key: presign.r2Key })
}

// `layerbase import <dumpfile> --target <db-id-or-name> [--yes] [--json]`
export async function runImport(options: {
  args: string[]
  flags: CommandFlags
}): Promise<number> {
  const { args, flags } = options
  const json = flags.json ?? false
  const interactive = Boolean(process.stdin.isTTY) && !json

  const filePath = args[0]
  const targetRef = flags.target
  if (!filePath || !targetRef) {
    process.stderr.write(
      'Usage: layerbase import <dumpfile> --target <db-id-or-name> [--yes] [--json]\n',
    )
    return 1
  }

  // 1. Validate the file exists and is non-empty before touching the network.
  let size: number
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) {
      process.stderr.write(`Not a file: ${filePath}\n`)
      return 1
    }
    size = stat.size
  } catch {
    process.stderr.write(
      `File not found: ${filePath}. Pass the path to a database dump file.\n`,
    )
    return 1
  }
  if (size === 0) {
    process.stderr.write(`File is empty: ${filePath}\n`)
    return 1
  }
  if (size >= LARGE_FILE_WARN_BYTES && !json) {
    process.stderr.write(
      `Warning: ${filePath} is ${formatBytes(size)}. Large imports can take a while and are capped server-side.\n`,
    )
  }

  try {
    const targetId = await resolveDatabaseId(targetRef)
    const target: CloudDatabase | undefined = (await listDatabases()).find(
      (d) => d.id === targetId,
    )
    const targetName = target ? `${target.name} (${target.engine})` : targetId

    // 2. Confirm - a dump import restores over the target database.
    if (!json) {
      process.stdout.write(
        `Import ${filePath} (${formatBytes(size)}) into ${targetName}.\n` +
          '  This restores the dump over the target and may overwrite existing data.\n',
      )
    }
    const decision = decideConfirmation({
      yes: flags.yes ?? false,
      interactive,
    })
    if (decision === 'refuse') {
      process.stderr.write(
        'Refusing to import without confirmation. Pass --yes (-y) to run non-interactively.\n',
      )
      return 1
    }
    if (decision === 'prompt') {
      const ok = await confirm('Import this dump?')
      if (!ok) {
        process.stdout.write('Aborted.\n')
        return 1
      }
    }

    // 3. Presign, size-check against the authoritative cloud cap, upload, import.
    const result = await uploadAndImport({
      filePath,
      size,
      targetId,
      onProgress: json
        ? undefined
        : (message) => process.stdout.write(`${message}\n`),
    })

    if (json) {
      writeJson({ ok: true, ...result })
    } else {
      process.stdout.write(
        `${result.message} (${formatBytes(result.bytesUploaded)}).\n`,
      )
    }
    return 0
  } catch (error) {
    return reportError(error, json)
  }
}
