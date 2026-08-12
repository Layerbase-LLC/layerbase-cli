import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

// Source detection + cloud-target mapping for `layerbase promote`. The
// classification half is deliberately PURE (it takes filesystem facts as data)
// so every branch is unit-testable without touching the disk or the network.

export type SpindbInstance = {
  name: string
  engine: string
  version?: string
  database?: string
  status?: string
}

export type PromoteSource =
  | { kind: 'sqlite'; path: string }
  | { kind: 'duckdb'; path: string }
  | { kind: 'sql-dump'; path: string }
  | { kind: 'spindb'; instance: SpindbInstance }

export type ClassifyResult =
  | { ok: true; source: PromoteSource }
  | { ok: false; error: string }

// What we read off disk before classifying. `header` is the first bytes of a
// regular file (enough for every signature we check), null for a directory or a
// missing path.
export type FileProbe = {
  exists: boolean
  isDirectory: boolean
  header: Buffer | null
}

// Bytes 0-14 of every SQLite database file.
const SQLITE_MAGIC = 'SQLite format 3'
// DuckDB stamps 'DUCK' at bytes 8-11 of its main database file.
const DUCKDB_MAGIC = 'DUCK'

const HEADER_BYTES = 16

const SQLITE_EXTENSIONS = ['.db', '.sqlite', '.sqlite3']
const DUCKDB_EXTENSIONS = ['.duckdb', '.ddb']
const SQL_EXTENSIONS = ['.sql']

// Accepted `--from` values. `pglite` is the one the plan calls out; the rest
// exist so an ambiguous path can be disambiguated explicitly instead of guessed.
export const FROM_VALUES = ['pglite', 'sqlite', 'duckdb', 'sql', 'spindb']

export function isSqliteHeader(header: Buffer | null): boolean {
  if (!header || header.length < SQLITE_MAGIC.length) return false
  return (
    header.subarray(0, SQLITE_MAGIC.length).toString('latin1') === SQLITE_MAGIC
  )
}

export function isDuckdbHeader(header: Buffer | null): boolean {
  if (!header || header.length < 12) return false
  return header.subarray(8, 12).toString('latin1') === DUCKDB_MAGIC
}

// The three-line pgDump recipe we hand people instead of shipping several MB of
// WASM in the default install. See the PGlite note in README.
const PGLITE_DIR_MESSAGE =
  'PGlite data directories are not supported yet. Dump the directory to SQL ' +
  'first, then promote the dump:\n' +
  "  const db = await PGlite.create('./pgdata')            // @electric-sql/pglite\n" +
  '  const dump = await pgDump({ pg: db })                 // @electric-sql/pglite-tools/pg_dump\n' +
  "  await writeFile('./dump.sql', await dump.text())      // node:fs/promises\n" +
  '\n' +
  '  layerbase promote ./dump.sql'

function looksLikePath(ref: string, probe: FileProbe | null): boolean {
  if (probe?.exists) return true
  if (ref.includes('/') || ref.includes('\\')) return true
  return extname(ref) !== ''
}

function findInstance(
  name: string,
  instances: SpindbInstance[],
): SpindbInstance | undefined {
  return instances.find((instance) => instance.name === name)
}

function classifyFile(options: {
  ref: string
  probe: FileProbe
}): ClassifyResult {
  const { ref, probe } = options
  const ext = extname(ref).toLowerCase()

  // The header is authoritative for the binary formats: an app.db that is
  // really a DuckDB file is a DuckDB file, whatever the extension claims.
  if (isSqliteHeader(probe.header)) {
    return { ok: true, source: { kind: 'sqlite', path: ref } }
  }
  if (isDuckdbHeader(probe.header)) {
    return { ok: true, source: { kind: 'duckdb', path: ref } }
  }

  if (SQL_EXTENSIONS.includes(ext)) {
    return { ok: true, source: { kind: 'sql-dump', path: ref } }
  }

  if (SQLITE_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      error:
        `${ref} ends in ${ext} but is not a SQLite database file (its header ` +
        `does not start with "${SQLITE_MAGIC}"). Pass the real database file, ` +
        'or promote a SQL dump as ./dump.sql.',
    }
  }
  if (DUCKDB_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      error:
        `${ref} ends in ${ext} but is not a DuckDB database file (no "DUCK" ` +
        'header). Pass the real .duckdb file.',
    }
  }

  return {
    ok: false,
    error:
      `Cannot tell what kind of database ${ref} is. promote accepts a SQLite ` +
      'file (.db/.sqlite/.sqlite3), a DuckDB file (.duckdb), a Postgres SQL ' +
      'dump (.sql), or the name of a local spindb container. Force the kind ' +
      `with --from <${FROM_VALUES.join('|')}>.`,
  }
}

// Turn the positional argument into a concrete source. Pure: `probe` is the
// filesystem fact and `instances` the spindb container list, both supplied by
// the caller.
export function classifySource(options: {
  ref: string
  from?: string
  probe: FileProbe | null
  instances: SpindbInstance[]
}): ClassifyResult {
  const { ref, probe, instances } = options
  const from = options.from?.toLowerCase()

  if (from && !FROM_VALUES.includes(from)) {
    return {
      ok: false,
      error: `Unknown --from "${options.from}". Use one of: ${FROM_VALUES.join(', ')}.`,
    }
  }

  if (from === 'spindb') {
    const instance = findInstance(ref, instances)
    if (!instance) {
      return {
        ok: false,
        error:
          `No local spindb container named "${ref}". Run \`lbase ls\` to see ` +
          'your local containers.',
      }
    }
    return { ok: true, source: { kind: 'spindb', instance } }
  }

  if (from === 'pglite') {
    if (!probe?.exists) {
      return { ok: false, error: `No such file or directory: ${ref}` }
    }
    if (probe.isDirectory) {
      return { ok: false, error: PGLITE_DIR_MESSAGE }
    }
    if (extname(ref).toLowerCase() !== '.sql') {
      return {
        ok: false,
        error:
          `--from pglite expects the .sql file pgDump produced, and ${ref} is ` +
          'not one.\n' +
          PGLITE_DIR_MESSAGE,
      }
    }
    return { ok: true, source: { kind: 'sql-dump', path: ref } }
  }

  if (from === 'sqlite' || from === 'duckdb' || from === 'sql') {
    if (!probe?.exists || probe.isDirectory) {
      return { ok: false, error: `No such file: ${ref}` }
    }
    if (from === 'sqlite') {
      if (!isSqliteHeader(probe.header)) {
        return {
          ok: false,
          error: `${ref} is not a SQLite database file (bad header).`,
        }
      }
      return { ok: true, source: { kind: 'sqlite', path: ref } }
    }
    if (from === 'duckdb') {
      if (!isDuckdbHeader(probe.header)) {
        return {
          ok: false,
          error: `${ref} is not a DuckDB database file (bad header).`,
        }
      }
      return { ok: true, source: { kind: 'duckdb', path: ref } }
    }
    return { ok: true, source: { kind: 'sql-dump', path: ref } }
  }

  // No --from: a path-shaped argument is a file, anything else is a container
  // name. Never guess between the two.
  if (!looksLikePath(ref, probe)) {
    const instance = findInstance(ref, instances)
    if (instance) return { ok: true, source: { kind: 'spindb', instance } }
    return {
      ok: false,
      error:
        `"${ref}" is neither a file on disk nor a local spindb container. ` +
        'Pass a path to a .db/.sqlite/.duckdb/.sql file, or a container name ' +
        'from `lbase ls`.',
    }
  }

  if (!probe?.exists) {
    const instance = findInstance(ref, instances)
    if (instance) return { ok: true, source: { kind: 'spindb', instance } }
    return { ok: false, error: `No such file or directory: ${ref}` }
  }

  if (probe.isDirectory) {
    return {
      ok: false,
      error:
        `${ref} is a directory. If it is a PGlite data directory, see below.\n` +
        PGLITE_DIR_MESSAGE,
    }
  }

  return classifyFile({ ref, probe })
}

// ─── Target mapping ─────────────────────────────────────────────────────────

// Engines we host locally (spindb/desktop) but cannot host in the cloud, with
// the licensing reason and the closest cloud alternative.
const DESKTOP_ONLY_REASONS: Record<string, string> = {
  mongodb:
    'MongoDB is desktop-only on Layerbase: its SSPL license does not allow us ' +
    'to offer it as a managed service. The closest cloud target is FerretDB ' +
    '(the MongoDB wire protocol on Postgres): create one with `lbase cloud ' +
    'create <name> --engine ferretdb` and load it with `lbase import`.',
  cockroachdb:
    'CockroachDB is desktop-only on Layerbase: its license does not allow us ' +
    'to offer it as a managed service. The closest cloud target is PostgreSQL ' +
    '(CockroachDB dumps are Postgres-dialect SQL): promote the dump with ' +
    '`lbase promote ./dump.sql`.',
  surrealdb:
    'SurrealDB is desktop-only on Layerbase: its license does not allow us to ' +
    'offer it as a managed service, and Layerbase Cloud has no SurrealDB ' +
    'equivalent to promote into.',
}

// spindb engines whose `spindb backup` artifact is a format the cloud import
// endpoint already restores (SQL text, an RDB, or a raw database file). Every
// other engine backs up to an engine-specific tar/snapshot that only the
// cloud's own backup pipeline produces, so promote refuses instead of uploading
// something the restore would reject (or, worse, half-apply).
export const PROMOTABLE_SPINDB_ENGINES = [
  'postgresql',
  'mysql',
  'mariadb',
  'redis',
  'valkey',
  'sqlite',
  'duckdb',
]

export type SqliteTarget = 'libsql' | 'pgsqlite'

export const SQLITE_TARGETS: SqliteTarget[] = ['libsql', 'pgsqlite']

// pgsqlite is the wire shim in front of the cloud `sqlite` engine, so the flag
// value the user types and the engine slug the API takes are different words
// for the same target.
const PGSQLITE_ENGINE = 'sqlite'

// libSQL restores from a tar of a live sqld data directory, not from a SQLite
// file, so there is no shipped path that puts a local .db into a cloud libSQL
// database. Refused BEFORE anything is created so promote never strands an
// empty database. Lift this the moment the cloud grows a SQLite-file loader for
// libSQL (the sqlite -> libsql converter already exists cloud-side for
// cloud-to-cloud conversions).
const LIBSQL_UNSUPPORTED =
  'Promoting into a cloud libSQL database is not supported yet: libSQL ' +
  'restores from a data-directory archive, not from a SQLite file. Use ' +
  '`--target pgsqlite` (SQLite storage behind the Postgres wire, which is the ' +
  'default), or import an existing hosted libSQL database with `lbase migrate ' +
  '--source turso`.'

export type TargetResult =
  | { ok: true; engine: string }
  | { ok: false; error: string }

export function mapTargetEngine(options: {
  source: PromoteSource
  sqliteTarget: SqliteTarget
}): TargetResult {
  const { source, sqliteTarget } = options

  const forSqlite = (): TargetResult =>
    sqliteTarget === 'libsql'
      ? { ok: false, error: LIBSQL_UNSUPPORTED }
      : { ok: true, engine: PGSQLITE_ENGINE }

  if (source.kind === 'sqlite') return forSqlite()
  if (source.kind === 'duckdb') return { ok: true, engine: 'duckdb' }
  if (source.kind === 'sql-dump') return { ok: true, engine: 'postgresql' }

  const engine = source.instance.engine.toLowerCase()

  const desktopOnly = DESKTOP_ONLY_REASONS[engine]
  if (desktopOnly) return { ok: false, error: desktopOnly }

  if (engine === 'libsql') return { ok: false, error: LIBSQL_UNSUPPORTED }
  if (engine === 'sqlite') return forSqlite()

  if (!PROMOTABLE_SPINDB_ENGINES.includes(engine)) {
    return {
      ok: false,
      error:
        `promote does not support ${engine} containers yet: spindb's backup ` +
        'format for this engine is not one the cloud import endpoint ' +
        'restores. Create the database with `lbase cloud create <name> ' +
        `--engine ${engine}` +
        '` and load it with `lbase migrate` instead.',
    }
  }

  return { ok: true, engine }
}

export function parseSqliteTarget(
  raw: string | undefined,
): { ok: true; target: SqliteTarget } | { ok: false; error: string } {
  if (!raw) return { ok: true, target: 'pgsqlite' }
  const value = raw.toLowerCase()
  if (value === 'libsql' || value === 'pgsqlite') {
    return { ok: true, target: value }
  }
  return {
    ok: false,
    error: `Unknown --target "${raw}". Use one of: ${SQLITE_TARGETS.join(', ')}.`,
  }
}

// ─── Naming ─────────────────────────────────────────────────────────────────

const MAX_NAME_LENGTH = 40

export function sanitizeDatabaseName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-$/, '')
  if (!slug) return 'promoted-db'
  return /^[a-z]/.test(slug) ? slug : `db-${slug}`.slice(0, MAX_NAME_LENGTH)
}

export function deriveDatabaseName(options: {
  source: PromoteSource
  explicit?: string
}): string {
  const { source, explicit } = options
  if (explicit) return sanitizeDatabaseName(explicit)
  if (source.kind === 'spindb')
    return sanitizeDatabaseName(source.instance.name)
  const base = basename(source.path, extname(source.path))
  return sanitizeDatabaseName(base)
}

// ─── Filesystem probe (the IO half) ─────────────────────────────────────────

export function probePath(path: string): FileProbe | null {
  let stat
  try {
    stat = statSync(path)
  } catch {
    return null
  }
  if (stat.isDirectory()) {
    return { exists: true, isDirectory: true, header: null }
  }
  return { exists: true, isDirectory: false, header: readHeader(path) }
}

function readHeader(path: string): Buffer | null {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(HEADER_BYTES)
    const read = readSync(fd, buffer, 0, HEADER_BYTES, 0)
    return buffer.subarray(0, read)
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function describeSource(source: PromoteSource): string {
  return source.kind === 'spindb'
    ? `spindb container "${source.instance.name}" (${source.instance.engine})`
    : `${source.path} (${source.kind})`
}
