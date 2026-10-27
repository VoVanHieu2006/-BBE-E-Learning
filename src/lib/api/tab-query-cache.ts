export type QueryPolicy = 'session' | 'always-validate' | 'legacy'
export interface QueryResponse<T = any> {
  ok: boolean
  status: number
  data?: T
  error?: { code: string; message: string }
}
interface Entry {
  data: any
  updatedAt: number
  bytes: number
  access: number
}
interface RequestOwner {
  controller: AbortController
  promise: Promise<QueryResponse>
}

/** Browser-memory only. A request owner is also its generation token. */
export class TabQueryCache {
  private scope = ''
  private epoch = 0
  private access = 0
  private entries = new Map<string, Entry>()
  private requests = new Map<string, RequestOwner>()
  private listeners = new Map<string, Set<() => void>>()
  private maxQueries: number
  private maxBytes: number

  constructor({ maxQueries = 128, maxBytes = 10 * 1024 * 1024 } = {}) {
    this.maxQueries = maxQueries
    this.maxBytes = maxBytes
  }
  setScope(scope: string) {
    if (scope === this.scope) return
    this.scope = scope
    this.epoch++
    this.invalidate(() => true)
  }
  getScope() { return `${this.epoch}:${this.scope}` }
  read<T = any>(key: string): { data: T; updatedAt: number } | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    entry.access = ++this.access
    return { data: entry.data, updatedAt: entry.updatedAt }
  }
  subscribe(key: string, callback: () => void) {
    const callbacks = this.listeners.get(key) || new Set<() => void>()
    callbacks.add(callback)
    this.listeners.set(key, callbacks)
    return () => {
      callbacks.delete(callback)
      if (!callbacks.size) this.listeners.delete(key)
    }
  }
  private emit(key: string) { this.listeners.get(key)?.forEach(callback => callback()) }
  invalidate(matches: (key: string) => boolean) {
    const keys = new Set([...Array.from(this.entries.keys()), ...Array.from(this.requests.keys())])
    for (const key of Array.from(keys)) {
      if (!matches(key)) continue
      this.entries.delete(key)
      const owner = this.requests.get(key)
      this.requests.delete(key)
      owner?.controller.abort()
      this.emit(key)
    }
  }
  stats() {
    return { queries: this.entries.size, bytes: Array.from(this.entries.values()).reduce((sum, e) => sum + e.bytes, 0) }
  }
  private store(key: string, data: any, updatedAt: number) {
    let bytes: number
    try { bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength + new TextEncoder().encode(key).byteLength + 128 }
    catch { return }
    this.entries.delete(key)
    if (bytes > this.maxBytes) return
    while (this.entries.size >= this.maxQueries || this.stats().bytes + bytes > this.maxBytes) {
      const oldest = Array.from(this.entries).filter(([k]) => !this.listeners.get(k)?.size).sort((a,b) => a[1].access - b[1].access)[0]
      if (!oldest) return
      this.entries.delete(oldest[0])
    }
    this.entries.set(key, { data, updatedAt, bytes, access: ++this.access })
  }
  fetch<T = any>(key: string, loader: (signal: AbortSignal) => Promise<QueryResponse<T>>, options: { policy: QueryPolicy; refresh?: boolean; now?: number } = { policy:'legacy' }): Promise<QueryResponse<T>> {
    const existing = this.requests.get(key)
    if (existing) return existing.promise
    const cached = this.entries.get(key)
    const now = options.now ?? Date.now()
    if (!options.refresh && options.policy !== 'always-validate' && cached && (options.policy === 'session' || now - cached.updatedAt < 30000)) {
      cached.access = ++this.access
      return Promise.resolve({ ok:true, status:200, data:cached.data })
    }
    const epoch = this.epoch
    const owner: RequestOwner = { controller:new AbortController(), promise:undefined! }
    this.requests.set(key, owner)
    owner.promise = (async () => {
      try {
        const response = await loader(owner.controller.signal)
        if (epoch !== this.epoch || this.requests.get(key) !== owner || owner.controller.signal.aborted) {
          return { ok:false, status:0, error:{ code:'STALE_REQUEST', message:'Phiên hoặc dữ liệu đã thay đổi.' } }
        }
        if (response.ok) {
          this.store(key, response.data, options.now ?? Date.now())
          this.emit(key)
        }
        return response
      } catch (error) {
        return { ok:false, status:0, error:{ code:owner.controller.signal.aborted ? 'STALE_REQUEST' : 'NETWORK_ERROR', message:error instanceof Error ? error.message : 'Lỗi kết nối mạng' } }
      } finally {
        if (this.requests.get(key) === owner) this.requests.delete(key)
      }
    })()
    return owner.promise
  }
}
