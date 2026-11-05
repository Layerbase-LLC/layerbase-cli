import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A throwaway HOME, set before the module loads, so no real stored login or
// key on this machine changes which path a create takes.
let home: string
let cloudApi: typeof import('@/lib/cloud-api')
const realFetch = globalThis.fetch
const calls: Array<{ url: string; body: unknown }> = []

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'lbase-home-'))
  process.env.HOME = home
  process.env.LAYERBASE_API_URL = 'https://web.example.com'
  process.env.LAYERBASE_CLOUD_API_URL = 'https://api.example.com'
  cloudApi = await import('@/lib/cloud-api')
  cloudApi.configureCloudAuth({ apiKey: 'sk_test' })
})

after(async () => {
  globalThis.fetch = realFetch
  await rm(home, { recursive: true, force: true })
})

function mockFetch(handler: (url: string) => Response): void {
  calls.length = 0
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return handler(url)
  }) as typeof fetch
}

test('a create goes to the web app, region included', async () => {
  mockFetch(() =>
    answer(201, {
      id: 'a',
      name: 'db',
      engine: 'postgresql',
      status: 'creating',
    }),
  )
  const result = await cloudApi.createDatabase({
    name: 'db',
    engine: 'postgresql',
    region: 'eu-west',
  })
  assert.equal(result.id, 'a')
  assert.deepEqual(
    calls.map((c) => c.url),
    ['https://web.example.com/api/cli/databases'],
  )
  assert.equal((calls[0]?.body as { region?: string }).region, 'eu-west')
})

test('a web app without the route falls back to the direct create', async () => {
  mockFetch((url) =>
    url.startsWith('https://web.example.com')
      ? new Response('Method Not Allowed', { status: 405 })
      : answer(201, {
          id: 'b',
          name: 'db',
          engine: 'postgresql',
          status: 'creating',
        }),
  )
  const result = await cloudApi.createDatabase({
    name: 'db',
    engine: 'postgresql',
  })
  assert.equal(result.id, 'b')
  assert.equal(calls[1]?.url, 'https://api.example.com/v1/databases')
})

test('--region never falls back to a create that would ignore it', async () => {
  mockFetch(() => new Response('Method Not Allowed', { status: 405 }))
  await assert.rejects(
    cloudApi.createDatabase({
      name: 'db',
      engine: 'postgresql',
      region: 'eu-west',
    }),
    /--region is not supported/,
  )
  assert.equal(calls.length, 1)
})

test("a server refusal is shown as the server's message, with no fallback", async () => {
  const message =
    'EU West requires a paid plan. Upgrade at https://layerbase.com/pricing or omit --region.'
  mockFetch(() => answer(402, { error: message, code: 'region_requires_plan' }))
  await assert.rejects(
    cloudApi.createDatabase({
      name: 'db',
      engine: 'postgresql',
      region: 'eu-west',
    }),
    (error: Error) => error.message === message,
  )
  assert.equal(calls.length, 1)
})

test('a per-database 404 on the API host is retried through the web app', async () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  mockFetch((url) =>
    url.startsWith('https://api.example.com')
      ? answer(404, { error: 'Database not found' })
      : answer(200, { id, status: 'stopped' }),
  )
  await cloudApi.stopDatabase(id)
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      `https://api.example.com/v1/databases/${id}/stop`,
      `https://web.example.com/api/cli/v1/databases/${id}/stop`,
    ],
  )
})
