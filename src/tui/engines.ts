// Display copy of SpinDB's engine ids (ALL_ENGINES). Local create offers these
// names to `spindb create --engine`. The cloud catalog is separate and is read
// from listEngines() at runtime. Do not import this from the spindb repo.

export const LOCAL_ENGINES = [
  'postgresql',
  'mysql',
  'mariadb',
  'sqlite',
  'duckdb',
  'mongodb',
  'redis',
  'valkey',
  'clickhouse',
  'qdrant',
  'meilisearch',
  'ferretdb',
  'couchdb',
  'cockroachdb',
  'surrealdb',
  'questdb',
  'typedb',
  'influxdb',
  'weaviate',
  'tigerbeetle',
  'libsql',
] as const

const FILE_ENGINES = new Set<string>(['sqlite', 'duckdb'])

const ENGINE_LABELS: Record<string, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  sqlite: 'SQLite',
  duckdb: 'DuckDB',
  mongodb: 'MongoDB',
  redis: 'Redis',
  valkey: 'Valkey',
  clickhouse: 'ClickHouse',
  qdrant: 'Qdrant',
  meilisearch: 'Meilisearch',
  ferretdb: 'FerretDB',
  couchdb: 'CouchDB',
  cockroachdb: 'CockroachDB',
  surrealdb: 'SurrealDB',
  questdb: 'QuestDB',
  typedb: 'TypeDB',
  influxdb: 'InfluxDB',
  weaviate: 'Weaviate',
  tigerbeetle: 'TigerBeetle',
  libsql: 'libSQL',
}

export function isFileEngine(engine: string): boolean {
  return FILE_ENGINES.has(engine)
}

export function engineLabel(engine: string): string {
  return ENGINE_LABELS[engine] ?? engine
}
