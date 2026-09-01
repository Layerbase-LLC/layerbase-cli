import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCreateDatabaseBody,
  pickApiKey,
  pickWebAppBaseUrl,
  exitCodeForStatus,
} from '@/lib/cloud-api'

test('pickApiKey: flag wins over env and stored', () => {
  assert.equal(
    pickApiKey({ flag: 'sk_flag', env: 'sk_env', stored: 'sk_stored' }),
    'sk_flag',
  )
})

test('pickApiKey: env wins over stored when no flag', () => {
  assert.equal(
    pickApiKey({ flag: undefined, env: 'sk_env', stored: 'sk_stored' }),
    'sk_env',
  )
})

test('pickApiKey: stored used when no flag or env', () => {
  assert.equal(
    pickApiKey({ flag: undefined, env: undefined, stored: 'sk_stored' }),
    'sk_stored',
  )
})

test('pickApiKey: undefined when no source', () => {
  assert.equal(
    pickApiKey({ flag: undefined, env: undefined, stored: null }),
    undefined,
  )
  assert.equal(pickApiKey({}), undefined)
})

test('pickApiKey: empty strings are ignored (falsy)', () => {
  assert.equal(pickApiKey({ flag: '', env: 'sk_env' }), 'sk_env')
})

test('exitCodeForStatus: distinct codes per failure class', () => {
  assert.equal(exitCodeForStatus(401), 3)
  assert.equal(exitCodeForStatus(402), 4)
  assert.equal(exitCodeForStatus(409), 5)
  assert.equal(exitCodeForStatus(429), 6)
  assert.equal(exitCodeForStatus(400), 1)
  assert.equal(exitCodeForStatus(500), 1)
})

test('pickWebAppBaseUrl: --api-url wins over the logged-in host and the default', () => {
  assert.equal(
    pickWebAppBaseUrl({
      flag: 'https://dev.layerbase.com',
      stored: 'https://layerbase.com',
      fallback: 'https://layerbase.com',
    }),
    'https://dev.layerbase.com',
  )
})

test('pickWebAppBaseUrl: the logged-in host wins over the default', () => {
  assert.equal(
    pickWebAppBaseUrl({
      stored: 'https://dev.layerbase.com',
      fallback: 'https://layerbase.com',
    }),
    'https://dev.layerbase.com',
  )
})

test('pickWebAppBaseUrl: falls back when nothing is configured', () => {
  assert.equal(
    pickWebAppBaseUrl({ stored: null, fallback: 'https://layerbase.com' }),
    'https://layerbase.com',
  )
  assert.equal(typeof pickWebAppBaseUrl({}), 'string')
})

// ─── Create body (provenance) ───────────────────────────────────────────────

test('create body: no source key at all when none is supplied', () => {
  const body = buildCreateDatabaseBody({ name: 'my-db', engine: 'postgresql' })
  assert.deepEqual(body, { engine: 'postgresql', name: 'my-db' })
  assert.equal('source' in body, false)
})

test('create body: version travels when resolved and is omitted when not', () => {
  // Omitting the key is what makes the cloud pick its own default, so an empty
  // string must never be sent in its place: that fails create-time validation.
  assert.equal(
    buildCreateDatabaseBody({ name: 'a', engine: 'postgresql', version: '18' })
      .version,
    '18',
  )
  assert.equal(
    'version' in buildCreateDatabaseBody({ name: 'a', engine: 'postgresql' }),
    false,
  )
  assert.equal(
    'version' in
      buildCreateDatabaseBody({ name: 'a', engine: 'postgresql', version: '' }),
    false,
  )
})

test('create body: ttlHours is still only present when set', () => {
  assert.equal(
    'ttlHours' in buildCreateDatabaseBody({ name: 'a', engine: 'postgresql' }),
    false,
  )
  assert.equal(
    buildCreateDatabaseBody({ name: 'a', engine: 'postgresql', ttlHours: 2 })
      .ttlHours,
    2,
  )
})

test('create body: promote sends via and the source kind', () => {
  const body = buildCreateDatabaseBody({
    name: 'app',
    engine: 'sqlite',
    source: { via: 'promote', kind: 'sqlite' },
  })
  assert.deepEqual(body, {
    engine: 'sqlite',
    name: 'app',
    source: { via: 'promote', kind: 'sqlite' },
  })
})

test('create body: every promote source kind survives the sanitizer', () => {
  for (const kind of ['sqlite', 'duckdb', 'sql-dump', 'spindb']) {
    const body = buildCreateDatabaseBody({
      name: 'app',
      engine: 'postgresql',
      source: { via: 'promote', kind },
    })
    assert.deepEqual(body.source, { via: 'promote', kind })
  }
})

test('create body: a plain CLI create sends via with no kind', () => {
  const body = buildCreateDatabaseBody({
    name: 'app',
    engine: 'postgresql',
    source: { via: 'cli' },
  })
  assert.deepEqual(body.source, { via: 'cli' })
})

test('create body: an unusable kind is dropped, the via is kept', () => {
  for (const kind of ['', 'SQLite', 'sql dump', 'x'.repeat(33)]) {
    const body = buildCreateDatabaseBody({
      name: 'app',
      engine: 'postgresql',
      source: { via: 'promote', kind },
    })
    assert.deepEqual(body.source, { via: 'promote' }, `kind: ${kind}`)
  }
})

// The PII guard: a path or a local container name must be structurally
// impossible to ship as a kind, whatever a future caller passes.
test('create body: nothing path-like can travel as a source kind', () => {
  const paths = [
    '/Users/bob/dev/app.db',
    './app.db',
    '../data/analytics.duckdb',
    '~/notes.sqlite',
    'C:\\Users\\bob\\app.db',
    'app.db',
    'my-local-pg container',
  ]
  for (const kind of paths) {
    const body = buildCreateDatabaseBody({
      name: 'app',
      engine: 'postgresql',
      source: { via: 'promote', kind },
    })
    assert.deepEqual(body.source, { via: 'promote' }, `kind: ${kind}`)
    assert.equal(JSON.stringify(body).includes(kind), false)
  }
})

test('create body: an unusable via drops the whole source block', () => {
  for (const via of ['', 'Promote', 'via with spaces', '/tmp/promote']) {
    const body = buildCreateDatabaseBody({
      name: 'app',
      engine: 'postgresql',
      source: { via, kind: 'sqlite' },
    })
    assert.equal('source' in body, false, `via: ${via}`)
  }
})
