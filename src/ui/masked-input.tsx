import { useState } from 'react'
import { Box, Text, useInput } from 'ink'

type MaskedInputProps = {
  label: string
  onSubmit: (value: string) => void
}

// A minimal password field: printable keys append, backspace pops, enter
// submits. Rendered as dots so the key never appears in scrollback.
export function MaskedInput({ label, onSubmit }: MaskedInputProps) {
  const [value, setValue] = useState('')

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value)
      return
    }
    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1))
      return
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((current) => current + input)
    }
  })

  return (
    <Box>
      <Text>{label} </Text>
      <Text color="cyan">{'•'.repeat(value.length)}</Text>
    </Box>
  )
}
