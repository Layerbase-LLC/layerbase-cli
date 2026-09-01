import meow from 'meow'
import { render } from 'ink'
import { App } from '@/ui/app'
import { runExec } from '@/commands/connect'
import { runInteractive } from '@/commands/interactive'
import { runClone } from '@/commands/clone'
import { runSpindb } from '@/lib/run-spindb'
import { registeredCommandNames } from '@/lib/commands'
import { getVersion } from '@/lib/version'
import { configureCloudAuth } from '@/lib/cloud-api'
import { runWhoami } from '@/commands/whoami-run'
import { runKeyLogin } from '@/commands/key-login'
import {
  runCreate,
  runDestroy,
  runStart,
  runStop,
} from '@/commands/cloud-write'
import { runBranch } from '@/commands/cloud-branch'
import { runAgentInit } from '@/commands/agent-init'
import { runMigrate } from '@/commands/migrate'
import { runImport } from '@/commands/import'
import { runPromote } from '@/commands/promote'
import type { CommandFlags } from '@/ui/app'

const VERSION = getVersion()

const UNIFIED_HELP = `
  Layerbase ${VERSION} - local-first database CLI (also as lbase)

  Local databases (drop-in for spindb - every spindb command works)
    create, ls, start, stop, connect, clone, branch, backup, restore, run,
    query, pull, menu, ...
    Anything not listed under "Cloud account" runs against your local spindb
    install verbatim, flags included. Run "lbase <cmd> --help" for details.

  Cloud account
    login / logout / whoami       Manage your Layerbase session
    cloud ls                      List your cloud databases (--json to script)
    cloud create <name> --engine <e> [--ttl 2h]  Provision a database
    cloud delete <db> --yes       Delete a cloud database
    cloud start / stop <db>       Start or stop a cloud database
    cloud branch <db> <name>      Create/reset/delete/ls database branches
    cloud connect <db>            Connect with the engine's native client
    cloud clone <db> [name]       Clone a cloud database into local spindb
    cloud connection-string <db>  Print the connection string (reveals password)
    psql / mysql / redis-cli <db> Connect to a cloud database by engine
    promote <file-or-container>   Put a local database in the cloud, data included
    migrate --source <s> --target <db>  Import an external database into a cloud DB
    import <dumpfile> --target <db>      Import a dump file into a cloud database
    agent init [--global]         Install the Layerbase skill for AI agents
    alias                         Set up the short "lb" command
    chat                          Interactive console for your Layerbase account

  Headless auth (CI / agents)
    Set LAYERBASE_API_KEY (or pass --api-key) to run cloud commands with no
    browser: calls go straight to the cloud API. "layerbase login --api-key
    <key>" saves it. Create a key at https://layerbase.com/cloud/settings.

  Notes
    bare = spindb, cloud = "lbase cloud <verb>"
    "lbase --help" / "--version" show this help / the layerbase version.
    "lbase version" forwards to spindb's version command.

  Examples
    $ lbase                          # spindb's interactive menu
    $ lbase create my-db --engine sqlite
    $ lbase login
    $ lbase promote ./app.db --write-env
    $ lbase cloud ls --json
    $ LAYERBASE_API_KEY=sk_... lbase cloud create ci-db --engine postgresql --ttl 2h
    $ lbase psql my-cloud-db
`

const CLOUD_HELP = `
  Cloud account commands

    lbase cloud ls                 List your cloud databases (--json to script)
    lbase cloud create <name> --engine <e> [--ttl 2h] [--json]
                                   Provision a database (--ttl makes it transient)
    lbase cloud delete <db> --yes  Delete a database (--yes to skip the prompt)
    lbase cloud start <db>         Start a database
    lbase cloud stop <db>          Stop a database
    lbase cloud branch <db> <name>        Create or reuse a branch
    lbase cloud branch reset <db> <name>  Re-fork a branch from its parent
    lbase cloud branch delete <db> <name> Delete a branch
    lbase cloud branch ls <db>            List a database branches
    lbase cloud connect <db>       Connect with the engine's native client
    lbase cloud clone <db> [name]  Clone a cloud database into local spindb
    lbase cloud connection-string <db> (alias: url)
                                   Print the connection string (reveals password)
    lbase psql / mysql / redis-cli <db>  Connect to a cloud database by engine

  "<db>" accepts a cloud database id or its name. Set LAYERBASE_API_KEY (or pass
  --api-key) to run these headlessly with no browser login.
`

const MIGRATE_HELP = `
  layerbase migrate - import an external database INTO a cloud database

    layerbase migrate --source <id> --target <db-id-or-name> [creds] [--yes] [--json]

  Sources and their credential flags
    Connection-string sources (paste one URL with --connection-string, alias --url):
      postgres       postgresql://user:password@host:5432/dbname
      mysql          mysql://user:password@host:3306/dbname
      mariadb        mysql://... (a caching_sha2_password MySQL 8 source needs --source mysql)
      redis          redis:// or rediss://
      valkey         redis://, rediss://, valkey:// or valkeys://
      vercel-kv      the store's rediss:// endpoint (Vercel KV now lives on Upstash)
      netlify        netlify database status --show-credentials --branch production
      replit         the production postgresql:// string, or REPLIT_DB_URL for ReplDB
      heroku         heroku config:get DATABASE_URL (or REDIS_URL) -a your-app
      digitalocean   Connection details, Public network, format "Connection string"
      fly            only through your own fly-mpg-proxy app, with ?sslmode=disable
      aiven          the Service URI (postgres://, mysql:// or valkeys://)
      crunchy-bridge the postgres-role URI, or cb uri <cluster>
      mongodb-atlas  mongodb+srv://user:password@cluster.mongodb.net/mydb (to FerretDB)

    API-key sources (we discover the account, then you pick a database):
      neon           --source-key <napi_...>
      supabase       --source-key <sbp_...> --source-secret <db password>
      render         --source-key <rnd_...>
      railway        --source-key <token>
      planetscale    --source-key <service token> --source-id <service token id>
      upstash        --source-key <mgmt api key> --source-id <account email>
      algolia        --source-key <admin api key> --source-id <application id> (--app-id)
      turso          --source-key <auth token> --source-id <libsql:// url> (--url)
      cloudflare-d1  --source-key <api token, D1 Read> --source-id <account id> (--account-id)

    Friendly aliases: --token = --source-key; --app-id / --email / --token-id /
    --account-id / --url fill --source-id; --db-password = --source-secret.

  Picking a source database
    --source-db <label-or-number>  choose among discovered databases in a non-TTY.

  Output
    --json prints ONE final JSON result object (no interim progress lines):
      { ok, runId, status, databaseId, report }  on success
      { ok: false, runId, status, error }         on failure
    Without --json, status + progress lines stream to stdout while the run polls.

  Credentials are never written to stdout, stderr, or --json output. In an
  interactive terminal, missing credentials are prompted for; in CI, a missing
  required flag exits 1 and lists what to pass.
`

const IMPORT_HELP = `
  layerbase import - restore a dump file INTO a cloud database

    layerbase import <dumpfile> --target <db-id-or-name> [--yes] [--json]

  Uploads the dump straight to storage (presigned), then restores it over the
  target database. Validates the file exists and is non-empty first and warns on
  very large files; the server enforces the hard size cap. --json prints a final
  { ok, message, database, engine, bytesUploaded } result.
`

const PROMOTE_HELP = `
  layerbase promote - put a local database in the cloud, data included

    layerbase promote <file-or-container> [--target pgsqlite] [--name <db>]
                      [--from <kind>] [--write-env] [--yes] [--json]

  It creates a NEW cloud database sized to the source, imports the data, and
  prints the connection string. One command instead of create + dump + import.

  Sources (detected from the argument, never guessed)
    ./app.db, ./app.sqlite, ./app.sqlite3   SQLite file (verified by its header)
    ./analytics.duckdb                      DuckDB file (verified by its header)
    ./dump.sql                              Postgres-dialect SQL dump
    my-local-pg                             a local spindb container, dumped
                                            with spindb's own backup command
    --from pglite ./dump.sql                a PGlite dump (see below)

  Targets
    SQLite sources land on the cloud SQLite engine (SQLite storage behind the
    Postgres wire, so psql and every Postgres driver work). --target libsql is
    accepted but refused for now: libSQL restores from a data-directory archive,
    not from a SQLite file. DuckDB -> DuckDB, SQL dumps and PGlite -> PostgreSQL,
    a spindb container -> the same engine in the cloud. Desktop-only engines
    (MongoDB, CockroachDB, SurrealDB) are refused with the licensing reason and
    the closest cloud alternative.

  PGlite data directories
    Not supported directly (that would ship several MB of WASM in every
    install). Dump the directory first with @electric-sql/pglite-tools' pgDump
    and promote the resulting .sql; promote prints the snippet if you point it
    at a directory.

  Flags
    --name <db>    name the cloud database (default: the file or container name)
    --target <t>   pgsqlite (default) or libsql, for SQLite sources
    --from <kind>  force the source kind: pglite, sqlite, duckdb, sql, spindb
    --write-env    rewrite DATABASE_URL in ./.env (opt-in, creates the file if
                   missing, never touches other lines)
    --yes (-y)     skip the confirmation prompt
    --json         print one machine-readable result object

  Needs a Layerbase API key (LAYERBASE_API_KEY, --api-key, or a browser login
  that cached one). If the import fails after the database is created, promote
  says so, leaves the empty database in place, and prints the exact retry and
  delete commands rather than deleting anything itself.
`

function printHelp(): void {
  process.stdout.write(`${UNIFIED_HELP}\n`)
}

// Both migrate/import reach meow (registered verbs), which has autoHelp off, so
// a --help/-h/`help` subtoken is handled here explicitly. Reads the raw argv for
// the flag (meow strips it into flags) plus the parsed `help` subtoken.
function wantsHelp(rest: string[]): boolean {
  return (
    process.argv.includes('--help') ||
    process.argv.includes('-h') ||
    rest[0] === 'help'
  )
}

function printCloudHelp(): void {
  process.stdout.write(`${CLOUD_HELP}\n`)
}

// Dispatch a "lbase cloud <verb> ..." invocation to the existing cloud command
// implementations. Flags (e.g. --json on cloud ls) are already parsed by meow.
async function runCloud(rest: string[], flags: CommandFlags): Promise<void> {
  const [sub = '', ...cloudArgs] = rest

  if (!sub) {
    printCloudHelp()
    process.exit(0)
  }

  if (sub === 'ls') {
    render(<App command="ls" args={[]} flags={flags} />)
    return
  }

  if (sub === 'create') {
    process.exit(await runCreate({ args: cloudArgs, flags }))
  }

  if (sub === 'delete' || sub === 'rm' || sub === 'destroy') {
    process.exit(await runDestroy({ args: cloudArgs, flags }))
  }

  if (sub === 'start') {
    process.exit(await runStart({ args: cloudArgs, flags }))
  }

  if (sub === 'stop') {
    process.exit(await runStop({ args: cloudArgs, flags }))
  }

  if (sub === 'branch') {
    process.exit(await runBranch({ args: cloudArgs, flags }))
  }

  if (sub === 'connect') {
    await runExec({ command: 'connect', args: cloudArgs, flags })
    return
  }

  if (sub === 'clone') {
    const dbRef = cloudArgs[0]
    if (!dbRef) {
      process.stderr.write('Usage: layerbase cloud clone <db> [local-name]\n')
      process.exit(1)
    }
    process.exit(await runClone({ dbRef, localName: cloudArgs[1] }))
  }

  // `url` is accepted as a sub-alias for connection-string (matching spindb's
  // own url|connection-string naming).
  if (sub === 'connection-string' || sub === 'url') {
    render(<App command="connection-string" args={cloudArgs} flags={flags} />)
    return
  }

  process.stderr.write(`Unknown cloud command: ${sub}\n`)
  printCloudHelp()
  process.exit(1)
}

// Everything below is a pre-meow raw-argv interception. It is the single
// dispatch point for the whole CLI. We read process.argv verbatim (never
// through meow, which strips/reorders flags and would corrupt forwarded spindb
// commands) and forward everything from the command token onward, flags and
// order preserved. meow is constructed AFTER these interceptions, so it only
// ever parses a genuinely layerbase-owned command.
const rawArgs = process.argv.slice(2)
const firstArgIndex = rawArgs.findIndex((arg) => !arg.startsWith('-'))
const leadingCommand = firstArgIndex >= 0 ? rawArgs[firstArgIndex] : ''

// First-token help/version flags (no command before them) render layerbase's
// own unified help / version. After a spindb-bound token they forward verbatim
// via the fallthrough below (so "lbase create --help" reaches spindb's help).
if (!leadingCommand && rawArgs.length > 0) {
  const flag = rawArgs[0]
  if (flag === '--help' || flag === '-h') {
    printHelp()
    process.exit(0)
  }
  if (flag === '--version' || flag === '-v') {
    process.stdout.write(`${VERSION}\n`)
    process.exit(0)
  }
}

// Bare invocation with no args: on a TTY hand off to spindb's interactive menu
// (the zero-arg case of the fallthrough); in a non-TTY context (pipes, CI)
// print the unified help and exit 0 instead of hanging on a prompt.
if (rawArgs.length === 0) {
  if (process.stdin.isTTY) {
    process.exit(await runSpindb([]))
  }
  printHelp()
  process.exit(0)
}

// Explicit "spindb" prefix: strip the token, forward the rest to spindb. Kept
// as an explicit escape hatch even though bare fallthrough covers most cases.
if (leadingCommand === 'spindb') {
  process.exit(await runSpindb(rawArgs.slice(firstArgIndex + 1)))
}

// Local-first fallthrough: any first token that is NOT a registered layerbase
// verb forwards verbatim to the local spindb CLI, INCLUDING the token itself,
// flags and order preserved. This is what makes "lbase create / list / backup /
// branch / connect / clone / ls / url ..." behave exactly like the same spindb
// command. The registered verbs are the ONLY bare words layerbase owns; the
// bare namespace otherwise belongs entirely to spindb.
const REGISTERED_COMMANDS = new Set(registeredCommandNames())

if (leadingCommand && !REGISTERED_COMMANDS.has(leadingCommand)) {
  process.exit(await runSpindb(rawArgs.slice(firstArgIndex)))
}

const cli = meow(UNIFIED_HELP, {
  importMeta: import.meta,
  autoHelp: false,
  autoVersion: false,
  version: VERSION,
  flags: {
    print: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    apiUrl: { type: 'string' },
    // Headless auth: an sk_ key overrides the browser JWT and routes cloud
    // calls straight to the cloud /v1 API.
    apiKey: { type: 'string' },
    // Cloud-mutation flags.
    engine: { type: 'string' },
    ttl: { type: 'string' },
    yes: { type: 'boolean', default: false, shortFlag: 'y' },
    force: { type: 'boolean', default: false },
    global: { type: 'boolean', default: false },
    // migrate / import / promote flags.
    source: { type: 'string' },
    target: { type: 'string' },
    // promote-only flags.
    from: { type: 'string' },
    name: { type: 'string' },
    writeEnv: { type: 'boolean', default: false },
    sourceDb: { type: 'string' },
    connectionString: { type: 'string' },
    sourceKey: { type: 'string' },
    sourceId: { type: 'string' },
    sourceSecret: { type: 'string' },
    // Friendly per-source credential aliases (resolved in migrate.ts).
    appId: { type: 'string' },
    email: { type: 'string' },
    tokenId: { type: 'string' },
    accountId: { type: 'string' },
    token: { type: 'string' },
    url: { type: 'string' },
    dbPassword: { type: 'string' },
  },
})

// The --api-key flag wins over LAYERBASE_API_KEY and the stored key, and
// --api-url over the stored host. Set once before any cloud command runs.
configureCloudAuth({ apiKey: cli.flags.apiKey, apiUrl: cli.flags.apiUrl })

const EXEC_COMMANDS = new Set(['psql', 'redis-cli', 'mysql'])

const [command = '', ...rest] = cli.input

if (command === 'help') {
  printHelp()
  process.exit(0)
} else if (command === 'whoami') {
  process.exit(await runWhoami({ json: cli.flags.json ?? false }))
} else if (command === 'login' && cli.flags.apiKey) {
  // Headless key login (no browser). Interactive browser login still runs via
  // the Ink <Login> below when no --api-key is passed.
  process.exit(
    await runKeyLogin({
      apiKey: cli.flags.apiKey,
      json: cli.flags.json ?? false,
    }),
  )
} else if (command === 'agent') {
  const [sub] = rest
  if (sub === 'init') {
    process.exit(await runAgentInit({ flags: cli.flags }))
  }
  process.stderr.write('Usage: layerbase agent init [--global] [--force]\n')
  process.exit(1)
} else if (command === 'chat') {
  // chat is the ONLY entry into the Ink interactive console (the bare no-arg
  // launch moved to spindb). It needs a real terminal for the prompt.
  if (!process.stdin.isTTY) {
    process.stderr.write('layerbase chat needs an interactive terminal.\n')
    process.exit(1)
  }
  await runInteractive(cli.flags)
} else if (command === 'migrate') {
  if (wantsHelp(rest)) {
    process.stdout.write(`${MIGRATE_HELP}\n`)
    process.exit(0)
  }
  process.exit(await runMigrate({ flags: cli.flags }))
} else if (command === 'import') {
  if (wantsHelp(rest)) {
    process.stdout.write(`${IMPORT_HELP}\n`)
    process.exit(0)
  }
  process.exit(await runImport({ args: rest, flags: cli.flags }))
} else if (command === 'promote') {
  if (wantsHelp(rest)) {
    process.stdout.write(`${PROMOTE_HELP}\n`)
    process.exit(0)
  }
  process.exit(await runPromote({ args: rest, flags: cli.flags }))
} else if (command === 'cloud') {
  await runCloud(rest, cli.flags)
} else if (EXEC_COMMANDS.has(command)) {
  await runExec({ command, args: rest, flags: cli.flags })
} else {
  // login, logout, whoami, alias.
  render(<App command={command} args={rest} flags={cli.flags} />)
}
