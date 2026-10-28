const assert=require('node:assert/strict'),fs=require('node:fs')
const {chromium}=require('@playwright/test')
const fixture=JSON.parse(fs.readFileSync('scratch/star-history/browser-fixture.json','utf8'))
;(async()=>{
 const browser=await chromium.launch({headless:true})
 try{
  const context=await browser.newContext({viewport:{width:1365,height:900}})
  await context.addInitScript(({token,user})=>{
   localStorage.setItem('accessToken',token);localStorage.setItem('user',JSON.stringify(user))
   // An old, valid-age session cache must not revive the nine individual rows.
   sessionStorage.setItem(`api_cache:${token}:/api/v1/stars/me?page=1&limit=20`,JSON.stringify({timestamp:Date.now(),data:{balance:9,items:Array.from({length:9},(_,i)=>({id:`cached-${i}`,amount:1,reason:'MODULE_QUIZ_PASS',source_type:'ASSESSMENT',awarded_at:new Date().toISOString(),detail:'Cached separate Quiz reward'})),page:1,limit:20,totalItems:9,totalPages:1}}))
  },fixture)
  const page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto('http://127.0.0.1:3118/student/stars')
  await page.getByText('+9 ⭐',{exact:true}).waitFor()
  assert.equal(await page.locator('main ul > li').count(),1)
  assert.equal(await page.getByText('+1 ⭐',{exact:true}).count(),0)
  await page.reload()
  await page.getByText('+9 ⭐',{exact:true}).waitFor()
  assert.equal(await page.locator('main ul > li').count(),1)
  await page.getByText(/Đang tải kỳ học/).waitFor({state:'hidden'})
  assert.deepEqual(errors,[])
  await page.screenshot({path:'scratch/star-history/quiz-nine-stars-one-event.png',fullPage:true})
  console.log('PASS browser: one Quiz +9 row, no +1 duplicates, old session cache bypassed, F5 preserved, no page errors')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
