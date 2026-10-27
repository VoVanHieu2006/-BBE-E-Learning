import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TabQueryCache } from '../lib/api/tab-query-cache'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
test('session queries survive time and concurrent refreshes share ownership', async () => {
  const cache = new TabQueryCache()
  cache.setScope('A')
  let calls = 0
  const load = async () => { calls++; return { ok: true, status: 200, data: { count: calls } } }
  await cache.fetch('/members', load, { policy: 'session' })
  assert.equal((await cache.fetch('/members', load, { policy: 'session', now: Date.now() + 900000 })).data?.count, 1)
  const pending = deferred<any>()
  const a = cache.fetch('/members', () => { calls++; return pending.promise }, { policy: 'session', refresh: true })
  const b = cache.fetch('/members', () => { calls++; return pending.promise }, { policy: 'session', refresh: true })
  pending.resolve({ ok: true, status: 200, data: { count: 2 } })
  assert.deepEqual(await a, await b)
  assert.equal(calls, 2)
})
test('mutation invalidation rejects old success and old finally cannot clear a newer request', async () => {
  const cache = new TabQueryCache(); cache.setScope('A')
  const old = deferred<any>(), fresh = deferred<any>()
  const a = cache.fetch('roster', () => old.promise, { policy: 'session' })
  cache.invalidate(key => key === 'roster')
  const b = cache.fetch('roster', () => fresh.promise, { policy: 'session' })
  old.resolve({ ok: true, status: 200, data: 'old' })
  assert.equal((await a).ok, false)
  let unexpected = false
  const c = cache.fetch('roster', async () => { unexpected = true; return { ok: true, status: 200, data: 'wrong' } }, { policy: 'session' })
  fresh.resolve({ ok: true, status: 200, data: 'fresh' })
  await b; await c
  assert.equal(unexpected, false)
  assert.equal(cache.read('roster')?.data, 'fresh')
})
test('account scope change aborts requests and suppresses late results', async () => {
  const cache = new TabQueryCache(); cache.setScope('A')
  const pending = deferred<any>(); let signal!: AbortSignal
  const result = cache.fetch('members', s => { signal=s; return pending.promise }, { policy: 'session' })
  cache.setScope('B')
  assert.equal(signal.aborted, true)
  pending.resolve({ ok:true, status:200, data:'private A' })
  assert.equal((await result).ok, false)
  assert.equal(cache.read('members'), null)
})
test('failed refresh preserves data and success timestamp', async () => {
  const cache = new TabQueryCache(); cache.setScope('A')
  await cache.fetch('courses', async () => ({ ok:true,status:200,data:[] }), { policy:'session', now:100 })
  await cache.fetch('courses', async () => ({ ok:false,status:500 }), { policy:'session', refresh:true, now:200 })
  assert.equal(cache.read('courses')?.updatedAt,100)
  assert.deepEqual(cache.read('courses')?.data,[])
})
test('a disconnected network preserves the last successful query',async()=>{
  const cache=new TabQueryCache();cache.setScope('A')
  await cache.fetch('members',async()=>({ok:true,status:200,data:{count:12}}),{policy:'session',now:100})
  const result=await cache.fetch('members',async()=>{throw new Error('offline')},{policy:'session',refresh:true,now:200})
  assert.equal(result.ok,false);assert.equal(result.error?.code,'NETWORK_ERROR')
  assert.deepEqual(cache.read('members'),{data:{count:12},updatedAt:100})
})
test('LRU and payload budget are hard bounds; active queries are not evicted', async () => {
  const cache = new TabQueryCache({ maxQueries:2, maxBytes:400 })
  cache.setScope('A')
  const unsubscribe=cache.subscribe('a',()=>{})
  for(const key of ['a','b','c']) await cache.fetch(key,async()=>({ok:true,status:200,data:key}),{policy:'session'})
  assert.ok(cache.read('a')); assert.equal(cache.read('b'),null); assert.ok(cache.read('c'))
  await cache.fetch('huge',async()=>({ok:true,status:200,data:'x'.repeat(1000)}),{policy:'session'})
  assert.equal(cache.read('huge'),null)
  assert.ok(cache.stats().bytes<=400); assert.ok(cache.stats().queries<=2)
  unsubscribe()
})
