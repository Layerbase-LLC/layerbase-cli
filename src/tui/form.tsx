import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { ACCENT } from '@/ui/brand'
import type { ServerOptions } from '@/lib/cloud-api'
import {
  initialServerIndex,
  serverOptionLabel,
  showsServerStep,
  stepServerIndex,
} from '@/tui/servers'

type Field = 'name' | 'engine' | 'server'

function clip(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

export function FormView(props: {
  title: string
  engines: string[] | null
  // Cloud create only: the team's servers. The step shows for two or more.
  servers?: ServerOptions | null
  hint?: string
  error: string | null
  busy: boolean
  height: number
  width: number
  onCancel: () => void
  onSubmit: (value: {
    name: string
    engine: string | null
    serverIndex: number | null
  }) => void
}) {
  const [name, setName] = useState('')
  const [engineIndex, setEngineIndex] = useState(0)
  const [field, setField] = useState<Field>('name')
  const engines = props.engines
  const engine = engines?.[engineIndex] ?? null
  const servers = showsServerStep(props.servers ?? null)
    ? (props.servers ?? null)
    : null
  const [serverIndex, setServerIndex] = useState<number | null>(() =>
    servers ? initialServerIndex(servers) : null,
  )
  const pickedServer =
    servers && serverIndex !== null
      ? servers.serverOptions[serverIndex]
      : undefined
  const fields: Field[] = [
    'name',
    ...(engines ? (['engine'] as const) : []),
    ...(servers ? (['server'] as const) : []),
  ]

  useInput(
    (input, key) => {
      if (key.escape) {
        props.onCancel()
        return
      }
      if (props.busy) return
      if (key.return) {
        props.onSubmit({ name: name.trim(), engine, serverIndex })
        return
      }
      if (key.tab) {
        setField(
          (current) =>
            fields[(fields.indexOf(current) + 1) % fields.length] ?? 'name',
        )
        return
      }
      if ((key.leftArrow || key.rightArrow) && servers && field === 'server') {
        const count = servers.serverOptions.length
        const direction = key.rightArrow ? 1 : -1
        setServerIndex((current) =>
          stepServerIndex({ count, index: current, direction }),
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
    servers
      ? `server  ${pickedServer ? serverOptionLabel(pickedServer) : 'pick one'}${
          field === 'server' ? '  left/right' : ''
        }`
      : null,
    props.busy
      ? 'working...'
      : (props.hint ?? 'enter creates it with spindb, esc home'),
    props.error,
  ].filter((line): line is string => Boolean(line))

  return (
    <Box flexDirection="column" height={props.height} width={props.width}>
      {lines.slice(0, props.height).map((line, index) => (
        <Text
          key={`${index}:${line}`}
          color={index === 0 ? ACCENT : undefined}
          dimColor={
            line.startsWith('enter') ||
            line.startsWith('working') ||
            (line.startsWith('server') &&
              line.includes('not accepting new databases'))
          }
        >
          {clip(line, props.width)}
        </Text>
      ))}
    </Box>
  )
}
