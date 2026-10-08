import net from 'node:net'

// Same ranges SpinDB uses when a start has to leave a busy port. File engines
// have no port. Kept here so the TUI does not import the spindb repo.
const PORT_RANGES: Record<string, { start: number; end: number }> = {
  postgresql: { start: 5432, end: 5500 },
  mysql: { start: 3306, end: 3400 },
  mariadb: { start: 3307, end: 3400 },
  mongodb: { start: 27017, end: 27100 },
  redis: { start: 6379, end: 6400 },
  valkey: { start: 6379, end: 6479 },
  clickhouse: { start: 9000, end: 9100 },
  qdrant: { start: 6333, end: 6400 },
  meilisearch: { start: 7700, end: 7800 },
  ferretdb: { start: 27017, end: 27100 },
  couchdb: { start: 5984, end: 6084 },
  cockroachdb: { start: 26257, end: 26357 },
  surrealdb: { start: 8000, end: 8100 },
  questdb: { start: 8812, end: 8912 },
  typedb: { start: 1729, end: 1829 },
  influxdb: { start: 8086, end: 8186 },
  weaviate: { start: 8080, end: 8180 },
  tigerbeetle: { start: 3000, end: 3100 },
  libsql: { start: 8080, end: 8180 },
}

export function enginePortRange(
  engine: string,
): { start: number; end: number } | null {
  return PORT_RANGES[engine] ?? null
}

// Walk the engine range once, starting just after the busy port. Skip ports
// already assigned to other local databases, then ports that fail isFree.
export function nextPort(options: {
  range: { start: number; end: number }
  avoid: number
  reserved: readonly number[]
  isFree: (port: number) => boolean
}): number | null {
  const { start, end } = options.range
  if (end < start) return null
  const reserved = new Set(options.reserved)
  reserved.add(options.avoid)
  const span = end - start + 1
  const first = Math.min(Math.max(options.avoid + 1, start), end + 1)
  for (let step = 0; step < span; step += 1) {
    const port = start + ((first - start + step) % span)
    if (reserved.has(port)) continue
    if (!options.isFree(port)) continue
    return port
  }
  return null
}

function bindHost(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    const finish = (ok: boolean) => {
      server.removeAllListeners()
      if (server.listening) server.close(() => resolve(ok))
      else resolve(ok)
    }
    server.once('error', () => finish(false))
    server.listen(port, host, () => finish(true))
  })
}

export async function canBind(port: number): Promise<boolean> {
  return bindHost(port, '127.0.0.1')
}

export async function chooseOpenPort(options: {
  engine: string
  avoid: number
  reserved: readonly number[]
}): Promise<number | null> {
  const range = enginePortRange(options.engine)
  if (!range) return null
  const reserved = new Set(options.reserved)
  reserved.add(options.avoid)
  const span = range.end - range.start + 1
  const first = Math.min(
    Math.max(options.avoid + 1, range.start),
    range.end + 1,
  )
  for (let step = 0; step < span; step += 1) {
    const port = range.start + ((first - range.start + step) % span)
    if (reserved.has(port)) continue
    if (await canBind(port)) return port
  }
  return null
}
