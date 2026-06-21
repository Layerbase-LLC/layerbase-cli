import { Login } from '../commands/login'
import { Logout } from '../commands/logout'
import { List } from '../commands/ls'
import { ConnectionString } from '../commands/connection-string'
import { Unknown } from './unknown'

export type CommandFlags = {
  print?: boolean
  json?: boolean
  apiUrl?: string
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
    case 'connection-string':
      return <ConnectionString dbRef={args[0]} />
    default:
      return <Unknown command={command} />
  }
}
