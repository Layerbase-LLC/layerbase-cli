import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  redactConnectionUri,
  redactJsonSecrets,
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
  // script was pointed at, or it is useless in a support thread. Asserted as
  // the whole string: the previous version matched /shop@?/, which the `shop`
  // in the PATH satisfied even if the username had been eaten.
  assert.equal(
    redactConnectionUri(
      'postgresql://shop:s3cr3t@fjord-falcon.layerbase.dev:5432/shop',
    ),
    'postgresql://shop:****@fjord-falcon.layerbase.dev:5432/shop',
  )
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
  const redacted = redactJsonSecrets(payload)

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

test('leaves a URI that has no password alone', () => {
  // `+` not `*` on the password class: a mask here would claim a password the
  // caller was never given.
  assert.equal(
    redactConnectionUri('postgresql://user:@host:5432/db'),
    'postgresql://user:@host:5432/db',
  )
})

test('does not let two connection strings on one line collapse', () => {
  // Greedy matching across a comma took the first host and the whole second
  // URI with it, so the output named neither database.
  assert.equal(
    redactConnectionUri('postgresql://a:p1@h1:5432/d1,mysql://b:p2@h2:3306/d2'),
    'postgresql://a:****@h1:5432/d1,mysql://b:****@h2:3306/d2',
  )
  assert.equal(
    redactConnectionUri('postgresql://a:p1@h1:5432/d1 mysql://b:p2@h2:3306/d2'),
    'postgresql://a:****@h1:5432/d1 mysql://b:****@h2:3306/d2',
  )
})

test('redacts credentials carried as other query parameters', () => {
  // A Redis REST endpoint carries ?token=, several migrate sources ?api_key=.
  assert.equal(
    redactConnectionUri('https://db.upstash.io/get/key?token=AX4gASQ'),
    'https://db.upstash.io/get/key?token=****',
  )
  assert.equal(
    redactConnectionUri('https://api.example.com/v1?api_key=k_123&x=1'),
    'https://api.example.com/v1?api_key=****&x=1',
  )
})

test('redacts the discrete credential fields, not just the URI', () => {
  // Issue #53 round two. The cloud returns the SAME password through several
  // keys: restToken (Redis/Valkey) and psPassword (MySQL/MariaDB) are literally
  // db.password. Masking only the connection string printed a mask directly
  // above a working credential, which reads as safe and is not.
  const wire = {
    id: 'db_1',
    name: 'cache-prod',
    engine: 'valkey',
    status: 'running',
    username: 'default',
    password: 's3cr3tpw',
    connectionString: 'redis://default:s3cr3tpw@fjord.layerbase.dev:6379',
    restUrl: 'https://fjord-rest.layerbase.dev',
    restToken: 's3cr3tpw',
    psUrl: 'https://fjord-ps.layerbase.dev',
    psUsername: 'app',
    psPassword: 's3cr3tpw',
  }
  const redacted = redactJsonSecrets(wire)

  assert.equal(redacted.password, '****')
  assert.equal(redacted.restToken, '****')
  assert.equal(redacted.psPassword, '****')
  assert.equal(
    redacted.connectionString,
    'redis://default:****@fjord.layerbase.dev:6379',
  )
  // Everything that is NOT a credential survives, including the two URLs that
  // tell you which endpoint the token belonged to.
  assert.equal(redacted.restUrl, 'https://fjord-rest.layerbase.dev')
  assert.equal(redacted.psUrl, 'https://fjord-ps.layerbase.dev')
  assert.equal(redacted.psUsername, 'app')
  assert.equal(redacted.username, 'default')
  assert.equal(redacted.engine, 'valkey')
  // And nothing anywhere in the payload still carries the secret.
  assert.doesNotMatch(JSON.stringify(redacted), /s3cr3tpw/)
})

test('leaves a withheld credential as the empty string it arrived as', () => {
  // The cloud sends password: '' (and connectionString: '') for a row whose
  // credentials are deliberately withheld - an admin with no support grant.
  // A mask there would invent a password the caller was never given.
  const redacted = redactJsonSecrets({
    id: 'db_2',
    password: '',
    connectionString: '',
    restToken: '',
  })
  assert.equal(redacted.password, '')
  assert.equal(redacted.connectionString, '')
  assert.equal(redacted.restToken, '')
})

test('matches a secret key however it is spelled', () => {
  const redacted = redactJsonSecrets({
    api_key: 'k_1',
    apiKey: 'k_2',
    'ACCESS-TOKEN': 't_1',
    sourceSecret: 's_1',
    // Not credentials: these must survive untouched.
    sourceId: 'neon',
    tokenId: 'tok_public_id',
    psUsername: 'app',
  })
  assert.equal(redacted.api_key, '****')
  assert.equal(redacted.apiKey, '****')
  assert.equal(redacted['ACCESS-TOKEN'], '****')
  assert.equal(redacted.sourceSecret, '****')
  assert.equal(redacted.sourceId, 'neon')
  assert.equal(redacted.tokenId, 'tok_public_id')
  assert.equal(redacted.psUsername, 'app')
})
