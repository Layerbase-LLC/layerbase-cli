import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIGRATION_CATALOG,
  catalogSourceIds,
  getCatalogSource,
} from '@/lib/migration-catalog'
import { redactSecrets } from '@/lib/redact'

// ─── Catalog integrity ──────────────────────────────────────────────────────

test('catalog: exposes every documented source id', () => {
  const ids = catalogSourceIds()
  const expected = [
    'neon',
    'supabase',
    'render',
    'railway',
    'postgres',
    'mysql',
    'mariadb',
    'planetscale',
    'upstash',
    'vercel-kv',
    'redis',
    'valkey',
    'algolia',
    'turso',
  ]
  assert.deepEqual([...ids].sort(), [...expected].sort())
})

test('catalog: api-key sources declare a provider and a source key', () => {
  for (const source of MIGRATION_CATALOG) {
    if (source.kind === 'api-key') {
      assert.ok(source.provider, `${source.id} api-key source needs a provider`)
      assert.ok(
        source.credentials.sourceKey,
        `${source.id} api-key source needs a sourceKey credential`,
      )
    } else {
      assert.equal(
        source.provider,
        undefined,
        `${source.id} connection-string source must not set a provider`,
      )
      assert.ok(
        source.credentials.connectionString,
        `${source.id} paste source needs a connectionString credential`,
      )
    }
  }
})

test('catalog: connection-string sources never require an api key', () => {
  for (const source of MIGRATION_CATALOG) {
    if (source.kind === 'connection-string') {
      assert.equal(source.credentials.sourceKey, undefined)
      assert.equal(source.credentials.sourceId, undefined)
      assert.equal(source.credentials.sourceSecret, undefined)
    }
  }
})

test('catalog: known credential shapes match the cloud contract', () => {
  // Supabase is the only source needing a user-supplied secret (db password).
  assert.ok(getCatalogSource('supabase')?.credentials.sourceSecret)
  assert.equal(getCatalogSource('neon')?.credentials.sourceSecret, undefined)
  // Two-part-key sources carry a sourceId (apiKeyId).
  for (const id of ['planetscale', 'upstash', 'algolia', 'turso']) {
    assert.ok(
      getCatalogSource(id)?.credentials.sourceId,
      `${id} needs a sourceId credential`,
    )
  }
  // Single-key sources do not.
  for (const id of ['neon', 'render', 'railway']) {
    assert.equal(getCatalogSource(id)?.credentials.sourceId, undefined)
  }
})

test('catalog: every source has at least one target engine', () => {
  for (const source of MIGRATION_CATALOG) {
    assert.ok(source.targetEngines.length > 0, `${source.id} needs a target`)
  }
})

test('catalog: getCatalogSource is undefined for an unknown id', () => {
  assert.equal(getCatalogSource('mongodb'), undefined)
})

// ─── Credential redaction ───────────────────────────────────────────────────

test('redactSecrets: masks a known secret value', () => {
  const out = redactSecrets('failed for key napi_abc123def', ['napi_abc123def'])
  assert.ok(!out.includes('napi_abc123def'))
  assert.ok(out.includes('[redacted]'))
})

test('redactSecrets: masks connection strings even when not passed', () => {
  const out = redactSecrets('could not reach postgresql://u:p@host:5432/db', [])
  assert.ok(!out.includes('host:5432'))
  assert.ok(out.includes('[redacted connection string]'))
})

test('redactSecrets: masks redis, libsql and bearer tokens', () => {
  assert.ok(!redactSecrets('rediss://x:y@h:6379', []).includes('6379'))
  assert.ok(
    redactSecrets('libsql://db.turso.io?authToken=z', []).includes(
      '[redacted connection string]',
    ),
  )
  assert.ok(
    redactSecrets('Authorization: Bearer sk_live_123', []).includes(
      'Bearer [redacted]',
    ),
  )
})

test('redactSecrets: ignores empty/short secrets so real text survives', () => {
  const out = redactSecrets('all good here', ['', '  ', 'ab'])
  assert.equal(out, 'all good here')
})
