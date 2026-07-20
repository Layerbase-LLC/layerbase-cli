import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickApiKey, exitCodeForStatus } from '@/lib/cloud-api'

test('pickApiKey: flag wins over env and stored', () => {
  assert.equal(
    pickApiKey({ flag: 'sk_flag', env: 'sk_env', stored: 'sk_stored' }),
    'sk_flag',
  )
})

test('pickApiKey: env wins over stored when no flag', () => {
  assert.equal(
    pickApiKey({ flag: undefined, env: 'sk_env', stored: 'sk_stored' }),
    'sk_env',
  )
})

test('pickApiKey: stored used when no flag or env', () => {
  assert.equal(
    pickApiKey({ flag: undefined, env: undefined, stored: 'sk_stored' }),
    'sk_stored',
  )
})

test('pickApiKey: undefined when no source', () => {
  assert.equal(
    pickApiKey({ flag: undefined, env: undefined, stored: null }),
    undefined,
  )
  assert.equal(pickApiKey({}), undefined)
})

test('pickApiKey: empty strings are ignored (falsy)', () => {
  assert.equal(pickApiKey({ flag: '', env: 'sk_env' }), 'sk_env')
})

test('exitCodeForStatus: distinct codes per failure class', () => {
  assert.equal(exitCodeForStatus(401), 3)
  assert.equal(exitCodeForStatus(402), 4)
  assert.equal(exitCodeForStatus(409), 5)
  assert.equal(exitCodeForStatus(429), 6)
  assert.equal(exitCodeForStatus(400), 1)
  assert.equal(exitCodeForStatus(500), 1)
})
