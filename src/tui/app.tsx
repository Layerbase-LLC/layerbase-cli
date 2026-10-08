import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput, useWindowSize } from 'ink'
import { ACCENT } from '@/ui/brand'
import { getVersion } from '@/lib/version'
import {
  copyCloudConnection,
  copyLocalConnection,
  createCloudBranch,
  createCloudDatabase,
  createLocalBranch,
  createLocalDatabase,
  downloadEngine,
  openCloudPage,
  openLayerbaseDesktop,
  setCloudPower,
  setLocalPower,
} from '@/tui/actions'
import { findLayerbaseDesktop, type DesktopLaunch } from '@/tui/launch'
import { engineLabel, LOCAL_ENGINES } from '@/tui/engines'
import { FormView } from '@/tui/form'
import { loadCloud, loadLocal, loadSession } from '@/tui/load'
import { signInWithApiKey, signInWithBrowser } from '@/tui/sign-in'
import {
  ageLabel,
  childrenOf,
  connectBlockReason,
  countGroup,
  findRow,
  flattenNodes,
  frameHeight,
  groupTitle,
  keepSelection,
  moveSelection,
  rowKey,
  shortProblem,
  sidebarLines,
  sliceLines,
  statusLabel,
  type TuiNode,
  type TuiRow,
} from '@/tui/model'
import { ActionMenu } from '@/tui/action-menu'
import { DownloadPrompt } from '@/tui/download-prompt'
import { Detail } from '@/tui/detail'
import { escapeChord, SHORTCUT_GROUPS } from '@/tui/keys'
import {
  pendingColumn,
  pendingLabel,
  pendingPhrase,
  spinFrame,
  type PendingPower,
} from '@/tui/pending'
import { actionMenu, powerToggle, type RowActionId } from '@/tui/row-actions'
import { KeyForm, SignInPanel } from '@/tui/sign-in-panel'
import { Sidebar } from '@/tui/sidebar'
import {
  anonymousSession,
  authMethodLabel,
  canCreateCloud,
  canWake,
  sessionBadge,
  statusBarText,
  type SessionFacts,
} from '@/tui/session'
import { BAD, PANEL, statusColor } from '@/tui/theme'

export type TuiAction =
  | { type: 'quit' }
  | { type: 'connect-local'; name: string; selectKey: string }
  | { type: 'connect-cloud'; ref: string; selectKey: string }

type Tab = 'local' | 'cloud'

type Screen =
  | { kind: 'list' }
  | { kind: 'help' }
  | { kind: 'actions'; index: number }
  | { kind: 'key' }
  | {
      kind: 'form'
      mode: 'local' | 'cloud' | 'branch'
      engines: string[] | null
    }
  | {
      kind: 'download'
      name: string
      engine: string
      version: string
      index: number
    }

type SignInState =
  | { step: 'waiting'; authUrl: string }
  | { step: 'saving' }
  | { step: 'error'; message: string }

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

function ShortcutModal(props: {
  height: number
  width: number
  onClose: () => void
  onEscape: () => void
  onQuit: () => void
}) {
  useInput(
    (input, key) => {
      if (input === 'q') {
        props.onQuit()
        return
      }
      if (key.escape) {
        props.onEscape()
        return
      }
      if (input === '?') props.onClose()
    },
    { isActive: true },
  )
  const innerWidth = Math.max(1, props.width - 4)
  const innerHeight = Math.max(1, props.height - 2)
  const lines: {
    key: string
    kind: 'page' | 'section' | 'row' | 'hint'
    keys?: string
    text: string
  }[] = [{ key: 'title', kind: 'page', text: 'Shortcuts' }]
  for (const group of SHORTCUT_GROUPS) {
    lines.push({ key: group.title, kind: 'section', text: group.title })
    for (const row of group.rows) {
      lines.push({
        key: `${group.title}:${row.keys}`,
        kind: 'row',
        keys: row.keys.padEnd(12).slice(0, 12),
        text: row.action,
      })
    }
  }
  lines.push({ key: 'close', kind: 'hint', text: 'esc or ? closes' })
  return (
    <Box
      flexDirection="column"
      height={props.height}
      width={props.width}
      borderStyle="round"
      borderColor={PANEL}
      paddingX={1}
    >
      {lines.slice(0, innerHeight).map((line) => (
        <Box key={line.key} height={1} width={innerWidth}>
          {line.kind === 'row' ? (
            <Text wrap="truncate">
              <Text dimColor>{`  ${line.keys}  `}</Text>
              <Text>{clip(line.text, Math.max(1, innerWidth - 16))}</Text>
            </Text>
          ) : (
            <Text
              wrap="truncate"
              bold={line.kind === 'page' || line.kind === 'section'}
              color={line.kind === 'page' ? ACCENT : undefined}
              dimColor={line.kind === 'hint'}
            >
              {clip(line.text, innerWidth)}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  )
}

function TabStrip(props: {
  tab: Tab
  localMeta: string
  cloudMeta: string
  cloudAttention: boolean
  width: number
}) {
  const localOn = props.tab === 'local'
  return (
    <Box width={props.width} height={1}>
      <Text wrap="truncate">
        <Text
          bold={localOn}
          color={localOn ? ACCENT : undefined}
          dimColor={!localOn}
        >
          {localOn ? '[Local]' : 'Local'}
        </Text>
        <Text dimColor>{`  ${props.localMeta}    `}</Text>
        <Text
          bold={!localOn}
          color={!localOn ? ACCENT : props.cloudAttention ? BAD : undefined}
          dimColor={localOn && !props.cloudAttention}
        >
          {localOn ? 'Cloud' : '[Cloud]'}
        </Text>
        <Text
          color={props.cloudAttention ? BAD : undefined}
          dimColor={!props.cloudAttention}
        >
          {`  ${props.cloudMeta}`}
        </Text>
      </Text>
    </Box>
  )
}

function HeaderBar(props: {
  width: number
  version: string
  name: string
  status: string
  badge: string
}) {
  const brand = 'layerbase'
  const versionText = ` ${props.version}  `
  const fit = (status: string, badge: string): number =>
    brand.length +
    versionText.length +
    (status ? status.length + 1 : 0) +
    (badge ? badge.length + 2 : 0)
  let badge = props.badge
  let status = props.status
  if (fit(status, badge) > props.width - 8) badge = ''
  if (fit(status, badge) > props.width - 4) status = ''
  if (fit(status, badge) > props.width) {
    return (
      <Box height={1} width={props.width}>
        <Text wrap="truncate">
          {clip(`${brand} ${props.version}`, props.width)}
        </Text>
      </Box>
    )
  }
  const name = clip(props.name, props.width - fit(status, badge))
  return (
    <Box height={1} width={props.width}>
      <Text wrap="truncate">
        <Text bold color={ACCENT}>
          {brand}
        </Text>
        <Text dimColor>{versionText}</Text>
        <Text bold>{name}</Text>
        {status ? (
          <Text color={statusColor(status)}>{` ${status}`}</Text>
        ) : null}
        {badge ? <Text dimColor>{`  ${badge}`}</Text> : null}
      </Text>
    </Box>
  )
}

export function TuiApp(props: {
  initialSelection: string | null
  notice: string | null
  onAction: (action: TuiAction) => void
}) {
  const { columns, rows } = useWindowSize()
  const width = Math.max(columns, 1)
  const height = frameHeight(rows)
  const wide = width >= 100
  const [session, setSession] = useState<SessionFacts>(anonymousSession())
  const [local, setLocal] = useState<{
    nodes: TuiNode[]
    error: string | null
  }>({
    nodes: [],
    error: null,
  })
  const [cloud, setCloud] = useState<{
    nodes: TuiNode[]
    error: string | null
  }>({
    nodes: [],
    error: null,
  })
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [tab, setTab] = useState<Tab>(
    props.initialSelection?.startsWith('cloud:') ? 'cloud' : 'local',
  )
  const [selected, setSelected] = useState<string | null>(
    props.initialSelection,
  )
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const [signIn, setSignIn] = useState<SignInState | null>(null)
  const [banner, setBanner] = useState<string | null>(props.notice)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingPower | null>(null)
  const [escHint, setEscHint] = useState(false)
  const [desktop, setDesktop] = useState<DesktopLaunch | null>(null)
  const loading = useRef(false)
  const escAt = useRef(0)
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loginLock = useRef(false)
  const downloadJob = useRef(0)
  const sessionRef = useRef(session)
  const indexRef = useRef(0)
  const selectionRef = useRef<{ local: string | null; cloud: string | null }>({
    local: props.initialSelection?.startsWith('cloud:')
      ? null
      : props.initialSelection,
    cloud: props.initialSelection?.startsWith('cloud:')
      ? props.initialSelection
      : null,
  })
  sessionRef.current = session

  const flat = useMemo(
    () => flattenNodes(tab === 'local' ? local.nodes : cloud.nodes),
    [local, cloud, tab],
  )
  const foundIndex = flat.findIndex((row) => rowKey(row) === selected)
  if (foundIndex >= 0) indexRef.current = foundIndex

  const refreshDatabases = useCallback(async () => {
    if (loading.current) return null
    loading.current = true
    try {
      const [nextLocal, nextCloud] = await Promise.all([
        loadLocal(),
        loadCloud(sessionRef.current),
      ])
      setLocal(nextLocal)
      setCloud(nextCloud)
      setLoadedAt(Date.now())
      return { local: nextLocal, cloud: nextCloud }
    } finally {
      loading.current = false
    }
  }, [])

  const refreshAll = useCallback(async () => {
    const next = await loadSession()
    sessionRef.current = next
    setSession(next)
    await refreshDatabases()
  }, [refreshDatabases])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    let alive = true
    void findLayerbaseDesktop().then((found) => {
      if (alive) setDesktop(found)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (screen.kind !== 'list' || busy || signIn) return
    const timer = setInterval(() => {
      void refreshDatabases()
    }, 4000)
    return () => clearInterval(timer)
  }, [screen.kind, busy, signIn, refreshDatabases])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), pending ? 120 : 1000)
    return () => clearInterval(timer)
  }, [pending])

  useEffect(() => {
    setSelected((current) => {
      const remembered = selectionRef.current[tab]
      const preferred =
        current && flat.some((row) => rowKey(row) === current)
          ? current
          : remembered
      const next = keepSelection(flat, preferred, indexRef.current)
      selectionRef.current[tab] = next
      return next
    })
  }, [flat, tab])

  const selectedRow = findRow(flat, selected)
  const signedOut = session.mode === 'anonymous'
  const cloudLocked = signedOut || Boolean(session.keyRejected)
  const authPanel = tab === 'cloud' && (cloudLocked || signIn !== null)

  async function submitForm(value: { name: string; engine: string | null }) {
    if (screen.kind !== 'form') return
    if (!value.name) {
      setFormError('Name is required.')
      return
    }
    if (screen.engines && !value.engine) {
      setFormError('Pick an engine.')
      return
    }
    setBusy(true)
    setFormError(null)
    const result =
      screen.mode === 'local'
        ? await createLocalDatabase({
            name: value.name,
            engine: value.engine ?? 'sqlite',
          })
        : screen.mode === 'cloud'
          ? await createCloudDatabase({
              name: value.name,
              engine: value.engine ?? '',
            })
          : selectedRow?.source === 'cloud'
            ? await createCloudBranch({
                parentId: selectedRow.id,
                name: value.name,
              })
            : await createLocalBranch({
                source: selectedRow?.name ?? '',
                name: value.name,
              })
    setBusy(false)
    if (!result.ok) {
      setFormError(result.message)
      return
    }
    const createdSource =
      screen.mode === 'cloud' ||
      (screen.mode === 'branch' && selectedRow?.source === 'cloud')
        ? 'cloud'
        : 'local'
    setScreen({ kind: 'list' })
    setFormError(null)
    const snapshot = await refreshDatabases()
    const created = snapshot
      ? [
          ...flattenNodes(snapshot.local.nodes),
          ...flattenNodes(snapshot.cloud.nodes),
        ].find(
          (row) => row.source === createdSource && row.name === result.name,
        )
      : null
    if (created) setSelected(rowKey(created))
    setBanner(`Created ${result.name}.`)
    setTab(createdSource)
  }

  function showTab(next: Tab) {
    selectionRef.current[tab] = selected
    setTab(next)
    setSelected(selectionRef.current[next])
  }

  function onEscape() {
    const now = Date.now()
    if (escapeChord({ now, lastAt: escAt.current }) === 'quit') {
      if (escTimer.current) clearTimeout(escTimer.current)
      setTimeout(() => props.onAction({ type: 'quit' }), 0)
      return
    }
    escAt.current = now
    setEscHint(true)
    if (escTimer.current) clearTimeout(escTimer.current)
    escTimer.current = setTimeout(() => {
      escAt.current = 0
      setEscHint(false)
    }, 1000)
    if (screen.kind === 'list' && tab === 'local') return
    setScreen({ kind: 'list' })
    setFormError(null)
    setSignIn((current) =>
      current?.step === 'waiting' || current?.step === 'saving'
        ? current
        : null,
    )
    showTab('local')
  }

  function accessOptions(): {
    paid: boolean
    cloudKey: boolean
    desktop: boolean
  } {
    return {
      paid: canWake(session),
      cloudKey: canCreateCloud(session),
      desktop: desktop !== null,
    }
  }

  function openActions() {
    if (!selectedRow) {
      setBanner('Select a database.')
      return
    }
    setScreen({ kind: 'actions', index: 0 })
  }

  function connectSelected() {
    if (!selectedRow) return
    const blocked = connectBlockReason(selectedRow)
    if (blocked) {
      setBanner(blocked)
      return
    }
    const selectKey = rowKey(selectedRow)
    if (selectedRow.source === 'cloud') {
      setTimeout(
        () =>
          props.onAction({
            type: 'connect-cloud',
            ref: selectedRow.id,
            selectKey,
          }),
        0,
      )
      return
    }
    setTimeout(
      () =>
        props.onAction({
          type: 'connect-local',
          name: selectedRow.name,
          selectKey,
        }),
      0,
    )
  }

  function openBranch() {
    if (!selectedRow) return
    if (selectedRow.parentName) {
      setBanner('Select the parent to branch it.')
      return
    }
    if (selectedRow.linked) {
      setBanner('Linked databases cannot be branched here.')
      return
    }
    if (selectedRow.source === 'cloud' && !canCreateCloud(session)) {
      setBanner('Cloud branch needs an API key.')
      return
    }
    setFormError(null)
    setScreen({ kind: 'form', mode: 'branch', engines: null })
  }

  function localPorts(): number[] {
    return flattenNodes(local.nodes)
      .map((item) => Number(item.detail))
      .filter((port) => Number.isInteger(port) && port > 0)
  }

  function localPort(row: TuiRow): number | null {
    const port = Number(row.detail)
    if (!Number.isInteger(port) || port <= 0) return null
    return port
  }

  function portHolder(row: TuiRow): string | null {
    const port = localPort(row)
    if (!port) return null
    const holder = flattenNodes(local.nodes).find(
      (item) =>
        item.name !== row.name &&
        item.status === 'running' &&
        Number(item.detail) === port,
    )
    return holder?.name ?? null
  }

  async function runPower(
    id: 'start' | 'stop' | 'wake' | 'hibernate',
    options?: { offerDownload?: boolean },
  ) {
    if (!selectedRow) return
    const row = selectedRow
    if (row.source === 'local' && id !== 'start' && id !== 'stop') {
      setBanner('Wake and hibernate are cloud actions.')
      return
    }
    setPending({ key: rowKey(row), verb: id })
    setBanner(pendingPhrase(id, row.name))
    setBusy(true)
    try {
      const result =
        row.source === 'local'
          ? await setLocalPower({
              name: row.name,
              verb: id === 'stop' ? 'stop' : 'start',
              engine: row.engine,
              port: localPort(row),
              reservedPorts: localPorts(),
              holder: portHolder(row),
            })
          : await setCloudPower({ id: row.id, name: row.name, verb: id })
      setScreen({ kind: 'list' })
      if (!result.ok) {
        if (
          result.needsBinary &&
          options?.offerDownload !== false &&
          row.version
        ) {
          setFormError(null)
          setScreen({
            kind: 'download',
            name: row.name,
            engine: row.engine,
            version: row.version,
            index: 0,
          })
          setBanner(null)
          return
        }
        setBanner(result.message)
        return
      }
      setBanner(result.message ?? `${id} ${result.name}`)
      await refreshDatabases()
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  async function acceptDownload() {
    if (screen.kind !== 'download' || busy) return
    const request = screen
    const token = downloadJob.current + 1
    downloadJob.current = token
    const label = engineLabel(request.engine)
    setBusy(true)
    setFormError(null)
    setBanner(`Downloading ${label} ${request.version}...`)
    const downloaded = await downloadEngine({
      engine: request.engine,
      version: request.version,
    })
    if (downloadJob.current !== token) return
    if (!downloaded.ok) {
      setBusy(false)
      setFormError(downloaded.message)
      setBanner(downloaded.message)
      return
    }
    setScreen({ kind: 'list' })
    setBusy(false)
    await runPower('start', { offerDownload: false })
  }

  function leaveDownload() {
    downloadJob.current += 1
    const waiting = busy
    setBusy(false)
    setBanner(
      waiting ? 'Stopped waiting. The download may still finish.' : null,
    )
    onEscape()
  }

  async function finishQuiet(result: { ok: boolean; message?: string }) {
    setBusy(false)
    setScreen({ kind: 'list' })
    if (result.message) setBanner(result.message)
  }

  async function copySelected() {
    if (!selectedRow) return
    const row = selectedRow
    setBusy(true)
    const result =
      row.source === 'local'
        ? await copyLocalConnection(row.name)
        : await copyCloudConnection({ id: row.id, name: row.name })
    await finishQuiet(result)
  }

  async function openSelectedPage(page: 'dashboard' | 'query') {
    if (!selectedRow) return
    const row = selectedRow
    setBusy(true)
    const result = await openCloudPage({ id: row.id, name: row.name, page })
    await finishQuiet(result)
  }

  async function openSelectedDesktop() {
    if (!desktop) {
      setBanner('Layerbase Desktop is not installed.')
      setScreen({ kind: 'list' })
      return
    }
    setBusy(true)
    const result = await openLayerbaseDesktop(desktop)
    await finishQuiet(result)
  }

  function runRowAction(id: RowActionId) {
    if (id === 'connect') {
      connectSelected()
      return
    }
    if (id === 'branch') {
      openBranch()
      return
    }
    if (id === 'copy') {
      void copySelected()
      return
    }
    if (id === 'web') {
      void openSelectedPage('dashboard')
      return
    }
    if (id === 'query') {
      void openSelectedPage('query')
      return
    }
    if (id === 'desktop') {
      void openSelectedDesktop()
      return
    }
    void runPower(id)
  }

  function togglePower() {
    if (!selectedRow) {
      setBanner('Select a database.')
      return
    }
    const next = powerToggle(selectedRow, accessOptions())
    if ('message' in next) {
      setBanner(next.message)
      return
    }
    void runPower(next.id)
  }

  function startBrowserSignIn() {
    if (loginLock.current) return
    loginLock.current = true
    setSignIn({ step: 'waiting', authUrl: '' })
    void signInWithBrowser({
      onWaiting: (authUrl) => setSignIn({ step: 'waiting', authUrl }),
    })
      .then(async (result) => {
        setSignIn({ step: 'saving' })
        await refreshAll()
        setSignIn(null)
        setBanner(result.banner)
        setTab('cloud')
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Sign-in failed.'
        setSignIn({ step: 'error', message })
      })
      .finally(() => {
        loginLock.current = false
      })
  }

  function submitApiKey(apiKey: string) {
    if (!apiKey.trim()) {
      setFormError('Paste the key, then press enter.')
      return
    }
    setBusy(true)
    setFormError(null)
    void signInWithApiKey(apiKey)
      .then(async (result) => {
        setScreen({ kind: 'list' })
        await refreshAll()
        setBanner(result.banner)
        setTab('cloud')
      })
      .catch((error: unknown) => {
        setFormError(
          error instanceof Error ? error.message : 'The API key was rejected.',
        )
      })
      .finally(() => {
        setBusy(false)
      })
  }

  useInput(
    (input, key) => {
      if (screen.kind !== 'list') return
      if (key.escape) {
        onEscape()
        return
      }
      if (busy) return
      if (input === 'q') {
        // Unmounting Ink from inside its own key dispatch deadlocks the
        // reconciler, so the handoff waits until this turn finishes.
        setTimeout(() => props.onAction({ type: 'quit' }), 0)
        return
      }
      if (input === '?') {
        setScreen({ kind: 'help' })
        return
      }
      if (input === 'r') {
        void refreshAll()
        return
      }
      if (key.tab && key.shift) {
        togglePower()
        return
      }
      if (key.tab || key.leftArrow || key.rightArrow) {
        showTab(tab === 'local' ? 'cloud' : 'local')
        return
      }
      if (input === '1') {
        showTab('local')
        return
      }
      if (input === '2') {
        showTab('cloud')
        return
      }
      if (key.downArrow || input === 'j') {
        setSelected((current) => moveSelection(flat, current, 1))
        return
      }
      if (key.upArrow || input === 'k') {
        setSelected((current) => moveSelection(flat, current, -1))
        return
      }
      if (input === 'g' && !key.shift) {
        const first = flat[0]
        if (first) setSelected(rowKey(first))
        return
      }
      if (input === 'G' || (input === 'g' && key.shift)) {
        const last = flat.at(-1)
        if (last) setSelected(rowKey(last))
        return
      }
      if (input === 'n') {
        setFormError(null)
        setScreen({ kind: 'form', mode: 'local', engines: [...LOCAL_ENGINES] })
        return
      }
      if (input === 'b') {
        openBranch()
        return
      }
      if (input === ' ' || key.return) {
        openActions()
      }
    },
    { isActive: screen.kind === 'list' && !authPanel },
  )

  const sidebarWidth = wide
    ? Math.min(104, Math.max(64, Math.floor(width * 0.64)))
    : width
  const sidebarInner = wide ? sidebarWidth - 4 : sidebarWidth
  const detailWidth = wide ? Math.max(1, width - sidebarWidth - 1) : width
  const detailInner = wide ? Math.max(1, detailWidth - 4) : detailWidth
  const boxWidth = authPanel ? width : sidebarWidth
  const boxInner = authPanel
    ? wide
      ? Math.max(1, width - 4)
      : width
    : sidebarInner
  const activeNodes = tab === 'local' ? local.nodes : cloud.nodes
  const lines = sidebarLines({
    nodes: activeNodes,
    empty:
      tab === 'local'
        ? 'No local databases. n to create one.'
        : 'No cloud databases yet.',
    error:
      tab === 'local'
        ? shortProblem(local.error)
        : cloudLocked
          ? null
          : shortProblem(cloud.error),
    width: boxInner,
  })
  const maxBody = Math.max(1, height - 2)
  const detailBudget = wide
    ? Math.max(1, maxBody - 2)
    : Math.min(8, Math.max(1, Math.floor(maxBody / 2)))
  const listBudget = wide
    ? Math.max(1, maxBody - 4)
    : Math.max(1, maxBody - detailBudget - 3)
  const visibleLines = sliceLines(lines, selected, listBudget)
  const localMeta = groupTitle('Local', countGroup(local.nodes)).replace(
    /^Local\s*/,
    '',
  )
  const cloudMeta = cloudLocked
    ? 'sign in'
    : groupTitle('Cloud', countGroup(cloud.nodes)).replace(/^Cloud\s*/, '')
  const childNodes = selectedRow?.parentName
    ? []
    : childrenOf(
        selectedRow?.source === 'cloud' ? cloud.nodes : local.nodes,
        selected,
      )

  const index = flat.findIndex((row) => rowKey(row) === selected)
  const badge = sessionBadge(session)
  const headerName = authPanel ? 'cloud' : (selectedRow?.name ?? 'databases')
  const onPendingRow =
    pending !== null &&
    selectedRow !== null &&
    rowKey(selectedRow) === pending.key
  const pendingView = pending
    ? {
        key: pending.key,
        status: pendingLabel(pending.verb),
        column: pendingColumn(pending.verb),
        mark: spinFrame(now),
      }
    : null
  const headerStatus =
    authPanel || !selectedRow
      ? ''
      : onPendingRow && pendingView
        ? pendingView.status
        : statusLabel(selectedRow)
  const neighbor =
    !authPanel && selectedRow ? `${index + 1}/${flat.length}` : null
  const footer = statusBarText({
    auth: authMethodLabel(session),
    escHint,
    banner,
    age: ageLabel(loadedAt, now),
    width,
  })

  let main = (
    <Box
      flexDirection={wide ? 'row' : 'column'}
      alignItems="flex-start"
      width={width}
      height={maxBody}
    >
      <Box
        width={boxWidth}
        height={wide ? maxBody : undefined}
        flexDirection="column"
        borderStyle={wide ? 'round' : undefined}
        borderColor={wide ? PANEL : undefined}
        paddingX={wide ? 1 : 0}
      >
        <TabStrip
          tab={tab}
          localMeta={localMeta}
          cloudMeta={cloudMeta}
          cloudAttention={cloudLocked}
          width={boxInner}
        />
        {authPanel ? (
          <SignInPanel
            width={boxInner}
            maxLines={listBudget}
            reason={signedOut ? 'signed-out' : 'rejected'}
            keyFromEnv={session.keyFromEnv}
            step={signIn?.step ?? 'choose'}
            authUrl={signIn?.step === 'waiting' ? signIn.authUrl : null}
            error={signIn?.step === 'error' ? signIn.message : null}
            onBrowser={startBrowserSignIn}
            onPaste={() => {
              setFormError(null)
              setScreen({ kind: 'key' })
            }}
            onBack={() => {
              if (signIn?.step === 'error') setSignIn(null)
              showTab('local')
            }}
            onEscape={onEscape}
            onQuit={() => {
              setTimeout(() => props.onAction({ type: 'quit' }), 0)
            }}
          />
        ) : (
          <Sidebar
            lines={visibleLines}
            selectedKey={selected}
            width={boxInner}
            pending={
              pendingView
                ? {
                    key: pendingView.key,
                    status: pendingView.column,
                    mark: pendingView.mark,
                  }
                : null
            }
          />
        )}
      </Box>
      {wide && !authPanel ? <Text> </Text> : null}
      {authPanel ? null : (
        <Box
          width={detailWidth}
          height={wide ? maxBody : undefined}
          flexDirection="column"
          borderStyle={wide ? 'round' : undefined}
          borderColor={wide ? PANEL : undefined}
          paddingX={wide ? 1 : 0}
        >
          <Detail
            row={selectedRow}
            children={childNodes}
            width={detailInner}
            maxLines={detailBudget}
            pending={
              onPendingRow && pendingView
                ? { status: pendingView.status, mark: pendingView.mark }
                : null
            }
          />
        </Box>
      )}
    </Box>
  )
  if (screen.kind === 'actions' && selectedRow) {
    const menu = actionMenu(selectedRow, accessOptions())
    const index = Math.min(screen.index, Math.max(menu.actions.length - 1, 0))
    const menuLines =
      2 + menu.actions.length + (menu.note ? 1 : 0) + (busy ? 1 : 0)
    main = (
      <Box width={width} height={maxBody} flexDirection="column">
        <ActionMenu
          title={selectedRow.name}
          actions={menu.actions}
          note={menu.note}
          index={index}
          width={width}
          height={Math.min(maxBody, menuLines + 2)}
          busy={busy}
          busyLabel={
            pending ? pendingPhrase(pending.verb, selectedRow.name) : null
          }
          onMove={(next) => setScreen({ kind: 'actions', index: next })}
          onRun={() => {
            const action = menu.actions[index]
            if (action) runRowAction(action.id)
          }}
          onEscape={onEscape}
          onQuit={() => {
            setTimeout(() => props.onAction({ type: 'quit' }), 0)
          }}
        />
      </Box>
    )
  } else if (screen.kind === 'help') {
    main = (
      <ShortcutModal
        height={maxBody}
        width={width}
        onClose={() => setScreen({ kind: 'list' })}
        onEscape={onEscape}
        onQuit={() => {
          setTimeout(() => props.onAction({ type: 'quit' }), 0)
        }}
      />
    )
  } else if (screen.kind === 'download') {
    main = (
      <Box width={width} height={maxBody} flexDirection="column">
        <DownloadPrompt
          engine={screen.engine}
          version={screen.version}
          name={screen.name}
          index={screen.index}
          width={width}
          busy={busy}
          busyLabel={banner}
          error={formError}
          onMove={(index) => setScreen({ ...screen, index })}
          onAccept={() => {
            void acceptDownload()
          }}
          onDecline={leaveDownload}
          onEscape={leaveDownload}
          onQuit={() => {
            setTimeout(() => props.onAction({ type: 'quit' }), 0)
          }}
        />
      </Box>
    )
  } else if (screen.kind === 'key') {
    main = (
      <KeyForm
        width={width}
        height={Math.min(8, maxBody)}
        error={formError}
        busy={busy}
        onCancel={onEscape}
        onSubmit={submitApiKey}
      />
    )
  } else if (screen.kind === 'form') {
    const title =
      screen.mode === 'local'
        ? 'New local database'
        : screen.mode === 'cloud'
          ? 'New cloud database'
          : `Branch ${selectedRow?.name ?? ''}`
    main = (
      <FormView
        title={title}
        engines={screen.engines}
        error={formError}
        busy={busy}
        height={Math.min(6, maxBody)}
        width={width}
        onCancel={onEscape}
        onSubmit={(value) => {
          void submitForm(value)
        }}
      />
    )
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <HeaderBar
        width={width}
        version={getVersion()}
        name={headerName}
        status={headerStatus}
        badge={[badge, neighbor].filter(Boolean).join('  ')}
      />
      {main}
      <Box height={1} width={width}>
        <Text dimColor>{footer || ' '}</Text>
      </Box>
    </Box>
  )
}
