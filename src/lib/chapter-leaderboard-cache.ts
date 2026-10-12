interface LeaderboardCacheEntry {
  data: unknown
  timestamp: number
}

type CacheGlobal = typeof globalThis & {
  __bbeChapterLeaderboardCache?: LeaderboardCacheEntry | null
}

const CACHE_TTL_MS = 30_000

export function getCachedChapterLeaderboard(now = Date.now()): unknown | null {
  const cache = (globalThis as CacheGlobal).__bbeChapterLeaderboardCache
  if (!cache || now - cache.timestamp >= CACHE_TTL_MS) return null
  return cache.data
}

export function setCachedChapterLeaderboard(data: unknown, now = Date.now()): void {
  (globalThis as CacheGlobal).__bbeChapterLeaderboardCache = { data, timestamp: now }
}

export function invalidateChapterLeaderboardCache(): void {
  (globalThis as CacheGlobal).__bbeChapterLeaderboardCache = null
}
