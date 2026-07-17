import meow from 'meow'
import { render } from 'ink'
import { App } from '@/ui/app'
import { runExec } from '@/commands/connect'
import { runInteractive } from '@/commands/interactive'
import { runClone } from '@/commands/clone'
import { runSpindb } from '@/lib/run-spindb'
import { registeredCommandNames } from '@/lib/commands'
import { getVersion } from '@/lib/version'
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
    cloud connect <db>            Connect with the engine's native client
    cloud clone <db> [name]       Clone a cloud database into local spindb
    cloud connection-string <db>  Print the connection string (reveals password)
    psql / mysql / redis-cli <db> Connect to a cloud database by engine
    alias                         Set up the short "lb" command
    chat                          Interactive console for your Layerbase account

  Notes
    bare = spindb, cloud = "lbase cloud <verb>"
    "lbase --help" / "--version" show this help / the layerbase version.
    "lbase version" forwards to spindb's version command.

  Examples
    $ lbase                          # spindb's interactive menu
    $ lbase create my-db --engine sqlite
    $ lbase login
    $ lbase cloud ls
    $ lbase psql my-cloud-db
`

const CLOUD_HELP = `
  Cloud account commands

    login / logout / whoami        Manage your Layerbase session
    lbase cloud ls                 List your cloud databases (--json to script)
    lbase cloud connect <db>       Connect with the engine's native client
    lbase cloud clone <db> [name]  Clone a cloud database into local spindb
    lbase cloud connection-string <db> (alias: url)
                                   Print the connection string (reveals password)
    lbase psql / mysql / redis-cli <db>  Connect to a cloud database by engine

  "<db>" accepts a cloud database id or its name.
`

function printHelp(): void {
  process.stdout.write(`${UNIFIED_HELP}\n`)
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
  },
})

const EXEC_COMMANDS = new Set(['psql', 'redis-cli', 'mysql'])

const [command = '', ...rest] = cli.input

if (command === 'help') {
  printHelp()
  process.exit(0)
} else if (command === 'chat') {
  // chat is the ONLY entry into the Ink interactive console (the bare no-arg
  // launch moved to spindb). It needs a real terminal for the prompt.
  if (!process.stdin.isTTY) {
    process.stderr.write('layerbase chat needs an interactive terminal.\n')
    process.exit(1)
  }
  await runInteractive(cli.flags)
} else if (command === 'cloud') {
  await runCloud(rest, cli.flags)
} else if (EXEC_COMMANDS.has(command)) {
  await runExec({ command, args: rest, flags: cli.flags })
} else {
  // login, logout, whoami, alias.
  render(<App command={command} args={rest} flags={cli.flags} />)
}
