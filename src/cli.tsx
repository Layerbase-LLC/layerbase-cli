import meow from 'meow'
import { render } from 'ink'
import { App } from '@/ui/app'
import { runExec } from '@/commands/connect'
import { runInteractive } from '@/commands/interactive'
import { runClone } from '@/commands/clone'
import { runSpindb, runLocalLifecycle } from '@/lib/run-spindb'

// Intercept the spindb passthrough and the local start/stop shortcuts BEFORE
// meow parses argv. meow keeps only positional tokens in `cli.input` and pulls
// every flag out into `cli.flags`, so a naive `runSpindb(cli.input)` drops the
// flags spindb needs (`--json`, `--engine`, `--force`, ...). We read
// process.argv verbatim instead and forward everything after the command token,
// flags and order preserved. Doing this before meow is constructed also keeps
// meow's autoHelp/autoVersion from hijacking `layerbase spindb --help` /
// `layerbase spindb --version` (which must reach spindb's own CLI).
const rawArgs = process.argv.slice(2)
const firstArgIndex = rawArgs.findIndex((arg) => !arg.startsWith('-'))
const leadingCommand = firstArgIndex >= 0 ? rawArgs[firstArgIndex] : ''

if (leadingCommand === 'spindb') {
  process.exit(await runSpindb(rawArgs.slice(firstArgIndex + 1)))
}

if (leadingCommand === 'start' || leadingCommand === 'stop') {
  process.exit(
    await runLocalLifecycle(leadingCommand, rawArgs.slice(firstArgIndex + 1)),
  )
}

const cli = meow(
  `
  Usage
    $ layerbase <command> [options]

  Commands
    login                     Sign in via your browser; saves a token to ~/.layerbase-cli
    logout                    Remove the stored credentials
    whoami                    Show the signed-in account (--json to script it)
    ls                        List your cloud databases
    connect <db>              Connect with the right client for the engine
    clone <db> [name]         Clone a cloud database into a local spindb container
    psql <db>                 Connect to a Postgres-family database
    redis-cli <db>            Connect to a Redis/Valkey database
    mysql <db>                Connect to a MySQL/MariaDB database
    connection-string <db>    Print the connection string (reveals the password)
    start <name>              Start a local database container (spindb-backed)
    stop <name>               Stop a local database container (spindb-backed)
    spindb [args...]          Run the local spindb CLI (forwards ALL args, flags included)
    alias                     Set up the short lb command (only if it is free)

  Run with no command for the interactive prompt (type /commands). Also lbase.

  Options
    --print                   With connect: show connection info, do not exec
    --json                    With ls: print JSON instead of a table
    --api-url <url>           Cloud API base (env: LAYERBASE_API_URL)

  Examples
    $ layerbase                # interactive menu
    $ layerbase login
    $ layerbase ls
    $ layerbase psql my-db
    $ layerbase start my-local-db
    $ layerbase spindb list --json
`,
  {
    importMeta: import.meta,
    flags: {
      print: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      apiUrl: { type: 'string' },
    },
  },
)

const EXEC_COMMANDS = new Set(['connect', 'psql', 'redis-cli', 'mysql'])

const [command = '', ...rest] = cli.input

if (command === 'help') {
  cli.showHelp(0)
} else if (!command) {
  // No command: interactive menu on a TTY, help otherwise (pipes, CI).
  if (process.stdin.isTTY) {
    await runInteractive(cli.flags)
  } else {
    cli.showHelp(0)
  }
} else if (command === 'clone') {
  const dbRef = rest[0]
  if (!dbRef) {
    process.stderr.write('Usage: layerbase clone <db> [local-name]\n')
    process.exit(1)
  }
  process.exit(await runClone({ dbRef, localName: rest[1] }))
} else if (EXEC_COMMANDS.has(command)) {
  await runExec({ command, args: rest, flags: cli.flags })
} else {
  render(<App command={command} args={rest} flags={cli.flags} />)
}
