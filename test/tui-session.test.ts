import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pendingColumn, pendingPhrase, spinFrame } from '@/tui/pending'
import { escapeChord } from '@/tui/keys'
import {
  anonymousSession,
  authMethodLabel,
  canCreateCloud,
  canWake,
  sessionBadge,
  sessionLabel,
  statusBarText,
  type SessionFacts,
} from '@/tui/session'

function facts(overrides: Partial<SessionFacts> = {}): SessionFacts {
  return { ...anonymousSession(), ...overrides }
}

test('key mode with a plan names the plan', () => {
  assert.equal(
    sessionLabel(facts({ mode: 'key', email: 'a@b.co', plan: 'pro' })),
    'signed in as a@b.co (pro)',
  )
})

test('key mode without a plan omits the parenthesis', () => {
  assert.equal(
    sessionLabel(facts({ mode: 'key', email: 'a@b.co' })),
    'signed in as a@b.co',
  )
})

test('a key with no identity endpoint says so', () => {
  assert.equal(sessionLabel(facts({ mode: 'key' })), 'signed in with API key')
})

test('JWT email formats without inventing a plan name', () => {
  assert.equal(
    sessionLabel(facts({ mode: 'jwt', email: 'a@b.co' })),
    'signed in as a@b.co',
  )
  assert.equal(
    sessionLabel(facts({ mode: 'jwt', email: 'a@b.co', hasActivePlan: true })),
    'signed in as a@b.co, active plan',
  )
  assert.equal(
    sessionLabel(facts({ mode: 'jwt', email: 'a@b.co', hasActivePlan: false })),
    'signed in as a@b.co, no active plan',
  )
})

test('neither key nor JWT is signed out', () => {
  assert.equal(sessionLabel(anonymousSession()), 'not signed in')
})

test('the header badge stays short when a key is rejected', () => {
  assert.equal(
    sessionBadge(
      facts({ mode: 'key', keyRejected: 'Invalid or revoked API key' }),
    ),
    'key rejected',
  )
  assert.equal(sessionBadge(anonymousSession()), 'signed out')
  assert.equal(
    sessionBadge(facts({ mode: 'key', email: 'a@b.co', plan: 'pro' })),
    'pro',
  )
})

test('auth method names the credential, not the plan', () => {
  assert.equal(authMethodLabel(anonymousSession()), 'signed out')
  assert.equal(
    authMethodLabel(facts({ mode: 'key', keyRejected: 'nope' })),
    'saved key rejected',
  )
  assert.equal(
    authMethodLabel(
      facts({ mode: 'key', keyRejected: 'nope', keyFromEnv: true }),
    ),
    'env key rejected',
  )
  assert.equal(authMethodLabel(facts({ mode: 'jwt' })), 'browser')
  assert.equal(
    authMethodLabel(facts({ mode: 'key', hasBrowserToken: true })),
    'browser + api key',
  )
  assert.equal(
    authMethodLabel(
      facts({ mode: 'key', hasBrowserToken: true, keyFromEnv: true }),
    ),
    'env key + browser',
  )
  assert.equal(
    authMethodLabel(facts({ mode: 'key', keyFromEnv: true })),
    'env api key',
  )
  assert.equal(authMethodLabel(facts({ mode: 'key' })), 'api key')
})

test('status bar keeps auth and the shortcut hint, and drops the key list', () => {
  const line = statusBarText({
    auth: 'browser + api key',
    escHint: true,
    banner: 'Created shop.',
    age: 'updated 2s ago',
    width: 80,
  })
  assert.match(line, /enter options/)
  assert.match(line, /shift\+tab start\/stop/)
  assert.match(line, /browser \+ api key/)
  assert.match(line, /esc again to quit/)
  assert.equal(line.includes('j  k'), false)
})

test('a power change names itself and fits the status column', () => {
  assert.equal(pendingPhrase('start', 'bbass_co'), 'Starting bbass_co...')
  assert.equal(pendingPhrase('stop', 'filmroom'), 'Stopping filmroom...')
  assert.equal(
    pendingPhrase('hibernate', 'bbass_co'),
    'Hibernating bbass_co...',
  )
  assert.equal(pendingColumn('hibernate').length <= 10, true)
  assert.equal(spinFrame(0).length, 1)
  assert.notEqual(spinFrame(0), spinFrame(120))
})

test('wake is a paid-plan action', () => {
  assert.equal(canWake(anonymousSession()), false)
  assert.equal(canWake(facts({ mode: 'key', plan: 'free' })), false)
  assert.equal(canWake(facts({ mode: 'key', plan: 'pro' })), true)
  assert.equal(canWake(facts({ mode: 'key', plan: 'Free' })), false)
  assert.equal(canWake(facts({ mode: 'jwt', hasActivePlan: true })), true)
  assert.equal(canWake(facts({ mode: 'jwt', hasActivePlan: false })), false)
  assert.equal(canWake(facts({ mode: 'key' })), false)
})

test('escape once is home, twice inside one second quits', () => {
  assert.equal(escapeChord({ now: 1000, lastAt: 0 }), 'home')
  assert.equal(escapeChord({ now: 2000, lastAt: 1000 }), 'quit')
  assert.equal(escapeChord({ now: 2001, lastAt: 1000 }), 'home')
})

test('cloud create is offered only in key mode', () => {
  assert.equal(canCreateCloud(facts({ mode: 'key', email: 'a@b.co' })), true)
  assert.equal(
    canCreateCloud(facts({ mode: 'key', keyRejected: 'nope' })),
    false,
  )
  assert.equal(canCreateCloud(facts({ mode: 'jwt', email: 'a@b.co' })), false)
  assert.equal(canCreateCloud(anonymousSession()), false)
})
