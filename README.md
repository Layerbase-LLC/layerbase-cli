# layerbase

[![npm version](https://img.shields.io/npm/v/layerbase.svg)](https://www.npmjs.com/package/layerbase)
[![license](https://img.shields.io/npm/l/layerbase.svg)](https://www.npmjs.com/package/layerbase)

The Layerbase CLI is **local-first**: it is a drop-in for
[spindb](https://github.com/robertjbass/spindb) for local database work, plus a
`cloud` layer for your managed **Layerbase cloud** account. Connect with native
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
| `lbase logout` | Remove the stored credentials. |
| `lbase whoami` | Show the signed-in account and token expiry (`--json`). |
| `lbase cloud ls` | List your cloud databases (`--json` for scripting). |
| `lbase cloud connect <db>` | Connect with the engine's native client. |
| `lbase cloud clone <db> [name]` | Clone a cloud database into a local spindb container. |
| `lbase cloud connection-string <db>` | Print the connection string (reveals the password; alias: `url`). |
| `lbase psql <db>` | Connect to a cloud Postgres-family database. |
| `lbase redis-cli <db>` | Connect to a cloud Redis / Valkey database. |
| `lbase mysql <db>` | Connect to a cloud MySQL / MariaDB database. |
| `lbase alias` | Set up the short `lb` command (only if it is free). |
| `lbase chat` | Interactive console for your Layerbase account. |

`<db>` accepts a cloud database id or its name. Add `--print` to
`cloud connect` to show the connection details instead of launching a client.
`lbase cloud` with no subcommand prints the cloud help.

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

## The `lb` shortcut

The CLI installs as `layerbase` and `lbase`. For a two-letter `lb`, run
`layerbase alias` (or pick it from the menu). It creates `lb` next to the
`layerbase` binary, but only when `lb` is not already taken on your system (for
example, Debian's `live-build` ships an `lb`). If it is taken, the CLI leaves it
alone and suggests a shell alias instead.

## Configuration

| Variable | Purpose |
| --- | --- |
| `LAYERBASE_API_URL` | Override the Layerbase API base (default `https://layerbase.com`). |

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

ISC, Layerbase, LLC.
