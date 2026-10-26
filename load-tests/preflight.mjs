import fs from 'node:fs';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import { ROOT,REPO,id,save } from './lib.mjs';
const configs=[];
for(const file of ['.env','.env.local']) {
  if(!fs.existsSync(REPO+'/'+file))continue;
  const content=fs.readFileSync(REPO+'/'+file,'utf8');
  for(const key of ['DATABASE_URL','DIRECT_URL']) {
    const line=content.match(new RegExp('^'+key+'\\s*=\\s*(.*)$','m'));
    if(!line)continue;
    try {
      const u=new URL(line[1].trim().replace(/^['"]|['"]$/g,''));
      configs.push({file,key,provider:u.hostname.includes('supabase')?'Supabase':'other',loopback:['localhost','127.0.0.1','[::1]'].includes(u.hostname),port:u.port,pooler:u.hostname.includes('pooler'),explicitConnectionLimit:u.searchParams.has('connection_limit')});
    }catch{configs.push({file,key,parseFailed:true});}
  }
}
const version=spawnSync('k6',['version'],{encoding:'utf8'});
const result={at:new Date().toISOString(),node:process.version,k6:version.status===0?version.stdout.trim():'not verified',cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),availableMemoryBytes:os.freemem(),rootDbConfig:configs,productionDbContacted:false};
const dir=ROOT+'/results/preflight_'+id();fs.mkdirSync(dir,{recursive:true});save(dir+'/environment.json',result);
console.log(JSON.stringify({path:dir+'/environment.json',...result},null,2));
