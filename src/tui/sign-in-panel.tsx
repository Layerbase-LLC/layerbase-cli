import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { ACCENT } from '@/ui/brand'
import { maskApiKey, signInGuide } from '@/tui/sign-in'
import { BAD } from '@/tui/theme'

function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return text.slice(0, 1)
  return `${text.slice(0, width - 1)}~`
}

export function SignInPanel(props: {
  width: number
  maxLines: number
  reason: 'signed-out' | 'rejected'
  keyFromEnv: boolean
  step: 'choose' | 'waiting' | 'saving' | 'error'
  authUrl: string | null
  error: string | null
  onBrowser: () => void
  onPaste: () => void
  onBack: () => void
  onEscape: () => void
  onQuit: () => void
}) {
  useInput(
    (input, key) => {
      if (
        (props.step === 'waiting' || props.step === 'saving') &&
        input === 'q'
      ) {
        return
      }
      if (input === 'q') {
        props.onQuit()
        return
      }
      if (key.escape) {
        props.onEscape()
        return
      }
      if (key.tab || key.leftArrow || key.rightArrow || input === '1') {
        props.onBack()
        return
      }
      if (props.step === 'waiting' || props.step === 'saving') return
      if (input === 'k') {
        props.onPaste()
        return
      }
      if (key.return) props.onBrowser()
    },
    { isActive: true },
  )

  const lines = signInGuide({
    reason: props.reason,
    keyFromEnv: props.keyFromEnv,
    step: props.step,
    authUrl: props.authUrl,
    error: props.error,
    width: props.width,
  }).slice(0, Math.max(1, props.maxLines))

  return (
    <Box flexDirection="column" width={props.width}>
      {lines.map((line, index) => (
        <Box key={`${index}:${line}`} width={props.width} height={1}>
          <Text
            wrap="truncate"
            color={index === 0 && props.step !== 'saving' ? BAD : undefined}
            dimColor={props.step === 'saving'}
          >
            {line || ' '}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

export function KeyForm(props: {
  width: number
  height: number
  error: string | null
  busy: boolean
  onCancel: () => void
  onSubmit: (apiKey: string) => void
}) {
  const [value, setValue] = useState('')
  useInput(
    (input, key) => {
      if (key.escape) {
        props.onCancel()
        return
      }
      if (props.busy) return
      if (key.return) {
        props.onSubmit(value)
        return
      }
      if (key.backspace || key.delete) {
        setValue((current) => current.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta && !key.tab) {
        setValue((current) =>
          `${current}${input}`.replace(/\s/g, '').slice(0, 200),
        )
      }
    },
    { isActive: true },
  )

  const lines = [
    'Paste an API key',
    `key    ${maskApiKey(value)}${props.busy ? '' : '_'}`,
    props.busy ? 'Checking the key...' : 'enter saves it, esc home',
    ...(props.error
      ? (props.error.match(
          new RegExp(`.{1,${Math.max(props.width, 1)}}`, 'g'),
        ) ?? [])
      : []),
  ]

  return (
    <Box flexDirection="column" width={props.width} height={props.height}>
      {lines.slice(0, props.height).map((line, index) => (
        <Text
          key={`${index}:${line}`}
          wrap="truncate"
          color={line === props.error ? BAD : undefined}
        >
          {line.startsWith('Paste') ? (
            <Text bold color={ACCENT}>
              {clip(line, props.width)}
            </Text>
          ) : (
            clip(line, props.width)
          )}
        </Text>
      ))}
    </Box>
  )
}
