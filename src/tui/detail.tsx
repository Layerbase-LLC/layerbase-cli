import type { ReactNode } from 'react'
import { Box, Text } from 'ink'
import { ACCENT } from '@/ui/brand'
import {
  formatBytes,
  statusLabel,
  whereLabel,
  type TuiNode,
  type TuiRow,
} from '@/tui/model'
import {
  engineColor,
  LINKED,
  MUTED,
  RUNNING,
  statusColor,
  statusMark,
  WARN,
} from '@/tui/theme'

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

type Field = {
  label: string
  value: string
  color: string
}

export function Detail(props: {
  row: TuiRow | null
  children: TuiNode[]
  width: number
  maxLines: number
  pending?: { status: string; mark: string } | null
}) {
  if (!props.row || props.maxLines <= 0 || props.width <= 0) {
    return (
      <Box width={props.width} height={1}>
        <Text dimColor wrap="truncate">
          {clip('Select a database', props.width) || ' '}
        </Text>
      </Box>
    )
  }

  const row = props.row
  const label = props.pending?.status ?? statusLabel(row)
  const mark = props.pending?.mark ?? statusMark(label)
  const fields: Field[] = [
    { label: 'Engine', value: row.engine, color: engineColor(row.engine) },
    { label: 'Version', value: row.version ?? '-', color: WARN },
    { label: whereLabel(row), value: row.detail ?? '-', color: RUNNING },
    {
      label: 'Size',
      value: row.sizeBytes != null ? formatBytes(row.sizeBytes) : '-',
      color: LINKED,
    },
  ]
  const lines: string[] = []
  const nodes: ReactNode[] = []
  const push = (key: string, node: ReactNode): void => {
    if (lines.length >= props.maxLines) return
    lines.push(key)
    nodes.push(
      <Box key={key} width={props.width} height={1}>
        {node}
      </Box>,
    )
  }

  const source = row.source === 'local' ? 'local' : 'cloud'
  push(
    'title',
    <Text wrap="truncate">
      <Text bold color="white">
        {clip(row.name, Math.max(1, props.width - source.length - 1))}
      </Text>
      <Text color={ACCENT}>{` ${source}`}</Text>
    </Text>,
  )
  push(
    'status',
    <Text wrap="truncate">
      <Text color={statusColor(label)}>{`${mark} ${label}`}</Text>
      <Text dimColor>
        {row.parentName
          ? `    branch of ${clip(row.parentName, Math.max(1, props.width - label.length - 16))}`
          : '    primary'}
      </Text>
    </Text>,
  )
  if (row.serverPool) {
    push(
      'server',
      <Text wrap="truncate">
        <Text dimColor>Server </Text>
        <Text color={row.serverPool === 'dedicated' ? LINKED : MUTED}>
          {row.serverPool}
        </Text>
      </Text>,
    )
  }

  const column =
    props.width >= 44 ? Math.max(8, Math.floor(props.width / fields.length)) : 0
  const fitsGrid =
    column > 0 &&
    props.maxLines - lines.length >= 3 &&
    fields.every((field) => field.value.length <= column - 1)
  if (fitsGrid) {
    push(
      'labels',
      <Text wrap="truncate">
        {fields.map((field) => (
          <Text key={field.label} dimColor>
            {field.label.padEnd(column).slice(0, column)}
          </Text>
        ))}
      </Text>,
    )
    push(
      'values',
      <Text wrap="truncate">
        {fields.map((field) => (
          <Text key={field.label} color={field.color}>
            {clip(field.value, column - 1).padEnd(column)}
          </Text>
        ))}
      </Text>,
    )
  } else {
    for (const field of fields) {
      push(
        field.label,
        <Text wrap="truncate">
          <Text dimColor>{field.label.padEnd(8).slice(0, 8)}</Text>
          <Text color={field.color}>
            {clip(field.value, Math.max(1, props.width - 8))}
          </Text>
        </Text>,
      )
    }
  }

  for (const item of row.meta) {
    push(
      item.label,
      <Text wrap="truncate">
        <Text dimColor>{item.label.padEnd(10).slice(0, 10)}</Text>
        <Text>{clip(item.value, Math.max(1, props.width - 10))}</Text>
      </Text>,
    )
  }

  if (row.expiresAt) {
    push(
      'expires',
      <Text dimColor wrap="truncate">
        {clip(`expires ${row.expiresAt}`, props.width)}
      </Text>,
    )
  }

  const branches = row.parentName ? [] : props.children
  if (branches.length > 0 && lines.length < props.maxLines - 1) {
    push(
      'branches',
      <Text dimColor wrap="truncate">
        branches
      </Text>,
    )
    for (const child of branches) {
      const childLabel = statusLabel(child.row)
      push(
        child.row.id,
        <Text wrap="truncate">
          <Text
            color={statusColor(childLabel)}
          >{`${statusMark(childLabel)} `}</Text>
          <Text>
            {clip(
              `${child.row.name}  ${childLabel}`,
              Math.max(1, props.width - 2),
            )}
          </Text>
        </Text>,
      )
    }
  }

  return (
    <Box flexDirection="column" width={props.width}>
      {nodes}
    </Box>
  )
}
