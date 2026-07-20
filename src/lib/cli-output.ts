import { CloudApiError, exitCodeForStatus } from '@/lib/cloud-api'

// Render an error for a scriptable command: a JSON object on stdout when --json,
// otherwise a human line on stderr. Returns the exit code the caller should use
// (script-friendly per exitCodeForStatus for cloud errors, 1 otherwise).
export function reportError(error: unknown, json: boolean): number {
  if (error instanceof CloudApiError) {
    const { status, code, message } = error.info
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: message, code, status })}\n`,
      )
    } else {
      process.stderr.write(`${message}\n`)
    }
    return exitCodeForStatus(status)
  }

  const message = error instanceof Error ? error.message : String(error)
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`)
  } else {
    process.stderr.write(`${message}\n`)
  }
  return 1
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
