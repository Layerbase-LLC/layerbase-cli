# AGENTS.md - layerbase-cli

`CLAUDE.md` is the project guide: read it before every task in this repository. This file adds only what agents other than Claude Code need on top of it; if the two differ, follow `CLAUDE.md`.

## Issue tracking

The local `tracker.md` is retired as an issue tracker. Concerns now live in GitHub issues on the [Ecosystem tracker](https://github.com/orgs/Layerbase-LLC/projects/1) project. Search open and closed issues in `Layerbase-LLC/layerbase-cloud`, `Layerbase-LLC/layerbase` and `Layerbase-LLC/layerbase-cli` before filing, and update the canonical issue instead of appending to `~/dev/layerbase-cloud/tracker.md` (now a read-only legacy index plus Module Sync and Risks & Watchlist). File web-only concerns in `layerbase`, CLI concerns in `layerbase-cli`, and everything else in `layerbase-cloud`; apply the `tracker` label, add the issue to the project, and set Status, Priority and every affected Surface. `layerbase-cli` is a public repository, so anyone can read its issues: keep them to what a CLI user could see (commands, behavior, error output), and put anything internal, such as server names, internal endpoints, infrastructure details or incident notes, in a private `layerbase-cloud` issue instead. Keep customer data and secrets out of issues.

## Git commands from a sandboxed agent

If your agent runs shell commands inside a built-in sandbox, run every `git` and `gh` command through the local zsh outside that sandbox instead, for example `/bin/zsh -lc 'git status'` with the agent's unsandboxed or escalated execution. The sandboxed bash lacks Bob's git config, credential helpers, SSH agent and GitHub login, and it can block writes under `.git`, so git commands run there fail or act as the wrong identity.
