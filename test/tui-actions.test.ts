import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickErrorLine } from '@/tui/actions'
import { missingEngineBinary } from '@/tui/binary'
import { engineLabel } from '@/tui/engines'
import {
  cloudPageUrl,
  connectionStringFromJson,
  desktopExec,
} from '@/tui/launch'
import { nextPort } from '@/tui/ports'
import { cloudNodes, localNodes, type TuiRow } from '@/tui/model'
import { actionMenu, powerToggle } from '@/tui/row-actions'
import type { CloudDatabase } from '@/lib/cloud-api'

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

const paidKey = { paid: true, cloudKey: true }
const freeKey = { paid: false, cloudKey: true }

test('a running local server can stop, connect, and branch', () => {
  const menu = actionMenu(row(), paidKey)
  assert.deepEqual(
    menu.actions.map((action) => action.id),
    ['connect', 'stop', 'branch', 'copy'],
  )
  const withDesktop = actionMenu(row(), { ...paidKey, desktop: true })
  assert.equal(
    withDesktop.actions.some((action) => action.id === 'desktop'),
    true,
  )
  const toggle = powerToggle(row(), paidKey)
  assert.equal('id' in toggle && toggle.id, 'stop')
})

test('a stopped local server offers start, and a file does not', () => {
  const stopped = powerToggle(row({ status: 'stopped' }), paidKey)
  assert.equal('id' in stopped && stopped.id, 'start')
  const file = actionMenu(row({ engine: 'sqlite', status: 'running' }), paidKey)
  assert.deepEqual(
    file.actions.map((action) => action.id),
    ['connect', 'branch', 'copy'],
  )
  assert.equal(
    'message' in powerToggle(row({ engine: 'sqlite' }), paidKey),
    true,
  )
})

test('cloud wake is offered only when hibernated on a paid plan', () => {
  const hibernated = row({
    source: 'cloud',
    status: 'hibernated',
    serverPool: 'dedicated',
  })
  assert.deepEqual(
    actionMenu(hibernated, paidKey).actions.map((action) => action.id),
    ['connect', 'wake', 'branch', 'copy', 'web', 'query'],
  )
  const toggle = powerToggle(hibernated, paidKey)
  assert.equal('id' in toggle && toggle.id, 'wake')
  const free = actionMenu(hibernated, freeKey)
  assert.equal(
    free.actions.some((action) => action.id === 'wake'),
    false,
  )
  assert.match(free.note ?? '', /paid/)
  assert.equal('message' in powerToggle(hibernated, freeKey), true)
})

test('a running cloud database can stop or hibernate', () => {
  const menu = actionMenu(row({ source: 'cloud', status: 'running' }), paidKey)
  assert.deepEqual(
    menu.actions.map((action) => action.id),
    ['connect', 'stop', 'hibernate', 'branch', 'copy', 'web', 'query'],
  )
  assert.equal(
    menu.actions.find((action) => action.id === 'web')?.label,
    'Open in Layerbase Web',
  )
  assert.equal(
    menu.actions.find((action) => action.id === 'query')?.label,
    'Query in Web IDE',
  )
})

test('cloud pages use the database id, and a redacted string is not copied', () => {
  assert.equal(
    cloudPageUrl({ id: 'db/1', page: 'dashboard' }),
    'https://cloud.layerbase.com/cloud/db%2F1',
  )
  assert.equal(
    cloudPageUrl({ id: 'db_1', page: 'query' }),
    'https://cloud.layerbase.com/cloud/db_1/query',
  )
  const hidden = connectionStringFromJson(
    JSON.stringify({ connectionString: 'postgresql://user:***@host/db' }),
  )
  assert.equal(hidden.ok, false)
  const ready = connectionStringFromJson(
    JSON.stringify(
      { connectionString: 'postgresql://user:secret@127.0.0.1/app' },
      null,
      2,
    ),
  )
  assert.equal(ready.ok && ready.value.includes('secret'), true)
  const desktop = desktopExec(
    [
      '[Desktop Entry]',
      'StartupWMClass=layerbase-desktop',
      'Exec=/opt/Layerbase/layerbase %U',
    ].join('\n'),
  )
  assert.equal(desktop, '/opt/Layerbase/layerbase')
  assert.equal(desktopExec('Exec=/usr/bin/layerbase\n'), null)
})

test('a missing engine binary is recognized, and a port error is not', () => {
  const mariadb = [
    'MariaDB server binary not found in /Users/bob/.spindb/bin/mariadb-10.11.16-darwin-arm64/bin/.',
    'Re-download the MariaDB binaries: spindb engines download mariadb',
  ].join('\n')
  assert.equal(missingEngineBinary(mariadb), true)
  assert.equal(engineLabel('mariadb'), 'MariaDB')
  assert.equal(missingEngineBinary('Port 3307 is in use by filmroom'), false)
  assert.equal(missingEngineBinary('spindb start failed'), false)
})

test('a busy port moves to the next free one, and pg_ctl noise is dropped', () => {
  const port = nextPort({
    range: { start: 5432, end: 5500 },
    avoid: 5435,
    reserved: [5432, 5433, 5434, 5435, 5436],
    isFree: () => true,
  })
  assert.equal(port, 5437)
  assert.equal(
    nextPort({
      range: { start: 5432, end: 5433 },
      avoid: 5432,
      reserved: [5432, 5433],
      isFree: () => true,
    }),
    null,
  )
  const stderr = [
    'pg_ctl: could not start server',
    'Examine the log output.',
  ].join('\n')
  assert.equal(
    pickErrorLine('', stderr, 'spindb start failed'),
    'spindb start failed',
  )
  assert.match(
    pickErrorLine(
      '',
      'pg_ctl start failed with code 1: FATAL: could not create any TCP/IP sockets\nExamine the log output.\n',
      'spindb start failed',
    ),
    /TCP\/IP sockets/,
  )
})

test('list fields that are safe to show land on the detail meta', () => {
  const local = localNodes(
    [
      {
        name: 'shop',
        engine: 'postgresql',
        version: '17',
        status: 'running',
        port: 5432,
        database: 'app',
        created: '2026-08-01T12:00:00.000Z',
        gitBranch: 'feat/shop',
        bindAddress: '0.0.0.0',
      },
    ],
    null,
  )
  const labels = new Map(
    local[0]?.row.meta.map((item) => [item.label, item.value]),
  )
  assert.equal(labels.get('Database'), 'app')
  assert.equal(labels.get('Git'), 'feat/shop')
  assert.equal(labels.get('Bind'), '0.0.0.0')
  assert.match(labels.get('Created') ?? '', /^2026-08-01 /)

  const cloud = cloudNodes([
    {
      id: 'db_1',
      name: 'layerbase',
      engine: 'postgresql',
      status: 'running',
      region: 'iad',
      created_at: '2026-08-01T00:00:00.000Z',
      hostname: 'layerbase.cloud.layerbase.dev',
      port: 5432,
      storageClass: 'zfs',
      memoryLimitMb: 512,
      serverPool: 'dedicated',
      connectionString: 'postgresql://user:secret@host/db',
    } as CloudDatabase,
  ])
  const cloudLabels = new Map(
    cloud[0]?.row.meta.map((item) => [item.label, item.value]),
  )
  assert.equal(cloudLabels.get('Host'), 'layerbase.cloud.layerbase.dev')
  assert.equal(cloudLabels.get('Port'), '5432')
  assert.equal(cloudLabels.get('Storage'), 'zfs')
  assert.equal(cloudLabels.get('Memory'), '512 MB')
  assert.equal(
    cloud[0]?.row.meta.some((item) => item.value.includes('secret')),
    false,
  )
})
