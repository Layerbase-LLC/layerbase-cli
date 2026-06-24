import { loadCredentials } from '@/lib/config'

// These /api/cli/* endpoints and the /auth/cli login pages are implemented in
// the layerbase web app (app/(frontend)/api/cli/* and app/(frontend)/auth/cli/*).
// They must be deployed for `login` and the cloud calls below to work; the CLI
// authenticates with the 30-day JWT and the web app proxies to the cloud API,
// exactly like layerbase-desktop.
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
  // Engine version (e.g. '17', '8.0'), used to create a matching local
  // container when cloning. Optional: present once the cloud connection-info
  // endpoint exposes it.
  version?: string
  host: string
  port: number
  database: string
  username: string
  password: string
  // Some engines hand back a ready-made URI instead of discrete parts.
  uri?: string
  tls?: boolean
}

export type WhoamiResponse = {
  user: {
    id: string
    email: string
    name: string | null
    avatarUrl: string | null
    role: 'admin' | 'user' | null
  }
  hasActivePlan: boolean
  cloudApiKey: string | null
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
      authorization: `Bearer ${credentials.token}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
  })

  if (response.status === 401) {
    throw new Error(
      'Your session has expired. Run `layerbase login` to sign in again.',
    )
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Cloud API ${response.status}: ${body || response.statusText}. ` +
        'Check the database id or name (`layerbase ls`).',
    )
  }

  return response
}

export async function whoami(): Promise<WhoamiResponse> {
  const response = await authedFetch('/api/cli/whoami')
  return (await response.json()) as WhoamiResponse
}

export async function listDatabases(): Promise<CloudDatabase[]> {
  const response = await authedFetch('/api/cli/databases')
  const data = (await response.json()) as { databases: CloudDatabase[] }
  return data.databases
}

export async function getConnectionInfo(
  dbRef: string,
): Promise<ConnectionInfo> {
  const response = await authedFetch(
    `/api/cli/databases/${encodeURIComponent(dbRef)}/connection-info`,
  )
  return (await response.json()) as ConnectionInfo
}
