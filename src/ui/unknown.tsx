import { useEffect } from 'react'
import { Text, useApp } from 'ink'

export function Unknown({ command }: { command: string }) {
  const { exit } = useApp()

  useEffect(() => {
    process.exitCode = 1
    exit()
  }, [exit])

  return (
    <Text color="red">
      Unknown command: {command}. Run `layerbase help` to see the commands.
    </Text>
  )
}
