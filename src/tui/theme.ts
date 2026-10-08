export const PANEL = '#3d465c'
export const SELECTED = '#1e2a44'
export const RUNNING = '#3dd68c'
export const MUTED = '#8b93a7'
export const LINKED = '#c084fc'
export const WARN = '#e8a838'
export const BAD = '#f07178'

export function statusColor(label: string): string {
  if (label === 'running' || label === 'available' || label === 'ready') {
    return RUNNING
  }
  if (label === 'linked') return LINKED
  if (label === 'stopped' || label === 'missing') return MUTED
  if (label === 'failed' || label === 'error') return BAD
  return WARN
}

export function statusMark(label: string): string {
  if (label === 'linked') return '↔'
  if (label === 'stopped' || label === 'missing') return '○'
  return '●'
}

export function engineColor(engine: string): string {
  switch (engine.toLowerCase()) {
    case 'postgresql':
    case 'cockroachdb':
      return '#7eb6ff'
    case 'mysql':
    case 'mariadb':
      return '#e8a838'
    case 'mongodb':
    case 'ferretdb':
      return '#6bcb8b'
    case 'redis':
    case 'valkey':
      return '#f07178'
    case 'sqlite':
    case 'duckdb':
    case 'libsql':
      return '#a8b0ba'
    case 'clickhouse':
      return '#f5d76e'
    default:
      return '#d0d4dc'
  }
}
