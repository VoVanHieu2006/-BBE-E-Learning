const {chromium,webkit}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base='http://127.0.0.1:3122';
const out=path.join(__dirname,'motion');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const {SignJWT}=await import('jose');
  const token=await new SignJWT({role:'CHAPTER_LEADER',chapterId:'C'}).setProtectedHeader({alg:'HS256'}).setSubject('A').setExpirationTime('2h').sign(new TextEncoder().encode('bbe-ui-cache-test-only-not-a-production-secret'));
  const reports=[];
  for(const engine of [{name:'Edge',type:chromium,channel:'msedge'},{name:'WebKit',type:webkit}]){
    const browser=await engine.type.launch({headless:true,...(engine.channel?{channel:engine.channel}:{})});
    try{
      for(const width of [1440,390]){
        const context=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390,...(engine.name==='Edge'?{recordVideo:{dir:out,size:{width,height:900}}}:{})});
        const user={id:'A',role:'CHAPTER_LEADER',chapterId:'C',chapterName:'BBE Chapter',isChapterManager:true,managedChapters:[{id:'C',name:'BBE Chapter',canManageMembers:true}],canManageMembers:true};
        await context.addCookies([{name:'accessToken',value:token,url:base},{name:'userRole',value:'CHAPTER_LEADER',url:base}]);
        await context.addInitScript(({token,user})=>{
          localStorage.setItem('accessToken',token);localStorage.setItem('user',JSON.stringify(user));
          window.__motion={creates:0,loads:0,track:false,frames:0,blank:0,gates:0,cls:0};
          const frame=()=>{const m=window.__motion;if(m.track){m.frames++;const main=document.querySelector('main');if(!main||!main.querySelector('h1')||getComputedStyle(main).opacity==='0')m.blank++;if(main?.textContent?.includes('Đang xác minh phiên'))m.gates++;}requestAnimationFrame(frame);};requestAnimationFrame(frame);
          try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)window.__motion.cls+=entry.value;}).observe({type:'layout-shift',buffered:true});}catch{}
          window.YT={Player:class{
            constructor(element,options){this.options=options;this.time=120;this.rate=1;this.state=2;window.__motion.creates++;this.frame=document.createElement('iframe');this.frame.title='BBE video fixture';this.frame.srcdoc='<body style="margin:0;background:#172554;color:white;height:100vh;display:grid;place-items:center;font:16px sans-serif">BBE · Video kiểm thử giao diện</body>';this.frame.style.cssText='width:100%;height:100%;border:0';this.frame.onload=()=>window.__motion.loads++;element.replaceWith(this.frame);setTimeout(()=>options.events.onReady({target:this}),0);}
            getCurrentTime(){return this.time;}getDuration(){return 600;}getPlaybackRate(){return this.rate;}getPlayerState(){return this.state;}
            playVideo(){this.state=1;this.options.events.onStateChange({data:1,target:this});}pauseVideo(){this.state=2;this.options.events.onStateChange({data:2,target:this});}stopVideo(){this.state=2;}seekTo(time){this.time=time;}setPlaybackRate(rate){this.rate=rate;}unloadModule(){}destroy(){this.frame.remove();}
          }};
        },{token,user});
        const requests=[],errors=[];
        let holdAuth=false,failAuth=false,releaseAuth;
        await context.route('**/api/v1/**',async route=>{
          const req=route.request(),url=new URL(req.url());requests.push({method:req.method(),endpoint:url.pathname});
          let data={items:[]};
          if(url.pathname.endsWith('/auth/me')){
            if(holdAuth)await new Promise(resolve=>{releaseAuth=resolve;});
            if(failAuth){failAuth=false;await route.fulfill({status:500,json:{error:{code:'NetworkTest',message:'Deferred verification failed'}}});return;}
            data={user};
          }
          else if(url.pathname.endsWith('/dashboard/members'))data={items:[],totalItems:12,summary:{totalMembers:12,avgChapterProgress:65,totalStars:240,membersOver70:6}};
          else if(url.pathname.endsWith('/dashboard/courses'))data={totalItems:1,items:[{id:'course-1',title:'Kỹ năng giao tiếp',completionRate:50,completedCount:6,totalMembers:12}]};
          else if(url.pathname==='/api/v1/courses/course-1')data={id:'course-1',title:'Kỹ năng giao tiếp',sessions:[{id:'session-1',title:'Lắng nghe và phản hồi',lessons:[{id:'lesson-1',title:'Giao tiếp trong đội ngũ',hasVideo:true,video:{youtubeVideoId:'dQw4w9WgXcQ',durationSeconds:600},documents:[]}]}]};
          else if(req.method()==='PATCH'){const body=req.postDataJSON();data={...body,completed:false,videoCompleted:false,furthestWatchedPositionSeconds:120,progressPercentage:20};}
          await route.fulfill({json:data});
        });
        const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
        const report={engine:engine.name,width,status:'PASS'};
        async function nav(route,text){if(width===390){await page.getByRole('button',{name:/Menu/}).click();}await page.locator(`aside a[href="/chapter-manager/${route}"]`).click();await page.waitForURL(base+'/chapter-manager/'+route);await page.getByText(text,{exact:false}).first().waitFor({timeout:90000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
        try{
          await page.goto(base+'/chapter-manager/dashboard');await page.getByText('Đồng bộ thành công cả hai nguồn').waitFor({timeout:90000});
          await nav('courses','Đồng bộ khóa học');await nav('dashboard','Đồng bộ thành công cả hai nguồn');
          await page.evaluate(()=>{window.__motion.track=true;});
          let mark=requests.length;
          for(let i=0;i<3;i++){await nav('courses','Đồng bộ khóa học');await nav('dashboard','Đồng bộ thành công cả hai nguồn');}
          await page.evaluate(()=>{window.__motion.track=false;});
          report.navigation=await page.evaluate(()=>({frames:window.__motion.frames,blankFrames:window.__motion.blank,verificationGateFrames:window.__motion.gates,cls:window.__motion.cls}));
          report.warmBusinessGET=requests.slice(mark).filter(r=>r.method==='GET'&&!r.endpoint.includes('/auth/')).length;
          assert.ok(report.navigation.frames>0);
          assert.equal(report.warmBusinessGET,0);assert.equal(report.navigation.blankFrames,0);assert.equal(report.navigation.verificationGateFrames,0);
          await nav('courses','Đồng bộ khóa học');
          await page.getByRole('button',{name:/Nội dung & Quiz/}).click();
          await page.locator('[data-pilot-accordion]').waitFor();
          const dialog=page.locator('[role="dialog"]').last();
          report.modalAnimation=await dialog.locator(':scope > div').evaluate(el=>({duration:getComputedStyle(el).animationDuration,transform:getComputedStyle(el).transform,filter:getComputedStyle(el).filter}));
          assert.equal(report.modalAnimation.duration,'0.18s');assert.equal(report.modalAnimation.transform,'none');assert.equal(report.modalAnimation.filter,'none');
          mark=requests.length;
          const summary=page.locator('[data-pilot-accordion] > summary');
          await summary.click();await summary.click();
          await page.waitForFunction(()=>document.querySelector('[data-pilot-accordion]').open);
          report.accordionGET=requests.slice(mark).filter(r=>r.method==='GET').length;assert.equal(report.accordionGET,0);
          await page.waitForTimeout(240);
          await page.screenshot({path:path.join(out,`${engine.name.toLowerCase()}-accordion-${width}.png`),fullPage:false});
          await page.getByRole('button',{name:/Xem video/}).click();
          await page.locator('[data-video-player] iframe').waitFor();
          await page.waitForFunction(()=>window.__motion.loads>0);
          await page.evaluate(()=>{window.__originalMotionFrame=document.querySelector('[data-video-player] iframe');window.__originalMotionCreates=window.__motion.creates;window.__originalMotionLoads=window.__motion.loads;});
          holdAuth=true;
          await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
          await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role="dialog"]')).every(el=>getComputedStyle(el).visibility==='hidden'&&el.hasAttribute('inert')));
          assert.equal(await page.locator('[data-video-player]').count(),1,'Private player must stay mounted while withheld');
          report.portalsWithheldWhileVerifying=true;
          holdAuth=false;releaseAuth();
          await page.locator('[data-video-player]').waitFor({state:'visible'});
          failAuth=true;
          await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
          await page.getByText('Chưa xác minh được phiên.',{exact:false}).first().waitFor();
          assert.equal(await page.locator('[role="dialog"]:visible').count(),0);
          assert.equal(await page.locator('[data-video-player]').count(),1);
          report.portalsWithheldOnVerificationFailure=true;
          await page.getByRole('button',{name:'Thử lại',exact:true}).click();
          await page.locator('[data-video-player]').waitFor({state:'visible'});
          report.playerStableAfterVerification=await page.evaluate(()=>document.querySelector('[data-video-player] iframe')===window.__originalMotionFrame&&window.__motion.creates===window.__originalMotionCreates&&window.__motion.loads===window.__originalMotionLoads);
          assert.equal(report.playerStableAfterVerification,true);
          await page.keyboard.press('Escape');await page.locator('[data-video-player]').waitFor({state:'hidden'});
          await page.keyboard.press('Escape');await page.locator('[role="dialog"]').waitFor({state:'hidden'});
          assert.equal(await page.locator('body').evaluate(el=>el.style.overflow),'');
          await page.emulateMedia({reducedMotion:'reduce'});
          await page.getByRole('button',{name:/Nội dung & Quiz/}).click();await page.locator('[data-pilot-accordion]').waitFor();
          report.reducedMotion=await page.locator('[role="dialog"]').last().locator(':scope > div').evaluate(el=>getComputedStyle(el).animationName);
          assert.equal(report.reducedMotion,'none');
          report.consoleErrors=errors;assert.deepEqual(errors,[]);
        }catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
        finally{
          const video=page.video();await context.close();
          if(video)await video.saveAs(path.join(out,`pilot-${width}.webm`));
          reports.push(report);console.log(JSON.stringify(report));
        }
      }
    }finally{await browser.close();}
  }
  fs.writeFileSync(path.join(__dirname,'motion-verification.json'),JSON.stringify(reports,null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;});
