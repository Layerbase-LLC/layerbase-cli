import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CloudDatabase } from '@/lib/cloud-api'
import {
  TuiParseError,
  cloudNodes,
  connectBlockReason,
  serverPoolOf,
  flattenNodes,
  keepSelection,
  localNodes,
  parseJsonDocument,
  rowKey,
  formatBytes,
  shortProblem,
  sliceLines,
  statusLabel,
  type TuiRow,
} from '@/tui/model'

function cloud(overrides: Partial<CloudDatabase> = {}): CloudDatabase {
  return {
    id: 'db_1',
    name: 'shop',
    engine: 'postgresql',
    status: 'ready',
    ...overrides,
  }
}

function local(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: 'shop',
    engine: 'postgresql',
    version: '17',
    status: 'running',
    port: 5432,
    ...overrides,
  }
}

function row(overrides: Partial<TuiRow> = {}): TuiRow {
  return {
    id: 'shop',
    source: 'local',
    name: 'shop',
    engine: 'postgresql',
    version: '17',
    status: 'running',
    parentName: null,
    detail: '5432',
    linked: false,
    expiresAt: null,
    sizeBytes: null,
    serverPool: null,
    meta: [],
    ...overrides,
  }
}

test('cloud placement is shared or dedicated, never guessed', () => {
  const nodes = cloudNodes([
    cloud({ id: 'db_d', name: 'layerbase', serverPool: 'dedicated' }),
    cloud({ id: 'db_s', name: 'shared-db', serverPool: 'shared' }),
    cloud({ id: 'db_x', name: 'older', serverPool: 'nope' }),
  ])
  const pools = new Map(
    nodes.map((node) => [node.row.name, node.row.serverPool]),
  )
  assert.equal(pools.get('layerbase'), 'dedicated')
  assert.equal(pools.get('shared-db'), 'shared')
  assert.equal(pools.get('older'), null)
  assert.equal(serverPoolOf(undefined), null)
})

test('cloud list nests a branch under its parent', () => {
  const nodes = cloudNodes([
    cloud(),
    cloud({
      id: 'db_2',
      name: 'shop-pr',
      parentId: 'db_1',
      parentName: 'shop',
    }),
  ])
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0]?.row.name, 'shop')
  assert.equal(nodes[0]?.children.length, 1)
  assert.equal(nodes[0]?.children[0]?.row.parentName, 'shop')
  assert.equal(flattenNodes(nodes).length, 2)
})

test('local branchParent nests the same way', () => {
  const nodes = localNodes(
    [
      local(),
      local({
        name: 'shop-pr',
        branchParent: 'shop',
        port: 5433,
      }),
    ],
    null,
  )
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0]?.children[0]?.row.name, 'shop-pr')
  assert.equal(nodes[0]?.children[0]?.row.parentName, 'shop')
})

test('branch list tree order wins over the flat list', () => {
  const nodes = localNodes(
    [local({ name: 'b', branchParent: 'a' }), local({ name: 'a' })],
    [{ name: 'a', children: [{ name: 'b', children: [] }] }],
  )
  assert.deepEqual(
    flattenNodes(nodes).map((item) => item.name),
    ['a', 'b'],
  )
})

test('file engine running displays as available, server status stays', () => {
  assert.equal(
    statusLabel(row({ engine: 'sqlite', status: 'running' })),
    'available',
  )
  assert.equal(
    statusLabel(row({ engine: 'sqlite', status: 'stopped' })),
    'missing',
  )
  assert.equal(statusLabel(row({ status: 'running' })), 'running')
  assert.equal(statusLabel(row({ status: 'stopped' })), 'stopped')
})

test('a remote local row stays local and displays as linked', () => {
  const nodes = localNodes(
    [
      local({
        remote: { provider: 'layerbase', host: 'db.example' },
      }),
    ],
    null,
  )
  const item = nodes[0]?.row
  assert.equal(item?.source, 'local')
  assert.equal(item?.linked, true)
  assert.equal(item ? statusLabel(item) : '', 'linked')
  assert.equal(item?.detail, 'layerbase')
})

test('invalid JSON throws and does not exit', () => {
  assert.throws(() => parseJsonDocument('not json'), TuiParseError)
  assert.deepEqual(parseJsonDocument('noise\n[{"name":"a"}]'), [{ name: 'a' }])
})

test('selection id survives a reload that reorders rows', () => {
  const before = [row({ id: 'a', name: 'a' }), row({ id: 'b', name: 'b' })]
  const after = [row({ id: 'b', name: 'b' }), row({ id: 'a', name: 'a' })]
  assert.equal(keepSelection(after, rowKey(before[1] as TuiRow), 1), 'local:b')
})

test('a missing selection falls back to the nearest index', () => {
  const rows = [row({ id: 'a', name: 'a' }), row({ id: 'c', name: 'c' })]
  assert.equal(keepSelection(rows, 'local:gone', 1), 'local:c')
})

test('byte sizes and api-key errors stay short', () => {
  assert.equal(formatBytes(8.2 * 1024 * 1024), '8.2 MB')
  assert.equal(formatBytes(16.8 * 1024 * 1024), '16.8 MB')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(
    shortProblem(
      'Invalid or revoked API key. Create a new one at https://layerbase.com/cloud/settings.',
    ),
    'Key rejected. lbase login --api-key',
  )
})

test('slice keeps the selected row inside the window', () => {
  const lines = Array.from({ length: 10 }, (_, index) => ({
    key: `local:${index}`,
    text: String(index),
    dim: false,
  }))
  const visible = sliceLines(lines, 'local:8', 3)
  assert.ok(visible.some((line) => line.key === 'local:8'))
  assert.equal(visible.length, 3)
})

test('connect is blocked for a stopped local server and open for a linked row', () => {
  assert.match(
    connectBlockReason(row({ status: 'stopped' })) ?? '',
    /lbase start shop/,
  )
  assert.equal(
    connectBlockReason(row({ linked: true, status: 'stopped' })),
    null,
  )
})
