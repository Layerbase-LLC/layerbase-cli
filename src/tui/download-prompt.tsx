import { Box, Text, useInput } from 'ink'
import { ACCENT } from '@/ui/brand'
import { engineLabel } from '@/tui/engines'
import { MUTED, PANEL } from '@/tui/theme'

const CHOICES = ['Download and start', 'Not now']

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

export function DownloadPrompt(props: {
  engine: string
  version: string
  name: string
  index: number
  width: number
  busy: boolean
  busyLabel: string | null
  error: string | null
  onMove: (index: number) => void
  onAccept: () => void
  onDecline: () => void
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
        if (props.index === 0) props.onAccept()
        else props.onDecline()
        return
      }
      if (key.downArrow || input === 'j' || key.upArrow || input === 'k') {
        props.onMove(props.index === 0 ? 1 : 0)
      }
    },
    { isActive: true },
  )

  const label = engineLabel(props.engine)
  const innerWidth = Math.max(1, props.width - 4)
  const lines: {
    key: string
    text: string
    color?: string
    bold?: boolean
    dim?: boolean
  }[] = [
    {
      key: 'title',
      text: `${label} ${props.version} is not installed`,
      bold: true,
    },
    {
      key: 'ask',
      text: `Download it and start ${props.name}?`,
      dim: true,
    },
  ]
  CHOICES.forEach((choice, index) => {
    const on = index === props.index
    lines.push({
      key: choice,
      text: `${on ? '> ' : '  '}${choice}`,
      color: on ? ACCENT : undefined,
      bold: on,
    })
  })
  if (props.busy) {
    lines.push({
      key: 'busy',
      text: props.busyLabel ?? 'Downloading...',
      color: MUTED,
    })
  }
  if (props.error) lines.push({ key: 'error', text: props.error, color: MUTED })
  lines.push({ key: 'hint', text: 'enter runs  esc home', dim: true })

  return (
    <Box
      flexDirection="column"
      width={props.width}
      borderStyle="round"
      borderColor={PANEL}
      paddingX={1}
    >
      {lines.map((line) => (
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
