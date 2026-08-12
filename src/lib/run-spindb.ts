import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'

// Resolve an executable to a CONCRETE path on PATH (null when it is not there).
// We resolve it ourselves rather than relying on a shell, because on Windows the
// real file is a shim (`spindb.cmd`, `npx.cmd`) that bare-name spawn cannot find.
function resolveOnPath(name: string): string | null {
  const exts =
    process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function detectPackageRunner(): string {
  const userAgent = process.env.npm_config_user_agent ?? ''
  if (userAgent.startsWith('pnpm')) return 'pnpx'
  if (userAgent.startsWith('bun')) return 'bunx'
  return 'npx'
}

// If spindb is installed we run the resolved binary directly; otherwise we run
// it through the package runner that launched layerbase, so `npx layerbase`
// users get `npx spindb` with no global install. A runner that does not resolve
// falls back to its bare name so the spawn error stays the familiar ENOENT.
function spindbInvocation(): { command: string; baseArgs: string[] } {
  const spindb = resolveOnPath('spindb')
  if (spindb) return { command: spindb, baseArgs: [] }
  const runner = detectPackageRunner()
  return { command: resolveOnPath(runner) ?? runner, baseArgs: ['spindb'] }
}

const WINDOWS_BATCH_FILE = /\.(cmd|bat)$/i

export type SpindbSpawn = {
  command: string
  args: string[]
  windowsVerbatimArguments: boolean
}

// Build the spawn call. `shell: true` is NEVER used: a shell flattens argv into
// a single command line, so an argument containing a space (an --output
// directory) is re-split and a shell metacharacter in a path or container name
// is interpreted. Windows batch shims cannot be spawned directly (Node refuses
// since the CVE-2024-27980 fix), so those alone go through cmd.exe with a
// pre-quoted, verbatim command line. Pure so the invariant is unit-testable.
export function buildSpindbSpawn(options: {
  command: string
  args: string[]
  platform?: NodeJS.Platform
  comSpec?: string
}): SpindbSpawn {
  const {
    command,
    args,
    platform = process.platform,
    comSpec = process.env.ComSpec ?? 'cmd.exe',
  } = options
  if (platform !== 'win32' || !WINDOWS_BATCH_FILE.test(command)) {
    return { command, args, windowsVerbatimArguments: false }
  }
  const line = [command, ...args].map(quoteWindowsArgument).join(' ')
  return {
    command: comSpec,
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  }
}

// cmd.exe keeps a double-quoted argument in one piece and does not interpret
// metacharacters inside it, so every argument is wrapped and its embedded
// quotes and trailing backslashes escaped. (cmd still expands %VAR% inside
// quotes; nothing we pass to spindb is user-supplied Windows env syntax.)
function quoteWindowsArgument(value: string): string {
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  return `"${escaped}"`
}

type SpawnOptions = {
  // Extra env merged for the child. The clone flow passes the connection string
  // here (via --from-env) so the password never lands on argv.
  env?: Record<string, string>
  // Suppress stdio + the "install spindb" hint (for probes like existence checks).
  quiet?: boolean
}

function spawnSpindb(args: string[], opts: SpawnOptions = {}): Promise<number> {
  const { command, baseArgs } = spindbInvocation()
  return new Promise<number>((resolve) => {
    // While spindb owns the foreground, let IT handle Ctrl+C. The parent ignores
    // SIGINT so it does not get terminated mid-loop (which exits with a confusing
    // "unsettled top-level await"); when spindb exits we resume the harness.
    const ignoreSigint = (): void => {}
    process.on('SIGINT', ignoreSigint)
    const settle = (code: number): void => {
      process.removeListener('SIGINT', ignoreSigint)
      resolve(code)
    }
    const invocation = buildSpindbSpawn({
      command,
      args: [...baseArgs, ...args],
    })
    const child = spawn(invocation.command, invocation.args, {
      stdio: opts.quiet ? 'ignore' : 'inherit',
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    })
    child.on('error', (error) => {
      if (!opts.quiet) {
        process.stderr.write(
          `Failed to run spindb: ${error.message}\n` +
            'Install spindb (https://github.com/robertjbass/spindb) or make sure ' +
            'it is on your PATH.\n',
        )
      }
      settle(127)
    })
    child.on('exit', (code) => settle(code ?? 0))
  })
}

// Hand the terminal to the local spindb CLI, passing through any args. This is
// the bridge: spindb manages local databases, layerbase adds the cloud account
// layer around it. `opts.env` is merged into the child (used by clone).
export async function runSpindb(
  args: string[] = [],
  opts: { env?: Record<string, string> } = {},
): Promise<number> {
  return spawnSpindb(args, { env: opts.env })
}

// Run spindb and CAPTURE its output instead of inheriting the terminal, for the
// machine-readable probes (`list --json`, `backup --json`). Never used for
// interactive passthrough, which must keep inherited stdio.
export function captureSpindb(args: string[]): Promise<{
  code: number
  stdout: string
  stderr: string
}> {
  const { command, baseArgs } = spindbInvocation()
  return new Promise((resolve) => {
    const invocation = buildSpindbSpawn({
      command,
      args: [...baseArgs, ...args],
    })
    const child = spawn(invocation.command, invocation.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

// spindb interleaves human progress lines with its `--json` result on stdout, so
// pick the LAST line that parses as a JSON object.
export function parseLastJson(output: string): Record<string, unknown> | null {
  const lines = output.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim()
    if (!line || !line.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }
    } catch {
      continue
    }
  }
  return null
}

// Whether a local spindb container with this name already exists. Uses
// `spindb info <name> --json`, which exits non-zero when the container is
// missing.
export async function spindbExists(name: string): Promise<boolean> {
  const code = await spawnSpindb(['info', name, '--json'], { quiet: true })
  return code === 0
}
