// The command registry: the single source of truth for BOTH top-level CLI
// routing and the interactive (chat) harness.
//
//   - registeredCommandNames() -> the bare tokens layerbase OWNS. cli.tsx reads
//     it to gate the spindb fallthrough: any first token NOT in this set is
//     forwarded verbatim to the local spindb CLI. The bare namespace otherwise
//     belongs entirely to spindb (local-first).
//   - availableCommands()/findCommand() -> the interactive palette inside the
//     `chat` console. There, ls/connect/clone keep their CLOUD meaning (chat is
//     the cloud account console).

// When true (the pre-AI state), bare input whose FIRST word matches a command
// runs it (with the rest as args), so `login` behaves like `/login` inside the
// chat console. Once AI chat is wired in, flip this to false so bare text is
// sent to the model instead. Deliberately an in-code constant, not an env var:
// it encodes a code-evolution stage, not a runtime/operator decision.
export const ALLOW_FORWARD_SLASH_OMISSION = true

export type CommandSpec = {
  name: string
  summary: string
  aliases?: string[]
  // Hidden from the palette/menu/help when the user is logged out (the command
  // still resolves if typed; it just reports "not logged in").
  requiresAuth?: boolean
  // Hidden when the user IS logged in (e.g. login).
  hideWhenAuthed?: boolean
  // A top-level CLI command with no interactive-harness surface (psql, cloud,
  // ...). It IS a registered layerbase verb for argv routing (so it is NOT
  // forwarded to spindb) but is not offered in the interactive palette and is
  // not matched by findCommand.
  cliOnly?: boolean
  // An interactive-harness-only concept (ls/connect/clone/quit) with no
  // top-level CLI handler, so it is excluded from registeredCommandNames used
  // for spindb fallthrough routing. At the top level these tokens fall through
  // to spindb; inside the chat console they resolve to the cloud command.
  interactiveOnly?: boolean
}

// MAINTAINER NOTE: this registry is the SINGLE SOURCE OF TRUTH for which bare
// top-level tokens layerbase owns. Everything else forwards to spindb. The bare
// namespace belongs to spindb: NEW cloud functionality goes under the `cloud`
// namespace (`lbase cloud <verb>`), NOT a new bare verb. If you truly must add
// a bare verb, first prove it is collision-free against `spindb --help`
// INCLUDING aliases (scripts/check-spindb-collisions.ts enforces this in the
// check chain). `help` intentionally overlaps spindb's `help`: layerbase owns
// the top-level help token and renders its own unified help; spindb's help
// stays reachable via `lbase spindb help` or `lbase <cmd> --help`.
export const COMMANDS: CommandSpec[] = [
  { name: 'login', summary: 'Sign in via your browser', hideWhenAuthed: true },
  {
    name: 'logout',
    summary: 'Sign out and remove the stored token',
    requiresAuth: true,
  },
  { name: 'whoami', summary: 'Show the signed-in account', requiresAuth: true },
  {
    name: 'psql',
    summary: 'Connect to a cloud Postgres-family database',
    cliOnly: true,
  },
  {
    name: 'redis-cli',
    summary: 'Connect to a cloud Redis/Valkey database',
    cliOnly: true,
  },
  {
    name: 'mysql',
    summary: 'Connect to a cloud MySQL/MariaDB database',
    cliOnly: true,
  },
  { name: 'alias', summary: 'Set up the short lb command', cliOnly: true },
  {
    name: 'chat',
    summary: 'Interactive console for your Layerbase account',
    cliOnly: true,
  },
  {
    name: 'cloud',
    summary: 'Cloud database commands (ls, connect, clone, connection-string)',
    cliOnly: true,
  },
  {
    name: 'spindb',
    summary: 'Open the local spindb manager (forwards all args)',
    aliases: ['menu'],
  },
  { name: 'help', summary: 'Show the unified help' },
  {
    name: 'ls',
    summary: 'List your cloud databases',
    requiresAuth: true,
    interactiveOnly: true,
  },
  {
    name: 'connect',
    summary: 'Connect to a cloud database',
    requiresAuth: true,
    interactiveOnly: true,
  },
  {
    name: 'clone',
    summary: 'Clone a cloud database into a local spindb container',
    requiresAuth: true,
    interactiveOnly: true,
  },
  { name: 'quit', summary: 'Exit', aliases: ['exit'], interactiveOnly: true },
]

// The registered bare token names cli.tsx uses to gate the spindb fallthrough.
// Excludes interactiveOnly concepts (ls/connect/clone/quit), which fall through
// to spindb at the top level; includes cliOnly commands (psql, cloud, ...).
export function registeredCommandNames(): string[] {
  return COMMANDS.filter((c) => !c.interactiveOnly).map((c) => c.name)
}

export function findCommand(token: string): CommandSpec | undefined {
  const t = token.toLowerCase()
  return COMMANDS.find(
    (c) => !c.cliOnly && (c.name === t || c.aliases?.includes(t)),
  )
}

export function availableCommands(loggedIn: boolean): CommandSpec[] {
  return COMMANDS.filter((c) => {
    if (c.cliOnly) return false
    if (c.requiresAuth && !loggedIn) return false
    if (c.hideWhenAuthed && loggedIn) return false
    return true
  })
}

export type Resolution =
  | { type: 'command'; name: string; args: string[] }
  | { type: 'unknown'; token: string }
  | { type: 'ai'; input: string }
  | { type: 'empty' }

// Parse a line of prompt input into an action. Slash commands always resolve as
// commands; bare input resolves to a command when its first word matches AND
// ALLOW_FORWARD_SLASH_OMISSION is on; everything else is 'ai' (the future
// AI-chat path, stubbed for now).
export function resolveInput(
  raw: string,
  options: { loggedIn: boolean },
): Resolution {
  void options
  const input = raw.trim()
  if (!input) return { type: 'empty' }

  if (input.startsWith('/')) {
    const parts = input.slice(1).trim().split(/\s+/)
    const token = parts[0]
    if (!token) return { type: 'empty' }
    const cmd = findCommand(token)
    return cmd
      ? { type: 'command', name: cmd.name, args: parts.slice(1) }
      : { type: 'unknown', token }
  }

  if (ALLOW_FORWARD_SLASH_OMISSION) {
    const words = input.split(/\s+/)
    const first = words[0]
    if (first) {
      const cmd = findCommand(first)
      if (cmd) return { type: 'command', name: cmd.name, args: words.slice(1) }
    }
  }

  return { type: 'ai', input }
}
