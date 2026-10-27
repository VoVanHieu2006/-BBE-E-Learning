import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TransitionDraftStore } from '../lib/api/transition-draft-store'

test('draft is owner scoped, survives durable restore and never touches legacy',()=>{
  const disk=new Map<string,string>([['bbe_term_transition_draft_C','legacy-unknown-owner']])
  const storage={getItem:(k:string)=>disk.get(k)??null,setItem:(k:string,v:string)=>{disk.set(k,v)}}
  const store=new TransitionDraftStore(storage)
  const fields={sheetUrl:'sheet',parsedResult:{items:[]},effectiveAt:'2026-12-01',termNumber:3}
  store.update('A','C',fields);assert.equal(store.read('A','C')?.termNumber,3)
  assert.equal(store.read('B','C'),null)
  assert.equal(store.flush('A','C'),null)
  const restored=new TransitionDraftStore(storage)
  assert.deepEqual(restored.read('A','C')?.parsedResult,{items:[]})
  assert.equal(disk.get('bbe_term_transition_draft_C'),'legacy-unknown-owner')
  const ownKey='bbe:term-transition:v1:B:C'
  disk.set(ownKey,disk.get('bbe:term-transition:v1:A:C')!)
  assert.equal(restored.read('B','C'),null)
})
test('quota failure is explicit and keeps memory; retry succeeds',()=>{
  let deny=true
  const store=new TransitionDraftStore({getItem:()=>null,setItem:()=>{if(deny)throw new Error('quota')}})
  store.update('A','C',{sheetUrl:'sheet',parsedResult:null,effectiveAt:'date',termNumber:1})
  assert.match(store.flush('A','C')!,/chưa được lưu/)
  assert.equal(store.read('A','C')?.sheetUrl,'sheet')
  deny=false;assert.equal(store.flush('A','C'),null)
})
