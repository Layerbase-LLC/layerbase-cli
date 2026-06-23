import { useEffect, useState } from 'react'
import { Text, useApp } from 'ink'
import { setupLb } from '@/lib/alias'

type Result = { ok: boolean; text: string }

// Sets up the short `lb` command, but only when it is free on this system.
export function Alias() {
  const { exit } = useApp()
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    const outcome = setupLb()
    if (outcome.ok) {
      setResult({ ok: true, text: 'The `lb` shortcut is ready. Try `lb`.' })
    } else {
      process.exitCode = 1
      setResult({ ok: false, text: outcome.reason })
    }
  }, [])

  useEffect(() => {
    if (result) exit()
  }, [result, exit])

  if (!result) return null
  return <Text color={result.ok ? 'green' : 'yellow'}>{result.text}</Text>
}
