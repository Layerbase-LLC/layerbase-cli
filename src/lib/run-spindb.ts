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

// Hand the terminal to the local spindb CLI, passing through any args. This is
// the bridge: spindb manages local databases, layerbase adds the cloud account
// layer around it.
export async function runSpindb(args: string[] = []): Promise<number> {
  const onPath = spindbOnPath()
  const command = onPath ? 'spindb' : detectPackageRunner()
  const fullArgs = onPath ? args : ['spindb', ...args]

  return new Promise<number>((resolve) => {
    const child = spawn(command, fullArgs, {
      stdio: 'inherit',
      // Windows needs a shell to resolve `spindb.cmd` / the package runner.
      shell: process.platform === 'win32',
    })
    child.on('error', (error) => {
      process.stderr.write(
        `Failed to run spindb: ${error.message}\n` +
          'Install spindb (https://github.com/robertjbass/spindb) or make sure ' +
          'it is on your PATH.\n',
      )
      resolve(127)
    })
    child.on('exit', (code) => resolve(code ?? 0))
  })
}
