import {
  describeCapacityPressure,
  isCapacityRiskError,
  parseCapacityPressure,
} from '@/lib/cloud-api'

// The same words the dashboard shows before a pressured create.
export const CAPACITY_RISK_WARNING =
  'Layerbase stays affordable by provisioning databases for you inside ' +
  'shared VMs and containers. Your plan allows several databases in one ' +
  'container. That does not make it the right architecture for every ' +
  'workload. Based on your current usage, adding another database here is ' +
  'likely to cause slowdowns or a crash, which can result in data loss. If ' +
  'you proceed, you accept that risk, and Layerbase may not be able to ' +
  'recover lost data. We recommend upgrading your plan or adding a dedicated ' +
  'server.'

export type CapacityRiskDecision = 'accept' | 'cancel'

// Pure so the three outcomes are unit-testable: the flag always accepts, an
// interactive run asks, and a non-interactive run without the flag refuses
// (never a silent "just do it" when nobody is there to read the warning).
export function decideCapacityRisk(options: {
  acceptFlag: boolean
  interactive: boolean
}): 'accept' | 'prompt' | 'refuse' {
  if (options.acceptFlag) return 'accept'
  return options.interactive ? 'prompt' : 'refuse'
}

export function formatCapacityWarning(pressureBody: unknown): string {
  const lines = describeCapacityPressure(parseCapacityPressure(pressureBody))
  return [
    'Capacity warning:',
    ...lines.map((line) => `  ${line}`),
    '',
    CAPACITY_RISK_WARNING,
  ].join('\n')
}

// Run a create that may be refused with a capacity warning. The first attempt
// never acknowledges the risk, so the user always sees the warning the cloud
// returns. On that refusal the create is resent AT MOST ONCE with the risk
// acknowledged: when --accept-capacity-risk was passed, or when the user picks
// "Proceed" at the prompt. Otherwise the original refusal is rethrown (its
// message carries the re-run hint and maps to EXIT_CAPACITY_RISK). Never loops.
export async function createWithCapacityConsent<T>(options: {
  create: (acknowledgeCapacityRisk: boolean) => Promise<T>
  acceptFlag: boolean
  interactive: boolean
  ask: () => Promise<CapacityRiskDecision | null>
  warn: (text: string) => void
}): Promise<T> {
  try {
    return await options.create(false)
  } catch (error) {
    if (!isCapacityRiskError(error)) throw error

    options.warn(formatCapacityWarning(error.info.body?.pressure))
    const decision = decideCapacityRisk({
      acceptFlag: options.acceptFlag,
      interactive: options.interactive,
    })
    if (decision === 'refuse') throw error
    if (decision === 'prompt') {
      const choice = await options.ask()
      if (choice !== 'accept') {
        error.info.message = 'Cancelled. No database was created.'
        error.message = error.info.message
        throw error
      }
    } else {
      options.warn('Proceeding because --accept-capacity-risk was passed.')
    }
    return options.create(true)
  }
}
