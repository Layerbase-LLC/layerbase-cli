import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  redactConnectionUri,
  redactConnectionUris,
  redactSecrets,
} from '@/lib/redact'

// Issue #53: `cloud ls --json` printed every database's connection string with
// the live password in it, so any transcript, CI log or support paste carried
// working credentials. Redaction is the default now; --show-secrets opts out.

test('redacts the password in every engine URI shape the CLI prints', () => {
  const cases: [string, string][] = [
    [
      'postgresql://shop:s3cr3t@db.layerbase.dev:5432/shop',
      'postgresql://shop:****@db.layerbase.dev:5432/shop',
    ],
    [
      'postgres://shop:s3cr3t@db.layerbase.dev:5432/shop?sslmode=require',
      'postgres://shop:****@db.layerbase.dev:5432/shop?sslmode=require',
    ],
    [
      'mysql://root:hunter2@db.layerbase.dev:3306/app',
      'mysql://root:****@db.layerbase.dev:3306/app',
    ],
    [
      'redis://default:tok3n@db.layerbase.dev:6379',
      'redis://default:****@db.layerbase.dev:6379',
    ],
    [
      'rediss://default:tok3n@db.layerbase.dev:6379/0',
      'rediss://default:****@db.layerbase.dev:6379/0',
    ],
    [
      'mongodb://app:p%40ss@db.layerbase.dev:27017/app?authSource=admin',
      'mongodb://app:****@db.layerbase.dev:27017/app?authSource=admin',
    ],
    [
      'mongodb+srv://app:p%40ss@cluster.layerbase.dev/app',
      'mongodb+srv://app:****@cluster.layerbase.dev/app',
    ],
  ]
  for (const [raw, expected] of cases) {
    assert.equal(redactConnectionUri(raw), expected, raw)
  }
})

test('keeps everything that is not the password', () => {
  // A redacted string still has to identify WHICH database on WHICH box a
  // script was pointed at, or it is useless in a support thread.
  const redacted = redactConnectionUri(
    'postgresql://shop:s3cr3t@fjord-falcon.layerbase.dev:5432/shop',
  )
  assert.match(redacted, /shop@?/)
  assert.match(redacted, /fjord-falcon\.layerbase\.dev:5432\/shop/)
  assert.doesNotMatch(redacted, /s3cr3t/)
})

test('handles a password with URI punctuation in it', () => {
  // new URL() throws on some of these, and a redactor that throws on the messy
  // input is a redactor that leaks it.
  assert.equal(
    redactConnectionUri('postgresql://u:p@ss:w/rd@host:5432/db'),
    'postgresql://u:****@host:5432/db',
  )
  assert.equal(
    redactConnectionUri('mysql://u:!$%^&*()@host:3306/db'),
    'mysql://u:****@host:3306/db',
  )
  assert.equal(
    redactConnectionUri('redis://default:a@b@c@host:6379'),
    'redis://default:****@host:6379',
  )
})

test('leaves a URI with no credentials alone', () => {
  for (const value of [
    'postgresql://db.layerbase.dev:5432/shop',
    'redis://db.layerbase.dev:6379',
    'https://layerbase.com/cloud/db_123',
    'not a uri at all',
    '',
  ]) {
    assert.equal(redactConnectionUri(value), value)
  }
})

test('redacts a password passed as a query parameter', () => {
  assert.equal(
    redactConnectionUri('postgresql://host:5432/db?user=shop&password=s3cr3t'),
    'postgresql://host:5432/db?user=shop&password=****',
  )
  // The value stops at the fragment marker: `#readonly` is not part of the
  // password, and swallowing it would lose information for no safety gain.
  assert.equal(
    redactConnectionUri('postgresql://host:5432/db?password=s3cr3t#readonly'),
    'postgresql://host:5432/db?password=****#readonly',
  )
})

test('walks a --json payload at any depth', () => {
  const payload = {
    ok: true,
    databases: [
      {
        id: 'db_1',
        name: 'shop-prod',
        connectionString: 'postgresql://shop:s3cr3t@host:5432/shop',
        nested: { uri: 'redis://default:tok3n@host:6379' },
      },
    ],
    count: 1,
    parentId: null,
  }
  const redacted = redactConnectionUris(payload)

  assert.equal(
    redacted.databases[0].connectionString,
    'postgresql://shop:****@host:5432/shop',
  )
  assert.equal(
    redacted.databases[0].nested.uri,
    'redis://default:****@host:6379',
  )
  // Shape, types and non-string values survive untouched: a script reading
  // .databases[0].id must still find it.
  assert.equal(redacted.databases[0].id, 'db_1')
  assert.equal(redacted.count, 1)
  assert.equal(redacted.parentId, null)
  assert.equal(redacted.ok, true)
  // And the original is not mutated.
  assert.match(payload.databases[0].connectionString, /s3cr3t/)
})

test('still redacts named secrets and bearer tokens', () => {
  // The pre-existing migrate-path behavior has to keep working.
  const text = redactSecrets('key abc123def used', ['abc123def'])
  assert.equal(text, 'key [redacted] used')
  assert.match(
    redactSecrets('Authorization: Bearer eyJhbGciOi', []),
    /Bearer \[redacted\]/,
  )
})
