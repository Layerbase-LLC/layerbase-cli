import { render } from 'ink'
import { Connecting } from '@/ui/connecting'
import { getConnectionInfo } from '@/lib/cloud-api'
import { buildLaunchPlan } from '@/lib/engines'
import { runClient } from '@/lib/launch'
import { printConnectionInfo } from '@/lib/format'
import type { CommandFlags } from '@/ui/app'
import { forOutput } from '@/lib/cli-output'

type ExecOptions = {
  command: string
  args: string[]
  flags: CommandFlags
}

// Resolve a database and hand the TTY to its native client. Returns the client's
// exit code (or 1 on a resolve/launch error) WITHOUT exiting the process, so it
// is reusable from both the CLI path and the interactive menu. Ink renders only
// a transient spinner during the cloud lookup, then unmounts before the client
// takes over the terminal.
export async function connectToDatabase(options: {
  dbRef: string
  command: string
  print?: boolean
}): Promise<number> {
  const { dbRef, command, print } = options

  const spinner = render(<Connecting label={`Resolving ${dbRef}...`} />)
  let info
  try {
    info = await getConnectionInfo(dbRef)
  } catch (error) {
    spinner.unmount()
    process.stderr.write(`${forOutput((error as Error).message)}\n`)
    return 1
  }
  spinner.unmount()

  if (print) {
    printConnectionInfo(info)
    return 0
  }

  let plan
  try {
    plan = buildLaunchPlan({ info, command })
  } catch (error) {
    process.stderr.write(`${forOutput((error as Error).message)}\n`)
    return 1
  }

  return runClient(plan)
}

// CLI entrypoint for connect/psql/redis-cli/mysql: resolve + launch, then exit.
export async function runExec(options: ExecOptions): Promise<void> {
  const { command, flags } = options
  const dbRef = options.args[0]

  if (!dbRef) {
    process.stderr.write(`Usage: layerbase ${command} <db>\n`)
    process.exit(1)
  }

  const code = await connectToDatabase({ dbRef, command, print: flags.print })
  process.exit(code)
}
