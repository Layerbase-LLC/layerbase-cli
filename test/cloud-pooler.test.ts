import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  CloudApiError,
  configureCloudAuth,
  exitCodeForCloudError,
  syncPoolerUsers,
  type PoolerSyncResult,
} from '@/lib/cloud-api'
import { reportError } from '@/lib/cli-output'
import { formatPoolerSyncReport } from '@/commands/cloud-pooler'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  configureCloudAuth({})
})

function result(overrides: Partial<PoolerSyncResult>): PoolerSyncResult {
  return {
    databaseId: 'db_1',
    applied: true,
    synced: [],
    skipped: [],
    warnings: [],
    poolers: [{ pooler: 'pgbouncer', applied: true, detail: 'reloaded' }],
    ...overrides,
  }
}

type Captured = { url: string; init: RequestInit | undefined }

function stubFetch(response: Response): Captured[] {
  const calls: Captured[] = []
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return response
  }) as typeof fetch
  return calls
}

test('syncPoolerUsers POSTs to the pooler sync route with the API key and no body', async () => {
  configureCloudAuth({ apiKey: 'sk_test' })
  const body = result({ synced: [{ username: 'app' }] })
  const calls = stubFetch(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )

  const out = await syncPoolerUsers('db 1')

  assert.equal(calls.length, 1)
  assert.equal(
    new URL(calls[0]!.url).pathname,
    '/v1/databases/db%201/pooler/sync-users',
  )
  assert.equal(calls[0]!.init?.method, 'POST')
  assert.equal(calls[0]!.init?.body, undefined)
  const headers = calls[0]!.init?.headers as Record<string, string>
  assert.equal(headers.authorization, 'Bearer sk_test')
  assert.deepEqual(out, body)
})

test('a cooldown 429 carries retryAfterSeconds into the message, the JSON error and exit 6', async () => {
  configureCloudAuth({ apiKey: 'sk_test' })
  stubFetch(
    new Response(
      JSON.stringify({
        error: 'A pooler sync ran moments ago.',
        code: 'pooler_sync_cooldown',
        retryAfterSeconds: 7.2,
      }),
      { status: 429 },
    ),
  )

  const error = await syncPoolerUsers('db_1').catch((caught: unknown) => caught)
  assert.ok(error instanceof CloudApiError)
  assert.equal(
    error.message,
    'A pooler sync ran moments ago. Try again in 8 seconds.',
  )
  assert.equal(exitCodeForCloudError(error.info), 6)

  const written: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  let code: number
  try {
    code = reportError(error, true)
  } finally {
    process.stdout.write = original
  }
  assert.equal(code, 6)
  const payload = JSON.parse(written.join(''))
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'pooler_sync_cooldown')
  assert.equal(payload.retryAfterSeconds, 7.2)
})

test('JSON errors without retryAfterSeconds keep their existing shape', () => {
  const written: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    reportError(
      new CloudApiError({
        status: 400,
        code: 'engine_not_supported',
        message: 'Cloud API 400: not supported',
        body: { error: 'not supported', code: 'engine_not_supported' },
      }),
      true,
    )
  } finally {
    process.stdout.write = original
  }
  assert.deepEqual(Object.keys(JSON.parse(written.join(''))), [
    'ok',
    'error',
    'code',
    'status',
  ])
})

test('report lists synced users, skips and warnings with details verbatim', () => {
  const dropStatement = "DROP USER ''@'localhost';"
  const report = formatPoolerSyncReport({
    ref: 'shop',
    result: result({
      synced: [{ username: 'app' }, { username: 'reporting' }],
      skipped: [
        {
          username: 'legacy',
          reason: 'no_password',
          detail: 'Set a password with ALTER USER, then sync again.',
        },
      ],
      warnings: [
        {
          username: 'app',
          reason: 'shadowed_by_anonymous_account',
          detail: `Remove the anonymous account: ${dropStatement}`,
        },
      ],
    }),
  })

  assert.deepEqual(report.stdout, [
    'Synced 2 users to the pooler for shop:',
    '  app',
    '  reporting',
    '',
    'Skipped 1 user:',
    '  legacy (no_password): Set a password with ALTER USER, then sync again.',
    '',
    'Warnings:',
    `  app (shadowed_by_anonymous_account): Remove the anonymous account: ${dropStatement}`,
  ])
  assert.deepEqual(report.stderr, [])
})

test('report says so when nothing synced', () => {
  const report = formatPoolerSyncReport({ ref: 'shop', result: result({}) })
  assert.deepEqual(report.stdout, ['No users synced to the pooler for shop.'])
})

test('applied false prints a retry notice with each pooler that did not apply', () => {
  const report = formatPoolerSyncReport({
    ref: 'shop',
    result: result({
      applied: false,
      synced: [{ username: 'app' }],
      poolers: [
        { pooler: 'pgbouncer', applied: true, detail: 'reloaded' },
        {
          pooler: 'host-pgbouncer',
          applied: false,
          detail: 'pooler is not running',
        },
      ],
    }),
  })
  assert.equal(report.stderr.length, 2)
  assert.match(report.stderr[0]!, /next starts/)
  assert.match(report.stderr[0]!, /again to retry/)
  assert.equal(report.stderr[1], '  host-pgbouncer: pooler is not running')
})
