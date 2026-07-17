# layerbase

[![npm version](https://img.shields.io/npm/v/layerbase.svg)](https://www.npmjs.com/package/layerbase)
[![license](https://img.shields.io/npm/l/layerbase.svg)](https://www.npmjs.com/package/layerbase)

The Layerbase cloud CLI: connect to your managed cloud databases with their
native clients, drop into local [spindb](https://github.com/robertjbass/spindb),
and never paste a connection string into your shell history.

`layerbase` is the bridge between **spindb** (the open-source local database
manager) and your **Layerbase cloud** account. Think `flyctl` / `heroku` /
`neonctl`, but it also wraps spindb for local work.

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
layerbase              # open the interactive menu
layerbase login        # sign in through your browser
layerbase ls           # list your cloud databases
layerbase psql my-db   # connect with the right client, no password typed
```

## Commands

| Command | Description |
| --- | --- |
| `layerbase` | Interactive menu: a hub to sign in, list, connect, and run spindb. |
| `layerbase login` | Sign in via the browser; stores a token in `~/.layerbase-cli`. |
| `layerbase logout` | Remove the stored credentials. |
| `layerbase whoami` | Show the signed-in account and token expiry (`--json`). |
| `layerbase ls` | List your cloud databases (`--json` for scripting). |
| `layerbase connect <db>` | Connect with the engine's native client. |
| `layerbase psql <db>` | Connect to a Postgres-family database. |
| `layerbase redis-cli <db>` | Connect to a Redis / Valkey database. |
| `layerbase mysql <db>` | Connect to a MySQL / MariaDB database. |
| `layerbase connection-string <db>` | Print the connection string (reveals the password). |
| `layerbase start <name>` | Start a local database container (spindb-backed). |
| `layerbase stop <name>` | Stop a local database container (spindb-backed). |
| `layerbase spindb [args...]` | Run the local spindb CLI (forwards **all** args, flags included). |
| `layerbase alias` | Set up the short `lb` command (only if it is free). |

`<db>` accepts a cloud database id or its name. Add `--print` to `connect` to
show the connection details instead of launching a client.

`start` and `stop` are local-only shortcuts for spindb containers; they never
touch cloud databases. `layerbase spindb ...` forwards every argument through to
spindb verbatim, including flags such as `--json`, `--engine`, and `--force`.

## Interactive menu

Run `layerbase` with no command for an arrow-key menu. It is a small hub: each
action runs, then the menu returns, so you can sign in, list databases, drop
into spindb, and keep going.

```
 ◆ Layerbase  cloud + local databases

 Signed in as you@example.com

 ❯ List cloud databases
   Connect to a database
   Run spindb               local databases
   Log out
   Quit

 Up/Down to move · Enter to select · q to quit
```

The menu is sugar over the commands above, so everything stays scriptable.

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
| Other engines | `layerbase connection-string` / `--print` |

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
- For `connect` / `psql` / `redis-cli` / `mysql`: the matching native client on
  your `PATH`.

## License

ISC, Layerbase, LLC.
