import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import {
  getMe,
  listDatabases,
  listEngines,
  resolveApiKey,
  whoami,
  CloudApiError,
} from '@/lib/cloud-api'
import type { CloudEngineInfo } from '@/lib/cloud-api'
import { loadCredentials } from '@/lib/config'
import { captureSpindb } from '@/lib/run-spindb'
import { decodeTokenClaims } from '@/lib/token'
import {
  cloudNodes,
  creatableEngineIds,
  localNodes,
  parseJsonDocument,
  TuiParseError,
  type TuiNode,
} from '@/tui/model'
import { anonymousSession, type SessionFacts } from '@/tui/session'

export type SourceSnapshot = {
  nodes: TuiNode[]
  error: string | null
}

function spindbInstalled(): boolean {
  const extensions =
    process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const extension of extensions) {
      if (existsSync(join(dir, `spindb${extension}`))) return true
    }
  }
  return false
}

function failureText(stderr: string, fallback: string): string {
  const line = stderr
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1)
  return line || fallback
}

export async function loadLocal(): Promise<SourceSnapshot> {
  if (!spindbInstalled()) {
    return { nodes: [], error: 'spindb is not installed' }
  }
  const listed = await captureSpindb(['list', '--json'])
  if (listed.code !== 0) {
    return {
      nodes: [],
      error: failureText(listed.stderr, 'spindb list failed'),
    }
  }
  let listJson: unknown
  try {
    listJson = parseJsonDocument(listed.stdout)
  } catch (error) {
    const message =
      error instanceof TuiParseError ? error.message : 'spindb list failed'
    return { nodes: [], error: message }
  }

  let treeJson: unknown | null = null
  const branched = await captureSpindb(['branch', 'list', '--json'])
  if (branched.code === 0) {
    try {
      treeJson = parseJsonDocument(branched.stdout)
    } catch {
      treeJson = null
    }
  }

  try {
    return { nodes: localNodes(listJson, treeJson), error: null }
  } catch (error) {
    const message =
      error instanceof TuiParseError ? error.message : 'spindb list failed'
    return { nodes: [], error: message }
  }
}

export async function loadSession(): Promise<SessionFacts> {
  const key = await resolveApiKey()
  const keyFromEnv = Boolean(process.env.LAYERBASE_API_KEY)
  const credentials = await loadCredentials()
  const hasBrowserToken = Boolean(credentials?.token)
  if (key) {
    try {
      const me = await getMe()
      if (!me) {
        return {
          ...anonymousSession(),
          mode: 'key',
          keyFromEnv,
          hasBrowserToken,
        }
      }
      return {
        mode: 'key',
        email: me.user.email,
        plan: me.user.plan ?? null,
        hasActivePlan: null,
        keyRejected: null,
        keyFromEnv,
        hasBrowserToken,
      }
    } catch (error) {
      const message =
        error instanceof CloudApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'request failed'
      return {
        ...anonymousSession(),
        mode: 'key',
        keyRejected: message,
        keyFromEnv,
        hasBrowserToken,
      }
    }
  }

  if (!credentials?.token) return anonymousSession()
  const email = decodeTokenClaims(credentials.token)?.email ?? null
  let hasActivePlan: boolean | null = null
  try {
    hasActivePlan = (await whoami()).hasActivePlan
  } catch {
    hasActivePlan = null
  }
  return {
    mode: 'jwt',
    email,
    plan: null,
    hasActivePlan,
    keyRejected: null,
    keyFromEnv: false,
    hasBrowserToken: true,
  }
}

export async function loadCloud(
  session: SessionFacts,
): Promise<SourceSnapshot> {
  if (session.mode === 'anonymous') return { nodes: [], error: null }
  if (session.keyRejected) {
    return { nodes: [], error: session.keyRejected }
  }
  try {
    return { nodes: cloudNodes(await listDatabases()), error: null }
  } catch (error) {
    const message =
      error instanceof CloudApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'cloud list failed'
    return { nodes: [], error: message }
  }
}

export async function loadCloudEngines(): Promise<
  { ids: string[] } | { error: string }
> {
  let catalog: CloudEngineInfo[]
  try {
    catalog = await listEngines()
  } catch (error) {
    const message =
      error instanceof CloudApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Could not read the cloud engine catalog.'
    return { error: message }
  }
  const ids = creatableEngineIds(catalog)
  if (ids.length === 0) {
    return { error: 'The cloud engine catalog has no creatable engines.' }
  }
  return { ids }
}
