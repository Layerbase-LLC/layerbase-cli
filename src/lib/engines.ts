import type { ConnectionInfo } from './cloud-api'

// Engine values mirror the canonical `Engine` map shared across the Layerbase
// ecosystem (web `lib/databases.ts`, cloud `src/config/engines.ts`). Kept as a
// local literal here so the CLI stays a standalone package with no cross-repo
// import.
const PG_FAMILY = new Set(['postgresql', 'cockroachdb'])
const MYSQL_FAMILY = new Set(['mysql', 'mariadb'])
const REDIS_FAMILY = new Set(['redis', 'valkey'])

// How the child process learns a path-based secret without it touching argv as
// a value: either via an env var pointing at a 0600 file, or via an argv option
// whose value is the (non-secret) path to a 0600 file.
export type TempFile = {
  contents: string
  mode: number
  via:
    | { type: 'env'; envVar: string }
    | { type: 'argv'; render: (path: string) => string[] }
}

export type LaunchPlan = {
  bin: string
  // argv never contains the password. Host/port/db/user are not secret.
  argv: string[]
  env?: Record<string, string>
  // Secret env vars are merged just for the child, never logged.
  secretEnv?: Record<string, string>
  tempFile?: TempFile
}

function commandMatchesEngine(command: string, engine: string): void {
  const aliasFamily: Record<string, Set<string>> = {
    psql: PG_FAMILY,
    'redis-cli': REDIS_FAMILY,
    mysql: MYSQL_FAMILY,
  }
  const expected = aliasFamily[command]
  if (expected && !expected.has(engine)) {
    throw new Error(
      `\`layerbase ${command}\` does not match engine "${engine}". ` +
        'Use `layerbase connect <db>` to auto-pick the right client.',
    )
  }
}

export function buildLaunchPlan(options: {
  info: ConnectionInfo
  command: string
}): LaunchPlan {
  const { info, command } = options
  const engine = info.engine.toLowerCase()
  commandMatchesEngine(command, engine)

  if (PG_FAMILY.has(engine)) {
    return {
      bin: 'psql',
      argv: [
        '-h',
        info.host,
        '-p',
        String(info.port),
        '-U',
        info.username,
        '-d',
        info.database,
      ],
      env: { PGSSLMODE: info.tls === false ? 'prefer' : 'require' },
      tempFile: {
        // ~/.pgpass line format: host:port:database:user:password
        contents: `${info.host}:${info.port}:${info.database}:${info.username}:${info.password}\n`,
        mode: 0o600,
        via: { type: 'env', envVar: 'PGPASSFILE' },
      },
    }
  }

  if (MYSQL_FAMILY.has(engine)) {
    return {
      bin: 'mysql',
      argv: [
        '-h',
        info.host,
        '-P',
        String(info.port),
        '-u',
        info.username,
        info.database,
      ],
      tempFile: {
        // --defaults-extra-file must precede other client options, so it is
        // prepended to argv. The file (0600) holds the password, not argv.
        contents: `[client]\npassword="${info.password}"\n`,
        mode: 0o600,
        via: {
          type: 'argv',
          render: (path) => [`--defaults-extra-file=${path}`],
        },
      },
    }
  }

  if (REDIS_FAMILY.has(engine)) {
    const argv = ['-h', info.host, '-p', String(info.port)]
    if (info.tls !== false) {
      argv.push('--tls', '--sni', info.host)
    }
    if (info.username && info.username !== 'default') {
      argv.push('--user', info.username)
    }
    return {
      bin: 'redis-cli',
      argv,
      // redis-cli reads the password from REDISCLI_AUTH instead of -a, which
      // would otherwise show in `ps` and trigger its own warning.
      secretEnv: { REDISCLI_AUTH: info.password },
    }
  }

  throw new Error(
    `No secure interactive client is wired for engine "${engine}" yet. ` +
      `Use \`layerbase connection-string <db>\` or the dashboard query console.`,
  )
}
