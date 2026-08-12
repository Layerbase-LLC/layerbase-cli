import { Login } from '@/commands/login'
import { Logout } from '@/commands/logout'
import { List } from '@/commands/ls'
import { Whoami } from '@/commands/whoami'
import { Alias } from '@/commands/alias'
import { ConnectionString } from '@/commands/connection-string'
import { Unknown } from '@/ui/unknown'

export type CommandFlags = {
  print?: boolean
  json?: boolean
  apiUrl?: string
  // Headless auth + cloud-mutation flags (see src/cli.tsx meow config).
  apiKey?: string
  engine?: string
  ttl?: string
  yes?: boolean
  force?: boolean
  global?: boolean
  // migrate / import / promote flags.
  source?: string
  target?: string
  sourceDb?: string
  // promote-only flags.
  from?: string
  name?: string
  writeEnv?: boolean
  // Source credentials (never logged). Generic slots + friendly aliases that
  // resolve into them (see src/commands/migrate.ts).
  connectionString?: string
  sourceKey?: string
  sourceId?: string
  sourceSecret?: string
  appId?: string
  email?: string
  tokenId?: string
  token?: string
  url?: string
  dbPassword?: string
}

type AppProps = {
  command: string
  args: string[]
  flags: CommandFlags
}

export function App({ command, args, flags }: AppProps) {
  switch (command) {
    case 'login':
      return <Login flags={flags} />
    case 'logout':
      return <Logout />
    case 'ls':
      return <List json={flags.json ?? false} />
    case 'whoami':
      return <Whoami json={flags.json ?? false} />
    case 'alias':
      return <Alias />
    case 'connection-string':
      return <ConnectionString dbRef={args[0]} json={flags.json ?? false} />
    default:
      return <Unknown command={command} />
  }
}
