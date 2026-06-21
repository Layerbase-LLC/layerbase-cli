import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { openBrowser } from './open-browser'

export type LoginPhase =
  | { kind: 'starting' }
  | { kind: 'waiting'; authUrl: string }

export type BrowserLoginResult = { token: string }

// Standard CLI OAuth-handoff: bind a loopback server on a random port, open the
// browser to the web /auth/cli page with that loopback as the redirect, and
// wait for the web callback to bounce back the freshly-minted token. A state
// nonce ties the request to this process so a stray request can't inject a token.
export async function runBrowserLogin(options: {
  apiUrl: string
  onPhase?: (phase: LoginPhase) => void
  timeoutMs?: number
}): Promise<BrowserLoginResult> {
  const { apiUrl, onPhase, timeoutMs = 120_000 } = options
  const state = randomBytes(16).toString('hex')

  onPhase?.({ kind: 'starting' })

  return new Promise<BrowserLoginResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>

    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (reqUrl.pathname !== '/callback') {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      const token = reqUrl.searchParams.get('token')
      const returnedState = reqUrl.searchParams.get('state')

      if (!token || returnedState !== state) {
        res.statusCode = 400
        res.setHeader('content-type', 'text/html')
        res.end(page('Sign-in failed', 'You can close this tab and try again.'))
        finish()
        reject(
          new Error(
            'Sign-in failed: invalid or missing token from the browser.',
          ),
        )
        return
      }

      res.statusCode = 200
      res.setHeader('content-type', 'text/html')
      res.end(
        page(
          'Signed in to the Layerbase CLI',
          'You can close this tab and return to your terminal.',
        ),
      )
      finish()
      resolve({ token })
    })

    function finish() {
      clearTimeout(timer)
      server.close()
    }

    server.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    // Bind to 127.0.0.1 only so no other machine on the network can reach it.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const redirect = `http://127.0.0.1:${port}/callback`
      const base = apiUrl.replace(/\/$/, '')
      const authUrl =
        `${base}/auth/cli?state=${encodeURIComponent(state)}` +
        `&redirect=${encodeURIComponent(redirect)}`

      onPhase?.({ kind: 'waiting', authUrl })
      openBrowser(authUrl).catch(() => {
        // Headless or no opener: the URL is shown in the CLI for manual use.
      })

      timer = setTimeout(() => {
        server.close()
        reject(
          new Error(
            'Sign-in timed out after 2 minutes. Run `layerbase login` again.',
          ),
        )
      }, timeoutMs)
    })
  })
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background:#0b0b0f; color:#e5e5e5;
    display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { text-align:center; padding:2.5rem 3rem; border:1px solid #ffffff1a; border-radius:14px;
    background:#ffffff08; }
  h1 { font-size:1.25rem; margin:0 0 .5rem; }
  p { color:#a3a3a3; margin:0; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body>
</html>`
}
