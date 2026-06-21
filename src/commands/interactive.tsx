import { render } from 'ink'
import { Menu } from '../ui/menu'
import type { MenuItem } from '../ui/menu'
import { loadCredentials } from '../lib/config'
import type { StoredCredentials } from '../lib/config'
import { decodeTokenClaims } from '../lib/token'
import { runSpindb } from '../lib/run-spindb'
import { App } from '../ui/app'
import type { CommandFlags } from '../ui/app'

// Decode the email claim from the stored JWT (no verification: it is only for a
// friendly menu header). Falls back to a generic label on any parse failure.
function accountLabel(creds: StoredCredentials | null): string {
  if (!creds) return 'Not signed in'
  const email = decodeTokenClaims(creds.token)?.email
  return email ? `Signed in as ${email}` : 'Signed in'
}

// The no-command experience: show a menu, then run the chosen command through
// the same paths a typed command would take. spindb is always offered (it is
// local and needs no login); the cloud actions depend on auth state.
export async function runInteractive(flags: CommandFlags): Promise<void> {
  const creds = await loadCredentials()
  const loggedIn = Boolean(creds)

  const items: MenuItem[] = loggedIn
    ? [
        { label: 'List cloud databases', value: 'ls' },
        { label: 'Run spindb (local databases)', value: 'spindb' },
        { label: 'Log out', value: 'logout' },
        { label: 'Quit', value: 'quit' },
      ]
    : [
        { label: 'Log in', value: 'login' },
        { label: 'Run spindb (local databases)', value: 'spindb' },
        { label: 'Quit', value: 'quit' },
      ]

  const choice = await new Promise<string>((resolve) => {
    const app = render(
      <Menu
        title={accountLabel(creds)}
        items={items}
        onSelect={(value) => {
          app.unmount()
          resolve(value)
        }}
      />,
    )
  })

  if (choice === 'quit') {
    return
  }

  if (choice === 'spindb') {
    process.exit(await runSpindb([]))
  }

  // login / logout / ls run through the same Ink dispatcher as typed commands.
  render(<App command={choice} args={[]} flags={flags} />)
}
