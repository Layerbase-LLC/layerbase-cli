import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sidebarHeader, sidebarLayout, sidebarRowSegments } from '@/tui/columns'

function joined(width: number, name: string, depth = 0): string {
  const segments = sidebarRowSegments({
    layout: sidebarLayout(width),
    name,
    engine: 'postgresql',
    version: '18.4.0',
    detail: '5435',
    size: '8.2 MB',
    status: 'running',
    depth,
    width,
    mark: '●',
  })
  return segments.map((segment) => segment.text).join('')
}

test('a sidebar row never exceeds its width', () => {
  const name = 'sqlite-wal-branch_6d9380c3'
  for (let width = 10; width <= 120; width += 1) {
    for (const depth of [0, 1, 3]) {
      const text = joined(width, name, depth)
      assert.ok(
        text.length <= width,
        `${width} d${depth} produced ${text.length}`,
      )
    }
  }
})

test('a long file name keeps the tail that tells branches apart', () => {
  const segments = sidebarRowSegments({
    layout: sidebarLayout(96),
    name: 'sqlite-wal-branch_cd390bbf',
    engine: 'sqlite',
    version: '3.53.1',
    detail: 'sqlite-wal-branch_cd390bbf',
    size: null,
    status: 'missing',
    depth: 1,
    width: 96,
    mark: '○',
  })
  const where = segments.find((segment) => segment.tone === 'where')
  assert.ok(where?.text.includes('390bbf'), where?.text)
  assert.equal(where?.text.includes('sqlite-wal'), false)
  const text = segments.map((segment) => segment.text).join('')
  assert.equal(text.length, 96)
})

test('the column header lines up and stays inside the row', () => {
  const header = sidebarHeader(96)
  assert.ok(header)
  assert.equal(header?.length, 96)
  assert.ok(header?.includes('engine'))
  assert.ok(header?.includes('version'))
  assert.ok(header?.includes('status'))
})

test('a wide row keeps the name and the spindb columns', () => {
  const name = 'sqlite-wal-branch_6d9380c3'
  const text = joined(96, name)
  assert.ok(text.includes(name), text)
  assert.ok(text.includes('postgresql'), text)
  assert.ok(text.includes('18.4.0'), text)
  assert.ok(text.includes('5435'), text)
  assert.ok(text.includes('8.2 MB'), text)
  assert.ok(text.includes('running'), text)
  assert.equal(text.length, 96)
})
