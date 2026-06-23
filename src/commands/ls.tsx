import { useEffect, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import Spinner from 'ink-spinner'
import { listDatabases } from '@/lib/cloud-api'
import type { CloudDatabase } from '@/lib/cloud-api'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; databases: CloudDatabase[] }
  | { kind: 'error'; message: string }

const STATUS_COLOR: Record<string, string> = {
  running: 'green',
  hibernated: 'yellow',
  stopped: 'gray',
  archived: 'gray',
  provisioning: 'cyan',
  error: 'red',
}

function pad(value: string, width: number): string {
  return value.length >= width
    ? value
    : value + ' '.repeat(width - value.length)
}

export function List({ json }: { json: boolean }) {
  const { exit } = useApp()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    async function fetchAndSetDatabases() {
      try {
        const databases = await listDatabases()
        if (json) {
          process.stdout.write(`${JSON.stringify(databases, null, 2)}\n`)
        }
        setState({ kind: 'ready', databases })
      } catch (error) {
        setState({ kind: 'error', message: (error as Error).message })
        process.exitCode = 1
      }
    }
    fetchAndSetDatabases()
  }, [json])

  // Exit only after the terminal frame has committed, so the table or error is
  // actually rendered before Ink unmounts.
  useEffect(() => {
    if (state.kind !== 'loading') {
      exit()
    }
  }, [state, exit])

  if (state.kind === 'loading') {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Loading your databases...</Text>
      </Box>
    )
  }

  if (state.kind === 'error') {
    return <Text color="red">{state.message}</Text>
  }

  // JSON already written to stdout; render nothing further.
  if (json) {
    return null
  }

  if (state.databases.length === 0) {
    return <Text>No databases yet. Create one at https://layerbase.com.</Text>
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {pad('NAME', 24)}
        {pad('ENGINE', 14)}
        {pad('STATUS', 14)}
        ID
      </Text>
      {state.databases.map((db) => (
        <Text key={db.id}>
          {pad(db.name, 24)}
          {pad(db.engine, 14)}
          <Text color={STATUS_COLOR[db.status] ?? 'white'}>
            {pad(db.status, 14)}
          </Text>
          {db.id}
        </Text>
      ))}
    </Box>
  )
}
