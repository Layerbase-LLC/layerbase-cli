import { useEffect, useState } from 'react'
import { Text, useApp } from 'ink'
import { getConnectionInfo } from '../lib/cloud-api'
import { buildConnectionString } from '../lib/format'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done' }

// Opt-in escape hatch: prints the full connection string (with password) to
// stdout for piping into an app. The secure path is `layerbase connect`.
export function ConnectionString({ dbRef }: { dbRef: string | undefined }) {
  const { exit } = useApp()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    async function fetchAndPrintConnectionString() {
      if (!dbRef) {
        setState({
          kind: 'error',
          message: 'Usage: layerbase connection-string <db>',
        })
        process.exitCode = 1
        return
      }
      try {
        const info = await getConnectionInfo(dbRef)
        process.stdout.write(`${buildConnectionString(info)}\n`)
        setState({ kind: 'done' })
      } catch (error) {
        setState({ kind: 'error', message: (error as Error).message })
        process.exitCode = 1
      }
    }
    fetchAndPrintConnectionString()
  }, [dbRef])

  useEffect(() => {
    if (state.kind !== 'loading') {
      exit()
    }
  }, [state, exit])

  if (state.kind === 'error') {
    return <Text color="red">{state.message}</Text>
  }
  return null
}
