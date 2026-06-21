import { render, Box, Text } from 'ink'
import { Menu } from '../ui/menu'
import type { MenuItem } from '../ui/menu'
import { Header } from '../ui/brand'
import { loadCredentials } from '../lib/config'
import type { StoredCredentials } from '../lib/config'
import { decodeTokenClaims } from '../lib/token'
import { runSpindb } from '../lib/run-spindb'
import { lbStatus } from '../lib/alias'
import { App } from '../ui/app'
import type { CommandFlags } from '../ui/app'

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

// The no-command experience: a small hub. Each action runs to completion, then
// the menu returns so you can do the next thing (sign in, then list, then
// connect, ...). Quit leaves. Cloud actions depend on auth; spindb is always
// offered (local, no login).
export async function runInteractive(flags: CommandFlags): Promise<void> {
  for (;;) {
    const creds = await loadCredentials()
    const choice = await pick(creds)

    if (choice === 'quit') {
      process.exitCode = 0
      return
    }

    if (choice === 'spindb') {
      await runSpindb([])
      continue
    }

    // login / logout / ls / alias run through the same Ink dispatcher as typed
    // commands; wait for the action to finish before re-showing the menu.
    const instance = render(<App command={choice} args={[]} flags={flags} />)
    await instance.waitUntilExit()
    process.stdout.write('\n')
  }
}
