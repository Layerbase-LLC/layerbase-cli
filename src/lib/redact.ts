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

// ─── Connection-string passwords ───────────────────────────────────
//
// Issue #53: `cloud ls --json` printed every database's connection string with
// the live password in it, so any transcript, CI log or support paste carried
// working credentials. Redaction is now the DEFAULT for everything the CLI
// prints; `--show-secrets` (alias `--reveal`) opts back in.
//
// The one deliberate exception is `cloud connection-string` (alias `url`),
// whose entire contract is "hand me the credential to pipe somewhere" - it is
// the escape hatch `printConnectionInfo` already points users at, and it stays
// verbatim.

export const REDACTED_PASSWORD = '****'

// `scheme://user:password@host` for every engine the CLI touches, and anything
// else URI-shaped. The password is the only part replaced: the scheme, user,
// host, port, path and query all survive, so a redacted string still tells you
// which database on which box a script was pointed at.
//
// Deliberately NOT `new URL()`: a connection string with an unencoded password
// (which the cloud's generated passwords avoid but a pasted source string may
// not) throws there, and a redactor that throws on the messy input is a
// redactor that leaks it.
// The password is matched GREEDILY up to the LAST `@` that is followed by
// something host-shaped, which is how a real URI parser resolves the ambiguity
// of an unencoded `@` inside a password. Stopping at the first `@` instead
// leaves the tail of such a password in the clear, which is the one case where
// getting this wrong actually leaks.
// The password class excludes the delimiters a connection string is USUALLY
// found next to: whitespace, quotes, angle brackets and commas. Two URIs on one
// comma-separated line would otherwise collapse into a single match, taking the
// first host and the second scheme with them, and `+` (not `*`) means
// `user:@host` - a URI with no password at all - is left alone instead of
// getting a mask that claims a password exists.
const URI_CREDENTIALS =
  /([a-z][a-z0-9+.-]*:\/\/)([^:/?#@\s]*):([^\s"'<>,]+)@(?=[^\s@]*(?:[/?#]|\s|$))/gi
// Query-string credentials. Not just `password`: a Redis REST endpoint carries
// `?token=`, and several migrate sources take `?api_key=`.
const QUERY_PASSWORD =
  /([?&](?:password|pwd|token|api_?key|auth_?token|secret)=)([^&#\s"']+)/gi

export function redactConnectionUri(value: string): string {
  return value
    .replace(
      URI_CREDENTIALS,
      (_match, scheme: string, user: string) =>
        `${scheme}${user}:${REDACTED_PASSWORD}@`,
    )
    .replace(
      QUERY_PASSWORD,
      (_match, key: string) => `${key}${REDACTED_PASSWORD}`,
    )
}

// Keys whose VALUE is a credential in its own right, not a URI. The cloud
// returns the same password through several of these: `restToken` on
// Redis/Valkey and `psPassword` on MySQL/MariaDB are literally `db.password`
// (layerbase-cloud src/api/databases/shared.ts), and `cloud create` / `cloud
// branch` return a top-level `password` as well. Redacting only URI-shaped
// strings left those in the clear, so `cloud ls --json` printed a masked
// connectionString directly above a usable password - worse than not masking at
// all, because it reads as safe.
//
// Compared after lowercasing and dropping `_`/`-`, so `api_key`, `apiKey` and
// `API-KEY` are one entry.
const SECRET_KEYS = new Set([
  'password',
  'pwd',
  'pspassword',
  'resttoken',
  'token',
  'authtoken',
  'accesstoken',
  'apikey',
  'apisecret',
  'secret',
  'sourcekey',
  'sourcesecret',
])

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))
}

// Walk a value about to be serialized as JSON and redact both the URI-shaped
// strings and the discrete credential fields in it, at any depth. Structure,
// key order and types are untouched, so a script that reads
// `.connectionString` or `.password` still finds the field - it just gets a
// value it cannot authenticate with.
export function redactJsonSecrets<T>(value: T): T {
  if (typeof value === 'string') {
    return redactConnectionUri(value) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonSecrets(item)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      // The EMPTY string is left exactly as it is. The cloud sends
      // `password: ''` on a row whose credentials are deliberately withheld
      // (an admin without a support grant), and masking that would invent a
      // password the caller was never given.
      if (isSecretKey(key) && typeof item === 'string' && item !== '') {
        out[key] = REDACTED_PASSWORD
        continue
      }
      out[key] = redactJsonSecrets(item)
    }
    return out as unknown as T
  }
  return value
}
