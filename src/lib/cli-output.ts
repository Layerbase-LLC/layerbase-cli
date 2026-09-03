import { CloudApiError, exitCodeForStatus } from '@/lib/cloud-api'
import { redactConnectionUri, redactJsonSecrets } from '@/lib/redact'

// Whether the user asked for secrets in the clear (`--show-secrets` / `--reveal`).
// Set ONCE from cli.tsx right after the flags are parsed, before any command
// runs. A module-level switch rather than a prop threaded through every command
// on purpose: this is the output boundary, and the security property we want is
// "a surface that forgets to opt in is redacted", not "a surface that forgets to
// opt in leaks".
let revealSecrets = false

export function setRevealSecrets(reveal: boolean): void {
  revealSecrets = reveal
}

export function secretsRevealed(): boolean {
  return revealSecrets
}

// A connection string on its way to stdout: verbatim when the user asked for it,
// password-redacted otherwise.
export function forOutput(value: string): string {
  return revealSecrets ? value : redactConnectionUri(value)
}

// Render an error for a scriptable command: a JSON object on stdout when --json,
// otherwise a human line on stderr. Returns the exit code the caller should use
// (script-friendly per exitCodeForStatus for cloud errors, 1 otherwise).
export function reportError(error: unknown, json: boolean): number {
  if (error instanceof CloudApiError) {
    const { status, code, message } = error.info
    const safe = forOutput(message)
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: safe, code, status })}\n`,
      )
    } else {
      process.stderr.write(`${safe}\n`)
    }
    return exitCodeForStatus(status)
  }

  const message = forOutput(
    error instanceof Error ? error.message : String(error),
  )
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`)
  } else {
    process.stderr.write(`${message}\n`)
  }
  return 1
}

// Every --json payload carrying database credentials goes through here, and
// every one of them is redacted unless --show-secrets was passed (issue #53):
// the connection string, and the discrete `password` / `restToken` /
// `psPassword` fields the cloud returns alongside it.
export function writeJson(value: unknown): void {
  const payload = revealSecrets ? value : redactJsonSecrets(value)
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}
