import {
  getMe,
  listDatabases,
  resolveApiKey,
} from '@/lib/cloud-api'
import { loadCredentials } from '@/lib/config'
import { decodeTokenClaims } from '@/lib/token'
import { reportError } from '@/lib/cli-output'

// The top-level `whoami`, scriptable and mode-aware:
//   - key mode: GET /v1/me for identity + programmatic-create usage. Falls back
//     to a /v1/databases probe (validates the key) when /v1/me is not deployed.
//   - browser-JWT mode: decodes the stored token offline (no network), same as
//     before, so it works even before the web endpoints are deployed.
// Never renders Ink, so it is safe in CI/non-TTY.
export async function runWhoami(options: { json: boolean }): Promise<number> {
  const { json } = options

  const key = await resolveApiKey()
  if (key) {
    try {
      const me = await getMe()
      if (me) {
        const usage = me.usage?.programmaticCreates
        if (json) {
          process.stdout.write(
            `${JSON.stringify({
              loggedIn: true,
              mode: 'api-key',
              user: me.user,
              usage: me.usage ?? null,
            })}\n`,
          )
        } else {
          const plan = me.user.plan ? ` (${me.user.plan} plan)` : ''
          process.stdout.write(`Authenticated as ${me.user.email}${plan}.\n`)
          if (usage) {
            const limit = usage.limit == null ? 'unlimited' : usage.limit
            process.stdout.write(
              `Programmatic creates this month: ${usage.used}/${limit}` +
                ` (resets ${usage.resetsAt}).\n`,
            )
          }
        }
        return 0
      }

      // /v1/me not available yet: validate the key with a cheap read instead.
      await listDatabases()
      if (json) {
        process.stdout.write(
          `${JSON.stringify({
            loggedIn: true,
            mode: 'api-key',
            identity: 'unavailable',
          })}\n`,
        )
      } else {
        process.stdout.write(
          'Authenticated with API key (identity endpoint unavailable).\n',
        )
      }
      return 0
    } catch (error) {
      return reportError(error, json)
    }
  }

  // Browser-JWT mode: read the cached token, no network.
  const credentials = await loadCredentials()
  if (!credentials?.token) {
    if (json) {
      process.stdout.write(`${JSON.stringify({ loggedIn: false })}\n`)
    } else {
      process.stderr.write(
        'Not logged in. Run `layerbase login`, or set LAYERBASE_API_KEY.\n',
      )
    }
    return 1
  }

  const claims = decodeTokenClaims(credentials.token)
  const email = claims?.email ?? 'unknown'
  const expiresAtMs = claims?.exp ? claims.exp * 1000 : null
  if (json) {
    process.stdout.write(
      `${JSON.stringify({
        loggedIn: true,
        mode: 'browser',
        email,
        apiUrl: credentials.apiUrl,
        expiresAt: expiresAtMs,
      })}\n`,
    )
  } else {
    const expiry = expiresAtMs
      ? ` Token expires ${new Date(expiresAtMs).toISOString().slice(0, 10)}.`
      : ''
    process.stdout.write(
      `Signed in as ${email} at ${credentials.apiUrl}.${expiry}\n`,
    )
  }
  return 0
}
