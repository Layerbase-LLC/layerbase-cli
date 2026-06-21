import { render } from 'ink'
import { Connecting } from '../ui/connecting'
import { getConnectionInfo } from '../lib/cloud-api'
import { buildLaunchPlan } from '../lib/engines'
import { runClient } from '../lib/launch'
import { printConnectionInfo } from '../lib/format'
import type { CommandFlags } from '../ui/app'

type ExecOptions = {
  command: string
  args: string[]
  flags: CommandFlags
}

// Exec commands hand the TTY to a native client, so they live outside the Ink
// tree. Ink renders only a transient spinner while the cloud lookup runs, then
// unmounts before the client takes over the terminal.
export async function runExec(options: ExecOptions): Promise<void> {
  const { command, flags } = options
  const dbRef = options.args[0]

  if (!dbRef) {
    process.stderr.write(`Usage: layerbase ${command} <db>\n`)
    process.exit(1)
  }

  const spinner = render(<Connecting label={`Resolving ${dbRef}...`} />)

  let info
  try {
    info = await getConnectionInfo(dbRef)
  } catch (error) {
    spinner.unmount()
    process.stderr.write(`${(error as Error).message}\n`)
    process.exit(1)
  }
  spinner.unmount()

  if (flags.print) {
    printConnectionInfo(info)
    return
  }

  let plan
  try {
    plan = buildLaunchPlan({ info, command })
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    process.exit(1)
  }

  const code = await runClient(plan)
  process.exit(code)
}
