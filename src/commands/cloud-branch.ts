import {
  createBranch,
  deleteBranch,
  listBranches,
  resetBranch,
  resolveDatabaseId,
} from '@/lib/cloud-api'
import type { BranchInfo } from '@/lib/cloud-api'
import type { CommandFlags } from '@/ui/app'
import { reportError, writeJson } from '@/lib/cli-output'

const BRANCH_USAGE =
  'Usage:\n' +
  '  layerbase cloud branch <db> <branch-name>   Create/reuse a branch\n' +
  '  layerbase cloud branch reset <db> <name>    Re-fork a branch from parent\n' +
  '  layerbase cloud branch delete <db> <name>   Delete a branch\n' +
  '  layerbase cloud branch ls <db>              List a database branches\n'

function printBranch(branch: BranchInfo): void {
  process.stdout.write(`${branch.name} (${branch.status})\n`)
  if (branch.connectionString) {
    process.stdout.write(`${branch.connectionString}\n`)
  }
}

async function runBranchCreate(
  db: string | undefined,
  name: string | undefined,
  json: boolean,
  action: 'create' | 'reset',
): Promise<number> {
  if (!db || !name) {
    process.stderr.write(BRANCH_USAGE)
    return 1
  }
  try {
    const parentId = await resolveDatabaseId(db)
    const branch =
      action === 'reset'
        ? await resetBranch({ parentId, name })
        : await createBranch({ parentId, name })
    if (json) {
      writeJson({ ok: true, ...branch })
    } else {
      printBranch(branch)
    }
    return 0
  } catch (error) {
    return reportError(error, json)
  }
}

async function runBranchDelete(
  db: string | undefined,
  name: string | undefined,
  json: boolean,
): Promise<number> {
  if (!db || !name) {
    process.stderr.write(BRANCH_USAGE)
    return 1
  }
  try {
    const parentId = await resolveDatabaseId(db)
    await deleteBranch({ parentId, name })
    if (json) {
      writeJson({ ok: true, deleted: name })
    } else {
      process.stdout.write(`Deleted branch ${name}.\n`)
    }
    return 0
  } catch (error) {
    return reportError(error, json)
  }
}

async function runBranchList(
  db: string | undefined,
  json: boolean,
): Promise<number> {
  if (!db) {
    process.stderr.write(BRANCH_USAGE)
    return 1
  }
  try {
    const parentId = await resolveDatabaseId(db)
    const branches = await listBranches(parentId)
    if (json) {
      writeJson(branches)
      return 0
    }
    if (branches.length === 0) {
      process.stdout.write('No branches.\n')
      return 0
    }
    for (const branch of branches) {
      process.stdout.write(`${branch.name}\t${branch.status}\t${branch.id}\n`)
    }
    return 0
  } catch (error) {
    return reportError(error, json)
  }
}

// Dispatch `cloud branch ...`. `args` is everything after the `branch` token.
export async function runBranch(options: {
  args: string[]
  flags: CommandFlags
}): Promise<number> {
  const json = options.flags.json ?? false
  const [first, ...rest] = options.args

  if (first === 'ls' || first === 'list') {
    return runBranchList(rest[0], json)
  }
  if (first === 'reset') {
    return runBranchCreate(rest[0], rest[1], json, 'reset')
  }
  if (first === 'delete' || first === 'rm') {
    return runBranchDelete(rest[0], rest[1], json)
  }
  // Default: create/reuse a branch named args[1] off database args[0].
  return runBranchCreate(first, rest[0], json, 'create')
}
