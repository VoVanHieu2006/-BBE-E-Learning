// Standalone specimen QA only. Never starts Next, imports app code or touches a DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('@playwright/test');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const out = path.join(__dirname,'screenshots');
  fs.mkdirSync(out,{recursive:true});
  const results={scope:'Standalone design specimen; not runtime cache/security acceptance',viewports:[],checks:[],engines:[],errors:[]};
  const server=http.createServer((req,res)=>{
    const target=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    try {const data=fs.readFileSync(target);res.setHeader('Content-Type',target.endsWith('.html')?'text/html; charset=utf-8':target.endsWith('.png')?'image/png':'application/octet-stream');res.end(data);}
    catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/docs/ui-cache-checkpoints/pilot.html`;
  const candidates=[
    {name:'Edge',engine:chromium,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'},
    {name:'Chrome',engine:chromium,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'},
    {name:'Chromium',engine:chromium,executablePath:chromium.executablePath()},
    {name:'WebKit',engine:webkit,executablePath:webkit.executablePath()},
  ];
  try {
    for (const candidate of candidates) {
      if(!fs.existsSync(candidate.executablePath)){results.engines.push({name:candidate.name,status:'NOT VERIFIED',reason:'Browser executable not installed'});continue;}
      const browser=await candidate.engine.launch({headless:true,executablePath:candidate.executablePath});
      try {
        const page=await browser.newPage();
        const errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        const business=[];
        page.on('request',request=>{if(request.url().includes('/api/'))business.push(request.url());});
        for(const [width,height] of [[360,844],[390,844],[430,932],[768,1024],[1024,768],[1440,900],[844,390]]) {
          await page.setViewportSize({width,height});
          await page.goto(url);
          await page.evaluate(()=>document.fonts.ready);
          for(const screen of ['dashboard','courses','transition']) {
            if(width<768){await page.locator('#open-menu').click();await page.locator(`#mobile-nav [data-screen="${screen}"]`).click();}
            else await page.locator(`#desktop-nav [data-screen="${screen}"]`).click();
            await page.locator('#content').waitFor({state:'visible'});
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${candidate.name} ${screen} overflows at ${width}`);
            if(width<768) {
              const short=await page.locator('button:visible,input:visible,select:visible').evaluateAll(elements=>elements.filter(el=>{const r=el.getBoundingClientRect();return r.height<43.9||r.width<43.9;}).map(el=>el.textContent));
              assert.deepEqual(short,[],`Touch targets at ${width}: ${short}`);
            }
            if([1440,390].includes(width))await page.screenshot({path:path.join(out,`${candidate.name.toLowerCase()}-${screen}-${width}.png`),fullPage:true});
            results.viewports.push({engine:candidate.name,screen,width,height,overflow:'PASS',touch:width<768?'PASS':'N/A'});
          }
        }
        await page.setViewportSize({width:390,height:844});
        await page.goto(url);
        await page.locator('#open-menu').click();
        assert.equal(await page.locator('#menu').evaluate(el=>el.open),true);
        assert.equal(await page.locator('body').evaluate(el=>el.style.overflow),'hidden');
        await page.keyboard.press('Escape');
        await page.locator('#menu').waitFor({state:'hidden'});
        await page.waitForFunction(()=>document.activeElement===document.querySelector('#open-menu'));
        assert.equal(await page.locator('#open-menu').evaluate(el=>el===document.activeElement),true);
        assert.equal(await page.locator('body').evaluate(el=>el.style.overflow),'');
        await page.locator('#open-menu').click();
        await page.locator('#mobile-nav [data-screen="courses"]').click();
        await page.locator('#search').fill('giao tiếp');
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-course]')).filter(row=>getComputedStyle(row).display!=='none').length===1);
        assert.equal(await page.locator('[data-course]:visible').count(),1);
        await page.locator('[data-content]:visible').click();
        await page.keyboard.press('Escape');
        await page.locator('#details').waitFor({state:'hidden'});
        await page.waitForFunction(()=>document.activeElement?.hasAttribute('data-content'));
        assert.equal(await page.locator('[data-content]:visible').evaluate(el=>el===document.activeElement),true);
        await page.locator('#open-menu').click();
        await page.locator('#mobile-nav [data-screen="transition"]').click();
        await page.locator('[data-view="draft"]').click();
        await page.locator('#sheet').fill('https://docs.google.com/spreadsheets/d/example');
        await page.locator('#term').fill('3');
        await page.locator('#date').fill('2026-12-01T09:00');
        await page.locator('[data-view="history"]').click();
        await page.locator('[data-view="draft"]').click();
        assert.equal(await page.locator('#term').inputValue(),'3');
        await page.locator('#refresh').click();
        await page.locator('#refresh:not([disabled])').waitFor();
        assert.equal(await page.locator('#term').inputValue(),'3');
        await page.screenshot({path:path.join(out,`${candidate.name.toLowerCase()}-draft-390.png`),fullPage:true});
        await page.locator('[data-view="current"]').click();
        for(const state of ['loading','empty','error','partial']){
          await page.locator('#state').selectOption(state);
          if(state==='loading')assert.equal(await page.locator('#content').getAttribute('aria-busy'),'true');
          if(['error','partial'].includes(state))assert.equal(await page.locator('[role="alert"]').count(),1);
          if(candidate.name==='Edge')await page.screenshot({path:path.join(out,`${state}-390.png`),fullPage:true});
        }
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.locator('#state').selectOption('loading');
        assert.equal(await page.locator('.skeleton').evaluate(el=>getComputedStyle(el).animationName),'none');
        assert.deepEqual(business,[],'Specimen must never call application APIs');
        assert.deepEqual(errors,[],'Specimen JS errors');
        results.engines.push({name:candidate.name,status:'PASS',version:browser.version()});
        results.checks.push({engine:candidate.name,keyboardDialogEscapeFocus:'PASS',scrollLock:'PASS',filter:'PASS',previewDraftAcrossViewsAndRefresh:'PASS',presentationStates:'PASS',reducedMotion:'PASS',noBusinessRequests:'PASS',consoleErrors:0});
      } finally {await browser.close();}
    }
    assert.ok(results.engines.some(e=>e.status==='PASS'),'No installed browser verified');
  } catch(error) {results.errors.push(error.stack);process.exitCode=1;}
  finally {
    await new Promise(resolve=>server.close(resolve));
    fs.writeFileSync(path.join(__dirname,'preview-verification.json'),JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify({engines:results.engines,viewportChecks:results.viewports.length,checks:results.checks,errors:results.errors},null,2));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
