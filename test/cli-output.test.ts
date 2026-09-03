import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  forOutput,
  reportError,
  secretsRevealed,
  setRevealSecrets,
  writeJson,
} from '@/lib/cli-output'
import { printConnectionInfo } from '@/lib/format'

// The output boundary is where issue #53 is actually fixed: every --json
// payload and every error line the CLI writes passes through here, so a command
// that forgets to think about secrets is redacted rather than leaking.

const CONNECTION_STRING =
  'postgresql://shop:s3cr3t@fjord.layerbase.dev:5432/shop'

function capture(run: () => void): string {
  const written: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    run()
  } finally {
    process.stdout.write = original
  }
  return written.join('')
}

function captureStderr(run: () => void): string {
  const written: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    run()
  } finally {
    process.stderr.write = original
  }
  return written.join('')
}

afterEach(() => setRevealSecrets(false))

test('redaction is the default, with nothing opted in', () => {
  assert.equal(secretsRevealed(), false)
  const out = capture(() =>
    writeJson([{ id: 'db_1', connectionString: CONNECTION_STRING }]),
  )
  assert.doesNotMatch(out, /s3cr3t/)
  assert.match(
    out,
    /postgresql:\/\/shop:\*\*\*\*@fjord\.layerbase\.dev:5432\/shop/,
  )
  assert.match(out, /"id": "db_1"/)
})

test('--show-secrets prints the password in full', () => {
  setRevealSecrets(true)
  const out = capture(() =>
    writeJson([{ id: 'db_1', connectionString: CONNECTION_STRING }]),
  )
  assert.match(out, /s3cr3t/)
})

test('the same switch governs the human-readable prints', () => {
  assert.equal(
    forOutput(CONNECTION_STRING),
    'postgresql://shop:****@fjord.layerbase.dev:5432/shop',
  )
  setRevealSecrets(true)
  assert.equal(forOutput(CONNECTION_STRING), CONNECTION_STRING)
})

test('an error that echoes a connection string is redacted too', () => {
  const json = capture(() =>
    reportError(new Error(`could not connect to ${CONNECTION_STRING}`), true),
  )
  assert.doesNotMatch(json, /s3cr3t/)

  const human = captureStderr(() =>
    reportError(new Error(`could not connect to ${CONNECTION_STRING}`), false),
  )
  assert.doesNotMatch(human, /s3cr3t/)
  assert.match(human, /could not connect to/)
})

test('the discrete credential fields are redacted in --json too', () => {
  // The shape cloud ls returns for a Valkey row: restToken IS the password.
  const out = capture(() =>
    writeJson([
      {
        id: 'db_1',
        engine: 'valkey',
        password: 's3cr3tpw',
        restToken: 's3cr3tpw',
        connectionString: 'redis://default:s3cr3tpw@host:6379',
      },
    ]),
  )
  assert.doesNotMatch(out, /s3cr3tpw/)
  assert.match(out, /"password": "\*\*\*\*"/)
  assert.match(out, /"restToken": "\*\*\*\*"/)
})

test('--print honors the same switch as everything else', () => {
  const info = {
    engine: 'postgresql',
    host: 'fjord.layerbase.dev',
    port: 5432,
    database: 'shop',
    username: 'shop',
    password: 's3cr3tpw',
    tls: true,
  }
  const masked = capture(() => printConnectionInfo(info))
  assert.doesNotMatch(masked, /s3cr3tpw/)
  assert.match(masked, /password {2}\*\*\*\*/)

  setRevealSecrets(true)
  const revealed = capture(() => printConnectionInfo(info))
  assert.match(revealed, /s3cr3tpw/)
})
