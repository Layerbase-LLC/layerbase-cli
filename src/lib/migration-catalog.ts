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
    // friendly aliases --app-id / --email / --token-id / --url).
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
    hint: 'Paste a full PostgreSQL connection string for any provider.',
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
    hint: 'Paste a MySQL connection string from any provider (Railway, RDS, self-hosted).',
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
    hint: 'Paste a MySQL or MariaDB connection string (MariaDB is MySQL-compatible).',
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
        placeholder: 'rediss://...',
      },
    },
    hint: 'Vercel KV is Upstash-backed Redis. Copy the KV_URL (a rediss:// string) from your Vercel project storage settings.',
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
    hint: 'Paste a Redis connection string (redis:// or rediss://) from any provider.',
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
    hint: 'Paste a Redis or Valkey connection string (Valkey is wire-compatible with Redis).',
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
]

export function getCatalogSource(id: string): CatalogSource | undefined {
  return MIGRATION_CATALOG.find((s) => s.id === id)
}

export function catalogSourceIds(): string[] {
  return MIGRATION_CATALOG.map((s) => s.id)
}
