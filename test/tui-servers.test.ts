import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseServerOptions } from '@/lib/cloud-api'
import {
  initialServerIndex,
  serverForCreate,
  showsServerStep,
  stepServerIndex,
} from '@/tui/servers'

const SHARED = {
  server: 'shared',
  name: 'Shared cloud',
  kind: 'shared' as const,
  accepting: true,
}
const BOX = {
  server: '12',
  name: 'Dedicated 8 GB (US East)',
  kind: 'dedicated' as const,
  accepting: true,
}
const BOX_DOWN = {
  server: '13',
  name: 'Dedicated 8 GB (EU West)',
  kind: 'dedicated' as const,
  accepting: false,
  reason: 'it is in maintenance',
}

test('parseServerOptions keeps the default and falls back on junk', () => {
  const parsed = parseServerOptions({
    serverOptions: [SHARED, { name: 'no value' }, BOX_DOWN],
    defaultServer: '12',
  })
  assert.deepEqual(
    parsed.serverOptions.map((o) => [o.server, o.accepting, o.reason]),
    [
      ['shared', true, undefined],
      ['13', false, 'it is in maintenance'],
    ],
  )
  assert.equal(parsed.defaultServer, '12')
  assert.deepEqual(parseServerOptions(null).serverOptions, [])
  assert.equal(parseServerOptions(null).defaultServer, null)
})

test('a single option skips the step and sends no server', () => {
  const one = { serverOptions: [SHARED], defaultServer: 'shared' }
  assert.equal(showsServerStep(one), false)
  assert.deepEqual(serverForCreate({ choice: one, index: 0 }), {
    ok: true,
    server: undefined,
  })
  assert.deepEqual(serverForCreate({ choice: null, index: null }), {
    ok: true,
    server: undefined,
  })
})

test('the default is preselected and the explicit pick is sent', () => {
  const two = { serverOptions: [SHARED, BOX], defaultServer: '12' }
  assert.equal(initialServerIndex(two), 1)
  assert.deepEqual(serverForCreate({ choice: two, index: 0 }), {
    ok: true,
    server: 'shared',
  })
})

test('no usable default asks for a pick, and a non-accepting server is refused', () => {
  const must = { serverOptions: [SHARED, BOX, BOX_DOWN], defaultServer: null }
  assert.equal(initialServerIndex(must), null)
  assert.equal(serverForCreate({ choice: must, index: null }).ok, false)
  const down = serverForCreate({ choice: must, index: 2 })
  assert.equal(down.ok, false)
  assert.match(down.ok ? '' : down.message, /it is in maintenance/)
  const preferDown = { serverOptions: [SHARED, BOX_DOWN], defaultServer: '13' }
  assert.equal(initialServerIndex(preferDown), null)
})

test('stepping wraps and starts from either end when nothing is picked', () => {
  assert.equal(stepServerIndex({ count: 3, index: null, direction: 1 }), 0)
  assert.equal(stepServerIndex({ count: 3, index: null, direction: -1 }), 2)
  assert.equal(stepServerIndex({ count: 3, index: 2, direction: 1 }), 0)
  assert.equal(stepServerIndex({ count: 3, index: 0, direction: -1 }), 2)
})
