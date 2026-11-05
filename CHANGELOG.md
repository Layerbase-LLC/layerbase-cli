# Changelog

Notable changes to the `layerbase` CLI. Newest first.

## 2.5.0

### Added

`lbase cloud create --region <region>` chooses where the database runs, for
example `eu-west`. Omit it for the default. The server owns the region list: an
unknown region is refused with the regions you can use, and a region your plan
cannot use is refused with what to do instead. The CLI prints either message
as-is.

### Changed

`lbase cloud create` (and the create step of `promote`) now goes through
layerbase.com, so a CLI database is placed exactly like a dashboard one and the
same account checks apply. It works with a browser login as well as an API key.
Against a server that does not offer this yet, a key-authenticated create falls
back to the previous direct create, except with `--region`, which then fails
with a clear message instead of being ignored.

`cloud ls`, name lookups and every per-database command (`delete`, `start`,
`stop`, `branch`, `import`, `connect` and the rest) now reach a database
wherever it runs. With only an API key, `cloud ls` also lists databases from
every location, and a per-database call the API host does not recognize is
retried through layerbase.com with the same key.

## 2.4.0

### Added

`lbase cloud pooler sync-users <db>` lets users created in SQL (`CREATE USER`,
or `CREATE ROLE ... LOGIN`) connect through the pooled connection string. They
already work on the direct connection string; run this after creating or
changing them. No password is sent, and synced users survive restarts and
wakes. The output lists synced users, skipped users and warnings, each with the
exact fix. When a pooler has not taken the users yet, a warning says they will
apply when it next starts or on a retry, and the command still exits `0`
(`--json` reports `"applied": false`). PostgreSQL, MySQL and MariaDB only.

`--json` error output now includes `retryAfterSeconds` when the cloud sends it.

## 2.3.1

### Changed

The release version check now reads the `package.json` version as data and
compares it with the published version using semver, rejecting a version that
is not a single-line semver string. No CLI behavior changes.

## 2.3.0

### Added

`lbase cloud create` and `lbase promote` now show a capacity warning when your
account container or its server is under memory or storage pressure. The
warning lists the usage the cloud reports (for example, memory at 84% with a
75% warning threshold) and explains the risk of adding another database there.

- In a terminal, an arrow-key prompt asks whether to proceed or cancel.
- `--accept-capacity-risk` proceeds after printing the warning.
- In a non-interactive run (no terminal, or `--json`) without the flag, nothing
  is created and the command exits with the new exit code `7`, with a hint to
  re-run with `--accept-capacity-risk`.

A refused create is sent again at most once, and only after the risk is
accepted. Other `409` refusals keep exit code `5` and their "try again" message.
Every CLI create now tells the cloud it can show this warning; older cloud
builds ignore that and behave as before. In `lbase tui`, a refused create shows
the usage and the `cloud create` command that accepts the risk.

## 2.2.1

### Changed

Agent instructions (`CLAUDE.md`, `AGENTS.md`) now point at GitHub issues and the
Ecosystem tracker project, and route CLI issues to `layerbase-cli`. No code
changes.

## 2.2.0

### Changed

Bare `layerbase` (or `lbase`) with no arguments opens the database browser
(`layerbase tui`) instead of the spindb menu when both stdin and stdout are
terminals (TTYs). The spindb menu stays at `layerbase spindb`. Unregistered
commands, such as `lbase create` and `lbase list`, still forward to spindb
verbatim. When either stream is not a terminal, a no-argument run prints the
help and exits 0.

## 2.1.0

### Added

`layerbase tui` (and `lbase tui`) is an interactive browser for local spindb
databases and Layerbase cloud databases. Bare `layerbase` with no arguments
still opens the spindb menu, and `chat` is unchanged.

The browser lists databases and branches on Local and Cloud tabs. Enter or
Space opens the actions for the selected database. Shift+Tab starts or stops
it, and the row shows a working state until that finishes.

Local actions are connect, start, stop, branch, copy the connection string,
and open Layerbase Desktop when that app is installed. If the configured port
is already taken, start moves the database to a free port and names the
database that holds the old one. If the pinned engine binaries are missing,
it asks to download that version and then start.

Cloud actions are connect, start, stop, wake, hibernate, branch, copy the
connection string, open the database in Layerbase Web, and open the web query
IDE. Wake is offered on a paid plan. Cloud start, stop, wake, and hibernate
need an API key. Sign-in is the existing browser login or a pasted API key,
and the footer shows which credential is in use. The connection string is
copied to the clipboard and is not printed.

### Changed

`layerbase cloud ls` includes databases on dedicated servers when a browser
login is stored, not only the shared host. Connection info for one of those
databases is read through the web app when that login exists.

## 2.0.1

### Changed

The local database menu opened through `layerbase` / `lbase` is now titled
"Layerbase - Local Database Manager" instead of "SpinDB - Local Database
Manager". The CLI sets `SPINDB_BRAND=Layerbase` for the spindb process it
spawns; spindb 0.69.6 or newer reads it, and an older spindb ignores it and
keeps its own title. Nothing else about the passthrough changed.

## 2.0.0

A major version because the change below alters what `--json` returns: a script
that read a password or connection string out of it stops working until it opts
back in. Nothing else about the command surface changed.

### Changed (breaking for scripts that read a credential out of `--json`)

Cloud database credentials now print redacted:

```
postgresql://shop:****@fjord.layerbase.dev:5432/shop
```

Two kinds of value are covered, and the second is the one that matters most:

- **Connection strings**, wherever the CLI prints one - `cloud ls --json` (the
  case in [#53](https://github.com/Layerbase-LLC/layerbase-cli/issues/53)),
  `cloud create`, `cloud branch`, `promote`, `cloud connect --print`, and any
  error message that echoes one back.
- **The discrete credential fields the cloud returns beside them**: `password`,
  and the `restToken` (Redis/Valkey) and `psPassword` (MySQL/MariaDB) fields,
  which are the SAME password under another key. Masking only the connection
  string would have printed a mask directly above a working credential, which
  reads as safe and is not.

Redaction happens at the output boundary, so a command has to opt IN to printing
a credential rather than opt out of leaking one.

**If a script read a password or token out of `--json`**, add `--show-secrets`
(alias `--reveal`) to that invocation, or switch it to `layerbase cloud
connection-string <db> --json`, which is unchanged.

`cloud connection-string` (alias `url`) is the deliberate exception and still
prints in full with no flag: its entire contract is handing you the credential
to pipe somewhere, and it is the command the rest of the CLI points at when
someone genuinely needs the password.

Only the credential is replaced. The scheme, user, host, port, database and
query survive, and so do `restUrl` / `psUrl` / `psUsername`, so a redacted
payload still identifies which database on which box a script was pointed at. A
credential the cloud deliberately withheld arrives as an empty string and stays
one - a mask there would claim a password that was never issued.

**Scope.** This is about what the LAYERBASE CLI prints about CLOUD databases.
Bare commands (`ls`, `create`, `connect`, ...) forward to your local spindb
install verbatim and this CLI never sees their output, so local database
credentials are unaffected.

### Added

- `--show-secrets` (alias `--reveal`), which prints credentials in full. It is
  documented in `layerbase --help` and `layerbase cloud` help, and honored by
  `cloud connect --print` as well as the `--json` surfaces.
