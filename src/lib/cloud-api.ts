import { loadCredentials } from './config'

// TODO(cloud): these /api/cli/* endpoints are the proposed CLI surface from
// plans/active/layerbase-cli-secure-connect.md and do not exist yet. They must
// be added on the layerbase-cloud / web side (reusing the dashboard's existing
// connection-info path and the API-key auth in src/api/api-keys.ts) before the
// connect commands work end to end.
export const DEFAULT_API_URL =
  process.env.LAYERBASE_API_URL ?? 'https://layerbase.com'

export type CloudDatabase = {
  id: string
  name: string
  engine: string
  status: string
  region?: string
}

export type ConnectionInfo = {
  engine: string
  host: string
  port: number
  database: string
  username: string
  password: string
  // Some engines hand back a ready-made URI instead of discrete parts.
  uri?: string
  tls?: boolean
}

async function authedFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const credentials = await loadCredentials()
  if (!credentials) {
    throw new Error('Not logged in. Run `layerbase login` first.')
  }

  const response = await fetch(new URL(path, credentials.apiUrl), {
    ...init,
    headers: {
      authorization: `Bearer ${credentials.apiKey}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Cloud API ${response.status}: ${body || response.statusText}. ` +
        'Check that you are logged in (`layerbase login`) and that the ' +
        'database id or name is correct (`layerbase ls`).',
    )
  }

  return response
}

export async function verifyApiKey(options: {
  apiUrl: string
  apiKey: string
}): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/cli/whoami', options.apiUrl), {
      headers: { authorization: `Bearer ${options.apiKey}` },
    })
    return response.ok
  } catch {
    return false
  }
}

export async function listDatabases(): Promise<CloudDatabase[]> {
  const response = await authedFetch('/api/cli/databases')
  return (await response.json()) as CloudDatabase[]
}

export async function getConnectionInfo(
  dbRef: string,
): Promise<ConnectionInfo> {
  const response = await authedFetch(
    `/api/cli/databases/${encodeURIComponent(dbRef)}/connection-info`,
  )
  return (await response.json()) as ConnectionInfo
}
