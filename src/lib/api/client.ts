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
const inFlightRequests = new Map<string, Promise<ApiResponse<any>>>()
const CACHE_TTL_MS = 30000 // 30s in-memory cache

let isRefreshing = false
let refreshPromise: Promise<string | null> | null = null

export function getCachedApiData<T = any>(path: string): T | null {
  if (typeof window === 'undefined') return null
  const token = localStorage.getItem('accessToken') || 'guest'
  const cacheKey = `${token}:${path}`
  
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
  options: RequestInit & { token?: string; noCache?: boolean; retryCount?: number } = {}
): Promise<ApiResponse<T>> {
  const method = (options.method || 'GET').toUpperCase()
  const isGet = method === 'GET'
  const retryCount = options.retryCount || 0

  let token = options.token
  if (!token && typeof window !== 'undefined') {
    token = localStorage.getItem('accessToken') || undefined
  }

  const cacheKey = `${token || 'guest'}:${path}`

  // 1. Fast return from memory cache for GET requests
  // Check in-memory cache first
  if (isGet && !options.noCache && apiCache.has(cacheKey)) {
    const cached = apiCache.get(cacheKey)!
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return {
        ok: true,
        status: 200,
        data: cached.data,
      }
    }
  }

  // Fallback: check sessionStorage when in-memory cache expired/missing
  // This gives instant response even after page navigation flushes memory
  if (isGet && !options.noCache && typeof window !== 'undefined') {
    try {
      const sessionItem = sessionStorage.getItem(`api_cache:${cacheKey}`)
      if (sessionItem) {
        const parsed = JSON.parse(sessionItem)
        if (Date.now() - parsed.timestamp < 120000) {
          // Restore to in-memory cache
          apiCache.set(cacheKey, parsed)
          return {
            ok: true,
            status: 200,
            data: parsed.data,
          }
        }
      }
    } catch {}
  }

  // 2. In-flight request deduplication for concurrent identical GETs
  // Deduplicate in-flight requests
  if (isGet && inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!
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

    try {
      const res = await fetch(path, {
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

      // 4. Save to memory and sessionStorage cache for GET requests
      if (isGet && !options.noCache) {
        const entry = { data, timestamp: Date.now() }
        apiCache.set(cacheKey, entry)
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(`api_cache:${cacheKey}`, JSON.stringify(entry))
          } catch {}
        }
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
      if (isGet) {
        inFlightRequests.delete(cacheKey)
      }
    }
  })()

  if (isGet) {
    inFlightRequests.set(cacheKey, fetchPromise)
  }

  return fetchPromise
}
