# Changelog

Notable changes to the `layerbase` CLI. Newest first.

## 1.6.0

### Changed (breaking for scripts that parsed a password out of `--json`)

Connection strings now print with the password redacted, everywhere the CLI
prints one:

```
postgresql://shop:****@fjord.layerbase.dev:5432/shop
```

This covers `cloud ls --json` (the case in
[#53](https://github.com/Layerbase-LLC/layerbase-cli/issues/53)), `cloud create`,
`cloud branch`, `promote`, and any error message that echoes a connection string
back. Redaction happens at the output boundary, so a command has to opt IN to
printing a credential rather than opt out of leaking one.

**If a script read the password out of `--json`**, add `--show-secrets` (alias
`--reveal`) to that invocation, or switch it to `layerbase cloud
connection-string <db> --json`, which is unchanged.

`cloud connection-string` (alias `url`) is the deliberate exception and still
prints in full with no flag: its entire contract is handing you the credential
to pipe somewhere, and it is the command the rest of the CLI points at when
someone genuinely needs the password.

Only the password is replaced. The scheme, user, host, port, database and query
survive, so a redacted string still identifies which database on which box a
script was pointed at.

### Added

- `--show-secrets` (alias `--reveal`) on every command that prints a connection
  string.
