// Same fixtures and viewports for the isolated HEAD baseline and working-tree Pilot.
const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const before=process.argv.includes('--before');
const base=before?'http://127.0.0.1:3123':'http://127.0.0.1:3122';
const label=before?'before':'after';
(async()=>{
  const {SignJWT}=await import('jose');
  const token=await new SignJWT({role:'CHAPTER_LEADER',chapterId:'C'}).setProtectedHeader({alg:'HS256'}).setSubject('A').setExpirationTime('2h').sign(new TextEncoder().encode('bbe-ui-cache-test-only-not-a-production-secret'));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext();
  const user={id:'A',role:'CHAPTER_LEADER',chapterId:'C',chapterName:'BBE Chapter',canManageMembers:true,isChapterManager:true,managedChapters:[{id:'C',name:'BBE Chapter',canManageMembers:true}]};
  await context.addCookies([{name:'accessToken',value:token,url:base},{name:'userRole',value:'CHAPTER_LEADER',url:base}]);
  await context.addInitScript(({token,user})=>{localStorage.setItem('accessToken',token);localStorage.setItem('user',JSON.stringify(user));},{token,user});
  let active=0;const requests=[],navigation=[];
  await context.route('**/api/v1/**',async route=>{
    active++;const url=new URL(route.request().url());
    requests.push({kind:url.pathname.includes('/auth/')?'auth':route.request().method()==='GET'?'business':'mutation',endpoint:url.pathname+url.search});
    let data={items:[]};
    if(url.pathname.endsWith('/auth/me'))data={user};
    if(url.pathname.endsWith('/dashboard/members'))data={items:[],totalItems:12,summary:{totalMembers:12,avgChapterProgress:65,totalStars:240,membersOver70:6}};
    if(url.pathname.endsWith('/dashboard/courses'))data={items:[{id:'course-1',title:'Kỹ năng giao tiếp',description:'Lắng nghe, trao đổi và kết nối trong đội ngũ BBE.',completionRate:50,completedCount:6,totalMembers:12},{id:'course-2',title:'Làm việc cùng đội ngũ',description:'Xây dựng thói quen phối hợp và hoàn thành mục tiêu chung.',completionRate:25,completedCount:3,totalMembers:12}],totalItems:2};
    if(url.pathname.endsWith('/current-roster'))data={roster:[],unassignedMembers:[],departments:[],scheduledBatch:null,currentTermNumber:1};
    try{await route.fulfill({json:data});}finally{active--;}
  });
  const page=await context.newPage();
  const out=path.join(__dirname,'comparison');fs.mkdirSync(out,{recursive:true});
  async function ready(route){
    if(route==='dashboard')await page.getByText('240',{exact:false}).first().waitFor({timeout:90000});
    if(route==='courses')await page.getByRole('heading',{name:'Kỹ năng giao tiếp',exact:true}).waitFor({timeout:90000});
    if(route==='term-transition')await page.locator('input[type="url"]').waitFor({timeout:90000});
    await page.evaluate(()=>document.fonts.ready);
    for(let i=0;i<100;i++){if(active===0){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));if(active===0)return;}await new Promise(r=>setTimeout(r,50));}
    throw Error('API fixture did not settle');
  }
  async function nav(route){const start=performance.now();await page.locator(`aside a[href="/chapter-manager/${route}"]`).click();await page.waitForURL(base+'/chapter-manager/'+route);await ready(route);navigation.push({route,ms:Math.round(performance.now()-start)});}
  try{
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:900});
      for(const route of ['dashboard','courses','term-transition']){
        await page.goto(base+'/chapter-manager/'+route);await ready(route);
        await page.screenshot({path:path.join(out,`${label}-${route}-${width}.png`),fullPage:true});
      }
    }
    await page.setViewportSize({width:1440,height:900});
    await page.goto(base+'/chapter-manager/dashboard');await ready('dashboard');
    await new Promise(r=>setTimeout(r,3500)); // let the incumbent idle prefetch finish before counting rounds
    await nav('courses');await nav('dashboard');
    const mark=requests.length;
    for(let i=0;i<10;i++){await nav('courses');await nav('dashboard');}
    const loop=requests.slice(mark);
    const report={label,base:before?'cf88238':'working-tree Pilot',browser:browser.version(),fixture:'same BBE Chapter / 12 members / 2 courses / 65% / 240 Stars',rounds:10,businessGET:loop.filter(r=>r.kind==='business').length,authRequests:loop.filter(r=>r.kind==='auth').length,navigation,requests:loop};
    fs.writeFileSync(path.join(out,`${label}-measurement.json`),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({label,businessGET:report.businessGET,authRequests:report.authRequests,screenshots:6}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
