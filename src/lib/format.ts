import type { ConnectionInfo } from '@/lib/cloud-api'

const SCHEME_BY_ENGINE: Record<string, string> = {
  postgresql: 'postgresql',
  cockroachdb: 'postgresql',
  mysql: 'mysql',
  mariadb: 'mysql',
  redis: 'redis',
  valkey: 'redis',
  mongodb: 'mongodb',
  ferretdb: 'mongodb',
}

export function buildConnectionString(info: ConnectionInfo): string {
  if (info.uri) {
    return info.uri
  }

  const scheme = SCHEME_BY_ENGINE[info.engine.toLowerCase()]
  if (!scheme) {
    throw new Error(
      `Cannot build a connection string for engine "${info.engine}". ` +
        'The cloud API did not return a ready-made uri for it.',
    )
  }

  const auth = `${encodeURIComponent(info.username)}:${encodeURIComponent(
    info.password,
  )}`
  const path = info.database ? `/${info.database}` : ''
  return `${scheme}://${auth}@${info.host}:${info.port}${path}`
}

// Prints connection details for `--print`. The password is masked; use
// `layerbase connection-string <db>` to deliberately reveal it.
export function printConnectionInfo(info: ConnectionInfo): void {
  const lines = [
    `engine    ${info.engine}`,
    `host      ${info.host}`,
    `port      ${info.port}`,
    `database  ${info.database}`,
    `username  ${info.username}`,
    `password  ${'*'.repeat(8)} (hidden)`,
    `tls       ${info.tls === false ? 'off' : 'on'}`,
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}
