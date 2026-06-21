# layerbase

The Layerbase cloud CLI. Connect to your managed cloud databases with the
engine's native client (`psql`, `redis-cli`, `mysql`, ...) without ever pasting
a connection string, so the password never lands in your shell history, the
process table (`ps`), or terminal scrollback.

Think `flyctl` / `heroku` / `neonctl`, but for Layerbase. This is the cloud CLI;
[spindb](https://github.com/robertjbass/spindb) remains the local database
manager.

## Install

```bash
npm i -g layerbase
# or
pnpm add -g layerbase
```

## Usage

```bash
layerbase                          # interactive menu (login / spindb / ...)
lbase                              # shorter alias - both are installed

layerbase login                    # browser sign-in; saves a token to ~/.layerbase-cli
layerbase whoami                   # show the signed-in account (--json to script)
layerbase ls                       # list your cloud databases
layerbase ls --json                # same, as JSON for scripting

layerbase connect <db>             # auto-pick the right client for the engine
layerbase psql <db>                # Postgres family
layerbase redis-cli <db>           # Redis / Valkey
layerbase mysql <db>               # MySQL / MariaDB

layerbase connect <db> --print     # show connection info, do not exec
layerbase connection-string <db>   # print the full connstr (reveals password)

layerbase spindb [args...]         # run the local spindb CLI (passes args through)
layerbase alias                    # set up the short `lb` command (only if free)
layerbase logout                   # remove the stored credentials
```

`<db>` accepts a cloud database id or its name.

## Interactive menu and the spindb bridge

Run `layerbase` with no command (on a terminal) for an arrow-key menu. It is a
small hub: each action runs and then the menu returns, so you can sign in, list
databases, drop into local [spindb](https://github.com/robertjbass/spindb), and
so on. The menu is just sugar over the commands above, so everything is still
scriptable.

layerbase is the bridge between local spindb and your Layerbase cloud account:
`layerbase spindb ...` runs the local engine manager (no login needed), while
the cloud commands work against your account once you `login`. spindb is found
on your PATH, or run via `npx`/`pnpx`/`bunx` if it is not installed.

### The `lb` shortcut

The CLI installs as both `layerbase` and `lbase`. For an even shorter `lb`, run
`layerbase alias` (or pick it from the menu): it creates `lb` next to the
`layerbase` binary, but **only if `lb` is not already taken** on your system
(for example Debian's `live-build` ships an `lb`). If it is taken, the CLI
leaves it alone and suggests a shell alias instead.

## Why no connection string

Passing `psql "postgresql://user:SECRET@host/db"` leaks the password into
`~/.zsh_history`, into `ps aux` while the client runs, and into any screen
recording. `layerbase` resolves the database server-side over TLS and hands the
credential to the client through an environment variable or a transient `0600`
file that is deleted on exit. The password is never an argv value.

| Engine | Credential path |
| --- | --- |
| Postgres family | `PGPASSFILE` (temp `0600` file), deleted on exit |
| MySQL / MariaDB | `--defaults-extra-file` (temp `0600` file), deleted on exit |
| Redis / Valkey | `REDISCLI_AUTH` env var |
| Others | `layerbase connection-string` / `--print` fallback for now |

## Login

`layerbase login` opens your browser to `layerbase.com/auth/cli`, you
authenticate with GitHub or Google, and a 30-day token is returned to a
loopback server the CLI runs on `127.0.0.1` (a random port). A `state` nonce
ties the response to your `login` process, and the web app only ever redirects
the token to a loopback address. Mirrors how layerbase-desktop signs in (it uses
a `layerbase://` deep link; a CLI uses the loopback instead).

The token is stored at **`~/.layerbase-cli/credentials.json`** (mode `0600`).
Cloud calls go through the web app's `/api/cli/*` routes with
`Authorization: Bearer <token>`, exactly like the desktop app, so the cloud API
URL stays internal.

## Security model

- Connection info is fetched over TLS, authenticated by your stored token.
- The token lives at `~/.layerbase-cli/credentials.json`, mode `0600`.
- Secrets are passed to the child client via env or a `0600` temp file, never on
  argv, and the temp file is removed when the client exits.

## Status

This is an early cut of the `layerbase` CLI (it replaces the old `0.0.3` shim
that proxied to `spindb`). The design it implements is in
`layerbase-cloud/plans/active/layerbase-cli-secure-connect.md`.

The web side (`/auth/cli` + `/api/cli/*`) is implemented in the layerbase repo
and must be deployed for login and cloud calls to work. Set `LAYERBASE_API_URL`
to point at a dev/preview deployment while testing.

The cloud `/api/cli/*` endpoints the CLI calls (`whoami`, `databases`,
`databases/:id/connection-info`) still need to be exposed on the
layerbase-cloud / web side, reusing the dashboard's existing connection-info
path and the API-key auth in `layerbase-cloud/src/api/api-keys.ts`. Until then
the local commands and secure-launch wiring run, but cloud calls will 404. Set
`LAYERBASE_API_URL` to point at a non-production API while developing.

## Development

No build step: [tsx](https://github.com/privatenumber/tsx) runs the TypeScript
and JSX entry directly.

```bash
pnpm install
pnpm dev -- ls          # run the CLI from source
pnpm check              # tsc --noEmit + eslint
pnpm format             # prettier
```

Built with [Ink](https://github.com/vadimdemedes/ink) (React for the terminal).
