import meow from 'meow'
import { render } from 'ink'
import { App } from './ui/app'
import { runExec } from './commands/connect'
import { runInteractive } from './commands/interactive'
import { runSpindb } from './lib/run-spindb'

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
    psql <db>                 Connect to a Postgres-family database
    redis-cli <db>            Connect to a Redis/Valkey database
    mysql <db>                Connect to a MySQL/MariaDB database
    connection-string <db>    Print the connection string (reveals the password)
    spindb [args...]          Run the local spindb CLI (passes args through)

  Run with no command for an interactive menu. Also installed as lbase.

  Options
    --print                   With connect: show connection info, do not exec
    --json                    With ls: print JSON instead of a table
    --api-url <url>           Cloud API base (env: LAYERBASE_API_URL)

  Examples
    $ layerbase                # interactive menu
    $ layerbase login
    $ layerbase ls
    $ layerbase psql my-db
    $ layerbase spindb create postgres
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
} else if (command === 'spindb') {
  process.exit(await runSpindb(rest))
} else if (EXEC_COMMANDS.has(command)) {
  await runExec({ command, args: rest, flags: cli.flags })
} else {
  render(<App command={command} args={rest} flags={cli.flags} />)
}
