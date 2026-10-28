import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  CloudApiError,
  EXIT_CAPACITY_RISK,
  describeCapacityPressure,
  exitCodeForCloudError,
  parseCapacityPressure,
} from '@/lib/cloud-api'
import {
  CAPACITY_RISK_WARNING,
  createWithCapacityConsent,
  decideCapacityRisk,
} from '@/lib/capacity-risk'

type Reply = { status: number; body: unknown }
type Recorded = { method: string; url: string; body: Record<string, unknown> }

const PRESSURE = {
  pressured: true,
  reasons: ['memory'],
  memoryPercent: 84.2,
  storagePercent: 31,
  scope: 'account',
  thresholds: { memoryPercent: 75, storagePercent: 85 },
}
const CAPACITY_REFUSAL: Reply = {
  status: 409,
  body: {
    code: 'capacity_risk_unacknowledged',
    error: 'Target is under memory pressure.',
    pressure: PRESSURE,
  },
}
const CREATED: Reply = {
  status: 201,
  body: { id: 'db-1', name: 'cap-db', engine: 'redis', status: 'running' },
}

let server: Server
let baseUrl = ''
let replies: Reply[] = []
let requests: Recorded[] = []

function handle(request: IncomingMessage, response: ServerResponse): void {
  let raw = ''
  request.on('data', (chunk: Buffer) => {
    raw += chunk.toString()
  })
  request.on('end', () => {
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
    })
    const reply = replies.shift() ?? { status: 500, body: { error: 'none' } }
    response.writeHead(reply.status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(reply.body))
  })
}

before(async () => {
  server = createServer(handle)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
})

after(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  replies = []
  requests = []
})

// The CLI runs as a real child process (stdin is /dev/null, so non-TTY): the
// node test runner reports over this process's stdout, so capturing it in
// process would corrupt the run.
const CLI = fileURLToPath(new URL('../src/cli.tsx', import.meta.url))

async function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
    env: {
      ...process.env,
      LAYERBASE_CLOUD_API_URL: baseUrl,
      LAYERBASE_API_KEY: 'sk_test_capacity',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const code = await new Promise<number>((resolve) =>
    child.on('close', (exit) => resolve(exit ?? -1)),
  )
  return { code, stdout, stderr }
}

test('cloud create: the body declares capacity warning support', async () => {
  replies = [CREATED]
  const result = await runCli([
    'cloud',
    'create',
    'cap-db',
    '--engine',
    'redis',
  ])
  assert.equal(result.code, 0)
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.method, 'POST')
  assert.equal(requests[0]?.url, '/v1/databases')
  assert.equal(requests[0]?.body.capacityWarningSupported, true)
  assert.equal('acknowledgeCapacityRisk' in (requests[0]?.body ?? {}), false)
})

test('cloud create: an older cloud that ignores the fields is unaffected', async () => {
  // A plain 201 with no capacity awareness: one request, normal output.
  replies = [CREATED]
  const result = await runCli([
    'cloud',
    'create',
    'cap-db',
    '--engine',
    'redis',
    '--accept-capacity-risk',
  ])
  assert.equal(result.code, 0)
  assert.equal(requests.length, 1)
  assert.match(result.stdout, /Created cap-db \(redis\)/)
  assert.doesNotMatch(result.stderr, /Capacity warning/)
})

test('cloud create: a non-TTY capacity refusal without the flag warns and exits 7, no retry', async () => {
  replies = [CAPACITY_REFUSAL, CREATED]
  const result = await runCli([
    'cloud',
    'create',
    'cap-db',
    '--engine',
    'redis',
  ])
  assert.equal(result.code, EXIT_CAPACITY_RISK)
  assert.equal(EXIT_CAPACITY_RISK, 7)
  assert.equal(requests.length, 1)
  assert.match(result.stderr, /Memory at 84\.2% used \(warning threshold 75%\)/)
  assert.match(result.stderr, /re-run with --accept-capacity-risk/i)
  assert.ok(result.stderr.includes(CAPACITY_RISK_WARNING))
  assert.doesNotMatch(result.stderr, /Storage at/)
})

test('cloud create: --json reports the capacity refusal as a JSON error with exit 7', async () => {
  replies = [CAPACITY_REFUSAL]
  const result = await runCli([
    'cloud',
    'create',
    'cap-db',
    '--engine',
    'redis',
    '--json',
  ])
  assert.equal(result.code, EXIT_CAPACITY_RISK)
  const payload = JSON.parse(result.stdout) as Record<string, unknown>
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'capacity_risk_unacknowledged')
  assert.equal(payload.status, 409)
  assert.equal(requests.length, 1)
})

test('cloud create: --accept-capacity-risk resends once with the acknowledgement', async () => {
  replies = [CAPACITY_REFUSAL, CREATED]
  const result = await runCli([
    'cloud',
    'create',
    'cap-db',
    '--engine',
    'redis',
    '--accept-capacity-risk',
  ])
  assert.equal(result.code, 0)
  assert.equal(requests.length, 2)
  assert.equal('acknowledgeCapacityRisk' in (requests[0]?.body ?? {}), false)
  assert.equal(requests[1]?.body.acknowledgeCapacityRisk, true)
  assert.equal(requests[1]?.body.capacityWarningSupported, true)
  assert.equal(requests[1]?.body.name, 'cap-db')
  assert.equal(requests[1]?.body.engine, 'redis')
  assert.match(result.stderr, /Memory at 84\.2% used/)
  assert.match(result.stdout, /Created cap-db/)
})

test('cloud create: a refused acknowledged resend is not retried again', async () => {
  replies = [CAPACITY_REFUSAL, CAPACITY_REFUSAL, CREATED]
  const result = await runCli([
    'cloud',
    'create',
    'cap-db',
    '--engine',
    'redis',
    '--accept-capacity-risk',
  ])
  assert.equal(result.code, EXIT_CAPACITY_RISK)
  assert.equal(requests.length, 2)
})

test('cloud create: a plain 409 still maps to exit 5 with its try-later message', async () => {
  replies = [
    {
      status: 409,
      body: {
        code: 'capacity_exhausted',
        error: 'No capacity right now. Try again shortly.',
      },
    },
  ]
  const result = await runCli([
    'cloud',
    'create',
    'cap-db',
    '--engine',
    'redis',
    '--accept-capacity-risk',
  ])
  assert.equal(result.code, 5)
  assert.equal(requests.length, 1)
  assert.match(result.stderr, /Try again shortly/)
  assert.doesNotMatch(result.stderr, /Capacity warning/)
})

test('consent: an interactive run asks, and Cancel creates nothing', async () => {
  let calls = 0
  let asked = 0
  const error = await createWithCapacityConsent({
    create: async (ack) => {
      calls++
      if (!ack) {
        throw new CloudApiError({
          status: 409,
          code: 'capacity_risk_unacknowledged',
          message: 'refused',
          body: CAPACITY_REFUSAL.body as Record<string, unknown>,
        })
      }
      return 'created'
    },
    acceptFlag: false,
    interactive: true,
    ask: async () => {
      asked++
      return 'cancel'
    },
    warn: () => {},
  }).catch((caught: unknown) => caught)
  assert.equal(asked, 1)
  assert.equal(calls, 1)
  assert.ok(error instanceof Error)
  assert.equal(
    exitCodeForCloudError({
      status: 409,
      code: 'capacity_risk_unacknowledged',
    }),
    7,
  )
})

test('decideCapacityRisk: flag accepts, TTY prompts, otherwise refuses', () => {
  assert.equal(
    decideCapacityRisk({ acceptFlag: true, interactive: false }),
    'accept',
  )
  assert.equal(
    decideCapacityRisk({ acceptFlag: false, interactive: true }),
    'prompt',
  )
  assert.equal(
    decideCapacityRisk({ acceptFlag: false, interactive: false }),
    'refuse',
  )
})

test('describeCapacityPressure: prints only what the response carries', () => {
  const lines = describeCapacityPressure(
    parseCapacityPressure({
      pressured: true,
      reasons: ['memory', 'storage'],
      memoryPercent: 91,
      storagePercent: null,
      scope: 'host',
      thresholds: { memoryPercent: 70 },
    }),
  )
  assert.deepEqual(lines, [
    'Memory at 91% used (warning threshold 70%) on the server',
    'Storage under pressure on the server',
  ])
  assert.deepEqual(describeCapacityPressure(parseCapacityPressure(undefined)), [
    'Resources under pressure',
  ])
})
