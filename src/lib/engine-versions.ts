// Version resolution for promote: turn the version a LOCAL database reports
// into the version identifier the cloud create API will actually accept.
//
// The two vocabularies do not line up. spindb reports the exact binary it
// installed ('18.6.0', '11.4.2', '3.53.1'), while the cloud engine catalog
// offers the identifiers it will create, and that catalog is MIXED: measured
// live against /v1/engines, postgresql offers majors (15, 16, 17, 18) plus
// exact prerelease tokens (19.0.0-beta.1, 19.0.0-beta.3), sqlite offers just
// '3', mysql 8.4 / 9.6 / 9.7, mariadb 10.11 / 11.4 / 11.8, duckdb 1.4 / 1.5,
// redis 7.2, valkey 8.0 / 9.0. No fixed truncation of the local string is
// right for all of them, so the local version is MATCHED against the engine's
// real offer list instead of reformatted and hoped for.
//
// Mirrors `resolvePromoteVersion` in layerbase-desktop
// (src/shared/promote-support.ts) so the two surfaces resolve identically.
// Pure and catalog-driven on purpose: no engine is special-cased, so a new
// engine or a re-shaped version line needs no change here.

const PRERELEASE_RE = /-(?:alpha|beta|rc)(?:[.-]?\d+)?$/i

// Whether a version identifier carries a prerelease suffix ('19.0.0-beta.3').
export function isPrereleaseVersionId(version: string): boolean {
  return PRERELEASE_RE.test(version.trim())
}

// The leading numeric segment of a version ('18.6.0' -> 18), or null.
export function versionMajor(version: string): number | null {
  const digits = version.trim().match(/^\D*(\d+)/)?.[1]
  if (!digits) return null
  return Number.parseInt(digits, 10)
}

// Numeric segments of a version, prerelease suffix dropped.
function numericParts(version: string): number[] {
  return version
    .trim()
    .replace(PRERELEASE_RE, '')
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => Number.isFinite(n))
}

// Order two version identifiers, newest last, so sort(compareVersionIds)
// ascends. A stable version outranks a prerelease with the same numbers
// (18 > 18.0.0-rc.1), which is how every engine's own line works.
export function compareVersionIds(a: string, b: string): number {
  const pa = numericParts(a)
  const pb = numericParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  const preA = isPrereleaseVersionId(a)
  const preB = isPrereleaseVersionId(b)
  if (preA !== preB) return preA ? -1 : 1
  return a.localeCompare(b)
}

function newest(versions: string[]): string | undefined {
  return [...versions].sort(compareVersionIds).pop()
}

// Whether an offered identifier names the release line the local version is on
// - '8.0' for a local 8.0.40, '18' for a local 18.6.0, '11.4' for 11.4.2. This
// is the LONGEST-PREFIX half of the match: comparing on segment boundaries
// keeps a MySQL 8.0 container off the 8.4 line, which shares its major but is a
// different release with its own incompatibilities.
function isVersionLinePrefix(candidate: string, local: string): boolean {
  const c = numericParts(candidate)
  const l = numericParts(local)
  if (c.length === 0 || c.length > l.length) return false
  return c.every((part, i) => part === l[i])
}

// ─── Sunset creates ─────────────────────────────────────────────────────────
//
// MIRROR SOURCE: layerbase-cloud `LEGACY_CREATE_VERSIONS` (src/config/engines.ts).
//
// /v1/engines publishes `supportedVersions` - every version the cloud can RUN -
// but the create endpoint validates against `creatableVersions`, which is that
// list minus the sunset ones, and the wire format exposes no such field. A
// sunset version stays valid for the databases already on it and is refused for
// new ones, so promote must not resolve into one: sending PostgreSQL '15'
// answers `Unsupported version "15" for PostgreSQL. Supported: 18,
// 19.0.0-beta.3` and creates nothing.
//
// Hand-kept, like MIGRATION_CATALOG: when a version is sunset cloud-side, add
// it here. Drift only costs a round trip, never a failed promote - the create
// path re-resolves against the list the cloud names in its own rejection and
// retries once (see promote.ts).
export const SUNSET_CREATE_VERSIONS: Record<string, string[]> = {
  postgresql: ['15', '16', '17', '19.0.0-beta.1'],
  mysql: ['9.6'],
  duckdb: ['1.4'],
  typedb: ['3.8', '3.11'],
}

// The versions of an engine the cloud will actually CREATE. Mirrors the cloud's
// own derivation, including its guard: if the filter would empty the list, the
// full supported list is used rather than nothing.
export function creatableVersions(options: {
  engine: string
  supportedVersions: string[]
}): string[] {
  const sunset = SUNSET_CREATE_VERSIONS[options.engine] ?? []
  const creatable = options.supportedVersions.filter(
    (version) => !sunset.includes(version),
  )
  return creatable.length > 0 ? creatable : options.supportedVersions
}

// ─── Resolution ─────────────────────────────────────────────────────────────

export type VersionResolution = {
  // The identifier to send to the cloud create API.
  version: string
  // True when the cloud offers the local version's major at all.
  matchedMajor: boolean
  // True when the resolved identifier names the local version's own release
  // line ('18' for 18.6.0, '11.4' for 11.4.2) rather than a different line the
  // data is being moved onto.
  sameLine: boolean
  // True when the resolved identifier is not the local version string.
  remapped: boolean
  // The local version, echoed for the stdout line.
  localVersion: string
}

// Pick the cloud version identifier for a local database.
//
// - The local version's own release line wins: 18 for 18.6.0, 11.4 for 11.4.2,
//   3 for 3.53.1, by longest version-prefix match, never a fixed truncation.
// - Among several offers for the major with no line match, the newest STABLE
//   offer for that major is taken.
// - A prerelease is only ever chosen when the local version is itself a
//   prerelease of the same major (exact token first, because a beta's data
//   directory is not portable between betas), never as a fallback for a stable
//   local version.
// - A sunset major (nothing on offer for it) falls back to the newest stable
//   version in the catalog. The caller MUST say so: it is a different engine
//   version than the one running locally.
// - Nothing usable on offer resolves to undefined, and the caller sends no
//   version at all so the cloud picks its own default.
export function resolvePromoteVersion(options: {
  localVersion: string | undefined
  offeredVersions: string[]
}): VersionResolution | undefined {
  const offered = options.offeredVersions
    .map((version) => version.trim())
    .filter((version) => version.length > 0)
  const local = options.localVersion?.trim()
  if (offered.length === 0 || !local) return undefined

  const stable = offered.filter((version) => !isPrereleaseVersionId(version))
  const localMajor = versionMajor(local)

  if (localMajor !== null) {
    const sameMajor = offered.filter(
      (version) => versionMajor(version) === localMajor,
    )
    const sameMajorStable = sameMajor.filter(
      (version) => !isPrereleaseVersionId(version),
    )

    if (isPrereleaseVersionId(local)) {
      const exact = sameMajor.find((version) => version === local)
      const candidate =
        exact ??
        newest(sameMajor.filter((version) => isPrereleaseVersionId(version))) ??
        newest(sameMajorStable)
      if (candidate) {
        return {
          version: candidate,
          matchedMajor: true,
          sameLine: isVersionLinePrefix(candidate, local),
          remapped: candidate !== local,
          localVersion: local,
        }
      }
    } else {
      const onSameLine = sameMajorStable.filter((version) =>
        isVersionLinePrefix(version, local),
      )
      const candidate = newest(onSameLine) ?? newest(sameMajorStable)
      if (candidate) {
        return {
          version: candidate,
          matchedMajor: true,
          sameLine: onSameLine.includes(candidate),
          remapped: candidate !== local,
          localVersion: local,
        }
      }
    }
  }

  // Sunset major, or a local version we could not parse. Newest stable wins; a
  // prerelease is never chosen for someone who did not ask for one.
  const fallback = newest(stable)
  if (!fallback) return undefined
  return {
    version: fallback,
    matchedMajor: false,
    sameLine: false,
    remapped: fallback !== local,
    localVersion: local,
  }
}

// The one line promote prints before it creates, so the version the user gets
// is never a surprise. Null when the cloud version is textually the local one
// and there is nothing to say.
export function promoteVersionLine(options: {
  resolution: VersionResolution
  engineLabel: string
}): string | null {
  const { resolution, engineLabel } = options
  if (!resolution.remapped) return null
  const local = `Local ${engineLabel} ${resolution.localVersion}`
  // Branch on the LINE, not the major: MySQL 8.0 -> 8.4 and DuckDB 1.4 -> 1.5
  // share a major but are different releases, and calling those "the same line"
  // would be a lie the user acts on.
  if (resolution.sameLine) {
    return (
      `${local} maps to cloud ${engineLabel} ${resolution.version}: ` +
      'Layerbase Cloud names its versions by release line, so this is the ' +
      'same line at its current release.'
    )
  }
  return (
    `${local} is no longer offered in cloud; creating ${engineLabel} ` +
    `${resolution.version}. Check your app against it before you switch over.`
  )
}

// The cloud rejects an uncreatable version with
// `Unsupported version "15" for PostgreSQL. Supported: 18, 19.0.0-beta.3`.
// That list is the authoritative creatable set, so a rejection is enough to
// re-resolve correctly even when the sunset mirror above has drifted.
export function parseSupportedVersionsFromError(
  message: string,
): string[] | undefined {
  const list = message.match(/Supported:\s*(.+?)\s*$/)?.[1]
  if (!list) return undefined
  const versions = list
    .split(',')
    .map((version) => version.trim())
    .filter((version) => version.length > 0)
  return versions.length > 0 ? versions : undefined
}

export function isUnsupportedVersionMessage(message: string): boolean {
  return /Unsupported version/i.test(message)
}
