export type TokenClaims = {
  email?: string
  // JWT exp claim, in SECONDS since the epoch.
  exp?: number
  sub?: string
}

// Decode (without verifying) the claims from the stored JWT. Used only for
// friendly local display: the email and the expiry. Returns null on any parse
// failure.
export function decodeTokenClaims(token: string): TokenClaims | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString()) as TokenClaims
  } catch {
    return null
  }
}
