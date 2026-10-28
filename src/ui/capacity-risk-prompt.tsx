import { Box, Text } from 'ink'
import { Menu } from '@/ui/menu'
import { runView } from '@/ui/run-view'
import type { CapacityRiskDecision } from '@/lib/capacity-risk'

// Arrow-key choice shown after the capacity warning. Cancel is first so a
// reflexive Enter never accepts the risk; q and Ctrl+C also cancel.
export async function askCapacityRisk(): Promise<CapacityRiskDecision | null> {
  const value = await runView<string>((resolve) => (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Create the database anyway?</Text>
      <Menu
        items={[
          { label: 'Cancel', value: 'cancel' },
          { label: 'Proceed and accept the risk', value: 'accept' },
        ]}
        onSelect={resolve}
      />
    </Box>
  ))
  return value === 'accept' ? 'accept' : value === null ? null : 'cancel'
}
