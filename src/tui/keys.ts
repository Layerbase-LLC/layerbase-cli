// Escape once returns to the home view. A second escape inside this window
// quits. The window is wall-clock time, not a count of frames.
export const ESC_QUIT_WINDOW_MS = 1000

export function escapeChord(options: {
  now: number
  lastAt: number
}): 'quit' | 'home' {
  if (
    options.lastAt > 0 &&
    options.now - options.lastAt <= ESC_QUIT_WINDOW_MS
  ) {
    return 'quit'
  }
  return 'home'
}

export type ShortcutRow = {
  keys: string
  action: string
}

export type ShortcutGroup = {
  title: string
  rows: ShortcutRow[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Move',
    rows: [
      { keys: 'j  k', action: 'up and down' },
      { keys: 'arrows', action: 'up and down' },
      { keys: 'g', action: 'top' },
      { keys: 'G', action: 'bottom' },
    ],
  },
  {
    title: 'This database',
    rows: [
      { keys: 'enter', action: 'options' },
      { keys: 'space', action: 'options' },
      { keys: 'shift+tab', action: 'start or stop' },
      { keys: 'b', action: 'branch' },
    ],
  },
  {
    title: 'Views',
    rows: [
      { keys: 'tab', action: 'switch Local and Cloud' },
      { keys: '1  2', action: 'Local, Cloud' },
      { keys: 'n', action: 'new local database' },
      { keys: 'r', action: 'refresh' },
      { keys: '?', action: 'this list' },
    ],
  },
  {
    title: 'Leave',
    rows: [
      { keys: 'esc', action: 'home' },
      { keys: 'esc twice', action: 'quit, within 1 second' },
      { keys: 'q', action: 'quit' },
    ],
  },
  {
    title: 'Cloud sign-in',
    rows: [
      { keys: 'enter', action: 'browser sign-in' },
      { keys: 'k', action: 'paste an API key' },
    ],
  },
]

export const QUICK_KEYS = 'enter options  shift+tab start/stop  ?'
