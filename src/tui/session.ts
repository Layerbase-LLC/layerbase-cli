// Pure session label. The loader fills the facts. This module does not touch
// the network or the disk.

import { QUICK_KEYS } from '@/tui/keys'

export type SessionFacts = {
  mode: 'anonymous' | 'key' | 'jwt'
  email: string | null
  plan: string | null
  // JWT whoami() only. Null when that call was skipped or failed.
  hasActivePlan: boolean | null
  keyRejected: string | null
  // True when LAYERBASE_API_KEY is set. That env var outranks the saved key.
  keyFromEnv: boolean
  // True when a browser-login JWT is stored, even if an API key is what this
  // process uses for requests.
  hasBrowserToken: boolean
}

export function anonymousSession(): SessionFacts {
  return {
    mode: 'anonymous',
    email: null,
    plan: null,
    hasActivePlan: null,
    keyRejected: null,
    keyFromEnv: false,
    hasBrowserToken: false,
  }
}

export function sessionLabel(facts: SessionFacts): string {
  if (facts.mode === 'key' && facts.keyRejected) {
    return `API key rejected: ${facts.keyRejected}`
  }
  if (facts.mode === 'key' && !facts.email) {
    return 'signed in with API key'
  }
  if (facts.mode === 'key' && facts.email) {
    return facts.plan
      ? `signed in as ${facts.email} (${facts.plan})`
      : `signed in as ${facts.email}`
  }
  if (facts.mode === 'jwt' && facts.email) {
    if (facts.hasActivePlan === true) {
      return `signed in as ${facts.email}, active plan`
    }
    if (facts.hasActivePlan === false) {
      return `signed in as ${facts.email}, no active plan`
    }
    return `signed in as ${facts.email}`
  }
  if (facts.mode === 'jwt') return 'signed in'
  return 'not signed in'
}

// Cloud create goes through createDatabase(), which requires key mode.
// Short label for the top bar. The full error stays in the cloud section.
export function sessionBadge(facts: SessionFacts): string {
  if (facts.mode === 'anonymous') return 'signed out'
  if (facts.keyRejected) return 'key rejected'
  if (facts.plan) return facts.plan
  if (facts.mode === 'key' && !facts.email) return 'api key'
  if (facts.email) return facts.email
  if (facts.hasActivePlan === true) return 'active plan'
  if (facts.hasActivePlan === false) return 'no plan'
  return 'signed in'
}

export function canCreateCloud(facts: SessionFacts): boolean {
  return facts.mode === 'key' && !facts.keyRejected
}

// Manual wake is a paid-plan action. Free plans wake on connect. A missing
// plan name is not treated as paid unless whoami reported an active plan.
export function canWake(facts: SessionFacts): boolean {
  if (facts.mode === 'anonymous' || facts.keyRejected) return false
  if (facts.plan) return facts.plan.toLowerCase() !== 'free'
  return facts.hasActivePlan === true
}

// How this process authenticated. The plan name stays in the header badge.
export function authMethodLabel(facts: SessionFacts): string {
  if (facts.mode === 'anonymous') return 'signed out'
  if (facts.keyRejected) {
    return facts.keyFromEnv ? 'env key rejected' : 'saved key rejected'
  }
  if (facts.mode === 'jwt') return 'browser'
  if (facts.hasBrowserToken && facts.keyFromEnv) return 'env key + browser'
  if (facts.hasBrowserToken) return 'browser + api key'
  if (facts.keyFromEnv) return 'env api key'
  return 'api key'
}

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

// Footer. The three keys people need stay on this line. The rest are in ?.
export function statusBarText(options: {
  auth: string
  escHint: boolean
  banner: string | null
  age: string
  width: number
  quick?: string
}): string {
  const parts = [
    options.quick ?? QUICK_KEYS,
    options.auth,
    options.escHint ? 'esc again to quit' : null,
    options.age,
    options.banner,
  ].filter((part): part is string => Boolean(part))
  return clip(parts.join('  '), options.width)
}
