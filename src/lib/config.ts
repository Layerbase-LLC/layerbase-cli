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
  // Cached cloud API key from /api/cli/whoami, like the desktop app stores.
  cloudApiKey?: string | null
  // A personal `sk_` API key saved by `layerbase login --api-key <key>`. When
  // present, cloud calls go DIRECTLY to the cloud /v1 API (no browser, no JWT).
  // This is distinct from `cloudApiKey`, the internal web-app credential.
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

// The stored personal `sk_` key, if a headless `login --api-key` saved one.
// The env var and the --api-key flag take precedence over this (see
// resolveApiKey in cloud-api), so this is only the lowest-priority source.
export async function loadStoredApiKey(): Promise<string | null> {
  const credentials = await loadCredentials()
  return credentials?.apiKey ?? null
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
