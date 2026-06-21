import { useEffect, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import Spinner from 'ink-spinner'
import { MaskedInput } from '../ui/masked-input'
import { DEFAULT_API_URL, verifyApiKey } from '../lib/cloud-api'
import { saveCredentials } from '../lib/config'
import type { CommandFlags } from '../ui/app'

type Phase =
  | { kind: 'prompt' }
  | { kind: 'verifying' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

export function Login({ flags }: { flags: CommandFlags }) {
  const { exit } = useApp()
  const apiUrl = flags.apiUrl ?? DEFAULT_API_URL
  const presetKey = flags.apiKey ?? process.env.LAYERBASE_API_KEY

  const [phase, setPhase] = useState<Phase>(
    presetKey ? { kind: 'verifying' } : { kind: 'prompt' },
  )

  async function submit(apiKey: string) {
    if (!apiKey.trim()) {
      setPhase({ kind: 'error', message: 'No API key entered.' })
      process.exitCode = 1
      return
    }
    setPhase({ kind: 'verifying' })
    const ok = await verifyApiKey({ apiUrl, apiKey })
    if (!ok) {
      setPhase({
        kind: 'error',
        message: `API key rejected by ${apiUrl}. Generate one in the dashboard, then retry.`,
      })
      process.exitCode = 1
      return
    }
    await saveCredentials({ apiUrl, apiKey })
    setPhase({ kind: 'done', message: `Logged in to ${apiUrl}.` })
  }

  useEffect(() => {
    // Runs once for the non-interactive path; interactive path waits on input.
    if (presetKey) {
      submit(presetKey)
    }
  }, [])

  // Exit only after the terminal frame has committed.
  useEffect(() => {
    if (phase.kind === 'done' || phase.kind === 'error') {
      exit()
    }
  }, [phase, exit])

  if (phase.kind === 'prompt') {
    return (
      <MaskedInput label="Paste your Layerbase API key:" onSubmit={submit} />
    )
  }
  if (phase.kind === 'verifying') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Verifying with {apiUrl}...</Text>
      </Box>
    )
  }
  if (phase.kind === 'done') {
    return <Text color="green">{phase.message}</Text>
  }
  return <Text color="red">{phase.message}</Text>
}
