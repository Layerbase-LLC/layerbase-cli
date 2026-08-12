import { readFileSync, writeFileSync } from 'node:fs'

// Opt-in `.env` rewriting for `layerbase promote --write-env`. Every unrelated
// line is preserved byte for byte: we only ever rewrite an existing assignment
// of the SAME key, or append one line at the end.

export type EnvWriteAction = 'created' | 'updated' | 'appended'

export type EnvWriteResult = {
  contents: string
  action: EnvWriteAction
}

// A connection string can contain `#`, spaces, and shell metacharacters, so it
// is always quoted. Single quotes are literal in every .env parser; a value
// containing one falls back to double quotes with escapes.
export function quoteEnvValue(value: string): string {
  if (!value.includes("'")) return `'${value}'`
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function assignmentPattern(key: string): RegExp {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^(\\s*)(export\\s+)?${escaped}\\s*=`)
}

// Rewrite (or add) `key` in the given file contents. `contents` is null when the
// file does not exist yet. Commented-out assignments are left alone; every
// active assignment of the key is rewritten so a duplicate further down the file
// cannot silently win at load time.
export function applyEnvAssignment(options: {
  contents: string | null
  key: string
  value: string
}): EnvWriteResult {
  const { contents, key, value } = options
  const line = `${key}=${quoteEnvValue(value)}`

  if (contents === null) {
    return { contents: `${line}\n`, action: 'created' }
  }

  const pattern = assignmentPattern(key)
  const lines = contents.split('\n')
  let replaced = false

  const next = lines.map((current) => {
    if (current.trimStart().startsWith('#')) return current
    const match = pattern.exec(current)
    if (!match) return current
    replaced = true
    return `${match[1] ?? ''}${match[2] ?? ''}${line}`
  })

  if (replaced) {
    return { contents: next.join('\n'), action: 'updated' }
  }

  const separator = contents === '' || contents.endsWith('\n') ? '' : '\n'
  return { contents: `${contents}${separator}${line}\n`, action: 'appended' }
}

// Apply the assignment to a real file, creating it when missing.
export function writeEnvAssignment(options: {
  filePath: string
  key: string
  value: string
}): EnvWriteAction {
  const { filePath, key, value } = options
  let contents: string | null = null
  try {
    contents = readFileSync(filePath, 'utf8')
  } catch {
    contents = null
  }
  const result = applyEnvAssignment({ contents, key, value })
  writeFileSync(filePath, result.contents, { mode: 0o600 })
  return result.action
}
