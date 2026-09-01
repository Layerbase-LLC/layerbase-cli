import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareVersionIds,
  creatableVersions,
  isPrereleaseVersionId,
  isUnsupportedVersionMessage,
  parseSupportedVersionsFromError,
  promoteVersionLine,
  resolvePromoteVersion,
  versionMajor,
} from '@/lib/engine-versions'

// The catalog as /v1/engines actually publishes it, measured live 2026-09-01.
// It is MIXED on purpose in this fixture: majors, major.minor, a bare '3', and
// exact prerelease tokens. Any resolution that only works for one shape is
// wrong for the others.
const SUPPORTED = {
  postgresql: ['15', '16', '17', '18', '19.0.0-beta.1', '19.0.0-beta.3'],
  sqlite: ['3'],
  mysql: ['8.4', '9.6', '9.7'],
  mariadb: ['10.11', '11.4', '11.8'],
  duckdb: ['1.4', '1.5'],
  valkey: ['8.0', '9.0'],
}

function resolve(localVersion: string | undefined, engine: string) {
  return resolvePromoteVersion({
    localVersion,
    offeredVersions: creatableVersions({
      engine,
      supportedVersions: SUPPORTED[engine as keyof typeof SUPPORTED],
    }),
  })
}

// ─── Version primitives ─────────────────────────────────────────────────────

test('version: reads the major off every shape the catalog uses', () => {
  assert.equal(versionMajor('18.6.0'), 18)
  assert.equal(versionMajor('3'), 3)
  assert.equal(versionMajor('19.0.0-beta.3'), 19)
  assert.equal(versionMajor('v11.4.2'), 11)
  assert.equal(versionMajor('unknown'), null)
})

test('version: only alpha/beta/rc suffixes count as a prerelease', () => {
  assert.equal(isPrereleaseVersionId('19.0.0-beta.3'), true)
  assert.equal(isPrereleaseVersionId('19.0.0-rc1'), true)
  assert.equal(isPrereleaseVersionId('18.6.0'), false)
  assert.equal(isPrereleaseVersionId('10.11'), false)
})

test('version: sorts numerically, and a stable outranks its own prerelease', () => {
  assert.deepEqual(['11.8', '10.11', '11.4'].sort(compareVersionIds), [
    '10.11',
    '11.4',
    '11.8',
  ])
  assert.ok(compareVersionIds('19', '19.0.0-beta.3') > 0)
  assert.ok(compareVersionIds('19.0.0-beta.1', '19.0.0-beta.3') < 0)
})

// ─── Creatable versions ─────────────────────────────────────────────────────

test('creatable: drops the versions the cloud will not create any more', () => {
  assert.deepEqual(
    creatableVersions({
      engine: 'postgresql',
      supportedVersions: SUPPORTED.postgresql,
    }),
    ['18', '19.0.0-beta.3'],
  )
  assert.deepEqual(
    creatableVersions({ engine: 'mysql', supportedVersions: SUPPORTED.mysql }),
    ['8.4', '9.7'],
  )
})

test('creatable: an engine with no sunset versions is untouched', () => {
  assert.deepEqual(
    creatableVersions({
      engine: 'mariadb',
      supportedVersions: SUPPORTED.mariadb,
    }),
    ['10.11', '11.4', '11.8'],
  )
})

test('creatable: never empties the list, matching the cloud-side guard', () => {
  assert.deepEqual(
    creatableVersions({ engine: 'duckdb', supportedVersions: ['1.4'] }),
    ['1.4'],
  )
})

// ─── Prefix matching ────────────────────────────────────────────────────────

test('resolve: a local version maps onto its own release line, not a truncation', () => {
  // Longest version-prefix wins, and the prefix length differs per engine.
  assert.equal(resolve('18.6.0', 'postgresql')?.version, '18')
  assert.equal(resolve('11.4.2', 'mariadb')?.version, '11.4')
  assert.equal(resolve('3.53.1', 'sqlite')?.version, '3')
  assert.equal(resolve('1.5.2', 'duckdb')?.version, '1.5')
  assert.equal(resolve('8.0.4', 'valkey')?.version, '8.0')
})

test('resolve: a prefix match reports the same line and the remap', () => {
  const resolution = resolve('18.6.0', 'postgresql')
  assert.deepEqual(resolution, {
    version: '18',
    matchedMajor: true,
    sameLine: true,
    remapped: true,
    localVersion: '18.6.0',
  })
})

test('resolve: an exact catalog match is not a remap', () => {
  const resolution = resolve('3', 'sqlite')
  assert.equal(resolution?.version, '3')
  assert.equal(resolution?.remapped, false)
  assert.equal(
    promoteVersionLine({ resolution: resolution!, engineLabel: 'SQLite' }),
    null,
  )
})

test('resolve: a shared major is not a shared line', () => {
  // MySQL 8.0 and 8.4 are both major 8, and 8.4 is a different release with its
  // own incompatibilities. The major still matches, so this is not a sunset.
  const resolution = resolve('8.0.40', 'mysql')
  assert.equal(resolution?.version, '8.4')
  assert.equal(resolution?.matchedMajor, true)
  assert.equal(resolution?.sameLine, false)
})

// ─── Sunset fallback ────────────────────────────────────────────────────────

test('resolve: a sunset major falls back to the newest offered stable', () => {
  const resolution = resolve('15.4', 'postgresql')
  assert.deepEqual(resolution, {
    version: '18',
    matchedMajor: false,
    sameLine: false,
    remapped: true,
    localVersion: '15.4',
  })
})

test('resolve: the sunset fallback never picks a prerelease for a stable local', () => {
  // Major 19 exists in the catalog as a beta only. A stable local 19 must not
  // be moved onto a beta: it falls back to the newest stable instead.
  const resolution = resolve('19.4.0', 'postgresql')
  assert.equal(resolution?.version, '18')
  assert.equal(resolution?.matchedMajor, false)
})

test('resolve: a sunset minor line moves up within its own major', () => {
  // MySQL 9.6 is sunset for creation while 9.7 is on offer, so the major still
  // matches and the data stays on the 9 line.
  const resolution = resolve('9.6.1', 'mysql')
  assert.equal(resolution?.version, '9.7')
  assert.equal(resolution?.matchedMajor, true)
})

test('resolve: a prerelease local takes its exact token when it is on offer', () => {
  const resolution = resolvePromoteVersion({
    localVersion: '19.0.0-beta.3',
    offeredVersions: ['18', '19.0.0-beta.3'],
  })
  assert.equal(resolution?.version, '19.0.0-beta.3')
  assert.equal(resolution?.remapped, false)
})

test('resolve: a prerelease local with no exact token takes the newest of its major', () => {
  const resolution = resolve('19.0.0-beta.1', 'postgresql')
  assert.equal(resolution?.version, '19.0.0-beta.3')
  assert.equal(resolution?.matchedMajor, true)
})

// ─── Nothing to resolve ─────────────────────────────────────────────────────

test('resolve: an unknown local version resolves to nothing at all', () => {
  // A bare .sqlite file or a SQL dump has no version, and promote then leaves
  // the choice to the cloud rather than inventing one.
  assert.equal(resolve(undefined, 'postgresql'), undefined)
  assert.equal(resolve('   ', 'postgresql'), undefined)
})

test('resolve: an unparseable local version still lands on the newest stable', () => {
  assert.equal(resolve('nightly', 'postgresql')?.version, '18')
})

test('resolve: an empty or prerelease-only offer list resolves to nothing', () => {
  assert.equal(
    resolvePromoteVersion({ localVersion: '18.6.0', offeredVersions: [] }),
    undefined,
  )
  assert.equal(
    resolvePromoteVersion({
      localVersion: '15.4',
      offeredVersions: ['19.0.0-beta.3'],
    }),
    undefined,
  )
})

// ─── The line the user reads ────────────────────────────────────────────────

test('line: a same-line remap explains the naming instead of alarming', () => {
  const line = promoteVersionLine({
    resolution: resolve('18.6.0', 'postgresql')!,
    engineLabel: 'PostgreSQL',
  })
  assert.equal(
    line,
    'Local PostgreSQL 18.6.0 maps to cloud PostgreSQL 18: Layerbase Cloud ' +
      'names its versions by release line, so this is the same line at its ' +
      'current release.',
  )
})

test('line: a sunset remap says the local version is gone and names the new one', () => {
  const line = promoteVersionLine({
    resolution: resolve('15.4', 'postgresql')!,
    engineLabel: 'PostgreSQL',
  })
  assert.equal(
    line,
    'Local PostgreSQL 15.4 is no longer offered in cloud; creating ' +
      'PostgreSQL 18. Check your app against it before you switch over.',
  )
})

test('line: a same-major line move is reported as a version change, not a rename', () => {
  // MySQL 8.0 -> 8.4 and DuckDB 1.4 -> 1.5 share a major but are different
  // releases. Calling either "the same line" would be a lie the user acts on.
  const line = promoteVersionLine({
    resolution: resolve('8.0.40', 'mysql')!,
    engineLabel: 'MySQL',
  })
  assert.equal(
    line,
    'Local MySQL 8.0.40 is no longer offered in cloud; creating MySQL 8.4. ' +
      'Check your app against it before you switch over.',
  )
})

// ─── Drift recovery ─────────────────────────────────────────────────────────

test('error: the cloud rejection names the versions it will create', () => {
  const message =
    'Cloud API 400: Unsupported version "15" for PostgreSQL. ' +
    'Supported: 18, 19.0.0-beta.3'
  assert.equal(isUnsupportedVersionMessage(message), true)
  assert.deepEqual(parseSupportedVersionsFromError(message), [
    '18',
    '19.0.0-beta.3',
  ])
})

test('error: an unrelated failure is left alone', () => {
  const message = 'Cloud API 409: Cloud capacity is temporarily unavailable.'
  assert.equal(isUnsupportedVersionMessage(message), false)
  assert.equal(parseSupportedVersionsFromError(message), undefined)
})
