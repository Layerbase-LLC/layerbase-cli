import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { ACCENT } from '@/ui/brand'

export type PromptCommand = { name: string; summary: string }

// A Claude-Code-style input line: type a /command (with a live palette you can
// arrow through and Tab-complete), or type free text. Enter submits. The palette
// shows only while typing a bare slash token (it hides once you add arguments).
export function Prompt({
  commands,
  onSubmit,
}: {
  commands: PromptCommand[]
  onSubmit: (raw: string) => void
}) {
  const [value, setValue] = useState('')
  const [index, setIndex] = useState(0)

  const showPalette = /^\/[a-z-]*$/i.test(value)
  const query = showPalette ? value.slice(1).toLowerCase() : ''
  const matches = showPalette
    ? commands.filter((c) => c.name.startsWith(query))
    : []
  const active = matches.length ? Math.min(index, matches.length - 1) : 0

  useInput((input, key) => {
    if (key.return) {
      const chosen = matches[active]
      if (showPalette && chosen) onSubmit(`/${chosen.name}`)
      else onSubmit(value)
      return
    }
    if (key.upArrow) {
      if (matches.length) setIndex((i) => (i <= 0 ? matches.length - 1 : i - 1))
      return
    }
    if (key.downArrow) {
      if (matches.length) setIndex((i) => (i >= matches.length - 1 ? 0 : i + 1))
      return
    }
    if (key.tab) {
      const chosen = matches[active]
      if (chosen) {
        setValue(`/${chosen.name}`)
        setIndex(0)
      }
      return
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1))
      setIndex(0)
      return
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input)
      setIndex(0)
    }
  })

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={ACCENT}>{'❯ '}</Text>
        <Text>{value}</Text>
        <Text inverse> </Text>
      </Box>

      {showPalette ? (
        <Box flexDirection="column" marginTop={1}>
          {matches.length === 0 ? (
            <Text dimColor> no matching command</Text>
          ) : (
            matches.map((c, i) => {
              const on = i === active
              return (
                <Box key={c.name}>
                  <Text color={on ? ACCENT : undefined} bold={on}>
                    {on ? '❯ ' : '  '}
                    {`/${c.name}`.padEnd(12)}
                  </Text>
                  <Text dimColor>{c.summary}</Text>
                </Box>
              )
            })
          )}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>
            Type a /command (or / to browse) {'·'} Enter to run {'·'} Ctrl+C to
            quit
          </Text>
        </Box>
      )}
    </Box>
  )
}
