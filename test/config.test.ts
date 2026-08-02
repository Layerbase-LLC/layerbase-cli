import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickStoredApiKey } from '@/lib/config'

test('pickStoredApiKey: reads the key the browser login writes', () => {
  assert.equal(
    pickStoredApiKey({
      apiUrl: 'https://layerbase.com',
      token: 'jwt',
      apiKey: 'sk_abcd',
    }),
    'sk_abcd',
  )
})

test('pickStoredApiKey: reads a headless `login --api-key` key', () => {
  assert.equal(
    pickStoredApiKey({
      apiUrl: 'https://layerbase.com',
      apiKey: 'sk_headless',
    }),
    'sk_headless',
  )
})

test('pickStoredApiKey: heals a legacy cloudApiKey-only file (<= 1.2.0)', () => {
  assert.equal(
    pickStoredApiKey({
      apiUrl: 'https://layerbase.com',
      token: 'jwt',
      cloudApiKey: 'sk_legacy',
    }),
    'sk_legacy',
  )
})

test('pickStoredApiKey: apiKey wins over the legacy slot', () => {
  assert.equal(
    pickStoredApiKey({
      apiUrl: 'https://layerbase.com',
      apiKey: 'sk_current',
      cloudApiKey: 'sk_legacy',
    }),
    'sk_current',
  )
})

test('pickStoredApiKey: null when no key is stored', () => {
  assert.equal(pickStoredApiKey(null), null)
  assert.equal(pickStoredApiKey({ apiUrl: 'https://layerbase.com' }), null)
  assert.equal(
    pickStoredApiKey({ apiUrl: 'https://layerbase.com', cloudApiKey: null }),
    null,
  )
})

test('pickStoredApiKey: an empty stored key is not a credential', () => {
  assert.equal(
    pickStoredApiKey({
      apiUrl: 'https://layerbase.com',
      apiKey: '',
      cloudApiKey: 'sk_legacy',
    }),
    'sk_legacy',
  )
})
