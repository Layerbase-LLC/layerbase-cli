import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// The cloud dashboard lives on this host. The site sends a signed-out visitor
// through its own login and back to the page.
const CLOUD_WEB = 'https://cloud.layerbase.com'

export type DesktopLaunch = {
  command: string
  args: string[]
}

export function cloudPageUrl(options: {
  id: string
  page: 'dashboard' | 'query'
}): string {
  const id = encodeURIComponent(options.id)
  if (options.page === 'query') return `${CLOUD_WEB}/cloud/${id}/query`
  return `${CLOUD_WEB}/cloud/${id}`
}

// spindb `url --json` pretty-prints one object. The password stays in the
// returned string and must not be written to the terminal.
export function connectionStringFromJson(
  stdout: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = stdout.trim()
  if (!trimmed) return { ok: false, message: 'spindb returned nothing.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, message: 'spindb did not return connection JSON.' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: 'spindb did not return connection JSON.' }
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.error === 'string' && record.error.trim()) {
    return { ok: false, message: record.error }
  }
  const value = record.connectionString
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: 'spindb did not return a connection string.' }
  }
  if (value.includes(':***@') || value.includes('//***@')) {
    return {
      ok: false,
      message: 'The password for this database is not available to copy.',
    }
  }
  return { ok: true, value }
}

type ClipboardCommand = { command: string; args: string[] }

function clipboardCommands(): ClipboardCommand[] {
  if (process.platform === 'darwin') return [{ command: 'pbcopy', args: [] }]
  if (process.platform === 'win32') return [{ command: 'clip', args: [] }]
  return [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] },
  ]
}

function writeClipboard(
  command: ClipboardCommand,
  text: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(ok)
    }
    timer = setTimeout(() => {
      child.kill()
      finish(false)
    }, 2000)
    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
    child.stdin?.on('error', () => finish(false))
    child.stdin?.write(text)
    child.stdin?.end()
  })
}

export async function copyToClipboard(text: string): Promise<boolean> {
  for (const command of clipboardCommands()) {
    if (await writeClipboard(command, text)) return true
  }
  return false
}

function commandSucceeds(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

// A .desktop file counts only when it is the Layerbase app (scheme handler or
// window class) and its Exec path exists. That skips the `layerbase` CLI.
export function desktopExec(text: string): string | null {
  if (!/layerbase-desktop|x-scheme-handler\/layerbase/i.test(text)) return null
  const line = text.split('\n').find((item) => item.startsWith('Exec='))
  if (!line) return null
  const raw = line.slice('Exec='.length).trim()
  const token = raw.startsWith('"')
    ? (raw.slice(1).split('"')[0] ?? '')
    : (raw.split(/\s+/)[0] ?? '')
  if (!token.startsWith('/')) return null
  return token
}

function windowsDesktopCandidates(): string[] {
  const local = process.env.LOCALAPPDATA
  const program = process.env.ProgramFiles
  const program32 = process.env['ProgramFiles(x86)']
  const roots = [local, program, program32].filter(
    (item): item is string => !!item,
  )
  const names = ['layerbase-desktop', 'Layerbase']
  const found: string[] = []
  for (const root of roots) {
    for (const name of names) {
      found.push(join(root, 'Programs', name, 'Layerbase.exe'))
      found.push(join(root, name, 'Layerbase.exe'))
    }
  }
  return found
}

function linuxDesktopCandidates(): string[] {
  const found = [
    '/opt/Layerbase/layerbase',
    '/usr/lib/layerbase/layerbase',
    '/usr/bin/layerbase-desktop',
  ]
  const dirs = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    join(homedir(), '.local', 'share', 'applications'),
  ]
  for (const dir of dirs) {
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.desktop')) continue
      try {
        const exec = desktopExec(readFileSync(join(dir, name), 'utf8'))
        if (exec) found.push(exec)
      } catch {
        continue
      }
    }
  }
  return found
}

export async function findLayerbaseDesktop(): Promise<DesktopLaunch | null> {
  if (process.platform === 'darwin') {
    const installed = await commandSucceeds('open', ['-Ra', 'Layerbase'])
    if (!installed) return null
    return { command: 'open', args: ['-a', 'Layerbase'] }
  }
  const candidates =
    process.platform === 'win32'
      ? windowsDesktopCandidates()
      : linuxDesktopCandidates()
  const exe = candidates.find((path) => existsSync(path))
  if (!exe) return null
  return { command: exe, args: [] }
}

export function launchDetached(launch: DesktopLaunch): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      stdio: 'ignore',
      detached: true,
    })
    child.on('error', reject)
    child.on('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
