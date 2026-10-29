/**
 * High-performance Client-side API fetch helper for BBE E-Learning
 * Features in-memory caching for GET requests, instant SWR retrieval,
 * sessionStorage caching, in-flight request deduplication, and automatic token refresh.
 */

export interface ApiResponse<T = any> {
  ok: boolean
  status: number
  data?: T
  error?: {
    code: string
    message: string
  }
}

interface CacheEntry {
  data: any
  timestamp: number
}

const apiCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30000 // 30s in-memory cache

function createInFlightStore(): Map<string, Promise<ApiResponse<any>>> {
  if (typeof window === 'undefined') return new Map()
  const host = window as any
  if (!(host.__bbeApiInFlight instanceof Map)) host.__bbeApiInFlight = new Map()
  return host.__bbeApiInFlight
}

// Shared across layout/page chunk instances so a layout prefetch and a page
// request for the same URL collapse into one network call.
const inFlightRequests = createInFlightStore()

/**
 * Tab-scoped, memory-only cache.
 *
 * These pages are separate routes, so navigating away unmounts the page and
 * coming back would normally refetch everything. A tab snapshot keeps the last
 * authorized payload for the SPA session, which makes revisits instant.
 *
 * Deliberately NOT sessionStorage: tab navigation must not pay synchronous
 * serialization/quota costs, and sensitive payloads must not outlive the JS
 * context. The cache is bounded and only used for the endpoints below.
 */
const TAB_CACHE_VERSION = 'v1'
const TAB_CACHE_MAX_ENTRIES = 30
const TAB_CACHE_WINDOW_KEY = '__bbeTabApiCache'

/**
 * Next builds the layout and page as separate chunks; keeping the Map on
 * `window` guarantees every chunk instance shares one cache and one LRU bound.
 * It is still memory-only and disappears with the JS context.
 */
function createTabCacheStore(): Map<string, CacheEntry> {
  if (typeof window === 'undefined') return new Map()
  const host = window as any
  if (!(host[TAB_CACHE_WINDOW_KEY] instanceof Map)) {
    host[TAB_CACHE_WINDOW_KEY] = new Map()
  }
  return host[TAB_CACHE_WINDOW_KEY]
}

const tabApiCache = createTabCacheStore()

const TAB_CACHE_PATH_RE =
  /^\/api\/v1\/(?:chapters\/[^/?]+\/(?:dashboard\/(?:members|courses)|current-roster|reorganizations)|members\/me\/(?:courses|deadlines)|users\/me|stars\/me|streak|learning\/me|admin\/transfer-seasons\/progress|courses)$/

function isTabCachePath(path: string): boolean {
  return TAB_CACHE_PATH_RE.test(path.split('?')[0])
}

let cachedRawUser: string | null | undefined
let cachedTabIdentity = ''

/**
 * Resolve the cache identity without parsing localStorage.user on every call.
 * The id (not the access token) is used so a silent token refresh does not
 * invalidate an otherwise valid tab snapshot.
 */
function resolveTabIdentity(token?: string): string {
  if (typeof window === 'undefined') return token ? `token:${token}` : 'guest'
  const raw = localStorage.getItem('user')
  if (raw !== cachedRawUser) {
    cachedRawUser = raw
    cachedTabIdentity = ''
    if (raw) {
      try {
        const id = JSON.parse(raw)?.id
        if (id) cachedTabIdentity = `user:${id}`
      } catch {}
    }
  }
  return cachedTabIdentity || (token ? `token:${token}` : 'guest')
}

function tabCacheKey(path: string, token?: string): string {
  return `tab:${TAB_CACHE_VERSION}:${resolveTabIdentity(token)}:${path}`
}

function readTabEntry(key: string): CacheEntry | null {
  const entry = tabApiCache.get(key)
  if (!entry) return null
  // LRU touch: a tab that is being revisited must not be evicted first.
  tabApiCache.delete(key)
  tabApiCache.set(key, entry)
  return entry
}

function writeTabEntry(key: string, entry: CacheEntry) {
  tabApiCache.delete(key)
  tabApiCache.set(key, entry)
  while (tabApiCache.size > TAB_CACHE_MAX_ENTRIES) {
    const oldest = tabApiCache.keys().next().value
    if (oldest === undefined) break
    tabApiCache.delete(oldest)
  }
}

function clearTabEntries(prefix?: string) {
  for (const key of Array.from(tabApiCache.keys())) {
    if (!prefix || key.includes(prefix)) tabApiCache.delete(key)
  }
}

// Permissions and current affiliations must be revalidated after another Admin's
// changes, including when this tab still has an old sessionStorage response.
function currentOrganizationView(path: string): boolean {
  if (/^\/api\/v1\/(learning\/me|stars\/me|lessons\/[^/?]+(?:\/progress)?|courses\/[^/?]+\/my-progress)([/?]|$)/.test(path)) return true
  return /^\/api\/v1\/(auth\/me|users|chapters|organization\/(managed-units|units)|admin\/organization)([/?]|$)/.test(path)
}

let isRefreshing = false
let refreshPromise: Promise<string | null> | null = null

export function getCachedApiData<T = any>(path: string): T | null {
  if (typeof window === 'undefined') return null

  const token = localStorage.getItem('accessToken') || undefined
  // A tab snapshot is allowed to win over the normal "always revalidate"
  // policy for permission-sensitive endpoints. It only ever holds a payload
  // that the server already authorized for this user.
  if (tabApiCache.size > 0 && isTabCachePath(path)) {
    const tabEntry = readTabEntry(tabCacheKey(path, token))
    if (tabEntry) return tabEntry.data as T
  }

  if (currentOrganizationView(path)) return null

  const cacheKey = `${token || 'guest'}:${path}`
  
  const inMem = apiCache.get(cacheKey)
  if (inMem && Date.now() - inMem.timestamp < CACHE_TTL_MS) {
    return inMem.data as T
  }

  try {
    const sessionItem = sessionStorage.getItem(`api_cache:${cacheKey}`)
    if (sessionItem) {
      const parsed = JSON.parse(sessionItem)
      if (Date.now() - parsed.timestamp < 120000) { // 2 minutes session cache
        apiCache.set(cacheKey, parsed)
        return parsed.data as T
      }
    }
  } catch {}
  return null
}

export function clearApiCache(prefix?: string) {
  if (!prefix) {
    apiCache.clear()
    inFlightRequests.clear()
    tabApiCache.clear()
    if (typeof window !== 'undefined') {
      try {
        Object.keys(sessionStorage).forEach((k) => {
          if (k.startsWith('api_cache:')) sessionStorage.removeItem(k)
        })
      } catch {}
    }
    return
  }
  for (const key of Array.from(apiCache.keys())) {
    if (key.includes(prefix)) {
      apiCache.delete(key)
    }
  }
  for (const key of Array.from(inFlightRequests.keys())) {
    if (key.includes(prefix)) {
      inFlightRequests.delete(key)
    }
  }
  clearTabEntries(prefix)
  if (typeof window !== 'undefined') {
    try {
      Object.keys(sessionStorage).forEach((k) => {
        if (k.includes(prefix)) sessionStorage.removeItem(k)
      })
    } catch {}
  }
}

async function tryRefreshToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return null

  if (isRefreshing && refreshPromise) {
    return refreshPromise
  }

  isRefreshing = true
  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken || undefined }),
      })

      if (res.ok) {
        const data = await res.json()
        if (data?.accessToken) {
          localStorage.setItem('accessToken', data.accessToken)
          if (data.user) {
            localStorage.setItem('user', JSON.stringify(data.user))
          }
          return data.accessToken as string
        }
      }
    } catch {}

    return null
  })().finally(() => {
    isRefreshing = false
    refreshPromise = null
  })

  return refreshPromise
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit & { token?: string; noCache?: boolean; retryCount?: number; tabCache?: boolean } = {}
): Promise<ApiResponse<T>> {
  const method = (options.method || 'GET').toUpperCase()
  const isGet = method === 'GET'
  const retryCount = options.retryCount || 0

  let token = options.token
  if (!token && typeof window !== 'undefined') {
    token = localStorage.getItem('accessToken') || undefined
  }

  const sensitive = isGet && currentOrganizationView(path)
  const tabCacheRequested = isGet && Boolean(options.tabCache) && isTabCachePath(path)
  // Permission-sensitive endpoints keep their "always revalidate" behaviour
  // unless a tab explicitly opts into its in-memory snapshot.
  if (sensitive && !tabCacheRequested) options = { ...options, noCache: true }

  const useNormalCache = isGet && !options.noCache && !sensitive
  const cacheKey = `${token || 'guest'}:${path}`
  const tabKey = tabCacheRequested ? tabCacheKey(path, token) : ''
  const inFlightKey = tabCacheRequested && options.noCache ? `${cacheKey}:fresh` : cacheKey
  const canDedupe = isGet && (tabCacheRequested || !options.noCache)

  // 0. Tab fast path: a revisit must not reach the network at all.
  if (tabCacheRequested && !options.noCache && tabKey) {
    const tabEntry = readTabEntry(tabKey)
    if (tabEntry) {
      return {
        ok: true,
        status: 200,
        data: tabEntry.data,
      }
    }
  }

  // 1. Fast return from memory cache for GET requests
  // Check in-memory cache first
  if (useNormalCache && apiCache.has(cacheKey)) {
    const cached = apiCache.get(cacheKey)!
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      if (tabKey) writeTabEntry(tabKey, cached)
      return {
        ok: true,
        status: 200,
        data: cached.data,
      }
    }
  }

  // Fallback: check sessionStorage when in-memory cache expired/missing
  // This gives instant response even after page navigation flushes memory
  if (useNormalCache && typeof window !== 'undefined') {
    try {
      const sessionItem = sessionStorage.getItem(`api_cache:${cacheKey}`)
      if (sessionItem) {
        const parsed = JSON.parse(sessionItem)
        if (Date.now() - parsed.timestamp < 120000) {
          // Restore to in-memory cache
          apiCache.set(cacheKey, parsed)
          if (tabKey) writeTabEntry(tabKey, parsed)
          return {
            ok: true,
            status: 200,
            data: parsed.data,
          }
        }
      }
    } catch {}
  }

  // If noCache is requested, immediately invalidate stale cache for this key.
  // The tab entry is intentionally left untouched until the fresh fetch wins.
  if (options.noCache) {
    apiCache.delete(cacheKey)
    inFlightRequests.delete(inFlightKey)
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(`api_cache:${cacheKey}`)
      } catch {}
    }
  }

  // 2. In-flight request deduplication for concurrent identical GETs.
  // Fresh tab refreshes also dedupe so two components asking at the same time
  // share one network request instead of doubling it.
  if (canDedupe && inFlightRequests.has(inFlightKey)) {
    return inFlightRequests.get(inFlightKey)!
  }

  const fetchPromise = (async (): Promise<ApiResponse<T>> => {
    const headers = new Headers(options.headers || {})

    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    if (options.noCache) {
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
      headers.set('Pragma', 'no-cache')
    }

    // Add cache-busting timestamp parameter to prevent browser or intermediate caching
    const fetchUrl = options.noCache
      ? `${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}`
      : path

    try {
      const res = await fetch(fetchUrl, {
        ...options,
        cache: options.noCache ? 'no-store' : options.cache,
        headers,
      })

      // 3. Handle 401 token expiration with automatic refresh
      if (res.status === 401 && retryCount === 0 && typeof window !== 'undefined' && !path.includes('/auth/')) {
        const newToken = await tryRefreshToken()
        if (newToken) {
          return apiFetch<T>(path, { ...options, token: newToken, retryCount: retryCount + 1 })
        } else {
          // Token refresh failed -> clear stale auth info
          localStorage.removeItem('accessToken')
          localStorage.removeItem('refreshToken')
          localStorage.removeItem('user')
          
          // Only redirect if on protected pages (not on homepage or public courses)
          const currentPath = window.location.pathname
          if (
            currentPath !== '/login' &&
            currentPath !== '/' &&
            !currentPath.startsWith('/student/courses') &&
            !currentPath.startsWith('/student/learning')
          ) {
            window.location.href = '/login'
          }
        }
      }

      const contentType = res.headers.get('content-type')
      let data: any = null

      if (contentType && contentType.includes('application/json')) {
        data = await res.json()
      } else {
        const text = await res.text()
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: data?.error || {
            code: `HTTP_${res.status}`,
            message: typeof data === 'string' ? data : data?.message || 'Có lỗi xảy ra',
          },
        }
      }

      // 4. Save to memory and sessionStorage cache for GET requests.
      // Permission-sensitive paths are never written to sessionStorage; their
      // tab snapshot is memory-only.
      if (useNormalCache) {
        const entry = { data, timestamp: Date.now() }
        apiCache.set(cacheKey, entry)
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(`api_cache:${cacheKey}`, JSON.stringify(entry))
          } catch {}
        }
      }
      if (tabCacheRequested && tabKey) {
        writeTabEntry(tabKey, { data, timestamp: Date.now() })
      }

      return {
        ok: true,
        status: res.status,
        data,
      }
    } catch (err: any) {
      return {
        ok: false,
        status: 0,
        error: {
          code: 'NETWORK_ERROR',
          message: err.message || 'Lỗi kết nối mạng',
        },
      }
    } finally {
      if (canDedupe) {
        inFlightRequests.delete(inFlightKey)
      }
    }
  })()

  if (canDedupe) {
    inFlightRequests.set(inFlightKey, fetchPromise)
  }

  return fetchPromise
}
