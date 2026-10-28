// Tests k6 serialization and thresholds against a stub. NEVER an app capacity test.
import http from 'node:http';
import fs from 'node:fs';
import { ROOT,safeEnv,id,command,save,freeGiB ,RESULTS} from '../lib.mjs';
if(freeGiB()<0.25)throw new Error('Insufficient available memory even for harness validation');
const runId='harness_'+id(), dir=RESULTS+'/'+runId;
fs.mkdirSync(dir);
const server=http.createServer((req,res)=>{if(req.url==='/login'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>Harness stub only</html>');}else{res.writeHead(404);res.end();}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3101,'127.0.0.1',resolve);});
const log=fs.openSync(dir+'/k6.log','wx');
try {
  const result=await command('k6',['--config','k6.config.json','run','--no-usage-report','--out','json='+dir+'/samples.json','--out','csv='+dir+'/samples.csv','scenarios/learners.js'],{
    env:{...safeEnv('postgresql://disabled:disabled@127.0.0.1:1/bbe_loadtest'),BASE_URL:'http://127.0.0.1:3101',MAX_VUS:'1',MODE:'static-smoke',HARNESS_ONLY:'yes',SAFETY_PREFLIGHT:'verified',RUN_DIR:'../artifacts/load-tests/results/'+runId},stdio:['ignore',log,log],
  });
  save(dir+'/metadata.json',{runId,kind:'HARNESS_STUB_ONLY',applicationTested:false,exit:result.code,at:new Date().toISOString()});
  console.log(JSON.stringify({kind:'HARNESS_STUB_ONLY',applicationTested:false,exit:result.code,directory:dir}));
  process.exitCode=result.code??1;
}finally{server.close();fs.closeSync(log);}
