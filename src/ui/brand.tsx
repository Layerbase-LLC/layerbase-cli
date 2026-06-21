import { Box, Text } from 'ink'

// Soft Layerbase blue. Truecolor terminals get the exact shade; others degrade.
export const ACCENT = '#7c9cff'

export function Header({ subtitle }: { subtitle?: string }) {
  return (
    <Box marginBottom={1}>
      <Text bold color={ACCENT}>
        {'◆'} Layerbase
      </Text>
      {subtitle ? <Text dimColor> {subtitle}</Text> : null}
    </Box>
  )
}
