/**
 * In-memory Server-side Caches for BBE E-Learning API routes
 * Kept in a dedicated library module so route.ts files only export valid HTTP handlers.
 */

interface CacheEntry<T = any> {
  data: T
  timestamp: number
}

// 1. Users Query & Global Metadata Cache
const userQueryCache = new Map<string, CacheEntry>()
let serverMetadataCache: CacheEntry<{ stats: any; publishedCourses: any[] }> | null = null

export function getUserQueryCache(key: string, ttlMs: number): any | null {
  const entry = userQueryCache.get(key)
  if (entry && Date.now() - entry.timestamp < ttlMs) {
    return entry.data
  }
  return null
}

export function setUserQueryCache(key: string, data: any) {
  userQueryCache.set(key, { data, timestamp: Date.now() })
}

export function getServerMetadataCache(ttlMs: number) {
  if (serverMetadataCache && Date.now() - serverMetadataCache.timestamp < ttlMs) {
    return serverMetadataCache.data
  }
  return null
}

export function setServerMetadataCache(data: { stats: any; publishedCourses: any[] }) {
  serverMetadataCache = { data, timestamp: Date.now() }
}

export function invalidateServerUsersCache() {
  userQueryCache.clear()
  serverMetadataCache = null
}

// 2. Admin Overview Cache
let serverOverviewCache: CacheEntry | null = null

export function getAdminOverviewCache(ttlMs: number) {
  if (serverOverviewCache && Date.now() - serverOverviewCache.timestamp < ttlMs) {
    return serverOverviewCache.data
  }
  return null
}

export function setAdminOverviewCache(data: any) {
  serverOverviewCache = { data, timestamp: Date.now() }
}

export function invalidateAdminOverviewCache() {
  serverOverviewCache = null
}

// 3. Chapters Server Cache
const chaptersServerCache = new Map<string, CacheEntry>()

export function getChaptersServerCache(key: string, ttlMs: number) {
  const entry = chaptersServerCache.get(key)
  if (entry && Date.now() - entry.timestamp < ttlMs) {
    return entry.data
  }
  return null
}

export function setChaptersServerCache(key: string, data: any) {
  chaptersServerCache.set(key, { data, timestamp: Date.now() })
}

export function invalidateChaptersServerCache() {
  chaptersServerCache.clear()
}

// 4. Courses Server Cache
const coursesServerCache = new Map<string, CacheEntry>()

export function getCoursesServerCache(key: string, ttlMs: number) {
  const entry = coursesServerCache.get(key)
  if (entry && Date.now() - entry.timestamp < ttlMs) {
    return entry.data
  }
  return null
}

export function setCoursesServerCache(key: string, data: any) {
  coursesServerCache.set(key, { data, timestamp: Date.now() })
}

export function invalidateCoursesServerCache() {
  coursesServerCache.clear()
}

// 5. Invitations Server Cache
const invitationsServerCache = new Map<string, CacheEntry>()

export function getInvitationsServerCache(key: string, ttlMs: number) {
  const entry = invitationsServerCache.get(key)
  if (entry && Date.now() - entry.timestamp < ttlMs) {
    return entry.data
  }
  return null
}

export function setInvitationsServerCache(key: string, data: any) {
  invitationsServerCache.set(key, { data, timestamp: Date.now() })
}

export function invalidateInvitationsServerCache() {
  invitationsServerCache.clear()
}
