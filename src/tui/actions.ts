import {
  createBranch,
  createDatabase,
  getConnectionInfo,
  hibernateDatabase,
  startDatabase,
  stopDatabase,
  wakeDatabase,
  CloudApiError,
} from '@/lib/cloud-api'
import { buildConnectionString } from '@/lib/format'
import { openBrowser } from '@/lib/open-browser'
import { captureSpindb, parseLastJson, runSpindb } from '@/lib/run-spindb'
import {
  cloudPageUrl,
  connectionStringFromJson,
  copyToClipboard,
  launchDetached,
  type DesktopLaunch,
} from '@/tui/launch'
import { missingEngineBinary } from '@/tui/binary'
import { canBind, chooseOpenPort } from '@/tui/ports'

type ActionResult =
  | { ok: true; name: string; message?: string }
  | { ok: false; message: string; needsBinary?: boolean }

const SKIP_ERROR_LINE =
  /^(examine the log output\.?|pg_ctl: could not start server)$/i

function usefulLine(text: string): string | null {
  const lines = text
    .split('\n')
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line) continue
    const cleaned = line.replace(/\s*Examine the log output\.?\s*$/i, '').trim()
    if (!cleaned || SKIP_ERROR_LINE.test(cleaned)) continue
    if (/^pg_ctl start failed with code \d+:?$/i.test(cleaned)) continue
    return cleaned.length > 160 ? `${cleaned.slice(0, 159)}~` : cleaned
  }
  return null
}

// pg_ctl's own last line is "Examine the log output." The reason is the line
// above it. Skip that hint so the footer shows the failure.
export function pickErrorLine(
  stdout: string,
  stderr: string,
  fallback: string,
): string {
  const parsed = parseLastJson(stdout)
  const error = parsed?.error
  if (typeof error === 'string' && error.trim()) {
    const fromJson = usefulLine(error)
    if (fromJson) return fromJson
  }
  return usefulLine(stderr) || usefulLine(stdout) || fallback
}

function messageFrom(stdout: string, stderr: string, fallback: string): string {
  return pickErrorLine(stdout, stderr, fallback)
}

function looksLikePortFailure(message: string): boolean {
  const text = message.toLowerCase()
  return (
    text.includes('address already in use') ||
    text.includes('could not bind') ||
    text.includes('eaddrinuse') ||
    text.includes('could not start server') ||
    text.includes('examine the log') ||
    text.includes('pg_ctl start failed')
  )
}

export async function createLocalDatabase(options: {
  name: string
  engine: string
}): Promise<ActionResult> {
  const result = await captureSpindb([
    'create',
    options.name,
    '--engine',
    options.engine,
    '--start',
    '--json',
  ])
  if (result.code !== 0) {
    return {
      ok: false,
      message: messageFrom(
        result.stdout,
        result.stderr,
        'spindb create failed',
      ),
    }
  }
  const parsed = parseLastJson(result.stdout)
  const name = typeof parsed?.name === 'string' ? parsed.name : options.name
  return { ok: true, name }
}

export async function createLocalBranch(options: {
  source: string
  name: string
}): Promise<ActionResult> {
  const result = await captureSpindb([
    'branch',
    'create',
    options.source,
    options.name,
    '--json',
  ])
  if (result.code !== 0) {
    return {
      ok: false,
      message: messageFrom(
        result.stdout,
        result.stderr,
        'spindb branch failed',
      ),
    }
  }
  return { ok: true, name: options.name }
}

export async function createCloudDatabase(options: {
  name: string
  engine: string
}): Promise<ActionResult> {
  try {
    const created = await createDatabase({
      name: options.name,
      engine: options.engine,
      source: { via: 'cli' },
    })
    return { ok: true, name: created.name }
  } catch (error) {
    const message =
      error instanceof CloudApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'cloud create failed'
    return { ok: false, message }
  }
}

export async function createCloudBranch(options: {
  parentId: string
  name: string
}): Promise<ActionResult> {
  try {
    const branch = await createBranch({
      parentId: options.parentId,
      name: options.name,
    })
    return { ok: true, name: branch.name }
  } catch (error) {
    const message =
      error instanceof CloudApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'cloud branch failed'
    return { ok: false, message }
  }
}

export async function connectLocal(name: string): Promise<number> {
  return runSpindb(['connect', name])
}

async function moveLocalPort(options: {
  name: string
  engine: string
  port: number
  reservedPorts: readonly number[]
  holder: string | null
}): Promise<
  { ok: true; port: number; note: string } | { ok: false; message: string }
> {
  const next = await chooseOpenPort({
    engine: options.engine,
    avoid: options.port,
    reserved: options.reservedPorts,
  })
  if (!next) {
    const who = options.holder ? ` by ${options.holder}` : ''
    return {
      ok: false,
      message: `Port ${options.port} is in use${who}, and no free ${options.engine} port is left.`,
    }
  }
  const edited = await captureSpindb([
    'edit',
    options.name,
    '--port',
    String(next),
    '--json',
  ])
  if (edited.code !== 0) {
    return {
      ok: false,
      message: messageFrom(edited.stdout, edited.stderr, 'spindb edit failed'),
    }
  }
  const who = options.holder
    ? `${options.port} is used by ${options.holder}.`
    : `Port ${options.port} was already in use.`
  return {
    ok: true,
    port: next,
    note: `Started ${options.name} on port ${next}. ${who}`,
  }
}

export async function setLocalPower(options: {
  name: string
  verb: 'start' | 'stop'
  engine?: string
  port?: number | null
  reservedPorts?: readonly number[]
  holder?: string | null
}): Promise<ActionResult> {
  let moved: string | null = null
  if (
    options.verb === 'start' &&
    options.engine &&
    options.port &&
    !(await canBind(options.port))
  ) {
    const relocated = await moveLocalPort({
      name: options.name,
      engine: options.engine,
      port: options.port,
      reservedPorts: options.reservedPorts ?? [],
      holder: options.holder ?? null,
    })
    if (!relocated.ok) return relocated
    moved = relocated.note
  }
  let result = await captureSpindb([options.verb, options.name])
  if (
    result.code !== 0 &&
    !moved &&
    options.verb === 'start' &&
    options.engine &&
    options.port
  ) {
    const reason = messageFrom(result.stdout, result.stderr, '')
    if (looksLikePortFailure(reason)) {
      const relocated = await moveLocalPort({
        name: options.name,
        engine: options.engine,
        port: options.port,
        reservedPorts: options.reservedPorts ?? [],
        holder: options.holder ?? null,
      })
      if (!relocated.ok) return relocated
      moved = relocated.note
      result = await captureSpindb(['start', options.name])
    }
  }
  if (result.code !== 0) {
    const raw = `${result.stdout}\n${result.stderr}`
    return {
      ok: false,
      message: messageFrom(
        result.stdout,
        result.stderr,
        `spindb ${options.verb} failed`,
      ),
      needsBinary: options.verb === 'start' && missingEngineBinary(raw),
    }
  }
  return { ok: true, name: options.name, message: moved ?? undefined }
}

export async function downloadEngine(options: {
  engine: string
  version: string
}): Promise<ActionResult> {
  const result = await captureSpindb([
    'engines',
    'download',
    options.engine,
    options.version,
  ])
  if (result.code !== 0) {
    return {
      ok: false,
      message: messageFrom(
        result.stdout,
        result.stderr,
        `Could not download ${options.engine} ${options.version}.`,
      ),
    }
  }
  return { ok: true, name: options.engine }
}

function cloudFailure(error: unknown, fallback: string): ActionResult {
  const message =
    error instanceof CloudApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : fallback
  return { ok: false, message }
}

function hideSecret(message: string): string {
  if (/:\/\/\S*@/.test(message)) return 'Could not read the connection string.'
  return message
}

async function copyValue(value: string, name: string): Promise<ActionResult> {
  const copied = await copyToClipboard(value)
  if (!copied) {
    return { ok: false, message: 'Could not copy to the clipboard.' }
  }
  return {
    ok: true,
    name,
    message: `Copied the connection string for ${name}.`,
  }
}

export async function copyLocalConnection(name: string): Promise<ActionResult> {
  const result = await captureSpindb(['url', name, '--json', '--password'])
  const parsed = connectionStringFromJson(result.stdout)
  if (!parsed.ok) {
    return {
      ok: false,
      message: hideSecret(
        parsed.message || 'Could not read the connection string.',
      ),
    }
  }
  return copyValue(parsed.value, name)
}

export async function copyCloudConnection(options: {
  id: string
  name: string
}): Promise<ActionResult> {
  try {
    const info = await getConnectionInfo(options.id)
    return copyValue(buildConnectionString(info), options.name)
  } catch (error) {
    const failed = cloudFailure(error, 'Could not read the connection string.')
    return {
      ok: false,
      message: hideSecret(
        failed.message ?? 'Could not read the connection string.',
      ),
    }
  }
}

export async function openCloudPage(options: {
  id: string
  name: string
  page: 'dashboard' | 'query'
}): Promise<ActionResult> {
  const url = cloudPageUrl({ id: options.id, page: options.page })
  try {
    await openBrowser(url)
  } catch {
    return { ok: false, message: `Could not open ${url}` }
  }
  const message =
    options.page === 'query'
      ? `Opened the query IDE for ${options.name}.`
      : `Opened ${options.name} in Layerbase Web.`
  return { ok: true, name: options.name, message }
}

export async function openLayerbaseDesktop(
  launch: DesktopLaunch,
): Promise<ActionResult> {
  try {
    await launchDetached(launch)
  } catch {
    return { ok: false, message: 'Could not open Layerbase Desktop.' }
  }
  return {
    ok: true,
    name: 'Layerbase',
    message: 'Opened Layerbase Desktop.',
  }
}

export async function setCloudPower(options: {
  id: string
  name: string
  verb: 'start' | 'stop' | 'wake' | 'hibernate'
}): Promise<ActionResult> {
  try {
    const result =
      options.verb === 'start'
        ? await startDatabase(options.id)
        : options.verb === 'stop'
          ? await stopDatabase(options.id)
          : options.verb === 'wake'
            ? await wakeDatabase(options.id)
            : await hibernateDatabase(options.id)
    const status = typeof result.status === 'string' ? result.status : null
    if (options.verb === 'wake') {
      return {
        ok: true,
        name: options.name,
        message: status
          ? `${options.name}: ${status}`
          : `Waking ${options.name}.`,
      }
    }
    return {
      ok: true,
      name: options.name,
      message: status
        ? `${options.name}: ${status}`
        : `${options.verb} ${options.name}`,
    }
  } catch (error) {
    return cloudFailure(error, `cloud ${options.verb} failed`)
  }
}
