import type { ConnectionInfo } from '@/lib/cloud-api'
import { secretsRevealed } from '@/lib/cli-output'
import { REDACTED_PASSWORD } from '@/lib/redact'

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

// Prints connection details for `--print`. The password is masked unless
// --show-secrets / --reveal was passed; `layerbase cloud connection-string <db>`
// remains the escape hatch that always reveals it.
//
// The mask is the same REDACTED_PASSWORD every other surface uses. It used to
// be its own eight-asterisk string, which meant the CLI showed a customer two
// different maskings of the same secret and ignored the flag here.
export function printConnectionInfo(info: ConnectionInfo): void {
  const password = secretsRevealed()
    ? info.password
    : `${REDACTED_PASSWORD} (hidden, --show-secrets to reveal)`
  const lines = [
    `engine    ${info.engine}`,
    `host      ${info.host}`,
    `port      ${info.port}`,
    `database  ${info.database}`,
    `username  ${info.username}`,
    `password  ${password}`,
    `tls       ${info.tls === false ? 'off' : 'on'}`,
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}
