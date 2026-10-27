import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apiFetch, clearApiCache, setVerifiedPilotScope, revokeApiSession, invalidateApiQueries, getKnownTransferDeadline } from '../lib/api/client'

class Storage {
  private entries = new Map<string,string>()
  getItem(key:string) { return this.entries.get(key) ?? null }
  setItem(key:string,value:string) { this.entries.set(key,value) }
  removeItem(key:string) { this.entries.delete(key) }
  key(index:number) { return Array.from(this.entries.keys())[index] ?? null }
  get length() { return this.entries.size }
}
test('verified Pilot shares dashboard-courses resource, refresh deduplicates, and writes no response storage', async () => {
  const storage = new Storage(), session = new Storage()
  storage.setItem('user',JSON.stringify({id:'A',chapterId:'C'})); storage.setItem('accessToken','secret-test-token')
  Object.assign(globalThis,{window:{location:{pathname:'/chapter-manager/dashboard'},dispatchEvent:()=>{}},localStorage:storage,sessionStorage:session})
  let calls=0
  const original=globalThis.fetch
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({items:[],totalItems:calls}),{headers:{'content-type':'application/json'}})}
  try {
    clearApiCache();setVerifiedPilotScope({id:'A',role:'CHAPTER_LEADER',chapterId:'C',managedChapters:[{id:'C'}]})
    const path='/api/v1/chapters/C/dashboard/courses'
    await apiFetch(path); await apiFetch(path)
    assert.equal(calls,1)
    await Promise.all([apiFetch(path,{noCache:true}),apiFetch(path,{noCache:true})])
    assert.equal(calls,2)
    await apiFetch(path);assert.equal(calls,2)
    assert.equal(session.length,0)
    revokeApiSession()
  } finally {globalThis.fetch=original}
})
test('logout while token refresh is pending cannot restore credentials', async () => {
  const storage = new Storage(),session=new Storage()
  storage.setItem('user',JSON.stringify({id:'A'}));storage.setItem('accessToken','old');storage.setItem('refreshToken','refresh-test')
  Object.assign(globalThis,{window:{location:{pathname:'/chapter-manager/dashboard'},dispatchEvent:()=>{}},localStorage:storage,sessionStorage:session})
  let resolve!: (response:Response)=>void
  const refresh=new Promise<Response>(r=>{resolve=r})
  const original=globalThis.fetch
  let refreshStarted!:()=>void
  const started=new Promise<void>(r=>{refreshStarted=r})
  globalThis.fetch=async input=>{if(String(input).includes('/auth/refresh')){refreshStarted();return refresh}return new Response('{}',{status:401,headers:{'content-type':'application/json'}})}
  try {
    const request=apiFetch('/api/v1/chapters/C/dashboard/members')
    await started
    revokeApiSession();storage.removeItem('accessToken');storage.removeItem('user')
    resolve(new Response(JSON.stringify({accessToken:'new',user:{id:'A'}}),{headers:{'content-type':'application/json'}}))
    assert.equal((await request).ok,false)
    assert.equal(storage.getItem('accessToken'),null)
    assert.equal(storage.getItem('user'),null)
  } finally {globalThis.fetch=original}
})
test('a known scheduled history expires at its deadline without relying on a roster read',async()=>{
  const storage=new Storage(),session=new Storage()
  storage.setItem('user',JSON.stringify({id:'A',chapterId:'C'}));storage.setItem('accessToken','history-test')
  Object.assign(globalThis,{window:{location:{pathname:'/chapter-manager/term-transition'},dispatchEvent:()=>{}},localStorage:storage,sessionStorage:session})
  const original=globalThis.fetch,clock=Date.now
  let now=10000,calls=0
  Date.now=()=>now
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({items:[{id:'batch',status:calls===1?'SCHEDULED':'APPLIED',effectiveAt:new Date(11000).toISOString()}]}),{headers:{'content-type':'application/json'}})}
  try{
    setVerifiedPilotScope({id:'A',role:'CHAPTER_LEADER',chapterId:'C'})
    const url='/api/v1/chapters/C/reorganizations'
    await apiFetch(url);await apiFetch(url);assert.equal(calls,1)
    now=12000
    const result=await apiFetch(url)
    assert.equal(calls,2);assert.equal(result.data.items[0].status,'APPLIED')
  }finally{globalThis.fetch=original;Date.now=clock;revokeApiSession()}
})
test('aborting one GET subscriber does not abort another subscriber’s shared transport',async()=>{
  const storage=new Storage(),session=new Storage()
  storage.setItem('user',JSON.stringify({id:'A'}));storage.setItem('accessToken','abort-test')
  Object.assign(globalThis,{window:{location:{pathname:'/chapter-manager/courses'},dispatchEvent:()=>{}},localStorage:storage,sessionStorage:session})
  const original=globalThis.fetch
  let resolve!:(r:Response)=>void,transportSignal:AbortSignal|undefined,calls=0
  globalThis.fetch=async(_url,options)=>{calls++;transportSignal=options?.signal as AbortSignal;return new Promise<Response>(r=>{resolve=r})}
  try{
    const abort=new AbortController()
    const a=apiFetch('/api/v1/courses/shared',{signal:abort.signal})
    const b=apiFetch('/api/v1/courses/shared')
    abort.abort()
    assert.equal(transportSignal?.aborted,false)
    resolve(new Response(JSON.stringify({title:'shared'}),{headers:{'content-type':'application/json'}}))
    assert.equal((await a).ok,false);assert.equal((await b).ok,true);assert.equal(calls,1)
  }finally{globalThis.fetch=original;revokeApiSession()}
})
test('confirmed automatic application invalidates warmed dashboard aggregates',async()=>{
  const storage=new Storage(),session=new Storage()
  storage.setItem('user',JSON.stringify({id:'A',chapterId:'C'}));storage.setItem('accessToken','due-aggregate-test')
  Object.assign(globalThis,{window:{location:{pathname:'/chapter-manager/term-transition'},dispatchEvent:()=>{}},localStorage:storage,sessionStorage:session})
  const original=globalThis.fetch,clock=Date.now
  let now=10000,rosterCalls=0,memberCalls=0
  Date.now=()=>now
  globalThis.fetch=async url=>{
    let data:any
    if(String(url).endsWith('/current-roster')){rosterCalls++;data=rosterCalls===1?{currentTermNumber:1,scheduledBatch:{id:'batch',termNumber:2,status:'SCHEDULED',effectiveAt:new Date(11000).toISOString()}}:{currentTermNumber:2,scheduledBatch:null}}
    else {memberCalls++;data={summary:{totalMembers:memberCalls}}}
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})
  }
  try{
    setVerifiedPilotScope({id:'A',role:'CHAPTER_LEADER',chapterId:'C'})
    await apiFetch('/api/v1/chapters/C/dashboard/members')
    await apiFetch('/api/v1/chapters/C/current-roster')
    now=12000
    await apiFetch('/api/v1/chapters/C/current-roster')
    await apiFetch('/api/v1/chapters/C/dashboard/members')
    assert.equal(memberCalls,2)
  }finally{globalThis.fetch=original;Date.now=clock;revokeApiSession()}
})
test('invalidating a read while its body is pending suppresses deadline side effects',async()=>{
  const storage=new Storage(),session=new Storage()
  storage.setItem('user',JSON.stringify({id:'A',chapterId:'C'}));storage.setItem('accessToken','late-body-test')
  Object.assign(globalThis,{window:{location:{pathname:'/chapter-manager/term-transition'},dispatchEvent:()=>{}},localStorage:storage,sessionStorage:session})
  const original=globalThis.fetch
  let release!:(body:string)=>void,bodyStarted!:()=>void
  const started=new Promise<void>(r=>{bodyStarted=r})
  globalThis.fetch=async()=>({status:200,ok:true,text:()=>{bodyStarted();return new Promise<string>(r=>{release=r})}} as Response)
  try{
    setVerifiedPilotScope({id:'A',role:'CHAPTER_LEADER',chapterId:'C'})
    const url='/api/v1/chapters/C/current-roster'
    const request=apiFetch(url);await started
    invalidateApiQueries([url])
    release(JSON.stringify({scheduledBatch:{id:'stale',termNumber:2,status:'SCHEDULED',effectiveAt:new Date(Date.now()+100000).toISOString()}}))
    assert.equal((await request).ok,false)
    assert.equal(getKnownTransferDeadline('C'),null)
  }finally{globalThis.fetch=original;revokeApiSession()}
})
test('an explicit token from the previous account cannot start a request for the new account',async()=>{
  const storage=new Storage(),session=new Storage()
  storage.setItem('user',JSON.stringify({id:'B'}));storage.setItem('accessToken','current-B')
  Object.assign(globalThis,{window:{location:{pathname:'/student/learning/B'},dispatchEvent:()=>{}},localStorage:storage,sessionStorage:session})
  const oldToken='e30.'+Buffer.from(JSON.stringify({sub:'A'})).toString('base64url')+'.signature'
  const original=globalThis.fetch;let calls=0
  globalThis.fetch=async()=>{calls++;return new Response('{}',{headers:{'content-type':'application/json'}})}
  try {assert.equal((await apiFetch('/api/v1/lessons/A/progress',{method:'PATCH',token:oldToken})).ok,false);assert.equal(calls,0)}
  finally{globalThis.fetch=original;revokeApiSession()}
})
