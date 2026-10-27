import { TabQueryCache, type QueryPolicy, type QueryResponse } from './tab-query-cache'
import { transitionDraftStore } from './transition-draft-store'

export interface ApiResponse<T = any> extends QueryResponse<T> {}
export const apiQueryCache = new TabQueryCache()
let accountMarker = ''
let credential: string | null = null
let sessionGeneration = 0
let verifiedPilot: { userId: string; chapterId: string; fingerprint: string } | null = null
let pilotActive = false
let pilotUser: any = null
let preparedNavigation: {path:string;scope:string} | null = null
let refreshPromise: Promise<string | null> | null = null
let verificationPromise: Promise<ApiResponse> | null = null
const dueDates = new Map<string, number>()
const knownTransfers = new Map<string,{id:string;termNumber:number}>()
const tabSnapshots = new Map<string, any>()

// Keep the sensitive legacy boundary. Pilot exceptions are exact, verified resources.
function currentOrganizationView(path: string): boolean {
  if (/^\/api\/v1\/(learning\/me|stars\/me|lessons\/[^/?]+(?:\/progress)?|courses\/[^/?]+\/my-progress)([/?]|$)/.test(path)) return true
  return /^\/api\/v1\/(auth\/me|users|chapters|organization\/(managed-units|units)|admin\/organization)([/?]|$)/.test(path)
}
function storedIdentity(): string {
  if (typeof window === 'undefined') return ''
  try { return JSON.parse(localStorage.getItem('user') || 'null')?.id || '' } catch { return '' }
}
function cleanLegacyStorage() {
  if (typeof window === 'undefined') return
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i)
      if (key?.startsWith('api_cache:')) sessionStorage.removeItem(key)
    }
  } catch { /* API memory remains usable when storage is denied. */ }
}
function syncAccount() {
  if (typeof window === 'undefined') return
  const userId = storedIdentity()
  const token = localStorage.getItem('accessToken')
  if (userId !== accountMarker || token !== credential) {
    accountMarker = userId
    credential = token
    sessionGeneration++
    verifiedPilot = null
    pilotUser = null
    preparedNavigation = null
    verificationPromise = null
    refreshPromise = null
    tabSnapshots.clear()
    transitionDraftStore.clearMemory()
    dueDates.clear()
    knownTransfers.clear()
    apiQueryCache.setScope(`${sessionGeneration}:${userId}`)
  }
  cleanLegacyStorage()
}
export function revokeApiSession() {
  sessionGeneration++
  verifiedPilot = null
  pilotUser = null
  preparedNavigation = null
  refreshPromise = null
  verificationPromise = null
  tabSnapshots.clear()
  transitionDraftStore.clearMemory()
  dueDates.clear()
  knownTransfers.clear()
  apiQueryCache.setScope(`revoked:${sessionGeneration}`)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('bbe:session-revoked'))
}
export function setVerifiedPilotScope(user: any) {
  syncAccount()
  if (!user?.id || !user?.chapterId) return
  pilotActive = true
  pilotUser = user
  const chapters = (user.managedChapters || []).map((chapter: any) => [chapter.id, chapter.canManageMembers]).sort((a: any,b: any) => String(a[0]).localeCompare(String(b[0])))
  const fingerprint = JSON.stringify([user.id, user.role, user.managerKind, user.chapterId, user.canManageMembers, chapters, (user.managedOrganizationUnits || []).map((unit:any) => [unit.id,unit.type,unit.canManageMembers]).sort((a:any,b:any)=>String(a[0]).localeCompare(String(b[0])))])
  const hadScope = verifiedPilot !== null
  const changed = verifiedPilot?.fingerprint !== fingerprint
  verifiedPilot = { userId:user.id, chapterId:user.chapterId, fingerprint }
  if (changed) {
    tabSnapshots.clear()
    dueDates.clear()
    knownTransfers.clear()
    apiQueryCache.setScope(`${sessionGeneration}:${fingerprint}`)
    if(hadScope && typeof window !== 'undefined')window.dispatchEvent(new Event('bbe:scope-changed'))
  }
}
function isPilotResource(path: string) {
  if (!pilotActive || !verifiedPilot || verifiedPilot.userId !== accountMarker) return false
  return path === `/api/v1/chapters/${verifiedPilot.chapterId}/dashboard/members`
    || path === `/api/v1/chapters/${verifiedPilot.chapterId}/dashboard/courses`
    || path === `/api/v1/chapters/${verifiedPilot.chapterId}/current-roster`
    || path === `/api/v1/chapters/${verifiedPilot.chapterId}/reorganizations`
}
export function deactivatePilotScope() { pilotActive = false }
export function isPilotSessionVerified() { return pilotActive && verifiedPilot !== null }
export function getVerifiedPilotUser() { syncAccount(); return isPilotSessionVerified() ? pilotUser : null }
export async function preparePilotNavigation(path:string) {
  const result=await verifyPilotSession()
  if(result.ok)preparedNavigation={path,scope:getApiSessionKey()}
  return result
}
export function consumePilotNavigation(path:string) {
  const prepared=preparedNavigation
  preparedNavigation=null
  return !!prepared && prepared.path===path && prepared.scope===getApiSessionKey() && isPilotSessionVerified()
}
export function getApiSessionKey() { syncAccount(); return apiQueryCache.getScope() }
export function getTabSnapshot<T>(route: string): T | undefined {
  syncAccount()
  const value = tabSnapshots.get(route)
  if (value !== undefined) { tabSnapshots.delete(route); tabSnapshots.set(route,value) }
  return value
}
export function saveTabSnapshot(route: string, value: any) {
  syncAccount()
  if (!verifiedPilot) return
  tabSnapshots.delete(route); tabSnapshots.set(route,value)
  while (tabSnapshots.size > 32) tabSnapshots.delete(tabSnapshots.keys().next().value!)
}
export function getCachedApiData<T = any>(path: string): T | null {
  syncAccount()
  if (currentOrganizationView(path) && !isPilotResource(path)) return null
  expireKnownSchedule(path)
  const entry = apiQueryCache.read<T>(path)
  if (!entry || (!isPilotResource(path) && Date.now() - entry.updatedAt >= 30000)) return null
  return entry.data
}
export function getApiUpdatedAt(path: string): number | null { return apiQueryCache.read(path)?.updatedAt ?? null }
export function getKnownTransferDeadline(chapterId:string) { return dueDates.get(chapterId) ?? null }
export function clearApiCache(prefix?: string) {
  apiQueryCache.invalidate(key => !prefix || key.includes(prefix))
  cleanLegacyStorage()
}
export function invalidateApiQueries(paths: string[]) { apiQueryCache.invalidate(key => paths.includes(key)) }
function expireKnownSchedule(path: string) {
  const match = path.match(/^\/api\/v1\/chapters\/([^/?]+)\/(current-roster|reorganizations)$/)
  if (!match) return
  const deadline = dueDates.get(match[1])
  if (deadline !== undefined && deadline <= Date.now()) {
    dueDates.delete(match[1])
    invalidateApiQueries([`/api/v1/chapters/${match[1]}/current-roster`, `/api/v1/chapters/${match[1]}/reorganizations`])
  }
}
async function tryRefreshToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (refreshPromise) return refreshPromise
  const owner = sessionGeneration, oldToken = localStorage.getItem('accessToken'), oldUser = storedIdentity()
  const promise = (async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken')
      const res = await fetch('/api/v1/auth/refresh', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ refreshToken:refreshToken || undefined }) })
      const data = await res.json()
      if (owner !== sessionGeneration || oldToken !== localStorage.getItem('accessToken') || oldUser !== storedIdentity()) return null
      if (!res.ok || !data?.accessToken) return null
      if (oldUser && data.user?.id && oldUser !== data.user.id) return null
      localStorage.setItem('accessToken', data.accessToken)
      // /auth/me owns effective scope; refresh must not overwrite it with legacy scope.
      if (!oldUser && data.user) localStorage.setItem('user',JSON.stringify(data.user))
      credential = data.accessToken
      accountMarker = storedIdentity()
      return data.accessToken as string
    } catch { return null }
  })()
  refreshPromise = promise
  try { return await promise } finally { if (refreshPromise === promise) refreshPromise = null }
}
export async function verifyPilotSession(): Promise<ApiResponse> {
  syncAccount()
  if (verificationPromise) return verificationPromise
  const owner = sessionGeneration
  const promise = apiFetch('/api/v1/auth/me', { noCache:true })
  verificationPromise = promise
  try {
    const result = await promise
    if (owner !== sessionGeneration) return { ok:false, status:0, error:{code:'STALE_REQUEST',message:'Phiên đã thay đổi.'} }
    const user = result.data?.user
    if (result.ok && user && (user.role === 'ADMIN' || user.role === 'CHAPTER_LEADER' || user.isChapterManager)) {
      // Retain existing preferred-Chapter behavior, restricted to the verified list.
      const preferred = JSON.parse(localStorage.getItem('user') || 'null')?.chapterId
      const selected = user.managedChapters?.find((chapter:any) => chapter.id === preferred)
      if (selected) Object.assign(user,{chapterId:selected.id,chapterName:selected.name,canManageMembers:selected.canManageMembers})
      localStorage.setItem('user',JSON.stringify(user))
      accountMarker = user.id
      setVerifiedPilotScope(user)
      return result
    }
    if(result.status === 401){localStorage.removeItem('accessToken');localStorage.removeItem('refreshToken');localStorage.removeItem('user')}
    if (result.status === 401 || result.status === 403 || (result.ok && !user?.isChapterManager)) revokeApiSession()
    return result.ok ? { ok:false, status:403, error:{code:'AccessDenied',message:'Không có quyền quản lý Chapter.'} } : result
  } finally { if (verificationPromise === promise) verificationPromise = null }
}
export async function apiFetch<T = any>(path: string, options: RequestInit & { token?: string; noCache?: boolean; retryCount?: number } = {}): Promise<ApiResponse<T>> {
  syncAccount()
  if(options.token && typeof window !== 'undefined' && storedIdentity()){
    // Decode only to reject a known subject mismatch, never to grant permissions.
    // Authentication and signature verification remain server responsibilities.
    try{
      const payload=options.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')
      const subject=JSON.parse(atob(payload)).sub
      if(typeof subject==='string' && subject!==storedIdentity())return {ok:false,status:0,error:{code:'STALE_REQUEST',message:'Yêu cầu thuộc tài khoản trước.'}}
    }catch{ /* Opaque legacy credentials are still checked by the server. */ }
  }
  const method = (options.method || 'GET').toUpperCase()
  const isGet = method === 'GET'
  if (!isGet && pilotActive && verifiedPilot && !path.includes('/auth/')) {
    const verified = await verifyPilotSession()
    if (!verified.ok) return verified
  }
  const owner = sessionGeneration
  const capturedIdentity = storedIdentity()
  let token = options.token || (typeof window !== 'undefined' ? localStorage.getItem('accessToken') || undefined : undefined)
  const policy: QueryPolicy = isPilotResource(path) ? 'session' : currentOrganizationView(path) ? 'always-validate' : 'legacy'
  const noCache = options.noCache || policy === 'always-validate'
  expireKnownSchedule(path)
  const execute = async (signal?: AbortSignal, shared = false): Promise<ApiResponse<T>> => {
    const cacheScope = apiQueryCache.getScope()
    const stillOwned = () => owner === sessionGeneration && !signal?.aborted && (!shared || cacheScope === apiQueryCache.getScope())
    const stale:ApiResponse<T> = {ok:false,status:0,error:{code:'STALE_REQUEST',message:'Phiên hoặc dữ liệu đã thay đổi.'}}
    const { token:_token, noCache:_noCache, retryCount:_retry, ...requestOptions } = options
    const headers = new Headers(options.headers)
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) headers.set('Content-Type','application/json')
    const request = async () => {
      if (token) headers.set('Authorization',`Bearer ${token}`)
      if (noCache) { headers.set('Cache-Control','no-cache, no-store, must-revalidate'); headers.set('Pragma','no-cache') }
      const combined = shared ? signal : signal && options.signal ? AbortSignal.any([signal, options.signal]) : signal || options.signal
      return fetch(path, { ...requestOptions, headers, signal:combined, cache:noCache ? 'no-store' : options.cache })
    }
    try {
      let response = await request()
      if(!stillOwned())return stale
      if (response.status === 401 && !path.includes('/auth/refresh') && (options.retryCount || 0) === 0 && typeof window !== 'undefined') {
        const newToken = await tryRefreshToken()
        if (!stillOwned() || capturedIdentity !== storedIdentity() && capturedIdentity !== '') return stale
        if (newToken) { token=newToken; response=await request() }
      }
      if (!stillOwned() || (capturedIdentity && capturedIdentity !== storedIdentity())) return stale
      const text = await response.text()
      let data: any
      try { data=JSON.parse(text) } catch { data=text }
      syncAccount()
      if (!stillOwned()) return stale
      if (!response.ok) {
        if (response.status === 401 && typeof window !== 'undefined' && path !== '/api/v1/auth/me') {
          localStorage.removeItem('accessToken'); localStorage.removeItem('refreshToken'); localStorage.removeItem('user')
          revokeApiSession()
          const currentPath = window.location.pathname
          if (!pilotActive && currentPath !== '/login' && currentPath !== '/' && !currentPath.startsWith('/student/courses') && !currentPath.startsWith('/student/learning')) window.location.href = '/login'
        } else if (response.status === 403 && verifiedPilot && path !== '/api/v1/auth/me') revokeApiSession()
        return {ok:false,status:response.status,error:data?.error || {code:`HTTP_${response.status}`,message:data?.message || 'Có lỗi xảy ra'}}
      }
      const chapter = path.match(/^\/api\/v1\/chapters\/([^/?]+)\/(current-roster|reorganizations)$/)?.[1]
      if (chapter) {
        const known=knownTransfers.get(chapter)
        const applied=known && (path.endsWith('/current-roster')
          ? data?.currentTermNumber===known.termNumber && !data?.scheduledBatch
          : data?.items?.some((batch:any)=>batch.id===known.id && batch.status==='APPLIED'))
        if(applied){
          knownTransfers.delete(chapter)
          apiQueryCache.invalidate(key=>key.startsWith(`/api/v1/chapters/${chapter}/dashboard/`)
            || key==='/api/v1/learning/me' || key==='/api/v1/members/me/courses'
            || key.startsWith('/api/v1/leaderboard')
            || (key.startsWith('/api/v1/courses/') && key.includes(`chapterId=${encodeURIComponent(chapter)}`)))
          const counterpart=`/api/v1/chapters/${chapter}/${path.endsWith('/current-roster')?'reorganizations':'current-roster'}`
          invalidateApiQueries([counterpart])
        }
        const batches = path.endsWith('/current-roster') ? [data?.scheduledBatch] : data?.items || []
        const scheduled=batches.filter((batch:any)=>batch && (!batch.status || batch.status==='SCHEDULED'))
        const knownBatch=scheduled.find((batch:any)=>batch.id && Number.isInteger(batch.termNumber))
        if(knownBatch)knownTransfers.set(chapter,{id:knownBatch.id,termNumber:knownBatch.termNumber})
        const deadlines=scheduled.map((batch:any)=>Date.parse(batch.effectiveAt)).filter(Number.isFinite)
        const deadline = Math.min(...deadlines)
        if (Number.isFinite(deadline)) dueDates.set(chapter,deadline)
        else dueDates.delete(chapter)
      }
      return {ok:true,status:response.status,data}
    } catch (error) { return {ok:false,status:0,error:{code:signal?.aborted ? 'STALE_REQUEST' : 'NETWORK_ERROR',message:error instanceof Error ? error.message : 'Lỗi kết nối mạng'}} }
  }
  // An explicit credential from an old player/lesson session cannot share current-account reads.
  if(options.token && typeof window !== 'undefined' && options.token !== localStorage.getItem('accessToken'))return execute()
  if(!isGet)return execute()
  const aborted:ApiResponse<T>={ok:false,status:0,error:{code:'ABORTED',message:'Yêu cầu đã được hủy.'}}
  if(options.signal?.aborted)return aborted
  const shared=apiQueryCache.fetch<T>(path,signal=>execute(signal,true),{policy,refresh:noCache})
  if(!options.signal)return shared
  // Cancellation belongs to the subscriber. Invalidation/logout owns transport abort.
  return new Promise(resolve=>{
    const abort=()=>{options.signal?.removeEventListener('abort',abort);resolve(aborted)}
    options.signal!.addEventListener('abort',abort,{once:true})
    void shared.then(result=>{options.signal?.removeEventListener('abort',abort);resolve(result)})
  })
}
