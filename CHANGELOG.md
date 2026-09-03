# Changelog

Notable changes to the `layerbase` CLI. Newest first.

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
