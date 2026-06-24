import { getConnectionInfo } from '@/lib/cloud-api'
import { buildConnectionString } from '@/lib/format'
import { runSpindb, spindbExists } from '@/lib/run-spindb'

// spindb reads the remote connection string from this env var (--from-env), so
// the password is never on argv / in shell history.
const CLONE_ENV = 'LAYERBASE_CLONE_URL'

// Clone a cloud database into a local spindb container. layerbase resolves the
// remote connection info (authenticated); spindb does the create + data copy.
// If the local container does not exist it is created (matching engine/version);
// then spindb pulls the data in via the env-passed connection string.
export async function runClone(options: {
  dbRef: string
  localName?: string
}): Promise<number> {
  const { dbRef } = options

  process.stdout.write(`Resolving ${dbRef}...\n`)
  let info
  try {
    info = await getConnectionInfo(dbRef)
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    return 1
  }

  let connectionString: string
  try {
    connectionString = buildConnectionString(info)
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`)
    return 1
  }

  const localName = options.localName ?? info.database ?? dbRef
  const versionLabel = info.version ? ` ${info.version}` : ''
  process.stdout.write(
    `Cloning "${dbRef}" (${info.engine}${versionLabel}) into local spindb container "${localName}".\n`,
  )

  let justCreated = false
  if (!(await spindbExists(localName))) {
    process.stdout.write(`Creating local container "${localName}"...\n`)
    const createArgs = [
      'create',
      localName,
      '--engine',
      info.engine,
      '--no-start',
    ]
    if (info.version) createArgs.push('--db-version', info.version)
    const code = await runSpindb(createArgs)
    if (code !== 0) {
      process.stderr.write('Could not create the local container.\n')
      return code
    }
    justCreated = true
  }

  process.stdout.write('Pulling data with spindb...\n')
  const pullArgs = ['pull', localName, '--from-env', CLONE_ENV]
  // A freshly created container is empty, so there is nothing to back up first.
  if (justCreated) pullArgs.push('--force')
  return runSpindb(pullArgs, { env: { [CLONE_ENV]: connectionString } })
}
