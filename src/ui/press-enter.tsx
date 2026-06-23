import { Text, useApp, useInput } from 'ink'

// A tiny gate between a hub action and returning to the menu, so the action's
// output stays readable until the user is ready to move on.
export function PressEnter() {
  const { exit } = useApp()
  useInput((_input, key) => {
    if (key.return) exit()
  })
  return <Text dimColor>Press Enter to return to the menu</Text>
}
