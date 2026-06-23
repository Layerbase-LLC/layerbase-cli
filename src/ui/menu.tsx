import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { ACCENT } from '@/ui/brand'

export type MenuItem = { label: string; value: string; hint?: string }

// A minimal arrow-key select list (no dependency), so `layerbase` with no
// command lands on a menu the way spindb does.
export function Menu({
  items,
  onSelect,
}: {
  items: MenuItem[]
  onSelect: (value: string) => void
}) {
  const [index, setIndex] = useState(0)

  useInput((input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i === 0 ? items.length - 1 : i - 1))
    } else if (key.downArrow) {
      setIndex((i) => (i === items.length - 1 ? 0 : i + 1))
    } else if (key.return) {
      const item = items[index]
      if (item) onSelect(item.value)
    } else if (input === 'q') {
      onSelect('quit')
    }
  })

  // Pad labels so any hints line up in a column.
  const labelWidth = Math.max(...items.map((i) => i.label.length)) + 3

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const active = i === index
        const label = item.hint ? item.label.padEnd(labelWidth) : item.label
        return (
          <Box key={item.value}>
            <Text color={active ? ACCENT : undefined} bold={active}>
              {active ? '❯ ' : '  '}
              {label}
            </Text>
            {item.hint ? <Text dimColor>{item.hint}</Text> : null}
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor>
          Up/Down to move {'·'} Enter to select {'·'} q to quit
        </Text>
      </Box>
    </Box>
  )
}
