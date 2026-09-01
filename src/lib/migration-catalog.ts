// Static catalog of the external platforms `layerbase migrate` can import FROM.
//
// MIRROR SOURCE: layerbase web `lib/cloud/migration-sources.ts`
// (MIGRATION_SOURCES) and the cloud adapter registry
// `layerbase-cloud/src/lib/migration-providers/registry.ts`. The cloud has no
// public "list migration sources" endpoint on /v1, so this is a hand-kept
// mirror. When a source is added/changed in the web MIGRATION_SOURCES, update
// this table to match (id, credential shape, target engines). The cloud infers
// connection-string providers from the URL, so paste sources send only a
// connection string; only api-key sources send a `provider` id, which MUST equal
// the cloud provider id (`apiKeyProviderId` in the web catalog).
//
// Last reconciled against the web catalog: 2026-09-01 (23 sources).
//
// The web catalog also carries per-target hint/warning copy (`hintByTarget`,
// `warningByTarget`) for sources whose credential differs by target engine
// (Replit Postgres vs ReplDB, Heroku Postgres vs Key-Value Store, DigitalOcean
// per engine, Aiven per engine). The CLI collects credentials BEFORE it resolves
// the target database, so it cannot pick a per-target string: each hint below
// names every credential path that source has, in one or two sentences.

// The engines a migration can actually provision/target today (mirror of the
// web MigrateEngine union).
export type MigrateEngine =
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'redis'
  | 'valkey'
  | 'meilisearch'
  | 'libsql'
  | 'ferretdb'

// How the CLI collects credentials for a source:
//   - 'connection-string': the user pastes one URL (--connection-string). The
//     cloud infers the provider from it; migrate-from-source sends
//     { connectionString }.
//   - 'api-key': the user supplies a provider account key (and sometimes a
//     second id + a source secret). The cloud discovers the account's databases
//     first, then migrate-from-source sends { provider, apiKey, ... , sourceRef }.
export type SourceKind = 'connection-string' | 'api-key'

// The cloud provider id sent for api-key sources. MUST match the cloud registry.
export type CloudProviderId =
  | 'neon'
  | 'upstash'
  | 'supabase'
  | 'render'
  | 'railway'
  | 'planetscale'
  | 'algolia'
  | 'turso'
  | 'cloudflare-d1'

export type CatalogSource = {
  // CLI-facing id (the value of --source). Note `postgres` maps to the web
  // catalog's `other` source: a generic pasted PostgreSQL connection string.
  id: string
  label: string
  kind: SourceKind
  // Set only for api-key sources: the provider id sent to the cloud.
  provider?: CloudProviderId
  // Every engine this source can populate (drives the target-engine hint).
  targetEngines: MigrateEngine[]
  // Credential requirements, used for interactive prompting AND non-TTY
  // missing-flag validation.
  credentials: {
    // Paste sources need one connection string (--connection-string).
    connectionString?: { label: string; placeholder: string }
    // The primary provider API key (--source-key, alias --token).
    sourceKey?: { label: string; placeholder: string }
    // Optional second credential part sent as `apiKeyId` (--source-id, plus the
    // friendly aliases --app-id / --email / --token-id / --account-id / --url).
    sourceId?: { label: string; placeholder: string }
    // Optional user-supplied secret the provider API never returns, sent as
    // `sourceSecret` (--source-secret, alias --db-password). Supabase only.
    sourceSecret?: { label: string }
  }
  hint: string
}

export const MIGRATION_CATALOG: CatalogSource[] = [
  {
    id: 'neon',
    label: 'Neon',
    kind: 'api-key',
    provider: 'neon',
    targetEngines: ['postgresql'],
    credentials: {
      sourceKey: { label: 'Neon API key', placeholder: 'napi_...' },
    },
    hint: 'Neon API key (Account settings, then API keys). We list your projects so you can pick one.',
  },
  {
    id: 'netlify',
    label: 'Netlify DB',
    kind: 'connection-string',
    targetEngines: ['postgresql'],
    credentials: {
      connectionString: {
        label: 'Netlify database connection string',
        placeholder: 'postgresql://user:password@ep-something.neon.tech/neondb',
      },
    },
    hint: 'The Netlify dashboard never shows the string, so it comes from the CLI: run `netlify database status --show-credentials --branch production` and paste the postgresql:// string. Without --branch production you get the LOCAL dev PGlite string, which is not your Netlify database.',
  },
  {
    id: 'supabase',
    label: 'Supabase',
    kind: 'api-key',
    provider: 'supabase',
    targetEngines: ['postgresql'],
    credentials: {
      sourceKey: { label: 'Supabase access token', placeholder: 'sbp_...' },
      sourceSecret: { label: 'Database password' },
    },
    hint: 'Supabase access token (Account, then Access Tokens) plus the project database password (Supabase never exposes it through its API).',
  },
  {
    id: 'render',
    label: 'Render',
    kind: 'api-key',
    provider: 'render',
    targetEngines: ['postgresql'],
    credentials: {
      sourceKey: { label: 'Render API key', placeholder: 'rnd_...' },
    },
    hint: 'Render API key (Account Settings, then API Keys). We list your Postgres instances.',
  },
  {
    id: 'railway',
    label: 'Railway',
    kind: 'api-key',
    provider: 'railway',
    targetEngines: ['postgresql', 'mysql', 'redis'],
    credentials: {
      sourceKey: {
        label: 'Railway account or team token',
        placeholder: 'Railway token',
      },
    },
    hint: 'Railway account or team token (Account Settings, then Tokens). The source service needs public networking enabled.',
  },
  {
    id: 'replit',
    label: 'Replit',
    kind: 'connection-string',
    // Two Replit products behind one source, and both fit the paste shape: a
    // PRODUCTION database is Neon-backed Postgres, and ReplDB is reached over
    // plain HTTPS at kv.replit.com. The cloud dispatches on the scheme + host
    // (layerbase-cloud/src/lib/migration-providers/replit-kv.ts), so one
    // --connection-string slot carries either credential and migrate-preflight
    // validates both. No new credential shape is needed here.
    targetEngines: ['postgresql', 'valkey', 'redis'],
    credentials: {
      connectionString: {
        label: 'Replit connection string or REPLIT_DB_URL',
        placeholder:
          'postgresql://... or https://kv.replit.com/... for a ReplDB import',
      },
    },
    hint: 'For a Replit production database, copy the postgresql:// string from Database, then Settings in your Repl. For ReplDB (a Valkey or Redis target) run `echo $REPLIT_DB_URL` in the Repl shell and paste the https://kv.replit.com/... URL, which rotates, so copy it fresh. A development database (Helium) is sandboxed inside the Repl and cannot be dialed from here: push it out with pg_dump from the Repl shell instead.',
  },
  {
    id: 'heroku',
    label: 'Heroku',
    kind: 'connection-string',
    // Valkey leads the key-value pair deliberately: Heroku Key-Value Store IS
    // Valkey 9, and a Valkey 9 DUMP payload is refused by a Redis 7.2 target.
    targetEngines: ['postgresql', 'valkey', 'redis'],
    credentials: {
      connectionString: {
        label: 'Heroku DATABASE_URL or REDIS_URL',
        placeholder: 'postgres://... or rediss://...',
      },
    },
    hint: 'Run `heroku config:get DATABASE_URL -a your-app` for Postgres, or `heroku config:get REDIS_URL -a your-app` for the Key-Value Store, and copy it fresh: Heroku rotates both on its own schedule. Land a Key-Value Store on a Valkey target (it runs Valkey 9, which a Redis 7.2 target refuses), and note a database in a Private or Shield space is not reachable from outside that space.',
  },
  {
    id: 'digitalocean',
    label: 'DigitalOcean',
    kind: 'connection-string',
    targetEngines: [
      'postgresql',
      'mysql',
      'mariadb',
      'valkey',
      'redis',
      'ferretdb',
    ],
    credentials: {
      connectionString: {
        label: 'DigitalOcean connection string',
        placeholder:
          'postgresql://doadmin:...@your-cluster.db.ondigitalocean.com:25060/defaultdb?sslmode=require',
      },
    },
    hint: 'Open Databases in the control panel, pick the cluster, and copy Connection details on the Overview tab with the network set to Public network and the format set to Connection string. Paste it whole, because DigitalOcean assigns its own port; for a MongoDB cluster swap the trailing /admin for the database you actually want. A cluster with trusted sources denies every other address, so lift the restriction while the copy runs.',
  },
  {
    id: 'fly',
    label: 'Fly.io',
    kind: 'connection-string',
    targetEngines: ['postgresql'],
    credentials: {
      connectionString: {
        label: 'Fly MPG proxy connection string',
        placeholder:
          'postgresql://fly-user:password@mpg-proxy-something.fly.dev:5432/fly-db?sslmode=disable',
      },
    },
    hint: 'Fly Managed Postgres lives inside your Fly private network, so a pasted string only works through your own fly-mpg-proxy app, with the proxy hostname and ?sslmode=disable on the end. Otherwise push the data out from inside Fly with pg_dump: both paths are written out on https://layerbase.com/migrate/fly.',
  },
  {
    id: 'postgres',
    label: 'PostgreSQL (any)',
    kind: 'connection-string',
    targetEngines: ['postgresql'],
    credentials: {
      connectionString: {
        label: 'PostgreSQL connection string',
        placeholder: 'postgresql://user:password@host:5432/dbname',
      },
    },
    hint: 'Paste the full connection string for any PostgreSQL database: postgresql://user:password@host:5432/dbname',
  },
  {
    id: 'mysql',
    label: 'MySQL',
    kind: 'connection-string',
    targetEngines: ['mysql', 'mariadb'],
    credentials: {
      connectionString: {
        label: 'MySQL connection string',
        placeholder: 'mysql://user:password@host:3306/dbname',
      },
    },
    hint: 'Paste a MySQL connection string from any provider (Railway, PlanetScale, RDS, self-hosted). We run mysqldump once and copy the schema and data.',
  },
  {
    id: 'mariadb',
    label: 'MariaDB',
    kind: 'connection-string',
    targetEngines: ['mariadb'],
    credentials: {
      connectionString: {
        label: 'MariaDB/MySQL connection string',
        placeholder: 'mysql://user:password@host:3306/dbname',
      },
    },
    hint: 'Paste a MySQL or MariaDB connection string. A MariaDB source copies straight in; a MySQL 8 source on the default caching_sha2_password auth cannot be read by the MariaDB dump tools yet, so pick the mysql source for those.',
  },
  {
    id: 'planetscale',
    label: 'PlanetScale',
    kind: 'api-key',
    provider: 'planetscale',
    targetEngines: ['mysql', 'mariadb'],
    credentials: {
      sourceKey: {
        label: 'PlanetScale service token',
        placeholder: 'Service token',
      },
      sourceId: {
        label: 'Service token ID',
        placeholder: 'Service token ID',
      },
    },
    hint: 'PlanetScale service token and its ID (Settings, then Service tokens). Needs org-level read-databases permission.',
  },
  {
    id: 'upstash',
    label: 'Upstash',
    kind: 'api-key',
    provider: 'upstash',
    targetEngines: ['redis', 'valkey'],
    credentials: {
      sourceKey: {
        label: 'Upstash management API key',
        placeholder: 'Your Upstash API key',
      },
      sourceId: { label: 'Account email', placeholder: 'you@example.com' },
    },
    hint: 'Upstash account email and a management API key (Account, then Management API).',
  },
  {
    id: 'vercel-kv',
    label: 'Vercel KV',
    kind: 'connection-string',
    targetEngines: ['redis', 'valkey'],
    credentials: {
      connectionString: {
        label: 'Vercel KV URL',
        placeholder: 'rediss://default:password@your-db.upstash.io:6379',
      },
    },
    hint: 'Vercel KV was sunset and existing stores moved to Upstash Redis: in your Vercel project open Storage, then the Redis resource, then its Upstash dashboard, and copy the rediss:// TLS endpoint. A legacy KV_URL works too, but the REST URL and token will not.',
  },
  {
    id: 'redis',
    label: 'Redis',
    kind: 'connection-string',
    targetEngines: ['redis', 'valkey'],
    credentials: {
      connectionString: {
        label: 'Redis connection string',
        placeholder: 'redis:// or rediss://',
      },
    },
    hint: 'Paste a Redis connection string (redis:// or rediss://) from any provider. We read it once with a non-blocking scan and copy every key, type, and TTL.',
  },
  {
    id: 'valkey',
    label: 'Valkey',
    kind: 'connection-string',
    targetEngines: ['valkey'],
    credentials: {
      connectionString: {
        label: 'Valkey/Redis connection string',
        placeholder: 'redis:// or rediss://',
      },
    },
    hint: 'Paste a Redis or Valkey connection string (Valkey is wire-compatible with Redis, and a valkey:// or valkeys:// URI is accepted too).',
  },
  {
    id: 'algolia',
    label: 'Algolia',
    kind: 'api-key',
    provider: 'algolia',
    targetEngines: ['meilisearch'],
    credentials: {
      sourceKey: {
        label: 'Algolia Admin API key',
        placeholder: 'Admin API key',
      },
      sourceId: { label: 'Application ID', placeholder: 'Application ID' },
    },
    hint: 'Algolia Application ID and an Admin API key (Settings, then API Keys). A Search-only key will not work.',
  },
  {
    id: 'turso',
    label: 'Turso',
    kind: 'api-key',
    provider: 'turso',
    targetEngines: ['libsql'],
    credentials: {
      sourceKey: { label: 'Auth token', placeholder: 'Auth token' },
      sourceId: {
        label: 'Database URL',
        placeholder: 'libsql://...',
      },
    },
    hint: 'Turso database URL (libsql://... from `turso db show <db> --url`) and an auth token (`turso db tokens create <db>`).',
  },
  {
    id: 'cloudflare-d1',
    label: 'Cloudflare D1',
    kind: 'api-key',
    provider: 'cloudflare-d1',
    targetEngines: ['libsql'],
    credentials: {
      sourceKey: {
        label: 'Cloudflare API token (D1 Read)',
        placeholder: 'Cloudflare API token',
      },
      sourceId: {
        label: 'Cloudflare account ID',
        placeholder: '32-character hex id',
      },
    },
    hint: 'Cloudflare account ID (the /accounts/<id> segment of your dashboard URL) and an API token with D1 Read on that account (My Profile, then API Tokens). The copy pages through your tables rather than taking a snapshot, so migrate from a quiet database.',
  },
  {
    id: 'mongodb-atlas',
    label: 'MongoDB Atlas',
    kind: 'connection-string',
    // Any MongoDB source, hosted or not, lands on FerretDB (the MongoDB wire
    // protocol target). Atlas Admin API discovery is a web-side fast-follow, so
    // this stays paste-only until a cloud adapter exists.
    targetEngines: ['ferretdb'],
    credentials: {
      connectionString: {
        label: 'MongoDB connection string',
        placeholder:
          'mongodb+srv://user:password@cluster0.abc123.mongodb.net/mydb',
      },
    },
    hint: 'Paste a MongoDB connection string INCLUDING the database name (mongodb+srv://... for Atlas, mongodb://user:password@host:27017/mydb self-hosted); a multi-host mongodb:// string is not accepted and Atlas refuses addresses missing from Network Access. The target is FerretDB, so views, time-series collections, and any index it cannot create are skipped and named in the report.',
  },
  {
    id: 'aiven',
    label: 'Aiven',
    kind: 'connection-string',
    // No mariadb target on purpose. Aiven for MySQL is verified live (spindb
    // 0.68.4 passes --single-transaction --set-gtid-purged=OFF; checked end to
    // end against Aiven for MySQL 8.4.8 with gtid_mode=ON on 2026-09-01), but
    // hostdb's mariadb-dump cannot authenticate against a caching_sha2_password
    // source, which is the MySQL 8 default, so the same service that copies
    // cleanly into MySQL dies in the dump tool on a MariaDB target. Tracked as
    // C-164 in layerbase-cloud/tracker.md; add 'mariadb' only when that closes.
    //
    // Aiven has no Redis product any more (Aiven for Caching was decommissioned
    // from 15 October 2025), so both key-value targets read the same Valkey
    // service. valkeys:// and rediss:// are the same TLS protocol and the cloud
    // normalizes the scheme, so either paste is accepted.
    targetEngines: ['postgresql', 'mysql', 'valkey', 'redis'],
    credentials: {
      connectionString: {
        label: 'Aiven Service URI',
        placeholder:
          'postgres://avnadmin:...@pg-yourproject.a.aivencloud.com:12345/defaultdb?sslmode=require',
      },
    },
    hint: 'Copy the Service URI from Overview, then Connection information on your Aiven service: the postgres:// form with sslmode=require, the mysql:// form with ssl-mode=REQUIRED, or the Valkey URI (valkeys:// and rediss:// are both accepted). Paste it whole, because Aiven assigns a random high port, and start a powered-off free service before you begin.',
  },
  {
    id: 'crunchy-bridge',
    label: 'Crunchy Bridge',
    kind: 'connection-string',
    targetEngines: ['postgresql'],
    credentials: {
      connectionString: {
        label: 'Crunchy Bridge connection URI',
        placeholder:
          'postgres://postgres:password@p.abc123.db.postgresbridge.com:5432/postgres?sslmode=require',
      },
    },
    hint: 'Open the cluster in the Crunchy Bridge dashboard, go to Connection, and copy the URI for the postgres role (`cb uri <cluster>` prints the same string). Keep sslmode at require: the application role works too but is not a superuser, so pick postgres if your schema has extensions it does not own.',
  },
]

export function getCatalogSource(id: string): CatalogSource | undefined {
  return MIGRATION_CATALOG.find((s) => s.id === id)
}

export function catalogSourceIds(): string[] {
  return MIGRATION_CATALOG.map((s) => s.id)
}
