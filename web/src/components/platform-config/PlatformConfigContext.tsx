import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'

type PlatformConfigContextValue = {
  helpUrl: string
  refresh: () => Promise<void>
}

const PlatformConfigContext = createContext<PlatformConfigContextValue>({ helpUrl: '', refresh: async () => undefined })

export function PlatformConfigProvider({ children }: { children: React.ReactNode }) {
  const [helpUrl, setHelpUrl] = useState('')
  const refresh = useCallback(async () => {
    try { setHelpUrl((await api.platformConfig()).help_url) }
    catch { setHelpUrl('') }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const value = useMemo(() => ({ helpUrl, refresh }), [helpUrl, refresh])
  return <PlatformConfigContext.Provider value={value}>{children}</PlatformConfigContext.Provider>
}

export function usePlatformConfig() {
  return useContext(PlatformConfigContext)
}
