import { createInterface } from 'node:readline'

export type ConfirmDecision = 'proceed' | 'prompt' | 'refuse'

// The one rule every billable or destructive command follows, kept pure so it
// is unit-testable: --yes always proceeds; without it an interactive run gets a
// prompt and a NON-interactive run (no TTY, or --json) REFUSES. Falling through
// to "just do it" when there is nobody to prompt is how a piped or --json run
// would silently create a billable resource.
export function decideConfirmation(options: {
  yes: boolean
  interactive: boolean
}): ConfirmDecision {
  if (options.yes) return 'proceed'
  return options.interactive ? 'prompt' : 'refuse'
}

// A minimal yes/no prompt for destructive CLI actions. TTY-only: callers MUST
// gate on process.stdin.isTTY and require an explicit --yes in non-TTY contexts
// so a script is never destructive by default. Defaults to "no" on empty input.
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question} [y/N] `, resolve)
    })
    return /^y(es)?$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}
