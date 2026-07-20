import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTtlToHours, MAX_TTL_HOURS } from '@/lib/duration'

test('parseTtlToHours: bare number defaults to hours', () => {
  assert.equal(parseTtlToHours('2'), 2)
  assert.equal(parseTtlToHours('72'), 72)
})

test('parseTtlToHours: hour units', () => {
  assert.equal(parseTtlToHours('2h'), 2)
  assert.equal(parseTtlToHours('1hr'), 1)
  assert.equal(parseTtlToHours('6 hours'), 6)
})

test('parseTtlToHours: minutes round up to whole hours, min 1', () => {
  assert.equal(parseTtlToHours('30m'), 1)
  assert.equal(parseTtlToHours('90m'), 2)
  assert.equal(parseTtlToHours('1min'), 1)
  assert.equal(parseTtlToHours('120minutes'), 2)
})

test('parseTtlToHours: day units', () => {
  assert.equal(parseTtlToHours('1d'), 24)
  assert.equal(parseTtlToHours('3days'), 72)
})

test('parseTtlToHours: rejects over the 72h cap', () => {
  assert.throws(() => parseTtlToHours('73h'), /cannot exceed/)
  assert.throws(() => parseTtlToHours('4d'), /cannot exceed/)
  assert.equal(MAX_TTL_HOURS, 72)
})

test('parseTtlToHours: rejects malformed input', () => {
  assert.throws(() => parseTtlToHours('soon'), /Invalid --ttl/)
  assert.throws(() => parseTtlToHours('2weeks'), /Invalid --ttl/)
  assert.throws(() => parseTtlToHours(''), /Invalid --ttl/)
})
