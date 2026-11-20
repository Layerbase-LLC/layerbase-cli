import type { ServerOption, ServerOptions } from '@/lib/cloud-api'

// The server step of the TUI's cloud create form. Shown only when the team
// has two or more options (the shared cloud plus a dedicated server); with
// one, the step is skipped and the create sends no server. A server that is
// not accepting new databases stays in the list with its reason but cannot be
// submitted. `null` index = nothing chosen yet (the team has no usable
// default), so the form asks for a pick.

export function showsServerStep(choice: ServerOptions | null): boolean {
  return Boolean(choice && choice.serverOptions.length > 1)
}

export function initialServerIndex(choice: ServerOptions): number | null {
  const index = choice.serverOptions.findIndex(
    (option) => option.server === choice.defaultServer && option.accepting,
  )
  return index === -1 ? null : index
}

export function stepServerIndex(options: {
  count: number
  index: number | null
  direction: 1 | -1
}): number | null {
  if (options.count === 0) return null
  if (options.index === null) {
    return options.direction === 1 ? 0 : options.count - 1
  }
  return (options.index + options.direction + options.count) % options.count
}

export function serverOptionLabel(option: ServerOption): string {
  const kind = option.kind === 'dedicated' ? ' (dedicated)' : ''
  const status = option.accepting
    ? ''
    : `, not accepting new databases${option.reason ? `: ${option.reason}` : ''}`
  return `${option.name}${kind}${status}`
}

// The `server` to send, or why the form cannot submit yet. `server` is
// undefined when the step is not shown.
export function serverForCreate(options: {
  choice: ServerOptions | null
  index: number | null
}): { ok: true; server: string | undefined } | { ok: false; message: string } {
  if (!options.choice || !showsServerStep(options.choice)) {
    return { ok: true, server: undefined }
  }
  const picked =
    options.index === null
      ? undefined
      : options.choice.serverOptions[options.index]
  if (!picked) return { ok: false, message: 'Pick a server.' }
  if (!picked.accepting) {
    return {
      ok: false,
      message: `${picked.name} is not accepting new databases${picked.reason ? `: ${picked.reason}` : ''}. Pick another server.`,
    }
  }
  return { ok: true, server: picked.server }
}
