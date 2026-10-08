import { isFileEngine } from '@/tui/engines'
import { connectBlockReason, type TuiRow } from '@/tui/model'

export type RowActionId =
  | 'connect'
  | 'start'
  | 'stop'
  | 'wake'
  | 'hibernate'
  | 'branch'
  | 'copy'
  | 'web'
  | 'query'
  | 'desktop'

export type RowAction = {
  id: RowActionId
  label: string
}

export type ActionMenuModel = {
  actions: RowAction[]
  note: string | null
}

export type PowerToggle =
  | { id: 'start' | 'stop' | 'wake' }
  | { message: string }

function cloudReady(options: { cloudKey: boolean }): string | null {
  if (options.cloudKey) return null
  return 'Cloud start, stop, wake, and hibernate need an API key.'
}

function serverLocal(row: TuiRow): boolean {
  return row.source === 'local' && !row.linked && !isFileEngine(row.engine)
}

function appendReach(actions: RowAction[], row: TuiRow, desktop: boolean) {
  actions.push({ id: 'copy', label: 'Copy connection string' })
  if (row.source === 'cloud') {
    actions.push({ id: 'web', label: 'Open in Layerbase Web' })
    actions.push({ id: 'query', label: 'Query in Web IDE' })
    return
  }
  if (desktop) {
    actions.push({ id: 'desktop', label: 'Open in Layerbase Desktop' })
  }
}

export function actionMenu(
  row: TuiRow,
  options: { paid: boolean; cloudKey: boolean; desktop?: boolean },
): ActionMenuModel {
  const actions: RowAction[] = []
  let note: string | null = null
  if (!connectBlockReason(row)) {
    actions.push({ id: 'connect', label: 'Connect' })
  }
  if (row.linked) {
    note = 'Linked databases are managed where they live.'
  } else if (row.source === 'local' && isFileEngine(row.engine)) {
    note = 'File databases do not start or stop.'
  } else if (serverLocal(row)) {
    actions.push(
      row.status === 'running'
        ? { id: 'stop', label: 'Stop' }
        : { id: 'start', label: 'Start' },
    )
  } else if (row.source === 'cloud') {
    const blocked = cloudReady(options)
    if (blocked) {
      note = blocked
    } else if (row.status === 'running') {
      actions.push({ id: 'stop', label: 'Stop' })
      actions.push({ id: 'hibernate', label: 'Hibernate' })
    } else if (row.status === 'stopped') {
      actions.push({ id: 'start', label: 'Start' })
    } else if (row.status === 'hibernated') {
      if (options.paid) {
        actions.push({ id: 'wake', label: 'Wake' })
      } else {
        note =
          'Wake is a paid-plan action. Connect, and the database wakes for that session.'
      }
    } else {
      note = `${row.name} is ${row.status}.`
    }
  }
  if (!row.parentName && !row.linked) {
    if (row.source === 'local' || options.cloudKey) {
      actions.push({ id: 'branch', label: 'Branch' })
    }
  }
  appendReach(actions, row, options.desktop === true)
  return { actions, note }
}

// Shift+Tab matches spindb: start or stop the highlighted database, without
// opening the menu. Cloud hibernated maps to wake, and only on a paid plan.
export function powerToggle(
  row: TuiRow,
  options: { paid: boolean; cloudKey: boolean },
): PowerToggle {
  if (row.linked) {
    return { message: 'Linked databases are managed where they live.' }
  }
  if (row.source === 'local' && isFileEngine(row.engine)) {
    return { message: 'File databases do not start or stop.' }
  }
  if (serverLocal(row)) {
    return { id: row.status === 'running' ? 'stop' : 'start' }
  }
  const blocked = cloudReady(options)
  if (blocked) return { message: blocked }
  if (row.status === 'running') return { id: 'stop' }
  if (row.status === 'stopped') return { id: 'start' }
  if (row.status === 'hibernated') {
    if (!options.paid) {
      return {
        message:
          'Wake is a paid-plan action. Connect, and the database wakes for that session.',
      }
    }
    return { id: 'wake' }
  }
  return { message: `${row.name} is ${row.status}.` }
}
