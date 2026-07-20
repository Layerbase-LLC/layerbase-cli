// Parse a human duration (30m, 2h, 1d, or a bare number of hours) into an
// integer number of hours for the transient-database TTL. Rounds UP so a
// sub-hour TTL still buys at least one whole hour, clamps to a minimum of 1,
// and rejects anything over the 72h server cap up front (client-side validate,
// so a bad value fails before a create is attempted).
export const MAX_TTL_HOURS = 72

// Longer unit spellings come first so the alternation matches them whole.
const TTL_PATTERN =
  /^(\d+)\s*(minutes|minute|mins|min|hours|hour|hrs|hr|days|day|d|h|m)?$/i

export function parseTtlToHours(input: string): number {
  const match = TTL_PATTERN.exec(input.trim())
  if (!match) {
    throw new Error(
      `Invalid --ttl "${input}". Use a duration like 30m, 2h, or 1d.`,
    )
  }

  const value = Number(match[1])
  const unit = (match[2] ?? 'h').toLowerCase()

  let hours: number
  if (unit.startsWith('m')) {
    hours = value / 60
  } else if (unit.startsWith('d')) {
    hours = value * 24
  } else {
    hours = value
  }

  const rounded = Math.max(1, Math.ceil(hours))
  if (rounded > MAX_TTL_HOURS) {
    throw new Error(
      `--ttl cannot exceed ${MAX_TTL_HOURS}h (got "${input}"). Transient ` +
        'databases are capped so a forgotten one cannot linger.',
    )
  }
  return rounded
}
