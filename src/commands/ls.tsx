import { useEffect, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import Spinner from 'ink-spinner'
import { listDatabases } from '@/lib/cloud-api'
import type { CloudDatabase } from '@/lib/cloud-api'
import { reportError } from '@/lib/cli-output'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; databases: CloudDatabase[] }
  // The error has already been reported (JSON to stdout or a line to stderr);
  // render nothing further.
  | { kind: 'silent' }

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

// Transient (TTL) databases show their expiry so they are not mistaken for a
// stranded database. Normal databases render a dash.
function expiryLabel(db: CloudDatabase): string {
  const expiresAt = db.expiresAt ?? db.expires_at ?? null
  if (!expiresAt) return db.transient ? 'transient' : '-'
  const when = new Date(expiresAt)
  if (Number.isNaN(when.getTime())) return 'transient'
  return `ttl ${when.toISOString().slice(0, 16).replace('T', ' ')}`
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
        process.exitCode = reportError(error, json)
        setState({ kind: 'silent' })
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

  if (state.kind === 'silent') {
    return null
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
        {pad('EXPIRES', 20)}
        ID
      </Text>
      {state.databases.map((db) => (
        <Text key={db.id}>
          {pad(db.name, 24)}
          {pad(db.engine, 14)}
          <Text color={STATUS_COLOR[db.status] ?? 'white'}>
            {pad(db.status, 14)}
          </Text>
          {pad(expiryLabel(db), 20)}
          {db.id}
        </Text>
      ))}
    </Box>
  )
}
