import { createInterface } from 'node:readline'

// A minimal numbered-choice prompt for interactive CLI selection (source /
// target picking). TTY-only: callers MUST gate on process.stdin.isTTY and
// require an explicit flag in non-TTY contexts so a script never blocks on a
// prompt. Returns the chosen item, or undefined when the input is empty or out
// of range (the caller treats that as an abort). Kept readline-based to match
// confirm.ts rather than pulling the async cloud flows into Ink.
export async function selectFromList<T>(options: {
  title: string
  items: T[]
  render: (item: T) => string
}): Promise<T | undefined> {
  const { title, items, render } = options
  if (items.length === 0) return undefined
  if (items.length === 1) return items[0]

  process.stdout.write(`${title}\n`)
  items.forEach((item, i) => {
    process.stdout.write(`  ${i + 1}) ${render(item)}\n`)
  })

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`Choose 1-${items.length}: `, resolve)
    })
    const index = Number(answer.trim())
    if (!Number.isInteger(index) || index < 1 || index > items.length) {
      return undefined
    }
    return items[index - 1]
  } finally {
    rl.close()
  }
}

// A single free-text line prompt (used to collect a credential or connection
// string interactively). TTY-only, same contract as selectFromList. Returns the
// trimmed input, or '' when empty.
export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question}: `, resolve)
    })
    return answer.trim()
  } finally {
    rl.close()
  }
}
