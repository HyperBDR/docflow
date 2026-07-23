import type { WorkspaceCapabilities } from './types'

type CacheEntry = {
  value?: WorkspaceCapabilities
  expiresAt: number
  pending?: Promise<WorkspaceCapabilities>
}

const cache = new Map<string, CacheEntry>()
const DEFAULT_TTL_MS = 30_000

export function cachedCapabilities(
  key: string,
  loader: () => Promise<WorkspaceCapabilities>,
  options: { force?: boolean; ttlMs?: number } = {},
) {
  const current = cache.get(key)
  const now = Date.now()
  if (current?.pending) return current.pending
  if (!options.force && current?.value && current.expiresAt > now) return Promise.resolve(current.value)

  const entry: CacheEntry = current || { expiresAt: 0 }
  const pending = loader()
    .then(value => {
      cache.set(key, { value, expiresAt: Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS) })
      return value
    })
    .catch(error => {
      if (entry.value) cache.set(key, { value: entry.value, expiresAt: entry.expiresAt })
      else cache.delete(key)
      throw error
    })
  cache.set(key, { ...entry, pending })
  return pending
}

export function invalidateCapabilities() {
  cache.clear()
}
