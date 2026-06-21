import { useEffect, useState } from 'react'
import { Text, useApp } from 'ink'
import { loadCredentials } from '../lib/config'
import { decodeTokenClaims } from '../lib/token'

type State =
  | { kind: 'loading' }
  | { kind: 'out' }
  | { kind: 'in'; email: string; apiUrl: string; expiresAtMs: number | null }

// Offline: reads the stored token and decodes it. No network, so it works even
// before the cloud endpoints are deployed. It reports the cached identity, not
// a live session check (use any cloud command to confirm the token still works).
export function Whoami({ json }: { json: boolean }) {
  const { exit } = useApp()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    async function fetchAndSetWhoami() {
      const creds = await loadCredentials()
      if (!creds) {
        if (json) {
          process.stdout.write(`${JSON.stringify({ loggedIn: false })}\n`)
        }
        process.exitCode = 1
        setState({ kind: 'out' })
        return
      }
      const claims = decodeTokenClaims(creds.token)
      const email = claims?.email ?? 'unknown'
      const expiresAtMs = claims?.exp ? claims.exp * 1000 : null
      if (json) {
        process.stdout.write(
          `${JSON.stringify({ loggedIn: true, email, apiUrl: creds.apiUrl, expiresAt: expiresAtMs })}\n`,
        )
      }
      setState({ kind: 'in', email, apiUrl: creds.apiUrl, expiresAtMs })
    }
    fetchAndSetWhoami()
  }, [json])

  useEffect(() => {
    if (state.kind !== 'loading') {
      exit()
    }
  }, [state, exit])

  if (state.kind === 'loading' || json) {
    return null
  }

  if (state.kind === 'out') {
    return <Text color="yellow">Not logged in. Run `layerbase login`.</Text>
  }

  const expiry = state.expiresAtMs
    ? ` Token expires ${new Date(state.expiresAtMs).toISOString().slice(0, 10)}.`
    : ''
  return (
    <Text color="green">
      Signed in as {state.email} at {state.apiUrl}.{expiry}
    </Text>
  )
}
