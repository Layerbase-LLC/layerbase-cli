import {
  CloudApiError,
  DEFAULT_API_URL,
  configureCloudAuth,
  getMe,
  listDatabases,
  whoami,
} from '@/lib/cloud-api'
import { runBrowserLogin } from '@/lib/browser-login'
import { loadCredentials, saveApiKey, saveCredentials } from '@/lib/config'

export type SignInResult = {
  email: string | null
  banner: string
}

function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof CloudApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

// Same sequence as `lbase login`: browser loopback, save the JWT, then backfill
// the account API key from whoami(). The key is what cloud create uses.
export async function signInWithBrowser(options: {
  onWaiting: (authUrl: string) => void
}): Promise<SignInResult> {
  const existing = await loadCredentials()
  const apiUrl = existing?.apiUrl || DEFAULT_API_URL
  const envKey = Boolean(process.env.LAYERBASE_API_KEY)
  const { token } = await runBrowserLogin({
    apiUrl,
    onPhase: (phase) => {
      if (phase.kind === 'waiting') options.onWaiting(phase.authUrl)
    },
  })
  await saveCredentials({ apiUrl, token })
  let email: string | null = null
  let cloudApiKey: string | null = null
  try {
    const me = await whoami()
    email = me.user.email
    cloudApiKey = me.cloudApiKey
    if (cloudApiKey) {
      await saveCredentials({ apiUrl, token, apiKey: cloudApiKey })
      configureCloudAuth({ apiKey: cloudApiKey })
    }
  } catch {
    // The JWT is already saved. Listing still works when no env key overrides it.
  }
  const signedIn = email ? `Signed in as ${email}.` : 'Signed in.'
  if (cloudApiKey && envKey) {
    return {
      email,
      banner: `${signedIn} Unset LAYERBASE_API_KEY so the next terminal uses this key.`,
    }
  }
  if (!cloudApiKey && envKey) {
    return {
      email,
      banner:
        'Signed in, but LAYERBASE_API_KEY is still the key this session uses. Unset it and sign in again.',
    }
  }
  return { email, banner: signedIn }
}

export async function signInWithApiKey(apiKey: string): Promise<SignInResult> {
  const trimmed = apiKey.trim()
  if (!trimmed.startsWith('sk_')) {
    throw new Error(
      'That does not look like a Layerbase API key. It should start with sk_. Create one at https://layerbase.com/cloud/settings.',
    )
  }
  configureCloudAuth({ apiKey: trimmed })
  try {
    const me = await getMe()
    if (!me) await listDatabases()
    await saveApiKey({ apiKey: trimmed, apiUrl: DEFAULT_API_URL })
    const email = me?.user.email ?? null
    return {
      email,
      banner: email ? `Saved API key for ${email}.` : 'Saved API key.',
    }
  } catch (error) {
    configureCloudAuth({})
    throw new Error(failureMessage(error, 'The API key was rejected.'))
  }
}

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

function wrap(text: string, width: number): string[] {
  if (width <= 0) return []
  const lines: string[] = []
  for (let index = 0; index < text.length; index += width) {
    lines.push(text.slice(index, index + width))
  }
  return lines.length > 0 ? lines : ['']
}

export function signInGuide(options: {
  reason: 'signed-out' | 'rejected'
  keyFromEnv: boolean
  step: 'choose' | 'waiting' | 'saving' | 'error'
  authUrl: string | null
  error: string | null
  width: number
}): string[] {
  const width = Math.max(options.width, 1)
  if (options.step === 'saving') return [clip('Saving credentials...', width)]
  if (options.step === 'waiting') {
    const lines = [
      options.authUrl
        ? 'Waiting for you to finish in the browser.'
        : 'Opening your browser...',
    ]
    if (options.authUrl) {
      lines.push('If it did not open, visit:')
      lines.push(...wrap(options.authUrl, width))
    }
    lines.push('tab    Local databases')
    return lines.map((line) => clip(line, width))
  }
  if (options.step === 'error') {
    return [
      ...wrap(options.error ?? 'Sign-in failed.', width),
      'enter  Try the browser again',
      'k      Paste an API key',
      'esc    Back',
    ].map((line) => clip(line, width))
  }
  const lead =
    options.reason === 'signed-out'
      ? 'Not signed in.'
      : options.keyFromEnv
        ? 'The cloud rejected LAYERBASE_API_KEY.'
        : 'The saved API key was rejected.'
  const lines = [
    lead,
    'enter  Sign in with your browser',
    options.reason === 'signed-out'
      ? 'k      Paste an API key'
      : 'k      Paste a new API key',
    'tab    Local databases',
  ]
  if (options.reason === 'rejected' && options.keyFromEnv) {
    lines.push('A new terminal keeps using that env var until you unset it.')
  }
  return lines.map((line) => clip(line, width))
}

export function maskApiKey(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${'*'.repeat(Math.min(16, value.length - 4))}${value.slice(-4)}`
}
