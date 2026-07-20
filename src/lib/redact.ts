// Credential redaction for anything the CLI prints (error text, --json output).
// Migration flows carry source connection strings + provider API keys; none of
// them may ever land in stdout/stderr. The cloud already redacts its own error
// messages (see redactConnStrings in layerbase-cloud), so this is a CLI-side
// backstop: strip any known secret value AND any connection-string-shaped token
// before writing a message.

// Replace each provided secret value (a pasted key, token, password, or
// connection string) with a placeholder, then blanket-redact any remaining
// connection-string-shaped substrings. Empty/whitespace secrets are ignored so
// an empty flag never turns into a `[redacted]` that eats real text.
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text
  for (const secret of secrets) {
    const trimmed = secret.trim()
    if (trimmed.length < 4) continue
    out = out.split(trimmed).join('[redacted]')
  }
  return out
    .replace(
      /\b(?:postgres(?:ql)?|mysql|rediss?|libsql):\/\/\S+/gi,
      '[redacted connection string]',
    )
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
}
