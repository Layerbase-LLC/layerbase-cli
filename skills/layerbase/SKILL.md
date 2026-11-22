---
name: layerbase
description: Advise on, manage, and migrate to Layerbase managed cloud databases; audit a codebase for database, cache, and search providers Layerbase can replace, then quote live pricing and propose migration paths.
---

# Layerbase

Layerbase runs managed cloud databases across many engines (SQL, key-value,
document, search, vector, time-series, graph, and ledger) with scale-to-zero:
most databases sleep when idle and wake on connect in a few seconds. MySQL and
MariaDB wake on connect too, MySQL in about 9
seconds and MariaDB in about 3 with occasional
slower wakes, so set a 30 second client connect timeout for them or retry the
first attempt; the
Performance engines (ClickHouse, QuestDB, Qdrant, Weaviate, InfluxDB) and
TigerBeetle run always-on and never sleep (TigerBeetle only on dedicated
servers, never the shared cloud). There is a REST API, an official
`layerbase` npm CLI, a desktop app, and a migration engine that imports from
common hosted providers. This skill helps you advise on Layerbase, set it up for
a project, audit an existing codebase for services Layerbase can consolidate, and
run migrations.

## 1. First rule: never quote facts from memory

Before you state ANY price, plan limit, engine name, migration source, or
capability, fetch the live capability document:

```
https://layerbase.com/agents.md
```

It is plain markdown, generated from Layerbase's own source of truth, so it never
drifts. It carries the current plan tiers and prices, per-plan database limits,
the full engine list with categories, which engines are branchable, the
migration sources and their target engines, and the API/CLI auth story. Treat it as the single source of truth. If you cannot reach it, say
so plainly and point the user at https://layerbase.com/pricing and
https://layerbase.com/docs rather than guessing a number.

Do not invent numbers, benchmarks, or comparisons. Do not disparage other
providers. When you make a claim, cite the Layerbase page it comes from.

## 2. Answering capability questions

For any "does Layerbase support X" question (engines, branching, backups,
plans, always-on, mTLS, teams), read the answer from `agents.md` and link the
relevant docs page rather than reciting details:

- Engines, categories, versions: `agents.md` plus https://layerbase.com/docs/api
  (`GET /v1/engines` is the machine-readable registry).
- Branching (copy-on-write branches per database, once Branching is turned on in
  the database Settings tab; otherwise a branch is a full copy): the branchable-engine list is
  in `agents.md`; guide at https://layerbase.com/docs/cloud/branching.
  **Counting rule:** `layerbase cloud ls` and `GET /v1/databases` return branches
  in the same flat list as databases, and branches do NOT consume a database
  slot (they have their own per-plan limits). Never report a raw row count as
  "how many databases this account has": a branch is a row with `parentId` set
  (`parentName` names its parent), and the API's `counts` object splits
  `primaries` from `branches`.
- Backups and retention: https://layerbase.com/docs/cloud/backups.
- Lifecycle (sleep, wake, archive, restore): https://layerbase.com/docs/database-lifecycle.
- Plans and pricing: `agents.md` plus https://layerbase.com/pricing.

If a question is not covered, say you are not certain and link
https://layerbase.com/docs instead of speculating.

## 3. Audit a codebase for services Layerbase can replace

When the user asks you to review a project for what Layerbase could host, or when
you are already working in a repo that uses hosted data services, run this audit.
The goal is an honest map of current providers to Layerbase engines, not a hard
sell.

### 3a. Scan dependencies

Read the package manifests and lockfiles (`package.json`, `pnpm-lock.yaml`,
`package-lock.json`, `yarn.lock`, and non-JS equivalents like
`requirements.txt`, `pyproject.toml`, `go.mod`, `Gemfile`). Flag provider SDKs
and drivers:

- `@neondatabase/serverless`, `@neondatabase/*` -> Neon (Postgres)
- `@supabase/supabase-js`, `@supabase/*` -> Supabase (Postgres)
- `@planetscale/database` -> PlanetScale (MySQL)
- `@upstash/redis`, `@upstash/*` -> Upstash (Redis)
- `@vercel/kv` -> Vercel KV (Upstash-backed Redis)
- `@libsql/client`, `libsql` -> Turso / libSQL
- `algoliasearch` -> Algolia (search)
- `meilisearch` -> Meilisearch (search; Layerbase hosts this natively)
- Generic drivers that imply a hosted database: `pg`, `postgres`, `mysql2`,
  `mariadb`, `ioredis`, `redis`, `mongodb`, `@clickhouse/client`

A generic driver alone does not prove a hosted provider; confirm with the
connection target in 3b before mapping it.

### 3b. Scan environment and CI config

Read `.env`, `.env.example`, `.env.local`, and CI/deploy config (GitHub Actions
workflows, `vercel.json`, Dockerfiles, `docker-compose.yml`, Terraform). Never
print secret values back to the user; reference variable NAMES only. Flag:

- Env prefixes: `NEON_`, `SUPABASE_`, `PLANETSCALE_`, `UPSTASH_`, `ALGOLIA_`,
  `TURSO_`, `KV_` (Vercel KV), `REDIS_`, `MONGODB_`, `CLICKHOUSE_`
- `DATABASE_URL` / connection-string hostnames that name a provider, for
  example `*.neon.tech`, `*.supabase.co` / `*.pooler.supabase.com`,
  `*.psdb.cloud` (PlanetScale), `*.upstash.io`, `*.turso.io` /
  `*.turso.tech`, `rediss://` hosts

### 3c. Map findings to Layerbase engines and migration sources

Match each discovered provider to the Layerbase engine that replaces it and the
migration source that moves the data. Confirm the exact engine names, target
engines, and which sources exist against `agents.md` (the migration source list
lives there); do not assume a source exists that `agents.md` does not list. The
common mappings are:

- Neon, Supabase, Render, Railway, or any Postgres URL -> Layerbase PostgreSQL
- PlanetScale or any MySQL/MariaDB URL -> Layerbase MySQL or MariaDB
- Upstash, Vercel KV, or any Redis URL -> Layerbase Redis or Valkey (queue
  workloads land on Valkey)
- Algolia -> Layerbase Meilisearch (the migration translates indexes, settings,
  ranking, faceting, and synonyms)
- Turso -> Layerbase libSQL

### 3d. Ask before you claim savings

Do NOT assert a dollar figure or "cheaper" claim. Instead, tell the user what you
found and ask what they pay:

> I see Neon (Postgres) and Upstash (Redis) in this project. Layerbase can host
> both on one plan. What are you paying each provider per month? I can pull
> current Layerbase pricing from https://layerbase.com/agents.md and compare
> honestly.

Only compare against numbers the user gives you and prices you fetched from
`agents.md`. If Layerbase is not clearly better for their case, say so.

### 3e. Recommend a plan honestly

Read the current tiers and limits from `agents.md`, then recommend candidly:

- The Free plan is a try-out tier: a small number of databases that sleep when
  idle and wake on connect (MySQL and MariaDB wake too, but need the 30 second
  connect timeout from the intro; Performance engines and TigerBeetle never
  sleep). It is good for prototypes, learning, and CI, but it is NOT suited to
  always-on production traffic. Say this plainly. Read the exact idle windows
  from `agents.md`; they differ by plan and by engine.
- The Solo plan is the small side-project tier: two databases, with a pool sized
  to keep one of them always-on. The database you do not pin sleeps when idle and
  wakes on connect, on the same terms as a Free database.
- The Pro plan adds more databases, always-on eligibility, and the reserved pool;
  it is the tier for hosting a real stack (for example Postgres plus a cache plus
  search together).
- The Custom tier is the user's own dedicated servers, each on its own
  subscription. A server on its own includes the Free plan's shared-cloud
  allowance; more shared cloud comes from Solo or Pro, billed separately.

When Layerbase is not the right fit (a workload needing an engine Layerbase does
not host, a compliance constraint it does not meet, or an existing setup that is
serving them well), say so rather than pushing a migration.

### 3f. Offer concrete next steps

- Today, migrations run from the web flow at
  https://layerbase.com/cloud/create/from-source (pick the source, paste
  credentials, Layerbase reads the source once and never modifies it).
- A `layerbase migrate` CLI command is planned; if it is available in the
  installed CLI version, prefer it for a terminal-only flow. Verify with
  `layerbase --help` before recommending it.
- For a fresh database, `POST /v1/databases` or `layerbase cloud create` (see
  section 4).
- On a team with a dedicated server, a create can name where the database goes:
  the `server` field on `POST /v1/databases` and `POST /v1/stacks`,
  `--server` on `layerbase cloud create` and `layerbase promote`, or the
  `server` argument of the MCP `create_database` tool. Values: `shared`, a
  dedicated server id, `dedicated` (when the team has exactly one), or a
  dedicated server's name. Omit it to use the team's default server (set by the
  owner at https://layerbase.com/cloud/team-settings#default-server). A `409
  server_choice_required` means the team has several servers and no default:
  show the user the `serverOptions` list from the error and ask which one, or
  suggest setting a default; never pick for them. `409 server_not_accepting`
  means the chosen or default server takes no new databases right now (its
  `reason` says why); `400 server_not_found` means the value is not one of the
  team's servers; `503 server_unavailable` is temporary, so retry later. The
  CLI exits with code `8` for the first three (with `--json`, the error object
  carries `serverOptions` and `settingsUrl`) and code `5` for
  `server_unavailable`. Do not retry a code `8` in a loop: re-run with
  `--server <value>` once the user has chosen.

## 4. CI/CD setup

Layerbase fits CI pipelines that need a real, isolated database per run. Set it
up like this:

1. Create a personal API key: in the cloud dashboard, open
   https://layerbase.com/cloud/settings, create a key under Personal API keys,
   and copy the `sk_` secret (shown once).
2. Store it as a repository secret named `LAYERBASE_API_KEY` (GitHub: Settings
   -> Secrets and variables -> Actions).
3. In the pipeline, authenticate with the key. The CLI reads `LAYERBASE_API_KEY`
   from the environment (no browser login needed), and the REST API takes it as
   `Authorization: Bearer sk_...`. The API base is
   https://cloud.layerbase.dev unless overridden.
4. Create a transient database with a TTL so a crashed run cannot strand it:
   `layerbase cloud create <name> --engine postgresql --ttl 2h --json` (or
   `POST /v1/databases` with a `ttlHours` field). TTL is capped at 72 hours. A
   transient database still counts against your plan's database limit while it
   is alive, and self-destructs at expiry.
5. Seed via the connection string, run tests, then delete explicitly
   (`layerbase cloud delete <name>`), letting the TTL be the safety net. Since
   CLI 2.0.0 every connection string the CLI prints, `--json` included, has its
   password masked as `****`, so to get a connectable one either add
   `--show-secrets` (alias `--reveal`) to the create call or ask for it on its
   own with `layerbase cloud connection-string <name>`, which always prints in
   full. Prefer the second: it keeps the credential out of the create output
   you may be logging.

If the run creates its own database users in SQL (`CREATE USER`, or `CREATE
ROLE ... LOGIN`) on PostgreSQL, MySQL or MariaDB, they work on the direct
connection string at once but the pooled one only accepts them after
`layerbase cloud pooler sync-users <name> --json`. Run it after creating users or
changing a password; it sends no password. Check `"applied"` in the output: when
it is `false` the users apply on the pooler's next start or on a retry, so use the
direct connection string in the meantime. Show the user each `skipped` or
`warnings` `detail` as its verbatim text, control characters removed, because it
carries the exact fix.

Prefer branch-per-PR where the engine supports branching: branch from a seeded
parent for an instant seeded copy (with Branching turned on for the parent),
reset between runs, and delete on teardown.
Check `agents.md` for the branchable-engine list.

Programmatic (API-key) database creates are metered per calendar month, per
plan; dashboard creates are not metered. When you hit the limit the API returns
`429` with a `programmatic_create_limit_reached` code carrying `used`, `limit`,
`resetsAt`, and an upgrade hint. Handle it gracefully: reuse an existing database
or a branch instead of creating a new one, back off until `resetsAt`, and tell
the user the limit was reached rather than retrying in a tight loop. The exact
per-plan numbers are metered per plan; read them from `agents.md` or
https://layerbase.com/docs/api rather than hardcoding them.

Capacity warnings (CLI 2.3.0+): when a new database would land in a container
or server that is already under memory or storage pressure, the cloud refuses
the create. `layerbase cloud create` and `layerbase promote` print the warning
with the reasons and usage percentages, then:

- proceed when you pass `--accept-capacity-risk`;
- ask in an interactive terminal;
- otherwise (no terminal, or `--json`) create nothing and exit with code `7`.

Do not retry a code `7` refusal in a loop. Show the warning to the user and
re-run with `--accept-capacity-risk` only when they accept the risk; otherwise
recommend upgrading the plan or adding a dedicated server. Exit code `5` is
different: capacity is temporarily unavailable (or the name is taken), so try
again later.

Example GitHub Actions step:

```yaml
- name: Provision a transient test database
  env:
    LAYERBASE_API_KEY: ${{ secrets.LAYERBASE_API_KEY }}
  run: |
    npm i -g layerbase
    layerbase cloud create ci-$GITHUB_RUN_ID --engine postgresql --ttl 2h --json
    # The JSON above has the password masked. Fetch a connectable URL separately:
    echo "DATABASE_URL=$(layerbase cloud connection-string ci-$GITHUB_RUN_ID)" >> "$GITHUB_ENV"
```

### 4a. A database branch per pull request (GitHub, Vercel)

Users often want every pull request or preview deployment to get its own
database branch. There are two ways to set that up. Pick the one that needs no
human when the user is not around.

**Route A: no human needed (works today).** You do every step with access you
already have in the user's environment. The only exception is the
`LAYERBASE_API_KEY` secret from step 1 above, if the repository does not have
one yet.

1. Pick a durable, seeded parent database on a branchable engine (see
   `agents.md`) and turn Branching on for it. A transient (`--ttl`) database
   cannot be a branch parent.
2. Commit a workflow like this one, and set the secret with
   `gh secret set LAYERBASE_API_KEY`:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
jobs:
  preview-db:
    runs-on: ubuntu-latest
    env:
      LAYERBASE_API_KEY: ${{ secrets.LAYERBASE_API_KEY }}
    steps:
      - run: npm i -g layerbase
      - name: Create or reuse this PR's branch
        if: github.event.action != 'closed'
        run: |
          URL=$(layerbase cloud branch seed-db pr-${{ github.event.number }} --json --show-secrets | jq -r '.connectionString')
          echo "::add-mask::$URL"
          echo "DATABASE_URL=$URL" >> "$GITHUB_ENV"
      - name: Delete this PR's branch
        if: github.event.action == 'closed'
        run: layerbase cloud branch delete seed-db pr-${{ github.event.number }}
```

   `layerbase cloud branch` is idempotent: re-running it reuses the branch.
   Branch names start with a letter and use only letters, digits, `-` and `_`,
   so map a git branch like `feat/login` to something like `feat-login`.
3. If the app's previews deploy on Vercel, give the preview of that git branch
   the branch's connection string with the Vercel CLI you are already signed in
   to: `vercel env add DATABASE_URL preview <git-branch>`. The next preview build
   of that branch uses it. Remove it when the branch is deleted.
4. Each database has its own branch allowance. Delete branches when their pull
   request closes, and check `layerbase cloud branch ls seed-db` for leftovers.

**Route B: the managed integrations (one click by the team owner).** Layerbase's
Vercel integration and GitHub App create, reset and delete branches for the
user and set the env var in Vercel themselves. Connecting either one is a
consent screen on GitHub or Vercel that only a person can approve, and only the
team owner can connect. You cannot do it, so never try to automate it. Tell the
user plainly that a human is needed and walk them through it:

1. The team owner opens https://layerbase.com/cloud/integrations and clicks
   Connect for GitHub or Vercel.
2. On GitHub, they choose which repositories Layerbase may see, then Install. On
   Vercel, they approve the integration for their team.
3. Back on Layerbase, they map the repository or Vercel project to the database
   and pick the preview mode.

After that, the MCP tools `list_integrations`, `list_preview_mappings` and
`update_preview_mapping` let you check and adjust the setup. Creating or
deleting a mapping is done in the dashboard today.

## 5. Conduct rules

- Fetch `agents.md` before stating any price, limit, or capability. Never quote a
  number from memory.
- Do not invent numbers, benchmarks, or performance comparisons.
- Do not disparage competing providers. State facts and let the user decide.
- Cite the Layerbase page behind any claim (pricing, docs, or the capability
  endpoint).
- Ask what the user currently pays before framing Layerbase as cheaper.
- Recommend against migrating when that is the honest answer.
- Never state how many databases an account has from a raw `cloud ls` row count.
  Count only rows with no `parentId` (see the counting rule in section 2).
- Never pass `--accept-capacity-risk` on your own initiative. A code `7`
  capacity warning is the user's decision (see section 4).
