import { render } from 'ink'
import type { ReactElement } from 'react'

// Render an interactive Ink view and resolve when it produces a value, OR when
// the user cancels with Ctrl+C (Ink unmounts on its own). Without this, a view
// that only resolves on a submit/select would orphan its promise on Ctrl+C and
// the process would exit with the confusing "unsettled top-level await" warning.
// Returns null on cancel.
export function runView<T>(
  build: (resolve: (value: T) => void) => ReactElement,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false
    const finish = (value: T | null): void => {
      if (settled) return
      settled = true
      app.unmount()
      resolve(value)
    }
    const app = render(build((value) => finish(value)))
    // Ctrl+C (Ink's default) unmounts the app; treat that as a cancel.
    app.waitUntilExit().then(
      () => finish(null),
      () => finish(null),
    )
  })
}
