import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  branchHint,
  countDatabases,
  hasBranches,
  isBranch,
  parentLabel,
  summaryLine,
} from '@/lib/database-list'
import type { CloudDatabase } from '@/lib/cloud-api'

function db(overrides: Partial<CloudDatabase> = {}): CloudDatabase {
  return {
    id: 'db_1',
    name: 'shop-prod',
    engine: 'postgresql',
    status: 'running',
    ...overrides,
  }
}

const primary = db()
const branch = db({
  id: 'db_2',
  name: 'shop-pr-42',
  parentId: 'db_1',
  parentName: 'shop-prod',
})
// A cloud build that predates parentName still marks the row as a branch.
const branchIdOnly = db({ id: 'db_3', name: 'shop-pr-43', parentId: 'db_1' })

test('isBranch: only a row with a parent id is a branch', () => {
  assert.equal(isBranch(primary), false)
  assert.equal(isBranch(branch), true)
  assert.equal(isBranch(branchIdOnly), true)
  assert.equal(isBranch(db({ parentId: null })), false)
})

test('parentLabel: names the parent, falls back to its id, dash on a primary', () => {
  assert.equal(parentLabel(branch), 'shop-prod')
  assert.equal(parentLabel(branchIdOnly), 'db_1')
  assert.equal(parentLabel(primary), '-')
})

test('hasBranches: gates the PARENT column', () => {
  assert.equal(hasBranches([primary]), false)
  assert.equal(hasBranches([]), false)
  assert.equal(hasBranches([primary, branch]), true)
})

test('countDatabases: branches never inflate the database count', () => {
  assert.deepEqual(countDatabases([primary, branch, branchIdOnly]), {
    total: 3,
    primaries: 1,
    branches: 2,
  })
  assert.deepEqual(countDatabases([]), {
    total: 0,
    primaries: 0,
    branches: 0,
  })
})

test('summaryLine: only when branches are present, and it says they are free', () => {
  assert.equal(summaryLine([primary]), null)
  assert.equal(summaryLine([]), null)
  assert.equal(
    summaryLine([primary, branch, branchIdOnly]),
    '3 rows: 1 database, 2 branches. Branches do not count toward your plan database limit.',
  )
})

test('summaryLine: singular wording for one of each', () => {
  assert.equal(
    summaryLine([primary, branch]),
    '2 rows: 1 database, 1 branch. Branches do not count toward your plan database limit.',
  )
})

test('branchHint: inline marker for compact surfaces', () => {
  assert.equal(branchHint(primary), null)
  assert.equal(branchHint(branch), 'branch of shop-prod')
  assert.equal(branchHint(branchIdOnly), 'branch of db_1')
})
