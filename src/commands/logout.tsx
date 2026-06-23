import { useEffect, useState } from 'react'
import { Text, useApp } from 'ink'
import { clearCredentials } from '@/lib/config'

export function Logout() {
  const { exit } = useApp()
  const [done, setDone] = useState(false)

  useEffect(() => {
    async function fetchAndClearCredentials() {
      await clearCredentials()
      setDone(true)
    }
    fetchAndClearCredentials()
  }, [])

  useEffect(() => {
    if (done) {
      exit()
    }
  }, [done, exit])

  if (!done) {
    return null
  }
  return <Text color="green">Logged out. Stored API key removed.</Text>
}
