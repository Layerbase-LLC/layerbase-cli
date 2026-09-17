import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spindbChildEnv } from '../src/lib/run-spindb'

test('spindbChildEnv brands the spindb session as Layerbase', () => {
  assert.equal(spindbChildEnv().SPINDB_BRAND, 'Layerbase')
})

test('spindbChildEnv keeps the parent env and merges extras', () => {
  const env = spindbChildEnv({ LAYERBASE_CLONE_URL: 'x' })
  assert.equal(env.LAYERBASE_CLONE_URL, 'x')
  assert.equal(env.PATH, process.env.PATH)
  assert.equal(env.SPINDB_BRAND, 'Layerbase')
})
