// Diagnostic-only Node preload. No application source/routes are changed.
// CPU attribution is usable only for non-overlapping requests in a 1-VU run.
const http=require('node:http'),fs=require('node:fs');
const output=process.env.PERF_REQUEST_OUTPUT;
if(!output)throw new Error('Missing private profiler output path');
function endpoint(method,url) {
  const p=String(url||'').split('?')[0];
  const exact={'/login':'login_page','/api/v1/auth/login':'login','/api/v1/auth/refresh':'refresh','/api/v1/courses':'courses','/api/v1/members/me/courses':'member_courses','/api/v1/streak':'streak','/api/v1/stars/me':'stars','/api/v1/members/me/deadlines':'deadlines','/api/v1/learning/me':'learning','/api/v1/leaderboard':'leaderboard'};
  if(exact[p])return exact[p];
  if(/^\/api\/v1\/leaderboard\/chapters\/[^/]+$/.test(p))return 'leaderboard';
  if(/^\/api\/v1\/lessons\/[^/]+\/progress$/.test(p))return method==='GET'?'progress':'heartbeat';
  if(/^\/api\/v1\/lessons\/[^/]+$/.test(p))return 'lesson';
  if(/^\/api\/v1\/courses\/[^/]+$/.test(p))return 'course';
  if(/^\/api\/v1\/assessments\/[^/]+\/attempts$/.test(p))return 'start_quiz';
  if(/^\/api\/v1\/attempts\/[^/]+\/submit$/.test(p))return 'submit_quiz';
  return null;
}
const emit=http.Server.prototype.emit,active=new Set();
const originalLog=console.log;
console.log=function(...args){
  const m=typeof args[0]==='string'?args[0].match(/^\[SQL ([0-9.]+)ms\]/):null;
  if(m)for(const c of active)c.sql.push(Number(m[1]));
  return originalLog.apply(console,args);
};
http.Server.prototype.emit=function(event,...args){
  if(event==='request') {
    const [req,res]=args,name=endpoint(req.method,req.url);
    if(name){
      const c={cpu:process.cpuUsage(),at:performance.now(),overlap:active.size>0,done:false,sql:[]};
      for(const other of active)other.overlap=true;active.add(c);
      const finish=(completed)=>{
        if(c.done)return;c.done=true;active.delete(c);
        const used=process.cpuUsage(c.cpu);
        fs.appendFileSync(output,JSON.stringify({at:new Date().toISOString(),endpoint:name,method:req.method,status:res.statusCode,completed,overlappingRequests:c.overlap,wallMs:performance.now()-c.at,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,cpuTotalMs:(used.user+used.system)/1000,sqlQueryCount:c.sql.length,sqlDurationSumMs:c.sql.reduce((a,b)=>a+b,0)})+'\n');
      };
      res.once('finish',()=>finish(true));res.once('close',()=>finish(res.writableFinished));
    }
  }
  return emit.call(this,event,...args);
};
