export type PowerVerb = 'start' | 'stop' | 'wake' | 'hibernate'

export type PendingPower = {
  key: string
  verb: PowerVerb
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function pendingLabel(verb: PowerVerb): string {
  if (verb === 'start') return 'starting'
  if (verb === 'stop') return 'stopping'
  if (verb === 'wake') return 'waking'
  return 'hibernating'
}

// The status column is 10 cells. "hibernating" does not fit, so the column
// uses the shorter verb while the footer keeps the full word.
export function pendingColumn(verb: PowerVerb): string {
  if (verb === 'hibernate') return 'hibernate'
  return pendingLabel(verb)
}

export function pendingPhrase(verb: PowerVerb, name: string): string {
  const label = pendingLabel(verb)
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${name}...`
}

export function spinFrame(now: number): string {
  const index = Math.floor(now / 120) % SPIN.length
  return SPIN[index] ?? '-'
}
