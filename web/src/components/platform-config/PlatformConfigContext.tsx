import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'

type PlatformConfigContextValue = {
  helpUrl: string
  upgradeUrl: string
  refresh: () => Promise<void>
}

const PlatformConfigContext = createContext<PlatformConfigContextValue>({ helpUrl: '', upgradeUrl: '', refresh: async () => undefined })

export function PlatformConfigProvider({ children }: { children: React.ReactNode }) {
  const [helpUrl, setHelpUrl] = useState('')
  const [upgradeUrl, setUpgradeUrl] = useState('')
  const refresh = useCallback(async () => {
    try { const value = await api.platformConfig(); setHelpUrl(value.help_url); setUpgradeUrl(value.upgrade_url) }
    catch { setHelpUrl(''); setUpgradeUrl('') }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const value = useMemo(() => ({ helpUrl, upgradeUrl, refresh }), [helpUrl, upgradeUrl, refresh])
  return <PlatformConfigContext.Provider value={value}>{children}</PlatformConfigContext.Provider>
}

export function usePlatformConfig() {
  return useContext(PlatformConfigContext)
}
