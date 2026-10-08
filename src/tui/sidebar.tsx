import { Box, Text } from 'ink'
import { ACCENT } from '@/ui/brand'
import {
  sidebarHeader,
  sidebarLayout,
  sidebarRowSegments,
  type Segment,
  type SegmentTone,
} from '@/tui/columns'
import { formatBytes, statusLabel, type DisplayLine } from '@/tui/model'
import {
  BAD,
  engineColor,
  LINKED,
  RUNNING,
  SELECTED,
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

function toneColor(
  tone: SegmentTone,
  engine: string,
  status: string,
): string | undefined {
  switch (tone) {
    case 'mark':
    case 'status':
      return statusColor(status)
    case 'name':
      return '#d7e3ff'
    case 'engine':
      return engineColor(engine)
    case 'version':
      return WARN
    case 'where':
      return RUNNING
    case 'size':
      return LINKED
    default:
      return undefined
  }
}

export function Sidebar(props: {
  lines: DisplayLine[]
  selectedKey: string | null
  width: number
  pending?: { key: string; status: string; mark: string } | null
}) {
  const layout = sidebarLayout(props.width)
  const header = sidebarHeader(props.width)
  return (
    <Box flexDirection="column" width={props.width}>
      {header ? (
        <Box width={props.width} height={1}>
          <Text dimColor wrap="truncate">
            {clip(header, props.width)}
          </Text>
        </Box>
      ) : null}
      {props.lines.map((line, index) => (
        <SidebarLine
          key={`${line.key ?? line.kind}:${index}`}
          line={line}
          selected={line.key != null && line.key === props.selectedKey}
          width={props.width}
          layout={layout}
          pending={
            props.pending && line.key === props.pending.key
              ? props.pending
              : null
          }
        />
      ))}
    </Box>
  )
}

function SidebarLine(props: {
  line: DisplayLine
  selected: boolean
  width: number
  layout: ReturnType<typeof sidebarLayout>
  pending: { status: string; mark: string } | null
}) {
  if (props.line.kind !== 'row' || !props.line.row) {
    return <MetaLine line={props.line} width={props.width} />
  }

  const row = props.line.row
  const label = props.pending?.status ?? statusLabel(row)
  const segments = sidebarRowSegments({
    layout: props.layout,
    name: row.name,
    engine: row.engine,
    version: row.version,
    detail: row.detail,
    size: row.sizeBytes != null ? formatBytes(row.sizeBytes) : null,
    status: label,
    depth: props.line.depth,
    width: props.width,
    mark: props.pending?.mark ?? statusMark(label),
  })

  return (
    <Box width={props.width} height={1}>
      <Text
        wrap="truncate"
        backgroundColor={props.selected ? SELECTED : undefined}
      >
        {segments.map((segment, index) => (
          <SegmentText
            key={`${segment.tone}:${index}`}
            segment={segment}
            engine={row.engine}
            status={label}
            selected={props.selected}
          />
        ))}
      </Text>
    </Box>
  )
}

function SegmentText(props: {
  segment: Segment
  engine: string
  status: string
  selected: boolean
}) {
  const color = toneColor(props.segment.tone, props.engine, props.status)
  return (
    <Text
      color={color}
      backgroundColor={props.selected ? SELECTED : undefined}
      bold={props.selected && props.segment.tone === 'name'}
    >
      {props.segment.text}
    </Text>
  )
}

function MetaLine(props: { line: DisplayLine; width: number }) {
  const section = props.line.kind === 'section'
  if (!section) {
    return (
      <Box width={props.width} height={1}>
        <Text
          wrap="truncate"
          color={props.line.kind === 'error' ? BAD : undefined}
          dimColor={props.line.kind !== 'error'}
        >
          {clip(props.line.text, props.width) || ' '}
        </Text>
      </Box>
    )
  }

  const meta = props.line.meta ?? ''
  const gap = props.width - props.line.text.length - meta.length
  const shownMeta = gap >= 1 ? meta : ''
  const pad = Math.max(
    1,
    props.width - props.line.text.length - shownMeta.length,
  )

  return (
    <Box width={props.width} height={1}>
      <Text wrap="truncate">
        <Text bold color={ACCENT}>
          {clip(props.line.text, props.width)}
        </Text>
        {shownMeta ? (
          <Text dimColor>{`${' '.repeat(pad)}${shownMeta}`}</Text>
        ) : null}
      </Text>
    </Box>
  )
}
