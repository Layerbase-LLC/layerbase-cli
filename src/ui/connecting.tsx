import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'

export function Connecting({ label }: { label: string }) {
  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text> {label}</Text>
    </Box>
  )
}
