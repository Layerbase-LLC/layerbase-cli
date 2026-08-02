import type { CloudDatabase } from '@/lib/cloud-api'

// Rendering helpers for `cloud ls`. Kept pure and out of the Ink component so
// they are unit-testable.
//
// The cloud list returns primaries and BRANCHES in one flat array. Rendered
// flat, a branch reads as just another database, and anything counting rows
// (a human, an agent reading --json) overstates how many databases the account
// actually has. Branches do not count toward the plan's database limit.

export function isBranch(db: CloudDatabase): boolean {
  return Boolean(db.parentId)
}

export function hasBranches(databases: CloudDatabase[]): boolean {
  return databases.some(isBranch)
}

// What the PARENT column shows: the parent's name when the API supplied it,
// else the parent id (an older cloud build sends parentId only, and a bare id
// still beats showing nothing), else '-' for a primary.
export function parentLabel(db: CloudDatabase): string {
  if (!db.parentId) return '-'
  return db.parentName || db.parentId
}

// Inline marker for compact surfaces (the interactive picker), null on a
// primary so callers can append it conditionally.
export function branchHint(db: CloudDatabase): string | null {
  return isBranch(db) ? `branch of ${parentLabel(db)}` : null
}

export type DatabaseCounts = {
  total: number
  primaries: number
  branches: number
}

export function countDatabases(databases: CloudDatabase[]): DatabaseCounts {
  const branches = databases.filter(isBranch).length
  return {
    total: databases.length,
    primaries: databases.length - branches,
    branches,
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

// The footer under the table. Null when there is nothing to disambiguate (no
// branches means every row IS a database and the row count is the truth).
export function summaryLine(databases: CloudDatabase[]): string | null {
  const counts = countDatabases(databases)
  if (counts.branches === 0) return null
  return (
    `${plural(counts.total, 'row', 'rows')}: ` +
    `${plural(counts.primaries, 'database', 'databases')}, ` +
    `${plural(counts.branches, 'branch', 'branches')}. ` +
    'Branches do not count toward your plan database limit.'
  )
}
