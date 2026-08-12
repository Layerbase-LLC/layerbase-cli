import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyEnvAssignment,
  isMissingFileError,
  quoteEnvValue,
  readEnvFile,
  writeEnvAssignment,
} from '@/lib/env-file'

const URL_A = 'postgresql://u:p@host:5432/db'
const URL_B = 'postgresql://u:new@host:5432/db'

function apply(contents: string | null, value = URL_A) {
  return applyEnvAssignment({ contents, key: 'DATABASE_URL', value })
}

test('env: creates the file contents when there is no .env', () => {
  const result = apply(null)
  assert.equal(result.action, 'created')
  assert.equal(result.contents, `DATABASE_URL='${URL_A}'\n`)
})

test('env: appends without touching any existing line', () => {
  const before = 'PORT=3000\nAPI_KEY=abc\n'
  const result = apply(before)
  assert.equal(result.action, 'appended')
  assert.equal(result.contents, `${before}DATABASE_URL='${URL_A}'\n`)
})

test('env: appends a newline first when the file lacks a trailing one', () => {
  const result = apply('PORT=3000')
  assert.equal(result.contents, `PORT=3000\nDATABASE_URL='${URL_A}'\n`)
})

test('env: replaces an existing assignment in place, leaving neighbours alone', () => {
  const before = [
    '# app config',
    'PORT=3000',
    `DATABASE_URL='${URL_A}'`,
    'NEXT_PUBLIC_DATABASE_URL=keep-me',
    'REDIS_URL=redis://localhost:6379',
    '',
  ].join('\n')
  const result = apply(before, URL_B)
  assert.equal(result.action, 'updated')
  assert.equal(
    result.contents,
    [
      '# app config',
      'PORT=3000',
      `DATABASE_URL='${URL_B}'`,
      'NEXT_PUBLIC_DATABASE_URL=keep-me',
      'REDIS_URL=redis://localhost:6379',
      '',
    ].join('\n'),
  )
})

test('env: leaves a commented-out assignment commented out', () => {
  const before = '# DATABASE_URL=old\nPORT=3000\n'
  const result = apply(before)
  assert.equal(result.action, 'appended')
  assert.match(result.contents, /^# DATABASE_URL=old$/m)
})

test('env: preserves indentation and an export prefix', () => {
  const result = apply('  export DATABASE_URL=old\n', URL_B)
  assert.equal(result.action, 'updated')
  assert.equal(result.contents, `  export DATABASE_URL='${URL_B}'\n`)
})

test('env: rewrites every active duplicate so a later one cannot win', () => {
  const before = 'DATABASE_URL=one\nPORT=3000\nDATABASE_URL=two\n'
  const result = apply(before, URL_B)
  assert.equal(
    result.contents,
    `DATABASE_URL='${URL_B}'\nPORT=3000\nDATABASE_URL='${URL_B}'\n`,
  )
})

test('env: quotes values, escaping only when the value has a single quote', () => {
  assert.equal(quoteEnvValue('postgres://a:b#c@h/d'), "'postgres://a:b#c@h/d'")
  assert.equal(quoteEnvValue("pa'ss"), '"pa\'ss"')
  assert.equal(quoteEnvValue('say "hi"\\'), '\'say "hi"\\\'')
  assert.equal(quoteEnvValue('it\'s "x"\\'), '"it\'s \\"x\\"\\\\"')
})

// ─── Reading (data-loss guard) ──────────────────────────────────────────────

test('env: only ENOENT counts as "no file yet"', () => {
  assert.equal(isMissingFileError({ code: 'ENOENT' }), true)
  assert.equal(isMissingFileError({ code: 'EACCES' }), false)
  assert.equal(isMissingFileError({ code: 'EISDIR' }), false)
  assert.equal(isMissingFileError(new Error('boom')), false)
  assert.equal(isMissingFileError(null), false)
})

test('env: readEnvFile returns null for a missing file and contents otherwise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'layerbase-env-'))
  try {
    const filePath = join(dir, '.env')
    assert.equal(readEnvFile(filePath), null)
    writeFileSync(filePath, 'PORT=3000\n')
    assert.equal(readEnvFile(filePath), 'PORT=3000\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('env: a read failure that is NOT ENOENT is rethrown, never treated as missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'layerbase-env-'))
  try {
    // A directory in the .env slot reads as EISDIR: an existing thing we cannot
    // read, which must never be reported as "created" and overwritten.
    const filePath = join(dir, 'env-dir')
    mkdirSync(filePath)
    assert.throws(() => readEnvFile(filePath))
    assert.throws(() =>
      writeEnvAssignment({
        filePath,
        key: 'DATABASE_URL',
        value: URL_A,
      }),
    )
    assert.equal(statSync(filePath).isDirectory(), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('env: writeEnvAssignment updates an existing file in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'layerbase-env-'))
  try {
    const filePath = join(dir, '.env')
    writeFileSync(filePath, `PORT=3000\nDATABASE_URL='${URL_A}'\n`)
    const action = writeEnvAssignment({
      filePath,
      key: 'DATABASE_URL',
      value: URL_B,
    })
    assert.equal(action, 'updated')
    assert.equal(
      readFileSync(filePath, 'utf8'),
      `PORT=3000\nDATABASE_URL='${URL_B}'\n`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
