# layerbase

[![npm version](https://img.shields.io/npm/v/layerbase.svg)](https://www.npmjs.com/package/layerbase)
[![license](https://img.shields.io/npm/l/layerbase.svg)](https://www.npmjs.com/package/layerbase)

The Layerbase CLI is **local-first**: it is a drop-in for
[spindb](https://github.com/robertjbass/spindb) for local database work, plus a
`cloud` layer for your managed [**Layerbase cloud**](https://layerbase.com)
account. Connect with native
clients, drop into spindb, and never paste a connection string into your shell
history.

**The bare command namespace belongs to spindb.** Any command that is not one of
layerbase's own verbs forwards straight to your local spindb install, verbatim,
so `lbase create / ls / start / backup / branch ...` behave exactly like
`spindb <same>`. Cloud database commands live under `lbase cloud <verb>`.

## Install

```bash
npm i -g layerbase
# or
pnpm add -g layerbase
# or
bun add -g layerbase
```

This installs two commands, `layerbase` and a shorter `lbase`. For a two-letter
`lb`, run `layerbase alias` (it only claims `lb` if nothing else owns it).

## Quick start

```bash
lbase                        # spindb's interactive menu (local databases)
lbase create my-db --engine postgres   # any spindb command, verbatim
lbase login                  # sign in through your browser
lbase promote ./app.db       # put a local database in the cloud, data included
lbase cloud ls               # list your cloud databases
lbase psql my-cloud-db       # connect with the right client, no password typed
```

## Local databases (drop-in for spindb)

Every spindb command works. Anything that is not a layerbase verb (see the
[cloud commands](#cloud-account) below) forwards straight to your local
[spindb](https://github.com/robertjbass/spindb) install, with every flag and the
exit code preserved:

```bash
lbase create my-db --engine postgres   # == spindb create my-db --engine postgres
lbase ls                                # == spindb list
lbase start my-db                       # == spindb start my-db
lbase backup my-db                      # == spindb backup my-db
lbase branch my-db feature-x            # == spindb branch my-db feature-x
lbase <cmd> --help                      # == spindb <cmd> --help
```

Bare `lbase` with no arguments opens spindb's own interactive menu. If spindb
does not recognize a command either, spindb's own error is shown and the exit
code is nonzero. `lbase spindb [args...]` is an explicit form of the same
passthrough.

## Cloud account

These are the only verbs layerbase owns; everything else is spindb.

| Command | Description |
| --- | --- |
| `lbase login` | Sign in via the browser; stores a token in `~/.layerbase-cli`. |
| `lbase login --api-key <key>` | Save a personal `sk_` API key for headless use (no browser). |
| `lbase logout` | Remove the stored credentials. |
| `lbase whoami` | Show the signed-in account (and API-key usage in key mode) (`--json`). |
| `lbase cloud ls` | List your cloud databases and branches (`--json` for scripting). |
| `lbase cloud create <name> --engine <e> [--ttl 2h]` | Provision a database (`--ttl` makes it transient). |
| `lbase cloud delete <db> --yes` | Delete a database (`--yes`/`-y` to skip the prompt). |
| `lbase cloud start <db>` / `stop <db>` | Start or stop a database. |
| `lbase cloud branch <db> <name>` | Create or reuse a branch (idempotent). |
| `lbase cloud branch reset <db> <name>` | Re-fork a branch from its parent. |
| `lbase cloud branch delete <db> <name>` | Delete a branch. |
| `lbase cloud branch ls <db>` | List a database's branches (`--json`). |
| `lbase cloud connect <db>` | Connect with the engine's native client. |
| `lbase cloud clone <db> [name]` | Clone a cloud database into a local spindb container. |
| `lbase cloud connection-string <db>` | Print the connection string (reveals the password; alias: `url`; `--json`). |
| `lbase psql <db>` | Connect to a cloud Postgres-family database. |
| `lbase redis-cli <db>` | Connect to a cloud Redis / Valkey database. |
| `lbase mysql <db>` | Connect to a cloud MySQL / MariaDB database. |
| `lbase promote <file-or-container>` | Create a cloud database from a local file or spindb container, data included. |
| `lbase migrate --source <id> --target <db>` | Migrate an external database into a cloud database. |
| `lbase import <dumpfile> --target <db>` | Import a dump file into a cloud database. |
| `lbase agent init [--global]` | Install the Layerbase skill for AI coding agents. |
| `lbase alias` | Set up the short `lb` command (only if it is free). |
| `lbase chat` | Interactive console for your Layerbase account. |

`<db>` accepts a cloud database id or its name. Add `--print` to
`cloud connect` to show the connection details instead of launching a client.

`cloud ls` lists databases **and their branches** in one table. When the account
has branches, a `PARENT` column names each branch's parent database (`-` on a
primary) and a footer splits the rows, because branches do not count toward your
plan's database limit: never read the row count as your database count. In
`--json`, a branch is any row with `parentId` set (`parentName` names its
parent); rows are passed through from the API untouched.
`lbase cloud` with no subcommand prints the cloud help. Cloud mutation commands
(`create`, `delete`, `start`, `stop`, `branch`) run against the cloud API and
need an API key (see [Headless auth](#headless-auth-ci-and-agents)); every one
supports `--json` and returns a meaningful exit code.

## Promote a local database to the cloud

`lbase promote` is the graduation path for a prototype: it creates a **new**
cloud database sized to the source, imports the data, and prints the connection
string. One command instead of create, dump, and import.

```bash
lbase promote ./app.db                    # SQLite file
lbase promote ./analytics.duckdb          # DuckDB file
lbase promote ./dump.sql                  # Postgres-dialect SQL dump
lbase promote my-local-pg                 # a local spindb container
lbase promote ./app.db --write-env --yes  # and rewrite DATABASE_URL in ./.env
```

The source is **detected, never guessed**: binary files are identified by their
header (a `.db` that is really a DuckDB file is treated as DuckDB), `.sql` is a
Postgres-dialect dump, and a bare name is looked up against your local spindb
containers. Anything ambiguous fails with an actionable message; `--from
pglite|sqlite|duckdb|sql|spindb` forces the kind.

| Source | Cloud target |
| --- | --- |
| SQLite file (`.db`, `.sqlite`, `.sqlite3`) | `sqlite` (SQLite storage behind the Postgres wire) |
| DuckDB file (`.duckdb`) | `duckdb` |
| SQL dump (`.sql`), PGlite dump | `postgresql` |
| spindb container | the same engine in the cloud |

`--target libsql` is accepted but currently refused: cloud libSQL restores from a
data-directory archive, not from a SQLite file, so there is no path that puts a
local `.db` into it yet. Use the default (`--target pgsqlite`), or
`lbase migrate --source turso` for an already-hosted libSQL database.
Desktop-only engines (MongoDB, CockroachDB, SurrealDB) are refused with the
licensing reason and the closest cloud alternative, and a spindb engine whose
local backup format the cloud import endpoint cannot restore is refused with a
pointer at `lbase migrate`. Every refusal happens **before** anything is created,
so an unsupported source never leaves an empty database behind.

**PGlite data directories** are not supported directly (that would put several MB
of WASM in every install). Dump the directory first and promote the `.sql`:

```js
const db = await PGlite.create('./pgdata') // @electric-sql/pglite
const dump = await pgDump({ pg: db }) // @electric-sql/pglite-tools/pg_dump
await writeFile('./dump.sql', await dump.text()) // node:fs/promises
```

```bash
lbase promote ./dump.sql
```

`--write-env` is opt-in: it rewrites `DATABASE_URL` in `./.env` (creating the
file when missing), leaves every other line untouched, ignores commented-out
assignments, and prints what it did. `--json` prints one result object with the
database, the connection string, the dashboard URL, and the bytes uploaded.
`--name` overrides the derived database name. If the import fails after the
database is created, promote says the database exists and is empty and prints the
exact retry and delete commands; it never deletes anything on your behalf.

The create request records how the database was made: `promote` (with the kind
of source it came from, one of `sqlite`, `duckdb`, `sql-dump`, `spindb`) or a
plain `cli` create. That is the whole payload - your file paths, filenames, and
local container names never leave your machine.

## Migrations and imports

`lbase migrate` imports an external database **into an existing cloud database**,
and `lbase import` restores a whole-database dump file. Both are headless (need
an API key), support `--json`, and never write credentials to stdout, stderr, or
JSON output. Run `lbase migrate --help` for the full per-source flag list.

```bash
# Connection-string sources (paste one URL):
lbase migrate --source postgres --target my-db \
  --connection-string "postgresql://user:pass@host:5432/db" --yes

lbase migrate --source heroku   --target my-db \
  --connection-string "$(heroku config:get DATABASE_URL -a your-app)" --yes

# API-key sources (we discover the account, then you pick a database):
lbase migrate --source neon    --target my-db --source-key napi_... --yes
lbase migrate --source algolia --target my-search --source-key <admin-key> --app-id <app-id> --yes
lbase migrate --source turso   --target my-libsql --source-key <token> --url libsql://... --yes
lbase migrate --source cloudflare-d1 --target my-libsql \
  --source-key <api-token> --account-id <account-id> --yes

# Whole-database dump import:
lbase import ./backup.dump --target my-db --yes
```

Connection-string sources (paste one URL with `--connection-string`, alias
`--url`): `postgres`, `mysql`, `mariadb`, `redis`, `valkey`, `vercel-kv`,
`netlify`, `replit`, `heroku`, `digitalocean`, `fly`, `aiven`,
`crunchy-bridge`, `mongodb-atlas` (to FerretDB).

API-key sources (we list the account's databases, then you pick one): `neon`,
`supabase`, `render`, `railway`, `planetscale`, `upstash`, `algolia` (to
Meilisearch), `turso` and `cloudflare-d1` (to libSQL). They take `--source-key`
(alias `--token`) plus, where needed, `--source-id` (aliases `--app-id`,
`--email`, `--token-id`, `--account-id`, and `--url` for a Turso database URL)
and `--source-secret` (alias `--db-password`, Supabase only). When multiple
source databases are discovered, pick one with `--source-db <label-or-number>`
(or interactively on a TTY).

A few sources have a trap worth knowing before you start. `replit` and `heroku`
each cover two products: paste the Postgres string for a Postgres target, or
`REPLIT_DB_URL` / `REDIS_URL` for a key-value target (land a Heroku Key-Value
Store on Valkey, not Redis). A `fly` Managed Postgres cluster is only reachable
through your own MPG proxy app with `?sslmode=disable`, or by pushing with
`pg_dump` from inside Fly; see
[layerbase.com/migrate/fly](https://layerbase.com/migrate/fly). And a MySQL 8
source on the default `caching_sha2_password` auth cannot be read by the MariaDB
dump tools, so use `--source mysql` for those rather than `--source mariadb`.

`--json` on `migrate` prints **one** final result object (no interim progress
lines): `{ ok, runId, status, databaseId, report }` on success or
`{ ok: false, runId, status, error }` on failure; without `--json`, status and
progress stream while the migration run polls. `--yes` (`-y`) confirms
non-interactively; a migration or import may overwrite the target's data, so a
non-TTY run without `--yes` refuses and exits `1`.

## Headless auth (CI and agents)

For CI pipelines and coding agents, authenticate with a personal API key instead
of the browser flow. Create one in the dashboard at
[layerbase.com/cloud/settings](https://layerbase.com/cloud/settings), then
either export it or save it:

```bash
export LAYERBASE_API_KEY=sk_...        # env var: no login step needed at all
# or
lbase login --api-key sk_...           # persists it to ~/.layerbase-cli (0600)
# or, per-invocation
lbase cloud ls --api-key sk_... --json
```

Precedence is `--api-key` flag > `LAYERBASE_API_KEY` env > stored key. When a key
is in play, cloud calls go **directly** to the cloud API (the browser-JWT proxy
is skipped). Note: a key is tied to one account and works against your primary
control plane.

A transient database auto-deletes at its TTL, so a crashed CI run cannot strand
a database against your quota. Where the engine supports branching, a
branch-per-run (branch from a seeded parent, `reset` between runs, `delete` on
teardown) is the cheaper CI primitive.

```yaml
# .github/workflows/test.yml (excerpt)
env:
  LAYERBASE_API_KEY: ${{ secrets.LAYERBASE_API_KEY }}
steps:
  - run: npm i -g layerbase
  - run: |
      DB=$(lbase cloud create "ci-$GITHUB_RUN_ID" --engine postgresql --ttl 2h --json)
      echo "DATABASE_URL=$(echo "$DB" | jq -r .connectionString)" >> "$GITHUB_ENV"
  - run: npm test
  - if: always()
    run: lbase cloud delete "ci-$GITHUB_RUN_ID" --yes || true
```

Exit codes for scripting: `0` success, `1` usage/generic, `3` auth (invalid or
revoked key), `4` account paused, `5` capacity, `6` quota or rate limit.

## Agents

`lbase agent init` installs the Layerbase skill so a coding agent (Claude Code,
etc.) knows how to use Layerbase. It writes `./.claude/skills/layerbase/SKILL.md`
(or `~/.claude/skills/layerbase/SKILL.md` with `--global`), fetching the latest
skill from `https://layerbase.com/skill.md` and falling back to the bundled copy
offline. It then prints an `AGENTS.md` snippet for Codex and other agents.

**Rule of thumb: bare = spindb, cloud = `lbase cloud <verb>`.** So `lbase ls`
lists your **local** containers (spindb) and `lbase cloud ls` lists your
**cloud** databases; likewise `lbase url` / `lbase connect` are local while
`lbase cloud connection-string` / `lbase cloud connect` are cloud.

### Help and version

`lbase --help` / `-h` and `lbase help` render this unified help. `lbase --version`
/ `-v` print the layerbase version. Because everything else forwards to spindb,
`lbase version` (no dashes) forwards to **spindb's** `version` command, and
`lbase <cmd> --help` reaches spindb's help for that command.

## The chat console

`lbase chat` opens an interactive console for your Layerbase account (a
Claude-Code-style prompt). Type `/help` to see commands, `/spindb` (or `/menu`)
to hand off to local spindb, `/quit` to exit. Inside the console, `/ls`,
`/connect`, and `/clone` mean the **cloud** commands (it is the cloud console).

## The spindb bridge

[spindb](https://github.com/robertjbass/spindb) manages local database
containers; `layerbase` adds the cloud account layer around it.

```bash
layerbase spindb                  # open spindb's own menu
layerbase spindb create postgres  # run any spindb command locally
```

spindb is found on your `PATH`, or run through `npx` / `pnpx` / `bunx` if it is
not installed. Local spindb commands need no login.

## Connecting without a connection string

Passing `psql "postgresql://user:SECRET@host/db"` leaks the password into your
shell history, into `ps` while the client runs, and into terminal scrollback.
`layerbase` resolves the database over TLS and hands the credential to the
client through an environment variable or a transient `0600` file that is
deleted on exit. The password is never an argv value.

| Engine | How the password is passed |
| --- | --- |
| Postgres family | `PGPASSFILE` (temp `0600` file), deleted on exit |
| MySQL / MariaDB | `--defaults-extra-file` (temp `0600` file), deleted on exit |
| Redis / Valkey | `REDISCLI_AUTH` environment variable |
| Other engines | `layerbase cloud connection-string` / `--print` |

Connecting requires the engine's native client (`psql`, `mysql`, `redis-cli`)
on your `PATH`.

## Authentication

`layerbase login` opens your browser, you sign in with GitHub or Google, and a
30-day token is returned to a loopback server the CLI runs on `127.0.0.1`. A
state nonce ties the response to your login, and the token is only ever
delivered to a loopback address. It is stored at
`~/.layerbase-cli/credentials.json` (mode `0600`). This mirrors how the
Layerbase desktop app signs in. Run `layerbase logout` to remove it.

For non-interactive use (CI, agents), skip the browser entirely with an API key:
see [Headless auth](#headless-auth-ci-and-agents).

## The `lb` shortcut

The CLI installs as `layerbase` and `lbase`. For a two-letter `lb`, run
`layerbase alias` (or pick it from the menu). It creates `lb` next to the
`layerbase` binary, but only when `lb` is not already taken on your system (for
example, Debian's `live-build` ships an `lb`). If it is taken, the CLI leaves it
alone and suggests a shell alias instead.

## Configuration

| Variable | Purpose |
| --- | --- |
| `LAYERBASE_API_KEY` | Personal `sk_` API key for headless cloud access (see [Headless auth](#headless-auth-ci-and-agents)). |
| `LAYERBASE_API_URL` | Override the web API base used by the browser-login flow (default `https://layerbase.com`). |
| `LAYERBASE_CLOUD_API_URL` | Override the cloud API base used in key mode (default `https://cloud.layerbase.dev`). |

## Requirements

- Node.js 20 or newer.
- For `cloud connect` / `psql` / `redis-cli` / `mysql`: the matching native
  client on your `PATH`.

## For maintainers

The bare command namespace belongs to spindb. **New cloud functionality goes
under the `cloud` namespace (`lbase cloud <verb>`), or must be proven
collision-free against `spindb --help` INCLUDING aliases before it can claim a
bare verb.** The registered layerbase verbs are the single source of truth in
`src/lib/commands.ts`, and `scripts/check-spindb-collisions.ts` (part of
`pnpm check`) fails the build if any registered bare verb collides with a spindb
command. See `CLAUDE.md` for the full contract.

## License

ISC, [Layerbase, LLC](https://layerbase.com).
