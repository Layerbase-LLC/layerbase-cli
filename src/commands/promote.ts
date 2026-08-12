import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createDatabase,
  DEFAULT_API_URL,
  getConnectionInfo,
  listDatabases,
} from '@/lib/cloud-api'
import type { CreateDatabaseResult } from '@/lib/cloud-api'
import { captureSpindb, parseLastJson } from '@/lib/run-spindb'
import { confirm } from '@/lib/confirm'
import { reportError, writeJson } from '@/lib/cli-output'
import { formatBytes, uploadAndImport } from '@/commands/import'
import { writeEnvAssignment } from '@/lib/env-file'
import {
  classifySource,
  deriveDatabaseName,
  describeSource,
  mapTargetEngine,
  parseSqliteTarget,
  probePath,
} from '@/lib/promote-source'
import type { SpindbInstance } from '@/lib/promote-source'
import type { CommandFlags } from '@/ui/app'

// Free-tier posture of a promoted database (plan decision: promoted databases
// get plain free-tier rules, nothing special).
const WHAT_HAPPENS_NEXT =
  'Free tier: it sleeps after an hour idle and wakes on your next connection.'

// Some engines provision asynchronously, so the create response can come back
// while the database is still `provisioning`. Import refuses in that state, so
// poll briefly before uploading.
const RUNNING_TIMEOUT_MS = 90_000
const RUNNING_INTERVAL_MS = 1_500

async function listSpindbInstances(): Promise<SpindbInstance[]> {
  // --no-scan: without it spindb scans the cwd for stray database files and can
  // prompt, which would hang a non-interactive promote.
  const result = await captureSpindb(['list', '--json', '--no-scan'])
  if (result.code !== 0) return []
  try {
    const parsed: unknown = JSON.parse(result.stdout.trim())
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is SpindbInstance =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as { name?: unknown }).name === 'string' &&
        typeof (row as { engine?: unknown }).engine === 'string',
    )
  } catch {
    return []
  }
}

// Ask spindb for a dump of one of its containers. `-n` is not cosmetic: spindb
// 0.59.0 builds its default backup filename out of the container's `database`
// value, which for file-based engines is an absolute path, and the resulting
// copy target does not exist.
async function backupSpindbInstance(options: {
  instance: SpindbInstance
  outputDir: string
}): Promise<string> {
  const { instance, outputDir } = options
  const result = await captureSpindb([
    'backup',
    instance.name,
    '--output',
    outputDir,
    '--name',
    'promote',
    '--json',
  ])
  const payload = parseLastJson(result.stdout) ?? parseLastJson(result.stderr)
  const path = payload && typeof payload.path === 'string' ? payload.path : ''
  if (result.code !== 0 || !path) {
    const detail =
      (payload && typeof payload.error === 'string' && payload.error) ||
      result.stderr.trim() ||
      `spindb backup exited ${result.code}`
    throw new Error(
      `Could not back up local container "${instance.name}": ${detail}\n` +
        `Run \`spindb backup ${instance.name}\` yourself, then promote the ` +
        'resulting file.',
    )
  }
  return path
}

async function waitForRunning(id: string): Promise<string> {
  const deadline = Date.now() + RUNNING_TIMEOUT_MS
  let status = 'provisioning'
  while (Date.now() < deadline) {
    const match = (await listDatabases()).find((db) => db.id === id)
    status = match?.status ?? status
    if (status === 'running') return status
    await new Promise((r) => setTimeout(r, RUNNING_INTERVAL_MS))
  }
  return status
}

async function resolveConnectionString(
  created: CreateDatabaseResult,
): Promise<string | undefined> {
  if (created.connectionString) return created.connectionString
  try {
    const info = await getConnectionInfo(created.id)
    return info.uri
  } catch {
    return undefined
  }
}

function dashboardUrl(id: string): string {
  return new URL(`/cloud/${encodeURIComponent(id)}`, DEFAULT_API_URL).toString()
}

// `layerbase promote <source> [--from pglite] [--target pgsqlite] [--name db]
//  [--write-env] [--yes] [--json]`
export async function runPromote(options: {
  args: string[]
  flags: CommandFlags
}): Promise<number> {
  const { args, flags } = options
  const json = flags.json ?? false
  const interactive = Boolean(process.stdin.isTTY) && !json
  const say = (message: string): void => {
    if (!json) process.stdout.write(`${message}\n`)
  }

  const ref = args[0]
  if (!ref) {
    process.stderr.write(
      'Usage: layerbase promote <file-or-container> [--target pgsqlite] ' +
        '[--name <db>] [--write-env] [--yes] [--json]\n',
    )
    return 1
  }

  const targetChoice = parseSqliteTarget(flags.target)
  if (!targetChoice.ok) {
    return reportError(new Error(targetChoice.error), json)
  }

  // 1. Detect the source: filesystem facts + the local spindb container list.
  const classified = classifySource({
    ref,
    from: flags.from,
    probe: probePath(ref),
    instances: await listSpindbInstances(),
  })
  if (!classified.ok) {
    return reportError(new Error(classified.error), json)
  }
  const source = classified.source

  // 2. Map to a cloud engine. Every refusal happens HERE, before anything is
  // created, so an unsupported source never strands an empty database.
  const target = mapTargetEngine({
    source,
    sqliteTarget: targetChoice.target,
  })
  if (!target.ok) {
    return reportError(new Error(target.error), json)
  }

  const name = deriveDatabaseName({ source, explicit: flags.name })

  say(
    `Promote ${describeSource(source)} to a new cloud ${target.engine} ` +
      `database named "${name}".`,
  )
  if (interactive && !flags.yes) {
    const ok = await confirm('Continue?')
    if (!ok) {
      process.stdout.write('Aborted.\n')
      return 1
    }
  }

  let tempDir: string | undefined
  let keepDump = false
  try {
    // 3. Produce the artifact to upload. A file source IS the artifact; a
    // spindb container is dumped with spindb's own backup command.
    let dumpPath: string
    if (source.kind === 'spindb') {
      tempDir = mkdtempSync(join(tmpdir(), 'layerbase-promote-'))
      say(`Backing up local container "${source.instance.name}"...`)
      dumpPath = await backupSpindbInstance({
        instance: source.instance,
        outputDir: tempDir,
      })
    } else {
      dumpPath = resolve(source.path)
    }

    const size = statSync(dumpPath).size
    if (size === 0) {
      throw new Error(`Nothing to promote: ${dumpPath} is empty.`)
    }

    // 4. Create the cloud database, then wait for it to be importable.
    say(`Creating cloud database "${name}" (${target.engine})...`)
    const created = await createDatabase({ name, engine: target.engine })

    if (created.status !== 'running') {
      say('Waiting for the database to come up...')
      const status = await waitForRunning(created.id)
      if (status !== 'running') {
        // Keep the dump: the retry command below points at it.
        keepDump = true
        throw new Error(
          `"${created.name}" is still ${status} after ` +
            `${RUNNING_TIMEOUT_MS / 1000}s. It exists but has no data yet. ` +
            `Retry the import with: layerbase import ${dumpPath} --target ${created.name} --yes`,
        )
      }
    }

    // 5. Import through the shipped import path.
    try {
      const imported = await uploadAndImport({
        filePath: dumpPath,
        size,
        targetId: created.id,
        onProgress: json ? undefined : (message) => say(message),
      })

      const connectionString = await resolveConnectionString(created)
      const url = dashboardUrl(created.id)

      let envAction: string | undefined
      if (flags.writeEnv) {
        if (!connectionString) {
          process.stderr.write(
            'Skipped --write-env: the cloud API returned no connection ' +
              'string for this database.\n',
          )
        } else {
          const envPath = resolve(process.cwd(), '.env')
          envAction = writeEnvAssignment({
            filePath: envPath,
            key: 'DATABASE_URL',
            value: connectionString,
          })
        }
      }

      if (json) {
        writeJson({
          ok: true,
          source: {
            kind: source.kind,
            ...(source.kind === 'spindb'
              ? {
                  container: source.instance.name,
                  engine: source.instance.engine,
                }
              : { path: resolve(source.path) }),
          },
          database: {
            id: created.id,
            name: created.name,
            engine: created.engine,
            status: 'running',
          },
          connectionString,
          dashboardUrl: url,
          bytesUploaded: imported.bytesUploaded,
          env: envAction ? { path: '.env', action: envAction } : null,
        })
        return 0
      }

      process.stdout.write(
        `\nPromoted ${describeSource(source)} into "${created.name}" ` +
          `(${formatBytes(imported.bytesUploaded)}).\n\n`,
      )
      if (connectionString) process.stdout.write(`${connectionString}\n\n`)
      process.stdout.write(`Dashboard: ${url}\n`)
      process.stdout.write(`${WHAT_HAPPENS_NEXT}\n`)
      if (envAction) {
        process.stdout.write(
          `Wrote DATABASE_URL to ./.env (${envAction} the assignment; no other lines changed).\n`,
        )
      }
      return 0
    } catch (error) {
      // The database exists but is empty. Never delete it behind the user's
      // back: say exactly what is there and how to remove it. The dump is kept
      // (see the finally below) so the retry command actually has a file.
      keepDump = true
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `${message}\n\n` +
          `The cloud database "${created.name}" WAS created and is empty. ` +
          'Retry the data load with:\n' +
          `  layerbase import ${dumpPath} --target ${created.name} --yes\n` +
          'or remove it with:\n' +
          `  layerbase cloud delete ${created.name} --yes`,
      )
    }
  } catch (error) {
    return reportError(error, json)
  } finally {
    if (tempDir && !keepDump) rmSync(tempDir, { recursive: true, force: true })
  }
}
