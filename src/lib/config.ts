import { homedir } from 'node:os'
import { join } from 'node:path'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const CONFIG_DIR = join(homedir(), '.config', 'layerbase')
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json')

export type StoredCredentials = {
  apiUrl: string
  apiKey: string
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
