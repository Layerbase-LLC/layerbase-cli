import { createInterface } from 'node:readline'

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
