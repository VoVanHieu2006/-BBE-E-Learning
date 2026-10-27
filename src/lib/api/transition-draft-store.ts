export interface TransitionDraftFields {
  sheetUrl: string
  parsedResult: any
  effectiveAt: string
  termNumber: number | ''
}
interface Draft extends TransitionDraftFields { version:1; ownerUserId:string; chapterId:string; savedAt:number }
interface StorageLike { getItem(key:string):string|null; setItem(key:string,value:string):void }
export class TransitionDraftStore {
  private memory = new Map<string,Draft>()
  constructor(private storage: StorageLike) {}
  private key(userId:string,chapterId:string) { return `bbe:term-transition:v1:${encodeURIComponent(userId)}:${encodeURIComponent(chapterId)}` }
  read(userId:string,chapterId:string): Draft|null {
    const key=this.key(userId,chapterId)
    if(this.memory.has(key))return this.memory.get(key)!
    const raw=this.storage.getItem(key)
    if(!raw)return null
    try {
      const draft=JSON.parse(raw)
      if(draft.version!==1||draft.ownerUserId!==userId||draft.chapterId!==chapterId||typeof draft.sheetUrl!=='string'||typeof draft.effectiveAt!=='string'||!(draft.termNumber===''||Number.isInteger(draft.termNumber)&&draft.termNumber>0)||!Number.isFinite(draft.savedAt)||!(draft.parsedResult===null||typeof draft.parsedResult==='object'&&Array.isArray(draft.parsedResult.items)))return null
      this.memory.set(key,draft)
      return draft
    } catch { return null }
  }
  update(userId:string,chapterId:string,fields:TransitionDraftFields) {
    this.memory.set(this.key(userId,chapterId),{...fields,version:1,ownerUserId:userId,chapterId,savedAt:Date.now()})
  }
  flush(userId:string,chapterId:string): string|null {
    const key=this.key(userId,chapterId),draft=this.memory.get(key)
    if(!draft)return null
    try {this.storage.setItem(key,JSON.stringify(draft));return null}
    catch {return 'Bản nháp chưa được lưu trên thiết bị. Giữ trang này mở và thử lưu lại.'}
  }
  clearMemory() {
    for(const [key,draft] of Array.from(this.memory)) {
      try { this.storage.setItem(key,JSON.stringify(draft)) } catch { /* Visible owner UI reports persistence errors before revocation. */ }
    }
    this.memory.clear()
  }
}
// Storage is resolved on use so importing this module during SSR is safe.
export const transitionDraftStore=new TransitionDraftStore({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)})
