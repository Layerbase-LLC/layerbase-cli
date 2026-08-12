import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'

// Is spindb installed on PATH? If so we run it by bare name (spawn resolves it
// via PATH); otherwise we run it through the package runner that launched
// layerbase, so `npx layerbase` users get `npx spindb` with no global install.
function spindbOnPath(): boolean {
  const exts =
    process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      if (existsSync(join(dir, `spindb${ext}`))) return true
    }
  }
  return false
}

function detectPackageRunner(): string {
  const userAgent = process.env.npm_config_user_agent ?? ''
  if (userAgent.startsWith('pnpm')) return 'pnpx'
  if (userAgent.startsWith('bun')) return 'bunx'
  return 'npx'
}

function spindbInvocation(): { command: string; baseArgs: string[] } {
  return spindbOnPath()
    ? { command: 'spindb', baseArgs: [] }
    : { command: detectPackageRunner(), baseArgs: ['spindb'] }
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
    const child = spawn(command, [...baseArgs, ...args], {
      stdio: opts.quiet ? 'ignore' : 'inherit',
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      // Windows needs a shell to resolve `spindb.cmd` / the package runner.
      shell: process.platform === 'win32',
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
    const child = spawn(command, [...baseArgs, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
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
