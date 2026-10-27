// Mocked API acceptance on the real Next UI. Never sends requests to application API routes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('@playwright/test');
const out=__dirname;
const base='http://127.0.0.1:3122';
const secret='bbe-ui-cache-test-only-not-a-production-secret';
(async()=>{
  const {SignJWT}=await import('jose');
  const token=await new SignJWT({role:'CHAPTER_LEADER',chapterId:'C'}).setProtectedHeader({alg:'HS256'}).setSubject('A').setExpirationTime('2h').sign(new TextEncoder().encode(secret));
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addCookies([{name:'accessToken',value:token,url:base},{name:'userRole',value:'CHAPTER_LEADER',url:base}]);
  let account='A', deny=false, failMembers=false, failCourses=false, businessVersion=1, currentTerm=1;
  const user=()=>({id:account,email:`${account}@example.invalid`,role:'CHAPTER_LEADER',chapterId:'C',chapterName:`Chapter ${account}`,canManageMembers:true,isChapterManager:true,managedChapters:[{id:'C',name:`Chapter ${account}`,canManageMembers:true}]});
  await context.addInitScript(({token})=>{if(!localStorage.getItem('accessToken')){localStorage.setItem('accessToken',token);localStorage.setItem('user',JSON.stringify({id:'A',role:'CHAPTER_LEADER',chapterId:'C'}));}},{token});
  const records=[],errors=[],cases=[],navigationMs=[],layoutChecks=[];
  await context.addInitScript(()=>{
    window.__bbePerf={cls:0,longTasks:0,longTaskMs:0};
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)window.__bbePerf.cls+=entry.value;}).observe({type:'layout-shift',buffered:true});}catch{}
    try{new PerformanceObserver(list=>{for(const entry of list.getEntries()){window.__bbePerf.longTasks++;window.__bbePerf.longTaskMs+=entry.duration;}}).observe({type:'longtask',buffered:true});}catch{}
  });
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  let active=0;
  await context.route('**/api/v1/**',async route=>{
    active++;
    const request=route.request(),url=new URL(request.url()),endpoint=url.pathname+url.search;
    const kind=url.pathname.includes('/auth/')?'auth':request.method()==='GET'?'business':'mutation';
    records.push({kind,method:request.method(),endpoint});
    let status=200,data={};
    if(url.pathname.endsWith('/auth/me')) {status=deny?403:200;data=deny?{error:{code:'AccessDenied',message:'Revoked'}}:{user:user()};}
    else if(url.pathname.endsWith('/auth/logout'))data={success:true};
    else if(url.pathname.endsWith('/dashboard/members')){status=failMembers?500:200;data={summary:{totalMembers:12,avgChapterProgress:65,totalStars:240+businessVersion,membersOver70:6},items:[],totalItems:12};}
    else if(url.pathname.endsWith('/dashboard/courses')){status=failCourses?500:200;data={items:[{id:'course-1',title:`Khóa học ${account}`,completionRate:50,completedCount:6,totalMembers:12}],totalItems:1};}
    else if(url.pathname.endsWith('/current-roster'))data={roster:[],unassignedMembers:[],departments:[],scheduledBatch:null,currentTermNumber:currentTerm};
    else if(url.pathname.endsWith('/reorganizations'))data={items:[]};
    else if(url.pathname.endsWith('/parse-sheet'))data={items:[],summary:{matchedInChapter:0,unmatchedSheetCount:0,unmatchedCurrentCount:0},unmatchedSheet:[],unmatchedCurrent:[]};
    else {status=501;data={error:{code:'UnmockedEndpoint',message:endpoint}};}
    try{await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});}catch(error){if(!String(error).includes('closed'))throw error;}finally{active--;}
  });
  async function stable(text){
    await page.getByText(text,{exact:false}).first().waitFor({timeout:90000});
    await page.waitForFunction(()=>!document.querySelector('main')?.textContent?.includes('Đang xác minh phiên'));
    for(let i=0;i<100;i++){if(active===0){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));if(active===0)return;}await new Promise(r=>setTimeout(r,50));}
    throw Error('Mocked requests never settled');
  }
  async function nav(route,text){const start=performance.now();await page.locator(`aside a[href="/chapter-manager/${route}"]`).click();await page.waitForURL(base+'/chapter-manager/'+route);await stable(text);navigationMs.push({route,ms:Math.round(performance.now()-start)});}
  const businessSince=index=>records.slice(index).filter(r=>r.kind==='business');
  try{
    await page.goto(base+'/chapter-manager/dashboard');await stable('Đồng bộ thành công cả hai nguồn');
    let mark=records.length;
    for(let i=0;i<10;i++){await nav('courses','Đồng bộ khóa học');await nav('dashboard','Đồng bộ thành công cả hai nguồn');}
    assert.equal(businessSince(mark).length,0);
    cases.push({id:'C01',status:'PASS',rounds:10,businessGET:0,auth:records.slice(mark).filter(r=>r.kind==='auth').length});
    await nav('term-transition','Đồng bộ sơ đồ');
    await page.getByRole('button',{name:/Lịch sử nhiệm kỳ/}).click();await stable('Đồng bộ lịch sử');
    mark=records.length;
    for(let i=0;i<10;i++){
      await page.getByRole('button',{name:/Nhiệm kỳ hiện tại/}).click();await stable('Đồng bộ sơ đồ');
      await page.getByRole('button',{name:/Lịch sử nhiệm kỳ/}).click();await stable('Đồng bộ lịch sử');
    }
    assert.equal(businessSince(mark).length,0);cases.push({id:'C02',status:'PASS',rounds:10,businessGET:0});
    mark=records.length;await page.getByRole('button',{name:'Làm mới',exact:true}).click();await stable('Đồng bộ lịch sử');
    assert.deepEqual(businessSince(mark).map(r=>r.endpoint),['/api/v1/chapters/C/reorganizations']);
    await nav('dashboard','Đồng bộ thành công cả hai nguồn');mark=records.length;
    await page.getByRole('button',{name:/Làm mới$/}).click();await stable('Đồng bộ thành công cả hai nguồn');
    assert.deepEqual(businessSince(mark).map(r=>r.endpoint).sort(),['/api/v1/chapters/C/dashboard/courses','/api/v1/chapters/C/dashboard/members']);
    cases.push({id:'C03',status:'PASS',dashboardGET:2,historyGET:1});
    mark=records.length;await page.locator('aside a[href="/chapter-manager/members"]').hover();
    await new Promise(r=>setTimeout(r,3500));assert.equal(businessSince(mark).length,0);
    assert.equal(records.slice(mark).filter(r=>r.kind==='auth').length,0);
    cases.push({id:'C04',status:'PASS',idleMs:3500,businessGET:0});
    failCourses=true;await page.getByRole('button',{name:/Làm mới$/}).click();await stable('Chưa cập nhật được');
    assert.ok(await page.getByText('12',{exact:true}).count());
    failCourses=false;cases.push({id:'C05',status:'PASS',scenario:'partial failure keeps loaded member data'});
    await nav('term-transition','Đồng bộ lịch sử');
    await page.getByRole('button',{name:/Nhiệm kỳ hiện tại/}).click();await stable('Đồng bộ sơ đồ');
    await page.locator('input[type="url"]').fill('https://docs.google.com/spreadsheets/d/owner-A');
    await page.locator('input[type="datetime-local"]').fill('2026-12-01T10:30');
    await page.locator('#transition-term-number').selectOption('3');
    await nav('courses','Đồng bộ khóa học');await nav('term-transition','Đồng bộ sơ đồ');
    assert.equal(await page.locator('input[type="url"]').inputValue(),'https://docs.google.com/spreadsheets/d/owner-A');
    assert.equal(await page.locator('input[type="datetime-local"]').inputValue(),'2026-12-01T10:30');
    assert.equal(await page.locator('#transition-term-number').inputValue(),'3');
    currentTerm=3;
    await page.getByRole('button',{name:'Làm mới',exact:true}).click();await stable('Đồng bộ sơ đồ');
    assert.equal(await page.locator('input[type="url"]').inputValue(),'https://docs.google.com/spreadsheets/d/owner-A');
    assert.equal(await page.locator('#transition-term-number').inputValue(),'3','A server term change must not overwrite the chosen draft term');
    await page.reload();await stable('Đồng bộ sơ đồ');
    assert.equal(await page.locator('input[type="url"]').inputValue(),'https://docs.google.com/spreadsheets/d/owner-A');
    cases.push({id:'C06',status:'PASS',scenario:'owner draft survives navigation, refresh and F5'});
    await page.evaluate(()=>{
      window.__bbeSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key.startsWith('bbe:term-transition:'))throw new DOMException('Quota exceeded','QuotaExceededError');return window.__bbeSetItem.call(this,key,value);};
    });
    await page.locator('input[type="url"]').fill('https://docs.google.com/spreadsheets/d/unsaved-A');
    await page.getByRole('alert').filter({hasText:'Bản nháp chưa được lưu'}).waitFor();
    await page.evaluate(()=>{Storage.prototype.setItem=window.__bbeSetItem;});
    await page.getByRole('button',{name:'Thử lưu lại'}).click();
    await page.getByRole('alert').filter({hasText:'Bản nháp chưa được lưu'}).waitFor({state:'hidden'});
    await page.locator('input[type="url"]').fill('https://docs.google.com/spreadsheets/d/owner-A');
    cases.push({id:'C06-storage',status:'PASS',scenario:'quota failure visible; draft retained; retry succeeds'});
    for(const [width,height] of [[360,844],[390,844],[430,932],[768,1024],[1024,768],[1440,900],[844,390]]){
      await page.setViewportSize({width,height});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Runtime root overflow ${width}`);
      layoutChecks.push({width,height,rootOverflow:'PASS'});
      if([390,1440].includes(width))await page.screenshot({path:path.join(out,`runtime-transition-${width}.png`),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:900});
    const legacy='legacy-unknown-owner';
    await page.evaluate(value=>localStorage.setItem('bbe_term_transition_draft_C',value),legacy);
    account='B';
    // Use an inert same-origin document; /login may redirect to a canonical host
    // and would then exercise a different origin's localStorage.
    const other=await context.newPage();await other.goto(base+'/images/logo-transparent.png');
    assert.equal(new URL(other.url()).origin,new URL(page.url()).origin);
    await other.evaluate(({token})=>{localStorage.setItem('user',JSON.stringify({id:'B',role:'CHAPTER_LEADER',chapterId:'C'}));localStorage.setItem('accessToken',token+'-B');},{token});
    await stable('Đồng bộ sơ đồ');
    await page.waitForFunction(()=>document.querySelector('input[type="url"]')?.value!=='https://docs.google.com/spreadsheets/d/owner-A');
    assert.equal(await page.evaluate(()=>localStorage.getItem('bbe_term_transition_draft_C')),legacy);
    assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(key=>key.startsWith('api_cache:'))),false);
    await other.close();cases.push({id:'C07',status:'PASS',scenario:'cross-tab A→B, no A draft, legacy untouched, no API storage'});
    deny=true;
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await page.waitForURL(/\/login/,{timeout:30000});
    assert.equal(await page.locator('input[type="datetime-local"]').count(),0);
    cases.push({id:'C08',status:'PASS',scenario:'revoked scope on BFCache-style pageshow withholds protected content'});
    cases.push({id:'C09',status:'NOT VERIFIED',scenario:'real database due schedule, apply/cancel/reset semantics; no DB exercised'});
    cases.push({id:'C10',status:'NOT VERIFIED',scenario:'physical devices, real video/Quiz/fullscreen and long-running memory measurements'});
  }catch(error){
    await page.screenshot({path:path.join(out,'runtime-failure.png'),fullPage:true});
    const debug=await page.evaluate(()=>({url:location.pathname,visible:document.visibilityState,userId:JSON.parse(localStorage.getItem('user')||'null')?.id,main:document.querySelector('main')?.textContent?.slice(0,900)}));
    cases.push({id:'RUN',status:'FAIL',error:error.stack,debug});process.exitCode=1;
  }
  finally{
    const performanceSample=await page.evaluate(()=>({...(window.__bbePerf||{}),heapUsedBytes:performance.memory?.usedJSHeapSize||null})).catch(()=>null);
    const report={environment:'Next dev, mocked APIs, Edge desktop 1440x900; not backend proof; timings include auth and development rendering',cases,errors,navigationMs,layoutChecks,performanceSample,counts:records.reduce((a,r)=>(a[r.kind]=(a[r.kind]||0)+1,a),{}),requests:records};
    fs.writeFileSync(path.join(out,'runtime-verification.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({cases,errors,counts:report.counts},null,2));
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
