import { render, Box, Text } from 'ink'
import { Prompt } from '@/ui/prompt'
import { Menu } from '@/ui/menu'
import type { MenuItem } from '@/ui/menu'
import { Connecting } from '@/ui/connecting'
import { runView } from '@/ui/run-view'
import { loadCredentials } from '@/lib/config'
import type { StoredCredentials } from '@/lib/config'
import { decodeTokenClaims } from '@/lib/token'
import { resolveInput, availableCommands } from '@/lib/commands'
import { listDatabases } from '@/lib/cloud-api'
import type { CloudDatabase } from '@/lib/cloud-api'
import { runSpindb } from '@/lib/run-spindb'
import { connectToDatabase } from '@/commands/connect'
import { runClone } from '@/commands/clone'
import { App } from '@/ui/app'
import type { CommandFlags } from '@/ui/app'

const ACCENT_ANSI = '\x1b[38;2;124;156;255m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const BACK = '__back__'

function accountText(creds: StoredCredentials | null): string {
  if (!creds) return 'Not signed in'
  const email = decodeTokenClaims(creds.token)?.email
  return email ? `Signed in as ${email}` : 'Signed in'
}

function printBanner(creds: StoredCredentials | null): void {
  process.stdout.write(
    `\n${ACCENT_ANSI}◆ Layerbase${RESET} ${DIM}cloud + local databases${RESET}\n` +
      `${DIM}${accountText(creds)} · type /help to see commands${RESET}\n\n`,
  )
}

function printCommands(loggedIn: boolean): void {
  const lines = availableCommands(loggedIn).map(
    (c) => `  ${DIM}/${RESET}${c.name.padEnd(11)}${DIM}${c.summary}${RESET}`,
  )
  process.stdout.write(`Commands:\n${lines.join('\n')}\n\n`)
}

async function promptOnce(creds: StoredCredentials | null): Promise<string> {
  // Surface aliases (e.g. /menu for spindb) as their own palette entries so
  // they are discoverable while typing.
  const commands = availableCommands(Boolean(creds)).flatMap((c) => [
    { name: c.name, summary: c.summary },
    ...(c.aliases ?? []).map((alias) => ({ name: alias, summary: c.summary })),
  ])
  // Ctrl+C at the prompt cancels (null), which we treat as /quit.
  const raw = await runView<string>((resolve) => (
    <Prompt commands={commands} onSubmit={resolve} />
  ))
  return raw ?? '/quit'
}

async function pickDatabase(
  databases: CloudDatabase[],
): Promise<string | null> {
  const items: MenuItem[] = databases.map((db) => ({
    label: db.name,
    value: db.id,
    hint: `${db.engine} · ${db.status}`,
  }))
  items.push({ label: 'Back', value: BACK })
  const chosen = await runView<string>((resolve) => (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Pick a database to connect to</Text>
      <Box marginTop={1}>
        <Menu items={items} onSelect={resolve} />
      </Box>
    </Box>
  ))
  // Ctrl+C (null) or Back both mean "cancel".
  return chosen === null || chosen === BACK ? null : chosen
}

// List the user's databases and let them pick one (used when /connect or /clone
// is run without a db argument). Returns null on error / empty / cancel.
async function selectDatabase(): Promise<string | null> {
  const spinner = render(<Connecting label="Loading your databases..." />)
  let databases: CloudDatabase[]
  try {
    databases = await listDatabases()
  } catch (error) {
    spinner.unmount()
    process.stderr.write(`${(error as Error).message}\n`)
    return null
  }
  spinner.unmount()
  if (databases.length === 0) {
    process.stdout.write(
      'No databases yet. Create one at https://layerbase.com.\n',
    )
    return null
  }
  return pickDatabase(databases)
}

async function runConnectFlow(dbRef: string | undefined): Promise<void> {
  const target = dbRef ?? (await selectDatabase())
  if (target) await connectToDatabase({ dbRef: target, command: 'connect' })
}

async function runCloneFlow(
  dbRef: string | undefined,
  localName: string | undefined,
): Promise<void> {
  const target = dbRef ?? (await selectDatabase())
  if (target) await runClone({ dbRef: target, localName })
}

async function dispatch(
  name: string,
  args: string[],
  creds: StoredCredentials | null,
  flags: CommandFlags,
): Promise<'quit' | 'continue'> {
  switch (name) {
    case 'quit':
      return 'quit'
    case 'help':
      printCommands(Boolean(creds))
      return 'continue'
    case 'spindb':
      await runSpindb(args)
      return 'continue'
    case 'connect':
      await runConnectFlow(args[0])
      return 'continue'
    case 'clone':
      await runCloneFlow(args[0], args[1])
      return 'continue'
    default: {
      const instance = render(<App command={name} args={args} flags={flags} />)
      await instance.waitUntilExit()
      process.stdout.write('\n')
      return 'continue'
    }
  }
}

// The interactive harness: a Claude-Code-style prompt loop. Type /commands (or
// browse the palette); /spindb (alias /menu) hands off to local spindb. Bare
// text is the future AI-chat path (stubbed for now). The command set lives in
// @/lib/commands.
export async function runInteractive(flags: CommandFlags): Promise<void> {
  printBanner(await loadCredentials())

  for (;;) {
    const creds = await loadCredentials()
    const raw = await promptOnce(creds)
    const res = resolveInput(raw, { loggedIn: Boolean(creds) })

    if (res.type === 'empty') continue
    if (res.type === 'unknown') {
      process.stdout.write(
        `Unknown command: /${res.token}. Type /help to see the commands.\n\n`,
      )
      continue
    }
    if (res.type === 'ai') {
      process.stdout.write(
        'We do not yet support AI chat, please check back soon.\n\n',
      )
      printCommands(Boolean(creds))
      continue
    }

    const result = await dispatch(res.name, res.args, creds, flags)
    if (result === 'quit') {
      process.stdout.write('Bye.\n')
      return
    }
  }
}
