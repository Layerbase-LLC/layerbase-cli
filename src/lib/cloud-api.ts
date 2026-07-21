import { loadCredentials, loadStoredApiKey } from '@/lib/config'
import { getVersion } from '@/lib/version'

// Sent on every cloud API request so CLI traffic is attributable in server logs
// (vs the desktop app or the dashboard). Read from package.json, not hardcoded.
const USER_AGENT = `layerbase-cli/${getVersion()}`

// Interactive (browser-JWT) mode talks to the web app, which proxies to cloud.
// These /api/cli/* endpoints and the /auth/cli login pages live in the web app
// (app/(frontend)/api/cli/* and app/(frontend)/auth/cli/*).
export const DEFAULT_API_URL =
  process.env.LAYERBASE_API_URL ?? 'https://layerbase.com'

// Headless (sk_ key) mode talks DIRECTLY to the cloud /v1 API - the same base
// the public /docs/api and the desktop app use - skipping the web proxy. The
// enforcement (quota/suspension/rate-limit) already lives cloud-side.
const DEFAULT_CLOUD_API_URL = 'https://cloud.layerbase.dev'

export function cloudApiBaseUrl(): string {
  return process.env.LAYERBASE_CLOUD_API_URL ?? DEFAULT_CLOUD_API_URL
}

// Set once from the CLI flags (before any cloud call) so `--api-key` wins over
// the env var and the stored key. Kept as module state to avoid threading an
// auth argument through every command; the CLI is a single-shot process.
let apiKeyFlag: string | undefined

export function configureCloudAuth(options: { apiKey?: string }): void {
  apiKeyFlag = options.apiKey
}

// Precedence: --api-key flag > LAYERBASE_API_KEY env > stored key file. Pure so
// the precedence is unit-testable without touching the filesystem or env.
export function pickApiKey(sources: {
  flag?: string
  env?: string
  stored?: string | null
}): string | undefined {
  return sources.flag || sources.env || sources.stored || undefined
}

export async function resolveApiKey(): Promise<string | undefined> {
  return pickApiKey({
    flag: apiKeyFlag,
    env: process.env.LAYERBASE_API_KEY,
    stored: await loadStoredApiKey(),
  })
}

type ResolvedAuth =
  | { mode: 'key'; apiKey: string; baseUrl: string }
  | { mode: 'jwt'; token: string; apiUrl: string }

export async function resolveAuth(): Promise<ResolvedAuth> {
  const key = await resolveApiKey()
  if (key) {
    return { mode: 'key', apiKey: key, baseUrl: cloudApiBaseUrl() }
  }

  const credentials = await loadCredentials()
  if (!credentials?.token) {
    throw new CloudApiError({
      status: 0,
      message:
        'Not authenticated. Set LAYERBASE_API_KEY (or pass --api-key) for ' +
        'headless use, or run `layerbase login`.',
    })
  }
  return { mode: 'jwt', token: credentials.token, apiUrl: credentials.apiUrl }
}

export type CloudErrorInfo = {
  status: number
  code?: string
  message: string
  body?: Record<string, unknown>
}

export class CloudApiError extends Error {
  info: CloudErrorInfo
  constructor(info: CloudErrorInfo) {
    super(info.message)
    this.name = 'CloudApiError'
    this.info = info
  }
}

// A distinct, script-friendly exit code per failure class. 0 is success; 1 is a
// generic/usage error. Agents can branch on these without parsing text.
export function exitCodeForStatus(status: number): number {
  switch (status) {
    case 401:
      return 3 // auth: invalid/revoked/expired credentials
    case 402:
      return 4 // billing: suspended account
    case 409:
      return 5 // capacity: pool exhausted, try later
    case 429:
      return 6 // quota / rate limit
    default:
      return 1
  }
}

function mapErrorMessage(
  status: number,
  code: string | undefined,
  serverMessage: string,
  body: Record<string, unknown>,
  mode: 'key' | 'jwt',
): string {
  // Typed codes carry the clearest intent regardless of their HTTP status.
  if (code === 'invalid_ttl') {
    return (
      serverMessage || '--ttl must be a whole number of hours between 1 and 72.'
    )
  }
  if (code === 'branch_on_transient_forbidden') {
    return (
      'Transient (--ttl) databases cannot be branched. Create a non-TTL ' +
      'parent database for branch-per-PR workflows.'
    )
  }
  if (status === 401) {
    return mode === 'key'
      ? 'Invalid or revoked API key. Create a new one at ' +
          'https://layerbase.com/cloud/settings.'
      : 'Your session has expired. Run `layerbase login` to sign in again.'
  }
  if (status === 402) {
    return (
      serverMessage ||
      'Your account is paused. Add credits or contact support to resume.'
    )
  }
  if (status === 429 && code === 'programmatic_create_limit_reached') {
    const used = body.used ?? '?'
    const limit = body.limit ?? '?'
    const resets =
      typeof body.resetsAt === 'string' ? ` Resets ${body.resetsAt}.` : ''
    return (
      `Monthly programmatic create limit reached (${used}/${limit}).${resets} ` +
      'Upgrade for a higher limit at https://layerbase.com/pricing.'
    )
  }
  if (status === 429) {
    return serverMessage || 'Rate limited. Wait a moment and try again.'
  }
  if (status === 409) {
    return (
      serverMessage ||
      'Cloud capacity is temporarily unavailable. Try again shortly.'
    )
  }
  return `Cloud API ${status}: ${serverMessage}`
}

async function toCloudError(
  response: Response,
  mode: 'key' | 'jwt',
): Promise<CloudApiError> {
  let body: Record<string, unknown> = {}
  const text = await response.text().catch(() => '')
  if (text) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') {
        body = parsed as Record<string, unknown>
      }
    } catch {
      body = { error: text }
    }
  }
  const code = typeof body.code === 'string' ? body.code : undefined
  const serverMessage =
    typeof body.error === 'string' ? body.error : response.statusText
  return new CloudApiError({
    status: response.status,
    code,
    body,
    message: mapErrorMessage(response.status, code, serverMessage, body, mode),
  })
}

async function rawFetch(
  url: URL,
  token: string,
  mode: 'key' | 'jwt',
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      ...init?.headers,
    },
  })
  if (!response.ok) {
    throw await toCloudError(response, mode)
  }
  return response
}

// For endpoints that exist in BOTH modes with the same response shape: pick the
// /v1 path (key) or the /api/cli path (jwt) based on the resolved auth.
async function dualFetch(
  paths: { v1: string; jwt: string },
  init?: RequestInit,
): Promise<Response> {
  const auth = await resolveAuth()
  if (auth.mode === 'key') {
    return rawFetch(new URL(paths.v1, auth.baseUrl), auth.apiKey, 'key', init)
  }
  return rawFetch(new URL(paths.jwt, auth.apiUrl), auth.token, 'jwt', init)
}

// For cloud /v1-only endpoints (all mutations + /v1/me): requires a key. Fails
// with a clear, actionable message when only a browser JWT is available, since
// the web proxy does not expose these.
async function keyFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = await resolveAuth()
  if (auth.mode !== 'key') {
    throw new CloudApiError({
      status: 0,
      message:
        'This command needs a Layerbase API key. Set LAYERBASE_API_KEY or ' +
        'pass --api-key (create one at https://layerbase.com/cloud/settings).',
    })
  }
  return rawFetch(new URL(path, auth.baseUrl), auth.apiKey, 'key', init)
}

export type CloudDatabase = {
  id: string
  name: string
  engine: string
  status: string
  region?: string
  version?: string
  // Transient-database TTL: `transient` flags a TTL database, `expiresAt` is its
  // ISO auto-delete time (null for a normal database). expires_at is read as a
  // defensive fallback in case an older cloud API uses the snake_case spelling.
  transient?: boolean
  expiresAt?: string | null
  expires_at?: string | null
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

// GET /v1/me (added in a parallel cloud PR). programmaticCreates reports the
// monthly api-key-authenticated create usage so agents can report standing.
export type MeResponse = {
  user: { id: string; email: string; plan?: string | null }
  usage?: {
    programmaticCreates?: {
      used: number
      // null when the plan is unmetered (Dedicated/Custom on own hardware).
      limit: number | null
      // ISO, the first instant of next UTC month.
      resetsAt: string
    }
  }
}

// The subset of GET /v1/databases/:id we map into ConnectionInfo for key mode.
type V1Database = {
  engine: string
  version?: string
  host: string
  port: number
  database: string
  username: string
  password: string
  connectionString?: string
}

// Browser-JWT identity enrichment, called right after an interactive login to
// backfill the cached cloud API key. JWT-only by design (the shape differs from
// the headless /v1/me below); key-mode callers use getMe() instead.
export async function whoami(): Promise<WhoamiResponse> {
  const credentials = await loadCredentials()
  if (!credentials?.token) {
    throw new CloudApiError({
      status: 0,
      message: 'Not logged in. Run `layerbase login` first.',
    })
  }
  const response = await rawFetch(
    new URL('/api/cli/whoami', credentials.apiUrl),
    credentials.token,
    'jwt',
  )
  return (await response.json()) as WhoamiResponse
}

// Headless identity + usage. Returns null when /v1/me is not deployed yet (404)
// so the caller can fall back to a database-list probe.
export async function getMe(): Promise<MeResponse | null> {
  try {
    const response = await keyFetch('/v1/me')
    return (await response.json()) as MeResponse
  } catch (error) {
    if (error instanceof CloudApiError && error.info.status === 404) {
      return null
    }
    throw error
  }
}

export async function listDatabases(): Promise<CloudDatabase[]> {
  const response = await dualFetch({
    v1: '/v1/databases',
    jwt: '/api/cli/databases',
  })
  const data = (await response.json()) as { databases: CloudDatabase[] }
  return data.databases
}

// Resolve a name-or-id to a concrete database id (the /v1 mutation endpoints are
// id-addressable). An exact id match wins over a name match.
export async function resolveDatabaseId(ref: string): Promise<string> {
  const databases = await listDatabases()
  const byId = databases.find((db) => db.id === ref)
  if (byId) return byId.id
  const byName = databases.find((db) => db.name === ref)
  if (byName) return byName.id
  throw new CloudApiError({
    status: 404,
    message:
      `No cloud database matches "${ref}". ` +
      'Run `layerbase cloud ls` to see yours.',
  })
}

export async function getConnectionInfo(
  dbRef: string,
): Promise<ConnectionInfo> {
  const auth = await resolveAuth()
  if (auth.mode === 'jwt') {
    const response = await rawFetch(
      new URL(
        `/api/cli/databases/${encodeURIComponent(dbRef)}/connection-info`,
        auth.apiUrl,
      ),
      auth.token,
      'jwt',
    )
    return (await response.json()) as ConnectionInfo
  }

  // Key mode: resolve to an id, read the full database, map its credentials.
  const id = await resolveDatabaseId(dbRef)
  const response = await keyFetch(`/v1/databases/${encodeURIComponent(id)}`)
  const db = (await response.json()) as V1Database
  return {
    engine: db.engine,
    version: db.version,
    host: db.host,
    port: db.port,
    database: db.database,
    username: db.username,
    password: db.password,
    uri: db.connectionString,
  }
}

export type CreateDatabaseResult = {
  id: string
  name: string
  engine: string
  version?: string
  status: string
  connectionString?: string
  directConnectionString?: string | null
  transient?: boolean
  expiresAt?: string | null
  expires_at?: string | null
}

export async function createDatabase(options: {
  name: string
  engine: string
  ttlHours?: number
}): Promise<CreateDatabaseResult> {
  const body: Record<string, unknown> = {
    engine: options.engine,
    name: options.name,
  }
  if (options.ttlHours != null) {
    body.ttlHours = options.ttlHours
  }
  const response = await keyFetch('/v1/databases', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return (await response.json()) as CreateDatabaseResult
}

export async function destroyDatabase(id: string): Promise<void> {
  await keyFetch(`/v1/databases/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function startDatabase(
  id: string,
): Promise<Record<string, unknown>> {
  const response = await keyFetch(
    `/v1/databases/${encodeURIComponent(id)}/start`,
    { method: 'POST' },
  )
  return (await response.json()) as Record<string, unknown>
}

export async function stopDatabase(
  id: string,
): Promise<Record<string, unknown>> {
  const response = await keyFetch(
    `/v1/databases/${encodeURIComponent(id)}/stop`,
    { method: 'POST' },
  )
  return (await response.json()) as Record<string, unknown>
}

export type BranchInfo = {
  id: string
  name: string
  engine: string
  status: string
  connectionString?: string
  branchedAt?: string | null
  branchMethod?: string | null
}

// Create (or, per ifExists, reuse/reset) a branch by name off a parent database.
// ifExists defaults to 'reuse' so `branch <db> <name>` is idempotent: rerunning
// it in CI returns the existing branch instead of erroring or auto-suffixing.
export async function createBranch(options: {
  parentId: string
  name: string
  ifExists?: 'reuse' | 'reset' | 'error'
}): Promise<BranchInfo> {
  const response = await keyFetch(
    `/v1/databases/${encodeURIComponent(options.parentId)}/branch`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: options.name,
        ifExists: options.ifExists ?? 'reuse',
      }),
    },
  )
  return (await response.json()) as BranchInfo
}

export async function resetBranch(options: {
  parentId: string
  name: string
}): Promise<BranchInfo> {
  // Reset is the ifExists='reset' path of the same by-name create endpoint:
  // re-fork the branch from the parent's current state.
  return createBranch({ ...options, ifExists: 'reset' })
}

export async function deleteBranch(options: {
  parentId: string
  name: string
}): Promise<void> {
  await keyFetch(
    `/v1/databases/${encodeURIComponent(options.parentId)}/branches/` +
      encodeURIComponent(options.name),
    { method: 'DELETE' },
  )
}

export async function listBranches(parentId: string): Promise<BranchInfo[]> {
  const response = await keyFetch(
    `/v1/databases/${encodeURIComponent(parentId)}/branches`,
  )
  const data = (await response.json()) as { branches: BranchInfo[] }
  return data.branches
}

// ─── Migration (import an external database INTO a cloud database) ───────────
//
// Contract mirrors layerbase-cloud src/api/databases/import-export.ts:
//   POST /v1/databases/:id/migrate-preflight   (connection-string sources only)
//   POST /v1/databases/:id/migrate-from-source (202 + runId)
//   GET  /v1/databases/:id/migration-runs/:runId (poll)
//   POST /v1/migrations/discover               (api-key source listing)
// All are /v1-only, so they run through keyFetch (headless key required).

// Successful preflight (HTTP 200). A failed preflight (bad creds / unreachable
// source) comes back as a non-2xx and is thrown as a CloudApiError instead.
export type MigratePreflightResult = {
  ok: boolean
  provider?: string
  rewritten?: boolean
  note?: string | null
  serverVersionNum?: number | null
  sizeBytes?: number | null
}

export async function migratePreflight(options: {
  targetId: string
  connectionString: string
}): Promise<MigratePreflightResult> {
  const response = await keyFetch(
    `/v1/databases/${encodeURIComponent(options.targetId)}/migrate-preflight`,
    {
      method: 'POST',
      body: JSON.stringify({ connectionString: options.connectionString }),
    },
  )
  return (await response.json()) as MigratePreflightResult
}

// Non-secret reference to one discoverable source database (the API key never
// travels in it). Shape mirrors the cloud MigrationSourceRef.
export type MigrationSourceRef = {
  projectId?: string
  branchId?: string
  database?: string
  role?: string
  databaseId?: string
  environmentId?: string
  serviceId?: string
  appId?: string
  indexName?: string
  label?: string
}

export type DiscoveredSource = {
  ref: MigrationSourceRef
  label: string
  engine: string
  sizeHint?: number | null
  branchCount?: number
}

export async function discoverSources(options: {
  provider: string
  apiKey: string
  apiKeyId?: string
}): Promise<{
  provider: string
  engine: string
  databases: DiscoveredSource[]
}> {
  const body: Record<string, unknown> = {
    provider: options.provider,
    apiKey: options.apiKey,
  }
  if (options.apiKeyId) body.apiKeyId = options.apiKeyId
  const response = await keyFetch('/v1/migrations/discover', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return (await response.json()) as {
    provider: string
    engine: string
    databases: DiscoveredSource[]
  }
}

export type MigrationStartResult = {
  runId: string
  status: string
  databaseId: string
}

// The body is EITHER { connectionString } (paste sources) or
// { provider, apiKey, apiKeyId?, sourceSecret?, sourceRef } (api-key sources).
// Kept as an opaque record so the credential shaping lives in the command layer.
export async function migrateFromSource(options: {
  targetId: string
  body: Record<string, unknown>
}): Promise<MigrationStartResult> {
  const response = await keyFetch(
    `/v1/databases/${encodeURIComponent(options.targetId)}/migrate-from-source`,
    { method: 'POST', body: JSON.stringify(options.body) },
  )
  return (await response.json()) as MigrationStartResult
}

export type MigrationRun = {
  id: string
  databaseId: string
  status: string
  sourceProvider: string | null
  bytesEstimated: number | null
  error: string | null
  report: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export async function getMigrationRun(options: {
  targetId: string
  runId: string
}): Promise<MigrationRun> {
  const response = await keyFetch(
    `/v1/databases/${encodeURIComponent(options.targetId)}/migration-runs/` +
      encodeURIComponent(options.runId),
  )
  return (await response.json()) as MigrationRun
}

// ─── Dump-file import (whole-DB restore via presigned R2 upload) ─────────────
//
//   POST /v1/databases/:id/import/presign  -> presigned PUT URL + r2Key
//   PUT  <uploadUrl>                        (the file bytes, unauthenticated)
//   POST /v1/databases/:id/import/from-r2  -> synchronous restore + report

export type PresignImportResult = {
  uploadUrl: string
  r2Key: string
  maxBytes: number
  expiresInSeconds: number
}

export async function presignImport(
  targetId: string,
): Promise<PresignImportResult> {
  const response = await keyFetch(
    `/v1/databases/${encodeURIComponent(targetId)}/import/presign`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  return (await response.json()) as PresignImportResult
}

// PUT the dump bytes straight to R2. The URL is presigned (bucket + key +
// expiry only, no signed content-type), so this carries NO Authorization
// header - it must not, or the signature check fails. A non-2xx becomes a
// CloudApiError so the command layer reports it uniformly.
export async function uploadToPresignedUrl(
  url: string,
  body: Buffer | Uint8Array,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(url, { method: 'PUT', body })
  } catch (error) {
    throw new CloudApiError({
      status: 0,
      message: `Upload failed: ${error instanceof Error ? error.message : 'network error'}`,
    })
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new CloudApiError({
      status: response.status,
      message:
        `Upload to storage failed (HTTP ${response.status}).` +
        (detail ? ` ${detail.slice(0, 200)}` : ''),
    })
  }
}

export type ImportFromR2Result = {
  message: string
  database: string
  engine: string
  bytesUploaded: number
}

export async function importFromR2(options: {
  targetId: string
  r2Key: string
}): Promise<ImportFromR2Result> {
  const response = await keyFetch(
    `/v1/databases/${encodeURIComponent(options.targetId)}/import/from-r2`,
    { method: 'POST', body: JSON.stringify({ r2Key: options.r2Key }) },
  )
  return (await response.json()) as ImportFromR2Result
}
