interface LeaderboardCacheEntry {
  data: unknown
  timestamp: number
}

type CacheGlobal = typeof globalThis & {
  __bbeChapterLeaderboardCache?: Map<string, LeaderboardCacheEntry>
}

const CACHE_TTL_MS = 30_000

export function getCachedChapterLeaderboard(key = 'latest', now = Date.now()): unknown | null {
  const cache = (globalThis as CacheGlobal).__bbeChapterLeaderboardCache?.get(key)
  if (!cache || now - cache.timestamp >= CACHE_TTL_MS) return null
  return cache.data
}

export function setCachedChapterLeaderboard(data: unknown, key = 'latest', now = Date.now()): void {
  const global = globalThis as CacheGlobal
  global.__bbeChapterLeaderboardCache ||= new Map()
  global.__bbeChapterLeaderboardCache.set(key, { data, timestamp: now })
}

export function invalidateChapterLeaderboardCache(): void {
  (globalThis as CacheGlobal).__bbeChapterLeaderboardCache = new Map()
}
