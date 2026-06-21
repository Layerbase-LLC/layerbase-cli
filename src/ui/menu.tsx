import { useState } from 'react'
import { Box, Text, useInput } from 'ink'

export type MenuItem = { label: string; value: string }

// A minimal arrow-key select list (no dependency), so `layerbase` with no
// command lands on a menu the way spindb does.
export function Menu({
  title,
  items,
  onSelect,
}: {
  title?: string
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

  return (
    <Box flexDirection="column">
      {title ? (
        <Box marginBottom={1}>
          <Text dimColor>{title}</Text>
        </Box>
      ) : null}
      {items.map((item, i) => {
        const active = i === index
        return (
          <Text key={item.value} color={active ? 'cyan' : undefined}>
            {active ? '> ' : '  '}
            {item.label}
          </Text>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor>Up/Down to move, Enter to select, q to quit</Text>
      </Box>
    </Box>
  )
}
