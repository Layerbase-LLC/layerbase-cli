import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySource,
  deriveDatabaseName,
  isDuckdbHeader,
  isSqliteHeader,
  mapTargetEngine,
  parseSqliteTarget,
  sanitizeDatabaseName,
} from '@/lib/promote-source'
import type { FileProbe, SpindbInstance } from '@/lib/promote-source'

// ─── Fixtures ───────────────────────────────────────────────────────────────

function header(bytes: string, offset = 0): Buffer {
  const buffer = Buffer.alloc(16)
  buffer.write(bytes, offset, 'latin1')
  return buffer
}

const SQLITE_HEADER = header('SQLite format 3')
const DUCKDB_HEADER = header('DUCK', 8)
const GARBAGE_HEADER = header('not a database')

function fileProbe(headerBytes: Buffer | null): FileProbe {
  return { exists: true, isDirectory: false, header: headerBytes }
}

const DIRECTORY_PROBE: FileProbe = {
  exists: true,
  isDirectory: true,
  header: null,
}

const INSTANCES: SpindbInstance[] = [
  { name: 'my-local-pg', engine: 'postgresql', version: '17.7.0' },
  { name: 'cache', engine: 'redis' },
  { name: 'notes', engine: 'sqlite' },
  { name: 'legacy-mongo', engine: 'mongodb' },
  { name: 'crdb', engine: 'cockroachdb' },
  { name: 'surreal', engine: 'surrealdb' },
  { name: 'vectors', engine: 'qdrant' },
  { name: 'edge', engine: 'libsql' },
]

function classify(options: {
  ref: string
  from?: string
  probe?: FileProbe | null
}) {
  return classifySource({
    ref: options.ref,
    from: options.from,
    probe: options.probe ?? null,
    instances: INSTANCES,
  })
}

// ─── Magic bytes ────────────────────────────────────────────────────────────

test('headers: recognizes a real SQLite file header', () => {
  assert.equal(isSqliteHeader(SQLITE_HEADER), true)
  assert.equal(isSqliteHeader(GARBAGE_HEADER), false)
  assert.equal(isSqliteHeader(null), false)
  assert.equal(isSqliteHeader(Buffer.from('SQLite')), false)
})

test('headers: recognizes DUCK at bytes 8-11, not at byte 0', () => {
  assert.equal(isDuckdbHeader(DUCKDB_HEADER), true)
  assert.equal(isDuckdbHeader(header('DUCK')), false)
  assert.equal(isDuckdbHeader(null), false)
})

// ─── Source detection ───────────────────────────────────────────────────────

test('detect: a .db file with a SQLite header is a sqlite source', () => {
  const result = classify({ ref: './app.db', probe: fileProbe(SQLITE_HEADER) })
  assert.equal(result.ok, true)
  assert.deepEqual(result.ok && result.source, {
    kind: 'sqlite',
    path: './app.db',
  })
})

test('detect: the header wins over a lying extension', () => {
  const result = classify({
    ref: './app.db',
    probe: fileProbe(DUCKDB_HEADER),
  })
  assert.equal(result.ok && result.source.kind, 'duckdb')
})

test('detect: a .sqlite file without the magic bytes is refused, not guessed', () => {
  const result = classify({
    ref: './app.sqlite',
    probe: fileProbe(GARBAGE_HEADER),
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /not a SQLite database file/)
})

test('detect: a .duckdb file without DUCK is refused', () => {
  const result = classify({
    ref: './analytics.duckdb',
    probe: fileProbe(GARBAGE_HEADER),
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /not a DuckDB database file/)
})

test('detect: a .sql file is a Postgres-dialect dump', () => {
  const result = classify({
    ref: './dump.sql',
    probe: fileProbe(Buffer.from('-- PostgreSQL database dump')),
  })
  assert.equal(result.ok && result.source.kind, 'sql-dump')
})

test('detect: an unknown extension is ambiguous and refused', () => {
  const result = classify({
    ref: './data.bin',
    probe: fileProbe(GARBAGE_HEADER),
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /Cannot tell what kind/)
  assert.match(!result.ok ? result.error : '', /--from/)
})

test('detect: a bare name matching a spindb container is that container', () => {
  const result = classify({ ref: 'my-local-pg' })
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.source.kind, 'spindb')
  assert.equal(
    result.ok && result.source.kind === 'spindb'
      ? result.source.instance.engine
      : '',
    'postgresql',
  )
})

test('detect: a bare name matching nothing names both possibilities', () => {
  const result = classify({ ref: 'nope' })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /neither a file on disk nor/)
})

test('detect: a missing path is refused', () => {
  const result = classify({ ref: './missing.db', probe: null })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /No such file or directory/)
})

test('detect: a directory prints the pgDump recipe instead of guessing', () => {
  const result = classify({ ref: './pgdata', probe: DIRECTORY_PROBE })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /PGlite data directories/)
  assert.match(!result.ok ? result.error : '', /pgDump/)
})

test('detect: --from pglite on a data dir refuses with the recipe', () => {
  const result = classify({
    ref: './pgdata',
    from: 'pglite',
    probe: DIRECTORY_PROBE,
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /not supported yet/)
})

test('detect: --from pglite on a .sql dump is accepted', () => {
  const result = classify({
    ref: './dump.sql',
    from: 'pglite',
    probe: fileProbe(Buffer.from('--')),
  })
  assert.equal(result.ok && result.source.kind, 'sql-dump')
})

test('detect: --from spindb resolves a container even with a file-ish name', () => {
  const result = classify({ ref: 'notes', from: 'spindb' })
  assert.equal(result.ok && result.source.kind, 'spindb')
})

test('detect: an unknown --from value is refused', () => {
  const result = classify({ ref: './app.db', from: 'mysql-dump' })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /Unknown --from/)
})

// ─── Target mapping ─────────────────────────────────────────────────────────

function targetFor(source: Parameters<typeof mapTargetEngine>[0]['source']) {
  return mapTargetEngine({ source, sqliteTarget: 'pgsqlite' })
}

test('target: a SQLite file defaults to the pgsqlite-backed sqlite engine', () => {
  const result = targetFor({ kind: 'sqlite', path: './app.db' })
  assert.deepEqual(result, { ok: true, engine: 'sqlite' })
})

test('target: --target libsql is refused before anything is created', () => {
  const result = mapTargetEngine({
    source: { kind: 'sqlite', path: './app.db' },
    sqliteTarget: 'libsql',
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /not supported yet/)
  assert.match(!result.ok ? result.error : '', /--target pgsqlite/)
})

test('target: DuckDB maps to DuckDB and SQL dumps map to PostgreSQL', () => {
  assert.deepEqual(targetFor({ kind: 'duckdb', path: './a.duckdb' }), {
    ok: true,
    engine: 'duckdb',
  })
  assert.deepEqual(targetFor({ kind: 'sql-dump', path: './dump.sql' }), {
    ok: true,
    engine: 'postgresql',
  })
})

test('target: a spindb container maps to the same cloud engine', () => {
  assert.deepEqual(
    targetFor({ kind: 'spindb', instance: INSTANCES[0] as SpindbInstance }),
    { ok: true, engine: 'postgresql' },
  )
  assert.deepEqual(
    targetFor({ kind: 'spindb', instance: INSTANCES[1] as SpindbInstance }),
    { ok: true, engine: 'redis' },
  )
})

test('target: a spindb SQLite container follows the same sqlite target rule', () => {
  const instance = INSTANCES[2] as SpindbInstance
  assert.deepEqual(targetFor({ kind: 'spindb', instance }), {
    ok: true,
    engine: 'sqlite',
  })
  const libsql = mapTargetEngine({
    source: { kind: 'spindb', instance },
    sqliteTarget: 'libsql',
  })
  assert.equal(libsql.ok, false)
})

test('target: MongoDB is refused with the licensing reason and FerretDB', () => {
  const result = targetFor({
    kind: 'spindb',
    instance: INSTANCES[3] as SpindbInstance,
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /SSPL/)
  assert.match(!result.ok ? result.error : '', /FerretDB/)
})

test('target: CockroachDB is refused and points at PostgreSQL', () => {
  const result = targetFor({
    kind: 'spindb',
    instance: INSTANCES[4] as SpindbInstance,
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /desktop-only/)
  assert.match(!result.ok ? result.error : '', /PostgreSQL/)
})

test('target: SurrealDB is refused and says there is no cloud equivalent', () => {
  const result = targetFor({
    kind: 'spindb',
    instance: INSTANCES[5] as SpindbInstance,
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /no SurrealDB/)
})

test('target: an engine with no restorable local dump format is refused', () => {
  const result = targetFor({
    kind: 'spindb',
    instance: INSTANCES[6] as SpindbInstance,
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /does not support qdrant/)
  assert.match(!result.ok ? result.error : '', /lbase migrate/)
})

test('target: a local libsql container hits the same libSQL refusal', () => {
  const result = targetFor({
    kind: 'spindb',
    instance: INSTANCES[7] as SpindbInstance,
  })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /libSQL/)
})

test('target flag: parses both values and rejects anything else', () => {
  assert.deepEqual(parseSqliteTarget(undefined), {
    ok: true,
    target: 'pgsqlite',
  })
  assert.deepEqual(parseSqliteTarget('LIBSQL'), { ok: true, target: 'libsql' })
  assert.equal(parseSqliteTarget('postgres').ok, false)
})

// ─── Naming ─────────────────────────────────────────────────────────────────

test('name: derives from the file basename without its extension', () => {
  assert.equal(
    deriveDatabaseName({
      source: { kind: 'sqlite', path: './data/App DB.db' },
    }),
    'app-db',
  )
})

test('name: derives from the container name, and --name wins', () => {
  const source = {
    kind: 'spindb' as const,
    instance: INSTANCES[0] as SpindbInstance,
  }
  assert.equal(deriveDatabaseName({ source }), 'my-local-pg')
  assert.equal(deriveDatabaseName({ source, explicit: 'Prod_DB' }), 'prod-db')
})

test('name: sanitizes to a safe slug and never returns an empty name', () => {
  assert.equal(sanitizeDatabaseName('___'), 'promoted-db')
  assert.equal(sanitizeDatabaseName('9lives'), 'db-9lives')
  assert.equal(sanitizeDatabaseName('a'.repeat(80)).length, 40)
  assert.equal(sanitizeDatabaseName('My App!!'), 'my-app')
})
