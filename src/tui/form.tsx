import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { ACCENT } from '@/ui/brand'

function clip(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

export function FormView(props: {
  title: string
  engines: string[] | null
  error: string | null
  busy: boolean
  height: number
  width: number
  onCancel: () => void
  onSubmit: (value: { name: string; engine: string | null }) => void
}) {
  const [name, setName] = useState('')
  const [engineIndex, setEngineIndex] = useState(0)
  const [field, setField] = useState<'name' | 'engine'>('name')
  const engines = props.engines
  const engine = engines?.[engineIndex] ?? null

  useInput(
    (input, key) => {
      if (key.escape) {
        props.onCancel()
        return
      }
      if (props.busy) return
      if (key.return) {
        props.onSubmit({ name: name.trim(), engine })
        return
      }
      if (key.tab) {
        setField((current) =>
          engines && current === 'name' ? 'engine' : 'name',
        )
        return
      }
      if (key.leftArrow || key.rightArrow) {
        if (!engines || engines.length === 0) return
        const direction = key.rightArrow ? 1 : -1
        setEngineIndex((current) => {
          const next = current + direction
          if (next < 0) return engines.length - 1
          if (next >= engines.length) return 0
          return next
        })
        setField('engine')
        return
      }
      if (key.backspace || key.delete) {
        setName((current) => current.slice(0, -1))
        setField('name')
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setName((current) => `${current}${input}`.slice(0, 64))
        setField('name')
      }
    },
    { isActive: true },
  )

  const lines = [
    props.title,
    `name    ${name}${field === 'name' ? '_' : ''}`,
    engines
      ? `engine  ${engine ?? '-'}${field === 'engine' ? '  left/right' : ''}`
      : null,
    props.busy ? 'working...' : 'enter creates it with spindb, esc home',
    props.error,
  ].filter((line): line is string => Boolean(line))

  return (
    <Box flexDirection="column" height={props.height} width={props.width}>
      {lines.slice(0, props.height).map((line, index) => (
        <Text
          key={`${index}:${line}`}
          color={index === 0 ? ACCENT : undefined}
          dimColor={line.startsWith('enter') || line.startsWith('working')}
        >
          {clip(line, props.width)}
        </Text>
      ))}
    </Box>
  )
}
