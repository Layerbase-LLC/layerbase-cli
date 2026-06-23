// The command registry: the single source of truth for the interactive harness.
// Adding a command here makes it show up in the prompt palette, the /menu, and
// /help automatically. This is the seam future AI chat plugs into (a default
// handler for non-command input).

// When true (the pre-AI state), a bare single word that matches a command runs
// it, so `login` behaves like `/login`. Once AI chat is wired in, flip this to
// false so bare text is sent to the model instead of being treated as a command.
// Deliberately an in-code constant, not an env var: it encodes a code-evolution
// stage, not a runtime/operator decision.
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
}

export const COMMANDS: CommandSpec[] = [
  { name: 'login', summary: 'Sign in via your browser', hideWhenAuthed: true },
  {
    name: 'logout',
    summary: 'Sign out and remove the stored token',
    requiresAuth: true,
  },
  { name: 'whoami', summary: 'Show the signed-in account', requiresAuth: true },
  { name: 'ls', summary: 'List your cloud databases', requiresAuth: true },
  {
    name: 'connect',
    summary: 'Connect to a cloud database',
    requiresAuth: true,
  },
  {
    name: 'spindb',
    summary: 'Open the local spindb manager (also /menu)',
    aliases: ['menu'],
  },
  { name: 'help', summary: 'List the available commands' },
  { name: 'quit', summary: 'Exit', aliases: ['exit'] },
]

export function findCommand(token: string): CommandSpec | undefined {
  const t = token.toLowerCase()
  return COMMANDS.find((c) => c.name === t || c.aliases?.includes(t))
}

export function availableCommands(loggedIn: boolean): CommandSpec[] {
  return COMMANDS.filter((c) => {
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
// commands; bare input resolves to a command only when it is a single word that
// matches AND ALLOW_FORWARD_SLASH_OMISSION is on; everything else is 'ai' (the
// future AI-chat path, stubbed for now).
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
    const only = words[0]
    if (words.length === 1 && only) {
      const cmd = findCommand(only)
      if (cmd) return { type: 'command', name: cmd.name, args: [] }
    }
  }

  return { type: 'ai', input }
}
