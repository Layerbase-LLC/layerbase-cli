import { resolveDatabaseId, syncPoolerUsers } from '@/lib/cloud-api'
import type { PoolerSyncResult } from '@/lib/cloud-api'
import type { CommandFlags } from '@/ui/app'
import { reportError, writeJson } from '@/lib/cli-output'

export const POOLER_HELP = `
  layerbase cloud pooler sync-users <db> [--json]

  Users you create in SQL (CREATE USER, or CREATE ROLE ... LOGIN) work on the
  direct connection string right away. Run this after creating or changing
  them so the pooled connection string accepts them too. No password is sent:
  the cloud reads the users from your database. Synced users survive restarts
  and wakes. Run it again after adding users or changing a password.

  PostgreSQL, MySQL and MariaDB databases only. The output lists the users
  synced, the users skipped and any warnings, each with the exact fix. If a
  pooler did not take the users yet, they apply when it next starts, or on a
  retry; the command still exits 0 and --json reports "applied": false.
`
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// The human report, one line per entry. Skip and warning details carry the
// exact fix (for example a DROP USER statement), so they print verbatim.
export function formatPoolerSyncReport(options: {
  ref: string
  result: PoolerSyncResult
}): { stdout: string[]; stderr: string[] } {
  const { ref, result } = options
  const stdout: string[] = []
  const stderr: string[] = []

  if (result.synced.length === 0) {
    stdout.push(`No users synced to the pooler for ${ref}.`)
  } else {
    stdout.push(
      `Synced ${plural(result.synced.length, 'user')} to the pooler for ${ref}:`,
    )
    for (const user of result.synced) {
      stdout.push(`  ${user.username}`)
    }
  }

  if (result.skipped.length > 0) {
    stdout.push('')
    stdout.push(`Skipped ${plural(result.skipped.length, 'user')}:`)
    for (const user of result.skipped) {
      stdout.push(`  ${user.username} (${user.reason}): ${user.detail}`)
    }
  }

  if (result.warnings.length > 0) {
    stdout.push('')
    stdout.push('Warnings:')
    for (const warning of result.warnings) {
      stdout.push(
        `  ${warning.username} (${warning.reason}): ${warning.detail}`,
      )
    }
  }

  if (!result.applied) {
    stderr.push(
      'Warning: not every pooler took the users yet. They are saved and will ' +
        'apply when the pooler next starts, or run this command again to retry.',
    )
    for (const pooler of result.poolers) {
      if (!pooler.applied) {
        stderr.push(`  ${pooler.pooler}: ${pooler.detail}`)
      }
    }
  }

  return { stdout, stderr }
}

// `layerbase cloud pooler sync-users <db> [--json]`. Exit 0 whenever the cloud
// answers 200, including `applied: false`: the users are recorded and apply on
// the pooler's next start, so nothing is lost and a retry is optional. Scripts
// that need the pooled string to work right now read `applied` from --json.
async function runPoolerSyncUsers(options: {
  ref: string | undefined
  json: boolean
}): Promise<number> {
  const { ref, json } = options
  if (!ref) {
    process.stderr.write('Usage: layerbase cloud pooler sync-users <db>\n')
    return 1
  }
  try {
    const id = await resolveDatabaseId(ref)
    const result = await syncPoolerUsers(id)
    if (json) {
      writeJson({ ok: true, ...result })
      return 0
    }
    const report = formatPoolerSyncReport({ ref, result })
    process.stdout.write(`${report.stdout.join('\n')}\n`)
    if (report.stderr.length > 0) {
      process.stderr.write(`${report.stderr.join('\n')}\n`)
    }
    return 0
  } catch (error) {
    return reportError(error, json)
  }
}

// Dispatch `cloud pooler ...`. `args` is everything after the `pooler` token.
export async function runPooler(options: {
  args: string[]
  flags: CommandFlags
  help: boolean
}): Promise<number> {
  const json = options.flags.json ?? false
  const [sub, ...rest] = options.args

  if (options.help) {
    process.stdout.write(`${POOLER_HELP}\n`)
    return 0
  }
  if (sub === 'sync-users') {
    return runPoolerSyncUsers({ ref: rest[0], json })
  }
  if (sub) {
    process.stderr.write(`Unknown pooler command: ${sub}\n`)
  }
  process.stderr.write(`${POOLER_HELP}\n`)
  return 1
}
