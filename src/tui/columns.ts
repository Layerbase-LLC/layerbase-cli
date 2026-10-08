// Column math for one sidebar row. Every segment is counted in UTF-16 code
// units, which matches how Ink measures width. The joined text is never longer
// than the row, so a line cannot wrap and grow the frame.

export type SidebarLayout = {
  engine: number
  version: number
  where: number
  size: number
  status: number
}

export type SegmentTone =
  | 'mark'
  | 'name'
  | 'engine'
  | 'version'
  | 'where'
  | 'size'
  | 'status'
  | 'plain'

export type Segment = {
  text: string
  tone: SegmentTone
}

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

// Keep the end of a long locator. Ports and regions already fit. File names
// share a prefix, so the tail is the part that tells two branches apart.
function clipEnd(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(-1)
  return `~${text.slice(-(width - 1))}`
}

function cell(text: string, width: number): string {
  if (width <= 0) return ''
  return clip(text, width).padEnd(width)
}

// Right-side columns turn on only after the name keeps room, including a
// branch indent. The same widths apply to every row so the columns line up.
export function sidebarLayout(width: number): SidebarLayout {
  const minimumLeft = Math.min(22, Math.max(8, width))
  let spare = width - minimumLeft
  const take = (max: number): number => {
    const need = max + 1
    if (spare < need) return 0
    spare -= need
    return max
  }
  return {
    status: take(10),
    engine: take(12),
    version: take(12),
    where: take(8),
    size: take(8),
  }
}

export function branchPrefix(depth: number): string {
  if (depth <= 0) return ''
  const level = Math.min(depth, 3)
  return `${'  '.repeat(level)}└ `
}

export function sidebarRowSegments(options: {
  layout: SidebarLayout
  name: string
  engine: string
  version: string | null
  detail: string | null
  size: string | null
  status: string
  depth: number
  width: number
  mark: string
}): Segment[] {
  const width = Math.max(0, options.width)
  if (width === 0) return []

  const prefix = branchPrefix(options.depth)
  const mark = `${options.mark} `
  const right: Segment[] = []
  const push = (text: string, column: number, tone: SegmentTone): void => {
    if (column <= 0) return
    right.push({ text: ` ${cell(text, column)}`, tone })
  }
  push(options.engine, options.layout.engine, 'engine')
  if (options.layout.version > 0) {
    push(options.version ?? '-', options.layout.version, 'version')
  }
  if (options.layout.where > 0) {
    push(
      clipEnd(options.detail ?? '-', options.layout.where),
      options.layout.where,
      'where',
    )
  }
  if (options.layout.size > 0) {
    push(options.size ?? '-', options.layout.size, 'size')
  }
  push(options.status, options.layout.status, 'status')

  const rightLength = right.reduce(
    (sum, segment) => sum + segment.text.length,
    0,
  )
  let nameWidth = width - prefix.length - mark.length - rightLength
  let head = `${prefix}${mark}`
  if (nameWidth < 1) {
    return [{ text: clip(`${head}${options.name}`, width), tone: 'plain' }]
  }
  if (head.length + nameWidth + rightLength > width) {
    head = clip(head, Math.max(0, width - nameWidth - rightLength))
    nameWidth = width - head.length - rightLength
  }

  const segments: Segment[] = [
    { text: head, tone: 'mark' },
    { text: cell(options.name, nameWidth), tone: 'name' },
    ...right,
  ]
  const used = segments.reduce((sum, segment) => sum + segment.text.length, 0)
  if (used < width) {
    segments.push({ text: ' '.repeat(width - used), tone: 'plain' })
  }
  const total = segments.reduce((sum, segment) => sum + segment.text.length, 0)
  if (total === width) return segments
  return [
    {
      text: clip(segments.map((segment) => segment.text).join(''), width),
      tone: 'plain',
    },
  ]
}

export function sidebarHeader(width: number): string | null {
  const layout = sidebarLayout(width)
  if (layout.engine <= 0) return null
  return sidebarRowSegments({
    layout,
    name: '',
    engine: 'engine',
    version: layout.version > 0 ? 'version' : null,
    detail: layout.where > 0 ? 'port' : null,
    size: layout.size > 0 ? 'size' : null,
    status: 'status',
    depth: 0,
    width,
    mark: ' ',
  })
    .map((segment) => segment.text)
    .join('')
}
