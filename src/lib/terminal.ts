// Wipe the visible screen and scrollback and home the cursor, so a full-screen
// view leaves the terminal looking like the app has exited. No-op off a TTY.
export function clearTerminal(): void {
  if (!process.stdout.isTTY) return
  process.stdout.write('\u001b[2J\u001b[3J\u001b[H')
}
