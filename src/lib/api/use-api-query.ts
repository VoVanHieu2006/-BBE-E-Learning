'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiQueryCache, getApiSessionKey, getApiUpdatedAt, getCachedApiData, isPilotSessionVerified } from './client'

/** Opt-in hook; the client owns policy, verified scope and request generations. */
export function useApiQuery<T = any>(path: string | null) {
  const [data,setData] = useState<T | null>(()=>path ? getCachedApiData<T>(path) : null)
  const [status,setStatus] = useState<'idle'|'loading'|'success'|'error'>(data!==null?'success':path?'loading':'idle')
  const [error,setError] = useState<string | null>(null)
  const [updatedAt,setUpdatedAt] = useState<number | null>(()=>path ? getApiUpdatedAt(path) : null)
  const [refreshing,setRefreshing] = useState(false)
  const mounted=useRef(false), sequence=useRef(0)
  const load=useCallback(async(force=false)=>{
    if (!path || !isPilotSessionVerified()) return
    const ticket=++sequence.current, scope=getApiSessionKey()
    const cached=getCachedApiData<T>(path)
    if (cached !== null) { setData(cached); setStatus('success'); setUpdatedAt(getApiUpdatedAt(path)) }
    else setStatus('loading')
    if (force) setRefreshing(true)
    const result=await apiFetch<T>(path,{noCache:force})
    if (!mounted.current || ticket!==sequence.current || scope!==getApiSessionKey()) return
    setRefreshing(false)
    if(result.ok){setData(result.data ?? null);setUpdatedAt(getApiUpdatedAt(path) ?? Date.now());setStatus('success');setError(null)}
    else if(result.error?.code!=='STALE_REQUEST'){setStatus('error');setError(result.error?.message || 'Không tải được dữ liệu. Vui lòng thử lại.')}
  },[path])
  useEffect(()=>{
    mounted.current=true
    const subscriptionScope=getApiSessionKey()
    setData(path ? getCachedApiData<T>(path) : null)
    setError(null)
    if(path)void load()
    const off=path ? apiQueryCache.subscribe(path,()=>{
      if (!isPilotSessionVerified() || subscriptionScope!==getApiSessionKey()) { sequence.current++;setData(null);return }
      const cached=getCachedApiData<T>(path)
      if(cached!==null){setData(cached);setUpdatedAt(getApiUpdatedAt(path))}
      else void load()
    }) : ()=>{}
    return ()=>{mounted.current=false;sequence.current++;off()}
  },[path,load])
  return {data,status,error,updatedAt,refreshing,refresh:()=>load(true)}
}
