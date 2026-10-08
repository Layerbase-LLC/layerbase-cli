import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localNodes, sidebarLines } from '@/tui/model'
import { maskApiKey, signInGuide } from '@/tui/sign-in'

test('a tab lists only that source', () => {
  const nodes = localNodes(
    [
      {
        name: 'shop',
        engine: 'postgresql',
        version: '17',
        status: 'running',
        port: 5432,
      },
    ],
    null,
  )
  const lines = sidebarLines({
    nodes,
    empty: null,
    error: null,
    width: 40,
  })
  assert.equal(lines.length, 1)
  assert.equal(lines[0]?.text, 'shop')
  assert.equal(
    sidebarLines({
      nodes: [],
      empty: 'No cloud databases. c to create one.',
      error: 'Key rejected. lbase login --api-key',
      width: 80,
    })[0]?.text,
    'Key rejected. lbase login --api-key',
  )
})

test('the cloud tab explains sign-in without the settings url', () => {
  const lines = signInGuide({
    reason: 'rejected',
    keyFromEnv: false,
    step: 'choose',
    authUrl: null,
    error: null,
    width: 80,
  })
  assert.match(lines.join('\n'), /saved API key was rejected/)
  assert.match(lines.join('\n'), /enter {2}Sign in with your browser/)
  assert.equal(
    lines.some((line) => line.includes('layerbase.com')),
    false,
  )
})

test('an api key is masked except for the last four characters', () => {
  assert.equal(maskApiKey(''), '')
  const masked = maskApiKey('sk_live_secret_ab12')
  assert.equal(masked.endsWith('ab12'), true)
  assert.equal(masked.includes('secret'), false)
})
