interface CachedLeaderboard { timestamp: number; allResults: unknown[] }

type CacheGlobal = typeof globalThis & { __bbeMemberLeaderboardCache?: CachedLeaderboard | null }

export function getCachedMemberLeaderboard(now = Date.now()): unknown[] | null {
  const cache = (globalThis as CacheGlobal).__bbeMemberLeaderboardCache
  return cache && now - cache.timestamp < 30_000 ? cache.allResults : null
}

export function setCachedMemberLeaderboard(allResults: unknown[], now = Date.now()): void {
  (globalThis as CacheGlobal).__bbeMemberLeaderboardCache = { timestamp: now, allResults }
}

export function invalidateMemberLeaderboardCache(): void {
  (globalThis as CacheGlobal).__bbeMemberLeaderboardCache = null
}
