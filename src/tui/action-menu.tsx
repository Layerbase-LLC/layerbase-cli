import { Box, Text, useInput } from 'ink'
import { ACCENT } from '@/ui/brand'
import type { RowAction } from '@/tui/row-actions'
import { MUTED, PANEL } from '@/tui/theme'

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

export function ActionMenu(props: {
  title: string
  actions: RowAction[]
  note: string | null
  index: number
  width: number
  height: number
  busy: boolean
  busyLabel?: string | null
  onMove: (index: number) => void
  onRun: () => void
  onEscape: () => void
  onQuit: () => void
}) {
  useInput(
    (input, key) => {
      if (key.escape) {
        props.onEscape()
        return
      }
      if (props.busy) return
      if (input === 'q') {
        props.onQuit()
        return
      }
      if (key.return || input === ' ') {
        props.onRun()
        return
      }
      if (key.downArrow || input === 'j') {
        if (props.actions.length === 0) return
        props.onMove((props.index + 1) % props.actions.length)
        return
      }
      if (key.upArrow || input === 'k') {
        if (props.actions.length === 0) return
        const next = props.index - 1
        props.onMove(next < 0 ? props.actions.length - 1 : next)
      }
    },
    { isActive: true },
  )

  const innerWidth = Math.max(1, props.width - 4)
  const innerHeight = Math.max(1, props.height - 2)
  const lines: {
    key: string
    text: string
    color?: string
    bold?: boolean
    dim?: boolean
  }[] = [{ key: 'title', text: props.title, bold: true }]
  if (props.actions.length === 0) {
    lines.push({
      key: 'empty',
      text: 'No actions for this database',
      dim: true,
    })
  }
  props.actions.forEach((action, index) => {
    const on = index === props.index
    lines.push({
      key: action.id,
      text: `${on ? '> ' : '  '}${action.label}`,
      color: on ? ACCENT : undefined,
      bold: on,
    })
  })
  if (props.note) lines.push({ key: 'note', text: props.note, dim: true })
  if (props.busy) {
    lines.push({
      key: 'busy',
      text: props.busyLabel ?? 'Working...',
      color: MUTED,
    })
  }
  lines.push({ key: 'hint', text: 'enter runs  esc home', dim: true })

  return (
    <Box
      flexDirection="column"
      height={props.height}
      width={props.width}
      borderStyle="round"
      borderColor={PANEL}
      paddingX={1}
    >
      {lines.slice(0, innerHeight).map((line) => (
        <Text
          key={line.key}
          bold={line.bold}
          color={line.color}
          dimColor={line.dim}
          wrap="truncate"
        >
          {clip(line.text, innerWidth)}
        </Text>
      ))}
    </Box>
  )
}
