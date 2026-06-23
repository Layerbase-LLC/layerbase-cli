import { render, Box, Text } from 'ink'
import { Menu } from '../ui/menu'
import type { MenuItem } from '../ui/menu'
import { Header } from '../ui/brand'
import { Connecting } from '../ui/connecting'
import { PressEnter } from '../ui/press-enter'
import { loadCredentials } from '../lib/config'
import type { StoredCredentials } from '../lib/config'
import { decodeTokenClaims } from '../lib/token'
import { listDatabases } from '../lib/cloud-api'
import type { CloudDatabase } from '../lib/cloud-api'
import { runSpindb } from '../lib/run-spindb'
import { connectToDatabase } from './connect'
import { lbStatus } from '../lib/alias'
import { App } from '../ui/app'
import type { CommandFlags } from '../ui/app'

const BACK = '__back__'

function clearScreen(): void {
  // Clear the visible screen and home the cursor (scrollback is preserved).
  process.stdout.write('[2J[H')
}

function accountLine(creds: StoredCredentials | null): {
  text: string
  loggedIn: boolean
} {
  if (!creds) return { text: 'Not signed in', loggedIn: false }
  const email = decodeTokenClaims(creds.token)?.email
  return { text: email ? `Signed in as ${email}` : 'Signed in', loggedIn: true }
}

function buildItems(loggedIn: boolean, lbAvailable: boolean): MenuItem[] {
  const items: MenuItem[] = []
  if (loggedIn) {
    items.push({ label: 'List cloud databases', value: 'ls' })
    items.push({ label: 'Connect to a database', value: 'connect' })
  } else {
    items.push({ label: 'Log in', value: 'login', hint: 'browser sign-in' })
  }
  items.push({ label: 'Run spindb', value: 'spindb', hint: 'local databases' })
  if (loggedIn) items.push({ label: 'Log out', value: 'logout' })
  if (lbAvailable) {
    items.push({ label: 'Enable the lb shortcut', value: 'alias' })
  }
  items.push({ label: 'Quit', value: 'quit' })
  return items
}

function pick(creds: StoredCredentials | null): Promise<string> {
  const loggedIn = Boolean(creds)
  const lbAvailable = lbStatus().state === 'available'
  const items = buildItems(loggedIn, lbAvailable)
  const account = accountLine(creds)

  return new Promise<string>((resolve) => {
    const app = render(
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Header subtitle="cloud + local databases" />
        <Box marginBottom={1}>
          <Text
            color={account.loggedIn ? 'green' : undefined}
            dimColor={!account.loggedIn}
          >
            {account.text}
          </Text>
        </Box>
        <Menu
          items={items}
          onSelect={(value) => {
            app.unmount()
            resolve(value)
          }}
        />
      </Box>,
    )
  })
}

function pickDatabase(databases: CloudDatabase[]): Promise<string | null> {
  const items: MenuItem[] = databases.map((db) => ({
    label: db.name,
    value: db.id,
    hint: `${db.engine} · ${db.status}`,
  }))
  items.push({ label: 'Back', value: BACK })

  return new Promise<string | null>((resolve) => {
    const app = render(
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold>Pick a database to connect to</Text>
        <Box marginTop={1}>
          <Menu
            items={items}
            onSelect={(value) => {
              app.unmount()
              resolve(value === BACK ? null : value)
            }}
          />
        </Box>
      </Box>,
    )
  })
}

// Menu action: list the user's databases, let them pick one, and connect with
// the right client. Returns to the hub when the client exits (or on Back/error).
async function runConnectFlow(): Promise<void> {
  const spinner = render(<Connecting label="Loading your databases..." />)
  let databases: CloudDatabase[]
  try {
    databases = await listDatabases()
  } catch (error) {
    spinner.unmount()
    process.stderr.write(`${(error as Error).message}\n`)
    return
  }
  spinner.unmount()

  if (databases.length === 0) {
    process.stdout.write(
      'No databases yet. Create one at https://layerbase.com.\n',
    )
    return
  }

  const dbRef = await pickDatabase(databases)
  if (!dbRef) return

  await connectToDatabase({ dbRef, command: 'connect' })
}

async function waitForEnter(): Promise<void> {
  const instance = render(<PressEnter />)
  await instance.waitUntilExit()
}

// The no-command experience: a small hub. Each action runs on a clean screen,
// then waits for Enter and returns to the menu, so you can sign in, then list,
// then connect, ... Cloud actions depend on auth; spindb is always offered.
export async function runInteractive(flags: CommandFlags): Promise<void> {
  for (;;) {
    clearScreen()
    const creds = await loadCredentials()
    const choice = await pick(creds)

    if (choice === 'quit') {
      clearScreen()
      process.exitCode = 0
      return
    }

    clearScreen()
    if (choice === 'spindb') {
      await runSpindb([])
    } else if (choice === 'connect') {
      await runConnectFlow()
    } else {
      // login / logout / ls / alias run through the same Ink dispatcher as
      // typed commands; wait for the action to finish.
      const instance = render(<App command={choice} args={[]} flags={flags} />)
      await instance.waitUntilExit()
    }

    await waitForEnter()
  }
}
