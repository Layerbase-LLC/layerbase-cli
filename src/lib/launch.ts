import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LaunchPlan } from './engines'

// Spawns the engine's native client with credentials passed via env or a
// transient 0600 file, never on argv, then cleans the credential up on exit.
export async function runClient(plan: LaunchPlan): Promise<number> {
  const scratch = await mkdtemp(join(tmpdir(), 'layerbase-'))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...plan.env,
    ...plan.secretEnv,
  }
  let argv = plan.argv

  try {
    if (plan.tempFile) {
      const file = join(scratch, 'credential')
      await writeFile(file, plan.tempFile.contents, {
        mode: plan.tempFile.mode,
      })
      await chmod(file, plan.tempFile.mode)

      if (plan.tempFile.via.type === 'env') {
        env[plan.tempFile.via.envVar] = file
      } else {
        argv = [...plan.tempFile.via.render(file), ...argv]
      }
    }

    return await new Promise<number>((resolve) => {
      const child = spawn(plan.bin, argv, { stdio: 'inherit', env })
      child.on('error', (error) => {
        process.stderr.write(
          `Failed to launch \`${plan.bin}\`: ${error.message}\n` +
            `Make sure \`${plan.bin}\` is installed and on your PATH.\n`,
        )
        resolve(127)
      })
      child.on('exit', (exitCode) => resolve(exitCode ?? 0))
    })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
