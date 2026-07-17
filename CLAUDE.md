# layerbase-cli

The branded `layerbase` npm CLI. An Ink/React CLI that is a **drop-in
replacement for [spindb](https://github.com/robertjbass/spindb)** locally, plus
a cloud account layer. Bins: `layerbase` and `lbase`; opt-in `lb` via
`layerbase alias`. Published to npm via **OIDC trusted publishing on push to
`main`** (`dist/` is gitignored, `prepack` builds it). The version-check
workflow blocks PRs to `main` unless `package.json` version > the published one.

## The core contract (do NOT break)

**The bare command namespace belongs to spindb.** Any first token that is not a
registered layerbase verb forwards to the local spindb CLI **verbatim**: raw
`process.argv` slice, flags included, stdio inherited, exit code propagated.

- Bare `lbase` with no args (TTY) = spindb's interactive menu (the zero-arg case
  of the fallthrough). Non-TTY no-args prints the unified help and exits 0
  (never hang a prompt in CI).
- Registered bare verbs are ONLY: `login`, `logout`, `whoami`, `psql`, `mysql`,
  `redis-cli`, `alias`, `chat`, `cloud`, `spindb`, `help`. This list lives in
  `src/lib/commands.ts` (`registeredCommandNames()`) - the single source of
  truth cli.tsx gates the fallthrough on.

## Cloud namespace rule

All cloud database verbs live under `lbase cloud <verb>`: `ls`, `connect`,
`clone`, `connection-string` (accepts `url` as a sub-alias). **New cloud
functionality MUST go under `cloud`, or be proven collision-free against
`spindb --help` INCLUDING aliases before claiming a bare verb.**
`scripts/check-spindb-collisions.ts` enforces this in the `pnpm check` chain -
keep it green, never delete it. (`help` is a deliberate, exempted overlap:
layerbase renders unified help; `lbase spindb help` / `lbase <cmd> --help` still
reach spindb.)

## Parser mechanics (why they are this way)

`src/cli.tsx` is the **single dispatch point**: a pre-meow raw-argv interception.
- meow runs with `autoHelp` / `autoVersion` **disabled**. Forwarded commands
  must NEVER pass through meow - it eats/reorders flags (the 0.4.2 bug silently
  turned `create x --engine sqlite` into a postgres container). Only genuinely
  layerbase-owned commands reach meow.
- `--version` / `-v` (flag, first token) = **layerbase's** version; `lbase
  version` (no dashes) = **spindb's** version command, by design. Same split for
  `--help` (unified) vs `lbase <cmd> --help` (spindb's).
- Version is read from `package.json` via `src/lib/version.ts` - never hardcode
  it. It also feeds the `layerbase-cli/<version>` User-Agent below.

## chat

`lbase chat` is the Ink interactive console, planned to evolve into an AI chat
console - keep the name and describe it as "interactive console" in copy (not
"cloud console"). The bare launch of the Ink app was removed in 1.0.0; `chat`
is the only entry. Inside it, `/ls` `/connect` `/clone` keep their CLOUD meaning.

## Cloud API

`src/lib/cloud-api.ts` is the shared client. Every request sends a
`layerbase-cli/<version>` User-Agent so CLI usage is attributable in server logs
(vs the desktop app or dashboard) - keep it. Auth is a 30-day JWT via the
browser loopback flow (`src/lib/browser-login.ts`), mirroring layerbase-desktop.

## Process

- Merge flow: feature -> `dev` -> `main`. A push to `main` publishes to npm;
  **Bob merges `dev` -> `main`**. Bump `package.json` version for any release PR.
- `spindb` on PATH matters for local verification (currently 0.59.0).
- Test changes by RUNNING the built `dist/cli.js` from a **clean empty
  directory** - spindb scans the cwd for sqlite/duckdb files and can prompt or
  crash in non-TTY from a dirty dir. Always clean up throwaway containers and
  verify against `spindb list` directly (check both sources of truth).

## Style

TypeScript; `type`, never `interface`; prettier with no semicolons and single
quotes; kebab-case file names. **No em/en dashes anywhere** (code, comments,
docs, strings) - use a hyphen, colon, or comma.
