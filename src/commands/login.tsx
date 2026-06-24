import { useEffect, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import Spinner from 'ink-spinner'
import { runBrowserLogin } from '@/lib/browser-login'
import { DEFAULT_API_URL, whoami } from '@/lib/cloud-api'
import { saveCredentials } from '@/lib/config'
import type { CommandFlags } from '@/ui/app'

type Phase =
  | { kind: 'starting' }
  | { kind: 'waiting'; authUrl: string }
  | { kind: 'finishing' }
  | { kind: 'done'; email: string }
  | { kind: 'error'; message: string }

export function Login({ flags }: { flags: CommandFlags }) {
  const { exit } = useApp()
  const apiUrl = flags.apiUrl ?? DEFAULT_API_URL
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })

  useEffect(() => {
    async function runLogin() {
      try {
        const { token } = await runBrowserLogin({
          apiUrl,
          onPhase: setPhase,
        })
        setPhase({ kind: 'finishing' })
        // Save the token first so whoami() can read it, then enrich with the
        // cloud API key (best-effort, mirrors how desktop backfills it).
        await saveCredentials({ apiUrl, token })
        let email = ''
        try {
          const me = await whoami()
          email = me.user.email
          await saveCredentials({ apiUrl, token, cloudApiKey: me.cloudApiKey })
        } catch {
          // Token is already saved; enrichment is non-fatal.
        }
        setPhase({ kind: 'done', email })
      } catch (error) {
        process.exitCode = 1
        setPhase({ kind: 'error', message: (error as Error).message })
      }
    }
    runLogin()
  }, [apiUrl])

  // Exit only after the terminal frame has committed.
  useEffect(() => {
    if (phase.kind === 'done' || phase.kind === 'error') {
      exit()
    }
  }, [phase, exit])

  if (phase.kind === 'starting') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Starting sign-in...</Text>
      </Box>
    )
  }

  if (phase.kind === 'waiting') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Waiting for you to finish signing in in your browser...</Text>
        </Box>
        <Text dimColor>If your browser did not open, visit:</Text>
        <Text color="blue">{phase.authUrl}</Text>
      </Box>
    )
  }

  if (phase.kind === 'finishing') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Saving credentials...</Text>
      </Box>
    )
  }

  if (phase.kind === 'done') {
    return (
      <Text color="green">
        Authenticated{phase.email ? ` as ${phase.email}` : ''}. Type{' '}
        <Text bold>ls</Text> to list your cloud databases.
      </Text>
    )
  }

  return <Text color="red">{phase.message}</Text>
}
