import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  CloudApiError,
  createDatabase,
  getConnectionInfo,
  listDatabases,
  listEngines,
  webAppBaseUrl,
} from '@/lib/cloud-api'
import type { CreateDatabaseResult, CreateSource } from '@/lib/cloud-api'
import { captureSpindb, parseLastJson } from '@/lib/run-spindb'
import { confirm, decideConfirmation } from '@/lib/confirm'
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
  sourceEngineVersion,
} from '@/lib/promote-source'
import type { SpindbInstance } from '@/lib/promote-source'
import {
  creatableVersions,
  isUnsupportedVersionMessage,
  parseSupportedVersionsFromError,
  promoteVersionLine,
  resolvePromoteVersion,
  versionMajor,
} from '@/lib/engine-versions'
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

// What version the new cloud database should run, worked out BEFORE it is
// created so the user reads it in the same breath as the confirmation.
type VersionPlan = {
  // The identifier to send. Undefined leaves the choice to the cloud, which is
  // what promote did unconditionally before this existed.
  version?: string
  // The one line to print before creating, when the cloud version is not the
  // local one.
  line?: string
  // True when no offer list could be read for this engine. The create then
  // falls back to the cloud default and promote reports what it actually got
  // rather than pretending it chose.
  unresolved: boolean
  // The catalog's display name for the engine ('PostgreSQL'), or the slug.
  engineLabel: string
}

// Resolve the local version against what the cloud will actually create.
//
// Best-effort by design, and this is where the CLI parts company with the
// desktop app: the desktop stops the promote on an unreadable catalog because
// it can show the user a dialog, while a promote that works today must not
// start failing here over a catalog request. An unreadable catalog sends no
// version (the pre-existing behavior) and is reported after the create.
async function planCloudVersion(options: {
  engine: string
  localVersion?: string
}): Promise<VersionPlan> {
  const { engine, localVersion } = options
  // A source with no version of its own (a bare .sqlite/.duckdb file, a SQL
  // dump) has nothing to resolve: keep the cloud default and stay quiet.
  if (!localVersion) return { unresolved: false, engineLabel: engine }

  let entry
  try {
    const engines = await listEngines()
    entry = engines.find(
      (candidate) =>
        candidate.id === engine &&
        candidate.status === 'supported' &&
        candidate.hostedServiceAllowed,
    )
  } catch {
    return { unresolved: true, engineLabel: engine }
  }

  const engineLabel = entry?.name || engine
  const supportedVersions = entry?.supportedVersions ?? []
  if (supportedVersions.length === 0) {
    return { unresolved: true, engineLabel }
  }

  const resolution = resolvePromoteVersion({
    localVersion,
    offeredVersions: creatableVersions({ engine, supportedVersions }),
  })
  if (!resolution) return { unresolved: true, engineLabel }

  return {
    version: resolution.version,
    line: promoteVersionLine({ resolution, engineLabel }) ?? undefined,
    unresolved: false,
    engineLabel,
  }
}

// Create the database, and heal the one failure the version can cause.
//
// The sunset list in engine-versions.ts is a mirror of a cloud-side gate that
// /v1/engines does not publish, so it can drift. When it has, the cloud names
// the versions it WILL create in its own rejection: re-resolve against that
// list and retry once. Nothing was created by the rejected call, so the retry
// is a plain create, not a cleanup.
async function createWithVersion(options: {
  name: string
  engine: string
  version?: string
  localVersion?: string
  engineLabel: string
  source: CreateSource
  say: (message: string) => void
}): Promise<CreateDatabaseResult> {
  const { name, engine, version, localVersion, engineLabel, source, say } =
    options
  try {
    return await createDatabase({ name, engine, version, source })
  } catch (error) {
    if (
      !version ||
      !(error instanceof CloudApiError) ||
      !isUnsupportedVersionMessage(error.message)
    ) {
      throw error
    }
    const offeredVersions = parseSupportedVersionsFromError(error.message)
    const retry = offeredVersions
      ? resolvePromoteVersion({ localVersion, offeredVersions })
      : undefined
    say(
      `Cloud does not create ${engineLabel} ${version} any more; creating ` +
        (retry
          ? `${engineLabel} ${retry.version} instead.`
          : `the default ${engineLabel} version instead.`),
    )
    return createDatabase({ name, engine, version: retry?.version, source })
  }
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

// The link must point at the host the database was actually created on, so the
// base is resolved the same way the cloud client resolves it (--api-url flag >
// the logged-in host > LAYERBASE_API_URL / the default).
async function dashboardUrl(id: string): Promise<string> {
  const base = await webAppBaseUrl()
  return new URL(`/cloud/${encodeURIComponent(id)}`, base).toString()
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
  // Promote CREATES a billable cloud database, so a non-interactive run (no
  // TTY, or --json) must carry --yes rather than proceed unconfirmed. This
  // refusal happens before any network call, so nothing is provisioned.
  const decision = decideConfirmation({
    yes: flags.yes ?? false,
    interactive,
  })
  if (decision === 'refuse') {
    process.stderr.write(
      'Refusing to create a cloud database without confirmation. Pass --yes (-y) to run non-interactively.\n',
    )
    return 1
  }
  if (decision === 'prompt') {
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

    // 4. Work out which version the cloud will run, then create the database
    // and wait for it to be importable. The version is resolved against the
    // cloud's own offer list rather than sent raw or left blank: a local
    // PostgreSQL 15 container silently landing on 18 is the behavior this
    // replaces.
    const localVersion = sourceEngineVersion(source)
    const plan = await planCloudVersion({
      engine: target.engine,
      localVersion,
    })
    if (plan.line) say(plan.line)

    say(`Creating cloud database "${name}" (${target.engine})...`)
    // The source KIND only ('sqlite' | 'duckdb' | 'sql-dump' | 'spindb'), so
    // graduated prototypes are countable. Never the path or the container name:
    // those are the user's filesystem, not our metric. cloud-api sanitizes this
    // again on the way out as a backstop.
    const created = await createWithVersion({
      name,
      engine: target.engine,
      version: plan.version,
      localVersion,
      engineLabel: plan.engineLabel,
      source: { via: 'promote', kind: source.kind },
      say,
    })

    // No offer list was readable, so the cloud picked the version. Say which
    // one it picked when it is not the local major, instead of leaving the user
    // to discover a major upgrade on their own.
    if (
      plan.unresolved &&
      localVersion &&
      created.version &&
      versionMajor(created.version) !== versionMajor(localVersion)
    ) {
      say(
        `Note: local ${plan.engineLabel} ${localVersion} promoted into cloud ` +
          `${plan.engineLabel} ${created.version}.`,
      )
    }

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
      const url = await dashboardUrl(created.id)

      let envAction: string | undefined
      let envError: string | undefined
      if (flags.writeEnv) {
        if (!connectionString) {
          process.stderr.write(
            'Skipped --write-env: the cloud API returned no connection ' +
              'string for this database.\n',
          )
        } else {
          const envPath = resolve(process.cwd(), '.env')
          try {
            envAction = writeEnvAssignment({
              filePath: envPath,
              key: 'DATABASE_URL',
              value: connectionString,
            })
          } catch (error) {
            // The data IS loaded at this point, so an unwritable .env is not an
            // import failure and must not be reported as one. Say what failed
            // and never claim the file was written.
            envError = error instanceof Error ? error.message : String(error)
            process.stderr.write(
              `Skipped --write-env: could not update ${envPath}: ${envError}\n`,
            )
          }
        }
      }
      const envResult = envAction
        ? { path: '.env', action: envAction }
        : envError
          ? { path: '.env', error: envError }
          : null

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
            version: created.version,
            status: 'running',
          },
          connectionString,
          dashboardUrl: url,
          bytesUploaded: imported.bytesUploaded,
          env: envResult,
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
