import meow from 'meow'
import { render } from 'ink'
import { App } from './ui/app'
import { runExec } from './commands/connect'

const cli = meow(
  `
  Usage
    $ layerbase <command> [options]

  Commands
    login                     Store a Layerbase API key (saved 0600, never echoed)
    logout                    Remove the stored API key
    ls                        List your cloud databases
    connect <db>              Connect with the right client for the engine
    psql <db>                 Connect to a Postgres-family database
    redis-cli <db>            Connect to a Redis/Valkey database
    mysql <db>                Connect to a MySQL/MariaDB database
    connection-string <db>    Print the connection string (reveals the password)

  Options
    --print                   With connect: show connection info, do not exec
    --json                    With ls: print JSON instead of a table
    --api-url <url>           Cloud API base (env: LAYERBASE_API_URL)
    --api-key <key>           Non-interactive login (env: LAYERBASE_API_KEY)

  Examples
    $ layerbase login
    $ layerbase ls
    $ layerbase psql my-db
    $ layerbase connect my-db --print
`,
  {
    importMeta: import.meta,
    flags: {
      print: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      apiUrl: { type: 'string' },
      apiKey: { type: 'string' },
    },
  },
)

const EXEC_COMMANDS = new Set(['connect', 'psql', 'redis-cli', 'mysql'])

const [command = '', ...rest] = cli.input

if (!command || command === 'help') {
  cli.showHelp(0)
} else if (EXEC_COMMANDS.has(command)) {
  await runExec({ command, args: rest, flags: cli.flags })
} else {
  render(<App command={command} args={rest} flags={cli.flags} />)
}
