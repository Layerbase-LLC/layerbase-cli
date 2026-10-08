import { runView } from '@/ui/run-view'
import { connectToDatabase } from '@/commands/connect'
import { connectLocal } from '@/tui/actions'
import { TuiApp, type TuiAction } from '@/tui/app'

// Ink entry for `lbase tui`. alternateScreen stays off (Ink's default) so the
// view stays on the primary screen and follows the terminal size. Each draw
// still clears the visible screen once, so earlier shell output is not sitting
// above the list. Connect unmounts first, then the loop draws the list again.
function clearScreen(): void {
  if (!process.stdout.isTTY) return
  process.stdout.write('\u001b[2J\u001b[3J\u001b[H')
}

export async function runTui(): Promise<void> {
  let selectKey: string | null = null
  let notice: string | null = null

  for (;;) {
    clearScreen()
    const action = await runView<TuiAction>((resolve) => (
      <TuiApp initialSelection={selectKey} notice={notice} onAction={resolve} />
    ))
    if (!action || action.type === 'quit') return

    selectKey = action.selectKey
    notice = null
    if (action.type === 'connect-local') {
      const code = await connectLocal(action.name)
      if (code !== 0) notice = `spindb connect exited ${code}`
    } else if (action.type === 'connect-cloud') {
      const code = await connectToDatabase({
        dbRef: action.ref,
        command: 'connect',
      })
      if (code !== 0) notice = `connect exited ${code}`
    }
  }
}
