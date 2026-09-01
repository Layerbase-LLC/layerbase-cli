import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIGRATION_CATALOG,
  catalogSourceIds,
  getCatalogSource,
  type MigrateEngine,
} from '@/lib/migration-catalog'
import { redactSecrets } from '@/lib/redact'

// ─── Catalog integrity ──────────────────────────────────────────────────────

// Mirror of the web MIGRATION_SOURCES ids (lib/cloud/migration-sources.ts),
// with the one deliberate rename: the web's generic `other` Postgres source is
// `postgres` here. When the web catalog gains a source, add it in both places.
const EXPECTED_SOURCE_IDS = [
  'neon',
  'netlify',
  'supabase',
  'render',
  'railway',
  'replit',
  'heroku',
  'digitalocean',
  'fly',
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
  'cloudflare-d1',
  'mongodb-atlas',
  'aiven',
  'crunchy-bridge',
]

test('catalog: exposes every documented source id', () => {
  const ids = catalogSourceIds()
  assert.deepEqual([...ids].sort(), [...EXPECTED_SOURCE_IDS].sort())
})

test('catalog: source ids are unique', () => {
  const ids = catalogSourceIds()
  assert.equal(new Set(ids).size, ids.length)
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
  for (const id of [
    'planetscale',
    'upstash',
    'algolia',
    'turso',
    'cloudflare-d1',
  ]) {
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

test('catalog: api-key providers match the cloud registry ids', () => {
  const cloudProviderIds = new Set([
    'neon',
    'upstash',
    'supabase',
    'render',
    'railway',
    'planetscale',
    'algolia',
    'turso',
    'cloudflare-d1',
  ])
  for (const source of MIGRATION_CATALOG) {
    if (source.kind !== 'api-key') continue
    assert.ok(
      cloudProviderIds.has(source.provider ?? ''),
      `${source.id} sends provider "${source.provider}", which the cloud does not know`,
    )
  }
})

test('catalog: every source has at least one target engine', () => {
  for (const source of MIGRATION_CATALOG) {
    assert.ok(source.targetEngines.length > 0, `${source.id} needs a target`)
  }
})

test('catalog: target engines stay inside the supported set', () => {
  const engines: MigrateEngine[] = [
    'postgresql',
    'mysql',
    'mariadb',
    'redis',
    'valkey',
    'meilisearch',
    'libsql',
    'ferretdb',
  ]
  const known = new Set<string>(engines)
  for (const source of MIGRATION_CATALOG) {
    for (const engine of source.targetEngines) {
      assert.ok(known.has(engine), `${source.id} targets unknown ${engine}`)
    }
    assert.equal(
      new Set(source.targetEngines).size,
      source.targetEngines.length,
      `${source.id} repeats a target engine`,
    )
  }
})

test('catalog: every source has a non-empty hint', () => {
  for (const source of MIGRATION_CATALOG) {
    assert.ok(source.hint.trim().length > 0, `${source.id} needs a hint`)
  }
})

test('catalog: the 2026-09-01 batch is connection-string only', () => {
  // Every source added in the September batch pastes a URL. None has a cloud
  // discovery adapter, so none may send a provider id.
  for (const id of [
    'heroku',
    'digitalocean',
    'netlify',
    'fly',
    'aiven',
    'crunchy-bridge',
    'replit',
    'mongodb-atlas',
  ]) {
    const source = getCatalogSource(id)
    assert.equal(source?.kind, 'connection-string', `${id} is a paste source`)
    assert.equal(source?.provider, undefined)
  }
})

test('catalog: MongoDB sources land on FerretDB', () => {
  assert.deepEqual(getCatalogSource('mongodb-atlas')?.targetEngines, [
    'ferretdb',
  ])
  assert.ok(
    getCatalogSource('digitalocean')?.targetEngines.includes('ferretdb'),
    'DigitalOcean Managed MongoDB imports into FerretDB',
  )
})

test('catalog: Aiven has no MariaDB target', () => {
  // hostdb's mariadb-dump cannot authenticate against a caching_sha2_password
  // source (the MySQL 8 default), so an Aiven service that copies cleanly into
  // MySQL dies in the dump tool on MariaDB. Tracked as C-164 in layerbase-cloud.
  const aiven = getCatalogSource('aiven')
  assert.ok(aiven?.targetEngines.includes('mysql'))
  assert.ok(!aiven?.targetEngines.includes('mariadb'))
})

test('catalog: dual-product sources carry both key-value targets', () => {
  // Heroku Key-Value Store and ReplDB are separate products behind the same
  // source id, so each source has to offer the key-value targets as well as
  // Postgres or the CLI would refuse a legitimate import.
  for (const id of ['heroku', 'replit']) {
    const targets = getCatalogSource(id)?.targetEngines ?? []
    for (const engine of ['postgresql', 'valkey', 'redis']) {
      assert.ok(targets.includes(engine as MigrateEngine), `${id} -> ${engine}`)
    }
  }
})

test('catalog: getCatalogSource is undefined for an unknown id', () => {
  assert.equal(getCatalogSource('mongodb'), undefined)
  assert.equal(getCatalogSource('other'), undefined)
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
