import {
  discoverSources,
  getMigrationRun,
  listDatabases,
  migrateFromSource,
  migratePreflight,
  resolveDatabaseId,
  CloudApiError,
} from '@/lib/cloud-api'
import type { DiscoveredSource, MigrationRun } from '@/lib/cloud-api'
import {
  getCatalogSource,
  catalogSourceIds,
  type CatalogSource,
} from '@/lib/migration-catalog'
import { redactSecrets } from '@/lib/redact'
import { promptLine, selectFromList } from '@/lib/select'
import { confirm } from '@/lib/confirm'
import { reportError, writeJson } from '@/lib/cli-output'
import type { CommandFlags } from '@/ui/app'

// Resolved credentials for a source. NEVER logged or included in --json output.
type Credentials = {
  connectionString?: string
  sourceKey?: string
  sourceId?: string
  sourceSecret?: string
}

// Every secret string we collected, so error/report text can be scrubbed of any
// accidental echo before it is written.
function secretValues(creds: Credentials): string[] {
  return [
    creds.connectionString,
    creds.sourceKey,
    creds.sourceId,
    creds.sourceSecret,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
}

function usage(): void {
  process.stderr.write(
    'Usage: layerbase migrate --source <id> --target <db-id-or-name> [creds] [--yes] [--json]\n' +
      `Sources: ${catalogSourceIds().join(', ')}\n`,
  )
}

// Resolve credentials from flags, with friendly per-source aliases. In an
// interactive TTY, prompt for anything still missing; in a non-TTY context,
// collect the list of missing required flags so the caller can exit 1.
async function resolveCredentials(options: {
  source: CatalogSource
  flags: CommandFlags
  interactive: boolean
}): Promise<{ creds: Credentials; missing: string[] }> {
  const { source, flags, interactive } = options
  const creds: Credentials = {}
  const missing: string[] = []
  const req = source.credentials

  if (req.connectionString) {
    // --url is a friendly alias of --connection-string for paste sources.
    let value = flags.connectionString ?? flags.url ?? ''
    if (!value && interactive) {
      value = await promptLine(req.connectionString.label)
    }
    if (!value) missing.push('--connection-string')
    else creds.connectionString = value
  }

  if (req.sourceKey) {
    // --token is a friendly alias of --source-key.
    let value = flags.sourceKey ?? flags.token ?? ''
    if (!value && interactive) value = await promptLine(req.sourceKey.label)
    if (!value) missing.push('--source-key')
    else creds.sourceKey = value
  }

  if (req.sourceId) {
    // Friendly per-provider aliases all feed the single apiKeyId slot.
    let value =
      flags.sourceId ??
      flags.appId ??
      flags.email ??
      flags.tokenId ??
      flags.accountId ??
      flags.url ??
      ''
    if (!value && interactive) value = await promptLine(req.sourceId.label)
    if (!value) missing.push('--source-id')
    else creds.sourceId = value
  }

  if (req.sourceSecret) {
    // --db-password is a friendly alias of --source-secret.
    let value = flags.sourceSecret ?? flags.dbPassword ?? ''
    if (!value && interactive) value = await promptLine(req.sourceSecret.label)
    if (!value) missing.push('--source-secret')
    else creds.sourceSecret = value
  }

  return { creds, missing }
}

// Poll a migration run to completion, printing coarse progress (non-json only).
// Returns the terminal run. Retries transient read failures a few times so a
// blip mid-run does not abort a migration that is still progressing.
async function pollMigration(options: {
  targetId: string
  runId: string
  json: boolean
  secrets: string[]
}): Promise<MigrationRun> {
  const { targetId, runId, json, secrets } = options
  let lastReport = ''
  let lastStatus = ''
  let transientErrors = 0
  for (;;) {
    let run: MigrationRun
    try {
      run = await getMigrationRun({ targetId, runId })
      transientErrors = 0
    } catch (error) {
      if (error instanceof CloudApiError && error.info.status >= 500) {
        transientErrors += 1
        if (transientErrors <= 5) {
          await sleep(2000)
          continue
        }
      }
      throw error
    }

    if (!json) {
      if (run.status !== lastStatus) {
        process.stdout.write(`Status: ${run.status}\n`)
        lastStatus = run.status
      }
      if (run.report && run.report !== lastReport) {
        process.stdout.write(`  ${redactSecrets(run.report, secrets)}\n`)
        lastReport = run.report
      }
    }

    if (run.status === 'completed' || run.status === 'failed') {
      return run
    }
    await sleep(2000)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Pick which discovered source database to migrate. Auto-selects a single
// match; otherwise honours --source-db (label match or 1-based index), prompts
// on a TTY, and errors with the available labels in a non-TTY context.
async function pickDiscoveredSource(options: {
  databases: DiscoveredSource[]
  selector: string | undefined
  interactive: boolean
}): Promise<DiscoveredSource | undefined> {
  const { databases, selector, interactive } = options
  if (databases.length === 0) return undefined
  if (databases.length === 1) return databases[0]

  if (selector) {
    const asIndex = Number(selector)
    if (
      Number.isInteger(asIndex) &&
      asIndex >= 1 &&
      asIndex <= databases.length
    ) {
      return databases[asIndex - 1]
    }
    const lower = selector.toLowerCase()
    return databases.find((d) => d.label.toLowerCase().includes(lower))
  }

  if (interactive) {
    return selectFromList({
      title: 'Select a source database to migrate:',
      items: databases,
      render: (d) => d.label,
    })
  }

  return undefined
}

// `layerbase migrate --source <id> --target <db> [creds] [--yes] [--json]`
export async function runMigrate(options: {
  flags: CommandFlags
}): Promise<number> {
  const { flags } = options
  const json = flags.json ?? false
  const interactive = Boolean(process.stdin.isTTY) && !json

  // 1. Resolve the source.
  let sourceId = flags.source
  if (!sourceId && interactive) {
    const chosen = await selectFromList({
      title: 'Migrate from which source?',
      items: catalogSourceIds(),
      render: (id) => id,
    })
    sourceId = chosen
  }
  if (!sourceId) {
    usage()
    return 1
  }
  const source = getCatalogSource(sourceId)
  if (!source) {
    process.stderr.write(
      `Unknown source "${sourceId}". Sources: ${catalogSourceIds().join(', ')}\n`,
    )
    return 1
  }

  // 2. Resolve the target database (id or name).
  const targetRef = flags.target
  if (!targetRef) {
    process.stderr.write(
      'Missing --target. Pass a cloud database id or name (see `layerbase cloud ls`).\n',
    )
    return 1
  }

  // 3. Collect credentials.
  const { creds, missing } = await resolveCredentials({
    source,
    flags,
    interactive,
  })
  if (missing.length > 0) {
    process.stderr.write(
      `Missing required credentials for source "${source.id}": ${missing.join(', ')}.\n` +
        `Hint: ${source.hint}\n`,
    )
    return 1
  }
  const secrets = secretValues(creds)

  try {
    const targetId = await resolveDatabaseId(targetRef)
    // Best-effort lookup for a friendlier confirmation line; never fatal.
    const target = (await listDatabases()).find((d) => d.id === targetId)

    let body: Record<string, unknown>
    let sourceLabel = source.label
    let sizeBytes: number | null = null

    if (source.kind === 'connection-string') {
      // Preflight validates + wakes + sizes the source (paste sources only).
      const pre = await migratePreflight({
        targetId,
        connectionString: creds.connectionString ?? '',
      })
      sizeBytes = pre.sizeBytes ?? null
      if (pre.note) sourceLabel = `${source.label} (${pre.note})`
      body = { connectionString: creds.connectionString }
    } else {
      // API-key sources: discover the account, then pick one database.
      if (!source.provider) {
        process.stderr.write(
          `Source "${source.id}" is misconfigured (no provider).\n`,
        )
        return 1
      }
      const discovery = await discoverSources({
        provider: source.provider,
        apiKey: creds.sourceKey ?? '',
        apiKeyId: creds.sourceId,
      })
      const picked = await pickDiscoveredSource({
        databases: discovery.databases,
        selector: flags.sourceDb,
        interactive,
      })
      if (!picked) {
        if (discovery.databases.length === 0) {
          process.stderr.write(
            `No importable databases found in the ${source.label} account.\n`,
          )
        } else {
          process.stderr.write(
            `Multiple source databases found. Pass --source-db <label-or-number>:\n` +
              discovery.databases
                .map((d, i) => `  ${i + 1}) ${d.label}`)
                .join('\n') +
              '\n',
          )
        }
        return 1
      }
      sourceLabel = `${source.label}: ${picked.label}`
      sizeBytes = picked.sizeHint ?? null
      body = {
        provider: source.provider,
        apiKey: creds.sourceKey,
        sourceRef: picked.ref,
      }
      if (creds.sourceId) body.apiKeyId = creds.sourceId
      if (creds.sourceSecret) body.sourceSecret = creds.sourceSecret
    }

    // 4. Show what will happen and confirm (unless --yes / --json non-TTY).
    const targetName = target ? `${target.name} (${target.engine})` : targetId
    const sizeLine =
      sizeBytes != null ? ` Source size: ~${formatBytes(sizeBytes)}.` : ''
    if (!json) {
      process.stdout.write(
        `Migrate ${sourceLabel}\n  into ${targetName}.${sizeLine}\n` +
          '  This imports into the target and may overwrite existing data.\n',
      )
    }
    if (!flags.yes) {
      if (!interactive) {
        process.stderr.write(
          'Refusing to start a migration without confirmation. ' +
            'Pass --yes (-y) to run non-interactively.\n',
        )
        return 1
      }
      const ok = await confirm('Start this migration?')
      if (!ok) {
        process.stdout.write('Aborted.\n')
        return 1
      }
    }

    // 5. Kick off + poll.
    const start = await migrateFromSource({ targetId, body })
    if (!json) {
      process.stdout.write(`Started migration run ${start.runId}.\n`)
    }
    const run = await pollMigration({
      targetId,
      runId: start.runId,
      json,
      secrets,
    })

    if (run.status === 'failed') {
      const message = redactSecrets(run.error ?? 'Migration failed.', secrets)
      if (json) {
        writeJson({
          ok: false,
          runId: run.id,
          status: run.status,
          error: message,
        })
      } else {
        process.stderr.write(`Migration failed: ${message}\n`)
      }
      return 1
    }

    if (json) {
      writeJson({
        ok: true,
        runId: run.id,
        status: run.status,
        databaseId: run.databaseId,
        report: run.report ? redactSecrets(run.report, secrets) : null,
      })
    } else {
      process.stdout.write(`Migration complete (run ${run.id}).\n`)
    }
    return 0
  } catch (error) {
    // Scrub any secret the error text might have echoed before reporting.
    if (error instanceof CloudApiError) {
      error.info.message = redactSecrets(error.info.message, secrets)
    } else if (error instanceof Error) {
      error.message = redactSecrets(error.message, secrets)
    }
    return reportError(error, json)
  }
}

function formatBytes(bytes: number): string {
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
