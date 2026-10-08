import { basename } from 'node:path'
import type { CloudDatabase, CloudEngineInfo } from '@/lib/cloud-api'
import { isBranch, parentLabel } from '@/lib/database-list'
import { isFileEngine } from '@/tui/engines'

export class TuiParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TuiParseError'
  }
}

export type TuiRow = {
  id: string
  source: 'local' | 'cloud'
  name: string
  engine: string
  version: string | null
  status: string
  parentName: string | null
  detail: string | null
  linked: boolean
  expiresAt: string | null
  sizeBytes: number | null
  // Cloud placement. Null on local rows, and on a cloud row whose list did not
  // report a pool. Never inferred.
  serverPool: 'shared' | 'dedicated' | null
  // Extra fields the list already returned. Connection strings and passwords
  // never land here.
  meta: { label: string; value: string }[]
}

export type TuiNode = {
  row: TuiRow
  children: TuiNode[]
}

export type FlatItem = {
  row: TuiRow
  parentKey: string | null
}

export function rowKey(row: TuiRow): string {
  return `${row.source}:${row.id}`
}

export function parseJsonDocument(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new TuiParseError('spindb returned no JSON')
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const start = trimmed.search(/[[{]/)
    if (start >= 0) {
      try {
        return JSON.parse(trimmed.slice(start)) as unknown
      } catch {
        // Fall through to the typed error below.
      }
    }
    throw new TuiParseError('spindb returned invalid JSON')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function statusLabel(row: TuiRow): string {
  if (row.source === 'local' && row.linked) return 'linked'
  if (row.source === 'local' && isFileEngine(row.engine)) {
    return row.status === 'running' ? 'available' : 'missing'
  }
  return row.status
}

export function connectBlockReason(row: TuiRow): string | null {
  if (row.linked) return null
  if (row.source === 'local' && isFileEngine(row.engine)) {
    if (row.status !== 'running') return `${row.name} is missing.`
    return null
  }
  if (row.source === 'local' && row.status !== 'running') {
    return `${row.name} is stopped. Start it with lbase start ${row.name}.`
  }
  if (row.source === 'cloud' && row.status === 'stopped') {
    return `${row.name} is stopped. Start it with lbase cloud start ${row.name}.`
  }
  return null
}

function shortWhen(value: string): string {
  const time = Date.parse(value)
  if (Number.isNaN(time)) {
    return value.length > 16 ? `${value.slice(0, 15)}~` : value
  }
  const date = new Date(time)
  const part = (n: number): string => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${part(date.getUTCMonth() + 1)}-${part(date.getUTCDate())} ${part(date.getUTCHours())}:${part(date.getUTCMinutes())}`
}

function addMeta(
  meta: { label: string; value: string }[],
  label: string,
  value: string | null,
): void {
  if (!value) return
  meta.push({ label, value })
}

function localDetail(
  record: Record<string, unknown>,
  linked: boolean,
): string | null {
  if (linked && isRecord(record.remote)) {
    const provider = asString(record.remote.provider)
    const host = asString(record.remote.host)
    return provider ?? host
  }
  const engine = asString(record.engine) ?? ''
  if (isFileEngine(engine)) {
    const database = asString(record.database)
    return database ? basename(database) : null
  }
  return asString(record.port)
}

export function localRow(record: Record<string, unknown>): TuiRow | null {
  const name = asString(record.name)
  const engine = asString(record.engine)
  if (!name || !engine) return null
  const linked = isRecord(record.remote)
  const meta: { label: string; value: string }[] = []
  const created = asString(record.created)
  if (created) addMeta(meta, 'Created', shortWhen(created))
  if (!isFileEngine(engine))
    addMeta(meta, 'Database', asString(record.database))
  const bind = asString(record.bindAddress)
  if (bind && bind !== '127.0.0.1') addMeta(meta, 'Bind', bind)
  if (record.authEnabled === true) addMeta(meta, 'Auth', 'on')
  addMeta(meta, 'Git', asString(record.gitBranch))
  if (typeof record.memoryBudgetMb === 'number' && record.memoryBudgetMb >= 0) {
    addMeta(meta, 'Memory', `${record.memoryBudgetMb} MB`)
  }
  const branched = asString(record.branchedAt)
  if (branched) addMeta(meta, 'Branched', shortWhen(branched))
  return {
    id: name,
    source: 'local',
    name,
    engine,
    version: asString(record.version),
    status: asString(record.status) ?? 'unknown',
    parentName: asString(record.branchParent),
    detail: localDetail(record, linked),
    linked,
    expiresAt: null,
    sizeBytes:
      typeof record.sizeBytes === 'number' && record.sizeBytes >= 0
        ? record.sizeBytes
        : null,
    serverPool: null,
    meta,
  }
}

function nest(items: FlatItem[]): TuiNode[] {
  const nodes = new Map<string, TuiNode>()
  for (const item of items) {
    nodes.set(rowKey(item.row), { row: item.row, children: [] })
  }
  const roots: TuiNode[] = []
  for (const item of items) {
    const node = nodes.get(rowKey(item.row))
    if (!node) continue
    const parent = item.parentKey ? nodes.get(item.parentKey) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  const sortTree = (list: TuiNode[]): void => {
    list.sort((a, b) => a.row.name.localeCompare(b.row.name))
    for (const node of list) sortTree(node.children)
  }
  sortTree(roots)
  return roots
}

function treeNodes(
  tree: unknown,
  byName: Map<string, TuiRow>,
  seen: Set<string>,
): TuiNode[] {
  if (!Array.isArray(tree)) return []
  const nodes: TuiNode[] = []
  for (const value of tree) {
    if (!isRecord(value)) continue
    const name = asString(value.name)
    if (!name) continue
    const row = byName.get(name)
    if (!row) continue
    seen.add(name)
    nodes.push({
      row,
      children: treeNodes(value.children, byName, seen),
    })
  }
  return nodes
}

export function localNodes(
  listJson: unknown,
  treeJson: unknown | null,
): TuiNode[] {
  if (isRecord(listJson) && typeof listJson.error === 'string') {
    throw new TuiParseError(listJson.error)
  }
  if (!Array.isArray(listJson)) {
    throw new TuiParseError('spindb list JSON was not a list')
  }
  const rows: TuiRow[] = []
  for (const value of listJson) {
    if (!isRecord(value)) continue
    const row = localRow(value)
    if (row) rows.push(row)
  }
  const byName = new Map(rows.map((row) => [row.name, row]))
  if (treeJson) {
    const seen = new Set<string>()
    const roots = treeNodes(treeJson, byName, seen)
    const leftover = rows.filter((row) => !seen.has(row.name))
    if (leftover.length === 0) return roots
    return [
      ...roots,
      ...nest(
        leftover.map((row) => ({
          row,
          parentKey: row.parentName ? `local:${row.parentName}` : null,
        })),
      ),
    ]
  }
  return nest(
    rows.map((row) => ({
      row,
      parentKey: row.parentName ? `local:${row.parentName}` : null,
    })),
  )
}

function cloudExpires(db: CloudDatabase): string | null {
  return db.expiresAt ?? db.expires_at ?? null
}

export function serverPoolOf(
  value: string | null | undefined,
): 'shared' | 'dedicated' | null {
  if (value === 'shared' || value === 'dedicated') return value
  return null
}

function cloudMeta(db: CloudDatabase): { label: string; value: string }[] {
  const meta: { label: string; value: string }[] = []
  const created = db.created_at
  if (created) addMeta(meta, 'Created', shortWhen(created))
  addMeta(meta, 'Host', db.hostname ?? db.host ?? null)
  if (typeof db.port === 'number' && db.port > 0) {
    addMeta(meta, 'Port', String(db.port))
  }
  addMeta(meta, 'Storage', db.storageClass ?? null)
  if (typeof db.memoryLimitMb === 'number' && db.memoryLimitMb >= 0) {
    addMeta(meta, 'Memory', `${db.memoryLimitMb} MB`)
  }
  addMeta(meta, 'Env', db.environment ?? null)
  if (db.lastActivityAt) addMeta(meta, 'Active', shortWhen(db.lastActivityAt))
  if (db.branchedAt) addMeta(meta, 'Branched', shortWhen(db.branchedAt))
  if (db.locked === 1 || db.locked === true) addMeta(meta, 'Locked', 'yes')
  return meta
}

export function cloudNodes(databases: CloudDatabase[]): TuiNode[] {
  return nest(
    databases.map((db) => ({
      row: {
        id: db.id,
        source: 'cloud' as const,
        name: db.name,
        engine: db.engine,
        version: db.version ?? null,
        status: db.status,
        parentName: isBranch(db) ? parentLabel(db) : null,
        detail: db.region ?? null,
        linked: false,
        expiresAt: cloudExpires(db),
        sizeBytes: null,
        serverPool: serverPoolOf(db.serverPool),
        meta: cloudMeta(db),
      },
      parentKey: db.parentId ? `cloud:${db.parentId}` : null,
    })),
  )
}

export function flattenNodes(nodes: TuiNode[]): TuiRow[] {
  const rows: TuiRow[] = []
  const walk = (list: TuiNode[]): void => {
    for (const node of list) {
      rows.push(node.row)
      walk(node.children)
    }
  }
  walk(nodes)
  return rows
}

export function keepSelection(
  rows: TuiRow[],
  previous: string | null,
  previousIndex: number,
): string | null {
  if (rows.length === 0) return null
  if (previous && rows.some((row) => rowKey(row) === previous)) return previous
  const index = Math.min(Math.max(previousIndex, 0), rows.length - 1)
  const row = rows[index]
  return row ? rowKey(row) : null
}

export function findRow(rows: TuiRow[], key: string | null): TuiRow | null {
  if (!key) return null
  return rows.find((row) => rowKey(row) === key) ?? null
}

export function childrenOf(nodes: TuiNode[], key: string | null): TuiNode[] {
  if (!key) return []
  const walk = (list: TuiNode[]): TuiNode[] | null => {
    for (const node of list) {
      if (rowKey(node.row) === key) return node.children
      const nested = walk(node.children)
      if (nested) return nested
    }
    return null
  }
  return walk(nodes) ?? []
}

export type GroupCounts = {
  databases: number
  branches: number
}

export function countGroup(nodes: TuiNode[]): GroupCounts {
  let databases = 0
  let branches = 0
  const walk = (list: TuiNode[], nested: boolean): void => {
    for (const node of list) {
      if (nested || node.row.parentName) branches += 1
      else databases += 1
      walk(node.children, true)
    }
  }
  walk(nodes, false)
  return { databases, branches }
}

export function groupTitle(label: string, counts: GroupCounts): string {
  if (counts.branches === 0) return `${label} ${counts.databases}`
  return `${label} ${counts.databases} db, ${counts.branches} branches`
}

export type DisplayLine = {
  key: string | null
  kind: 'section' | 'note' | 'error' | 'row'
  text: string
  meta: string | null
  depth: number
  row: TuiRow | null
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const shown = unit === 0 || value >= 100 ? value.toFixed(0) : value.toFixed(1)
  const name = units[unit] ?? 'B'
  return `${shown} ${name}`
}

export function whereLabel(row: TuiRow): string {
  if (row.source === 'cloud') return 'Region'
  if (row.linked) return 'Host'
  if (isFileEngine(row.engine)) return 'File'
  return 'Port'
}

export function shortProblem(error: string | null): string | null {
  if (!error) return null
  if (/api key/i.test(error)) return 'Key rejected. lbase login --api-key'
  const line = error.split('\n')[0] ?? error
  return line.length > 64 ? `${line.slice(0, 63)}~` : line
}

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

export function sidebarLines(options: {
  nodes: TuiNode[]
  empty: string | null
  error: string | null
  width: number
}): DisplayLine[] {
  const lines: DisplayLine[] = []
  if (options.error) {
    lines.push({
      key: null,
      kind: 'error',
      text: clip(options.error, options.width),
      meta: null,
      depth: 0,
      row: null,
    })
    return lines
  }
  if (options.nodes.length === 0 && options.empty) {
    lines.push({
      key: null,
      kind: 'note',
      text: clip(options.empty, options.width),
      meta: null,
      depth: 0,
      row: null,
    })
    return lines
  }
  const walk = (list: TuiNode[], depth: number): void => {
    for (const node of list) {
      lines.push({
        key: rowKey(node.row),
        kind: 'row',
        text: node.row.name,
        meta: null,
        depth,
        row: node.row,
      })
      walk(node.children, depth + 1)
    }
  }
  walk(options.nodes, 0)
  return lines
}

export function sliceLines(
  lines: DisplayLine[],
  selectedKey: string | null,
  height: number,
): DisplayLine[] {
  if (height <= 0) return []
  if (lines.length <= height) return lines
  const focus = selectedKey
    ? lines.findIndex((line) => line.key === selectedKey)
    : 0
  const index = focus >= 0 ? focus : 0
  let start = Math.max(0, index - Math.floor(height / 2))
  if (start + height > lines.length) start = lines.length - height
  return lines.slice(start, start + height)
}

export function frameHeight(terminalRows: number): number {
  if (!Number.isFinite(terminalRows) || terminalRows <= 1) return 1
  return terminalRows - 1
}

export function moveSelection(
  rows: TuiRow[],
  selected: string | null,
  delta: number,
): string | null {
  if (rows.length === 0) return null
  const index = rows.findIndex((row) => rowKey(row) === selected)
  const current = index >= 0 ? index : 0
  const next = Math.min(rows.length - 1, Math.max(0, current + delta))
  return rowKey(rows[next] as TuiRow)
}

export function creatableEngineIds(catalog: CloudEngineInfo[]): string[] {
  return catalog
    .filter(
      (entry) => entry.status === 'supported' && entry.hostedServiceAllowed,
    )
    .map((entry) => entry.id)
}

export function ageLabel(at: number | null, now: number): string {
  if (at == null) return 'waiting'
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  return `updated ${seconds}s ago`
}
