import { spawn } from 'node:child_process'

// Opens a URL in the user's default browser. No dependency: just the per-OS
// opener. Rejects if the opener binary can't be spawned (e.g. headless box),
// so the caller can fall back to printing the URL.
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform
  const command =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', reject)
    child.on('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
