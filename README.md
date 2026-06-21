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
layerbase login                    # store an API key (saved 0600, never echoed)
layerbase ls                       # list your cloud databases
layerbase ls --json                # same, as JSON for scripting

layerbase connect <db>             # auto-pick the right client for the engine
layerbase psql <db>                # Postgres family
layerbase redis-cli <db>           # Redis / Valkey
layerbase mysql <db>               # MySQL / MariaDB

layerbase connect <db> --print     # show connection info, do not exec
layerbase connection-string <db>   # print the full connstr (reveals password)

layerbase logout                   # remove the stored API key
```

`<db>` accepts a cloud database id or its name.

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

## Security model

- Connection info is fetched over TLS, authenticated by your stored API key.
- The API key lives at `~/.config/layerbase/credentials.json`, mode `0600`.
- Secrets are passed to the child client via env or a `0600` temp file, never on
  argv, and the temp file is removed when the client exits.

## Status

This is the first standalone cut of the `layerbase` CLI (it replaces the old
`0.0.3` shim that proxied to `spindb`). The design it implements is in
`layerbase-cloud/plans/active/layerbase-cli-secure-connect.md`.

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
