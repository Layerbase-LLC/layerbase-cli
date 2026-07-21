import { useEffect, useState } from 'react'
import { useApp } from 'ink'
import { getConnectionInfo } from '@/lib/cloud-api'
import { buildConnectionString } from '@/lib/format'
import { reportError } from '@/lib/cli-output'

type State = { kind: 'loading' } | { kind: 'done' }

// Opt-in escape hatch: prints the full connection string (with password) to
// stdout for piping into an app. With --json it prints { connectionString }.
// The secure path is `layerbase connect`.
export function ConnectionString({
  dbRef,
  json,
}: {
  dbRef: string | undefined
  json: boolean
}) {
  const { exit } = useApp()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    async function fetchAndPrintConnectionString() {
      if (!dbRef) {
        process.exitCode = reportError(
          new Error('Usage: layerbase cloud connection-string <db>'),
          json,
        )
        setState({ kind: 'done' })
        return
      }
      try {
        const info = await getConnectionInfo(dbRef)
        const connectionString = buildConnectionString(info)
        if (json) {
          process.stdout.write(`${JSON.stringify({ connectionString })}\n`)
        } else {
          process.stdout.write(`${connectionString}\n`)
        }
        setState({ kind: 'done' })
      } catch (error) {
        process.exitCode = reportError(error, json)
        setState({ kind: 'done' })
      }
    }
    fetchAndPrintConnectionString()
  }, [dbRef, json])

  useEffect(() => {
    if (state.kind !== 'loading') {
      exit()
    }
  }, [state, exit])

  return null
}
