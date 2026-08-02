import { homedir } from 'node:os'
import { join } from 'node:path'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

// Mirrors layerbase-desktop's ~/.layerbase-desktop convention. The desktop app
// relies on Electron safeStorage (OS-encrypted); a plain CLI has no equivalent,
// so we lock the file down to 0600 ourselves.
const CONFIG_DIR = join(homedir(), '.layerbase-cli')
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json')

export type StoredCredentials = {
  apiUrl: string
  // The 30-day Layerbase CLI token (JWT), sent as `Authorization: Bearer` for
  // the interactive browser-login path. Absent for a headless key-only login.
  token?: string
  // LEGACY (<= 1.2.0): where the browser login used to cache the cloud API key
  // from /api/cli/whoami. Nothing ever read it, so every mutation failed after
  // an interactive login. Both logins now write `apiKey`; this field is only
  // still read (see pickStoredApiKey) so existing files heal without a re-login.
  cloudApiKey?: string | null
  // The `sk_` cloud API key. Written by BOTH login paths: `login --api-key
  // <key>` (a personal key) and the browser login (the account key returned by
  // /api/cli/whoami). When present, cloud calls that have no web-proxy
  // equivalent - every mutation, plus /v1/me - go DIRECTLY to the cloud /v1 API.
  apiKey?: string
}

export async function saveCredentials(
  credentials: StoredCredentials,
): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  })
  // writeFile honours umask on an existing file, so force the mode explicitly.
  await chmod(CREDENTIALS_FILE, 0o600)
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_FILE, 'utf8')
    return JSON.parse(raw) as StoredCredentials
  } catch {
    return null
  }
}

export async function clearCredentials(): Promise<void> {
  await rm(CREDENTIALS_FILE, { force: true })
}

export function credentialsPath(): string {
  return CREDENTIALS_FILE
}

// The stored `sk_` key from either login path, with a fallback to the legacy
// `cloudApiKey` slot so a credentials file written by <= 1.2.0's browser login
// keeps working. Pure so the fallback is unit-testable without touching disk.
export function pickStoredApiKey(
  credentials: StoredCredentials | null,
): string | null {
  return credentials?.apiKey || credentials?.cloudApiKey || null
}

// The stored `sk_` key, if either `layerbase login` or `login --api-key` saved
// one. The env var and the --api-key flag take precedence over this (see
// resolveApiKey in cloud-api), so this is only the lowest-priority source.
export async function loadStoredApiKey(): Promise<string | null> {
  return pickStoredApiKey(await loadCredentials())
}

// Persist a personal API key without a browser login (CI/agents). Preserves any
// existing JWT/apiUrl so a user who logged in interactively and then adds a key
// keeps both.
export async function saveApiKey(options: {
  apiKey: string
  apiUrl: string
}): Promise<void> {
  const existing = await loadCredentials()
  await saveCredentials({
    ...(existing ?? {}),
    apiUrl: existing?.apiUrl ?? options.apiUrl,
    apiKey: options.apiKey,
  })
}
