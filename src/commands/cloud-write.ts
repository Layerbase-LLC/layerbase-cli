import {
  createDatabase,
  destroyDatabase,
  resolveDatabaseId,
  startDatabase,
  stopDatabase,
} from '@/lib/cloud-api'
import type { CommandFlags } from '@/ui/app'
import { parseTtlToHours } from '@/lib/duration'
import { reportError, writeJson } from '@/lib/cli-output'
import { confirm } from '@/lib/confirm'

function expiresAtOf(result: {
  expiresAt?: string | null
  expires_at?: string | null
}): string | null {
  return result.expiresAt ?? result.expires_at ?? null
}

// `layerbase cloud create <name> --engine <engine> [--ttl 2h] [--json]`
export async function runCreate(options: {
  args: string[]
  flags: CommandFlags
}): Promise<number> {
  const json = options.flags.json ?? false
  const name = options.args[0]
  const engine = options.flags.engine

  if (!name) {
    process.stderr.write(
      'Usage: layerbase cloud create <name> --engine <engine> [--ttl 2h]\n',
    )
    return 1
  }
  if (!engine) {
    process.stderr.write(
      'Missing --engine. Example: layerbase cloud create my-db --engine postgresql\n',
    )
    return 1
  }

  let ttlHours: number | undefined
  if (options.flags.ttl) {
    try {
      ttlHours = parseTtlToHours(options.flags.ttl)
    } catch (error) {
      return reportError(error, json)
    }
  }

  try {
    const result = await createDatabase({ name, engine, ttlHours })
    const expiresAt = expiresAtOf(result)
    const isTransient = result.transient === true || Boolean(expiresAt)

    if (ttlHours != null && !isTransient) {
      // The server accepted the create but did not stamp an expiry, so this
      // cloud API predates transient TTL. Warn loudly rather than silently
      // leaving a non-expiring database against quota.
      process.stderr.write(
        'Warning: this database was created WITHOUT a TTL. Transient ' +
          '(--ttl) databases require the latest cloud API; it will not ' +
          'auto-delete. Delete it manually with "layerbase cloud delete ' +
          `${result.name}".\n`,
      )
    }

    if (json) {
      writeJson({ ok: true, ...result, expiresAt })
      return 0
    }

    process.stdout.write(`Created ${result.name} (${result.engine}).\n`)
    process.stdout.write(`Status: ${result.status}\n`)
    if (expiresAt) {
      process.stdout.write(`Expires: ${expiresAt}\n`)
    }
    if (result.connectionString) {
      process.stdout.write(`\n${result.connectionString}\n`)
    }
    return 0
  } catch (error) {
    return reportError(error, json)
  }
}

// `layerbase cloud delete <id-or-name>` - requires --yes/-y (or an interactive
// confirm on a TTY). Never destructive by default in a script.
export async function runDestroy(options: {
  args: string[]
  flags: CommandFlags
}): Promise<number> {
  const json = options.flags.json ?? false
  const ref = options.args[0]
  if (!ref) {
    process.stderr.write('Usage: layerbase cloud delete <id-or-name> [--yes]\n')
    return 1
  }

  if (!options.flags.yes) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        `Refusing to delete "${ref}" without confirmation. ` +
          'Pass --yes (-y) to delete non-interactively.\n',
      )
      return 1
    }
    const ok = await confirm(`Delete cloud database "${ref}"? This cannot be undone.`)
    if (!ok) {
      process.stdout.write('Aborted.\n')
      return 1
    }
  }

  try {
    const id = await resolveDatabaseId(ref)
    await destroyDatabase(id)
    if (json) {
      writeJson({ ok: true, id, deleted: true })
    } else {
      process.stdout.write(`Deleted ${ref}.\n`)
    }
    return 0
  } catch (error) {
    return reportError(error, json)
  }
}

async function runLifecycle(options: {
  ref: string | undefined
  json: boolean
  verb: 'start' | 'stop'
}): Promise<number> {
  const { ref, json, verb } = options
  if (!ref) {
    process.stderr.write(`Usage: layerbase cloud ${verb} <id-or-name>\n`)
    return 1
  }
  try {
    const id = await resolveDatabaseId(ref)
    const result =
      verb === 'start' ? await startDatabase(id) : await stopDatabase(id)
    if (json) {
      writeJson({ ok: true, id, ...result })
    } else {
      const status =
        typeof result.status === 'string' ? result.status : `${verb}ed`
      process.stdout.write(`${ref}: ${status}\n`)
    }
    return 0
  } catch (error) {
    return reportError(error, json)
  }
}

export async function runStart(options: {
  args: string[]
  flags: CommandFlags
}): Promise<number> {
  return runLifecycle({
    ref: options.args[0],
    json: options.flags.json ?? false,
    verb: 'start',
  })
}

export async function runStop(options: {
  args: string[]
  flags: CommandFlags
}): Promise<number> {
  return runLifecycle({
    ref: options.args[0],
    json: options.flags.json ?? false,
    verb: 'stop',
  })
}
