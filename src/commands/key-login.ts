import {
  DEFAULT_API_URL,
  configureCloudAuth,
  getMe,
  listDatabases,
} from '@/lib/cloud-api'
import { saveApiKey } from '@/lib/config'
import { reportError } from '@/lib/cli-output'

// `layerbase login --api-key <key>`: a browser-less login for CI/agents. The
// key is validated (via /v1/me, or a /v1/databases probe if /v1/me is not
// deployed) and then written to the 0600 credentials file. Pure-env usage
// (LAYERBASE_API_KEY) needs no login at all; this is for persisting a key on a
// workstation or a self-hosted runner.
export async function runKeyLogin(options: {
  apiKey: string
  json: boolean
}): Promise<number> {
  const { apiKey, json } = options

  if (!apiKey.startsWith('sk_')) {
    const message =
      'That does not look like a Layerbase API key (expected an `sk_` prefix). ' +
      'Create one at https://layerbase.com/cloud/settings.'
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`)
    } else {
      process.stderr.write(`${message}\n`)
    }
    return 1
  }

  configureCloudAuth({ apiKey })

  try {
    const me = await getMe()
    if (!me) {
      // /v1/me not deployed yet: a successful list proves the key is valid.
      await listDatabases()
    }
    await saveApiKey({ apiKey, apiUrl: DEFAULT_API_URL })

    const email = me?.user.email
    if (json) {
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          mode: 'api-key',
          user: me?.user ?? null,
        })}\n`,
      )
    } else {
      process.stdout.write(
        `Saved API key${email ? ` for ${email}` : ''}. ` +
          'Cloud commands now run headlessly.\n',
      )
    }
    return 0
  } catch (error) {
    return reportError(error, json)
  }
}
