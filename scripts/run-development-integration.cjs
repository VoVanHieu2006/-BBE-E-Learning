// Explicit Supabase development target + isolated schema + backup/server attestations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd());
const {loadDevelopmentTarget,assertPrismaIsolation}=require('./development-integration-target.cjs');
const {createVerifiedClient}=require('./development-db-inspect.cjs');
const suite=process.argv[2],manifest=path.resolve(process.argv[3]||'');
const scripts={leaderboard:'scripts/test-chapter-leaderboard-integration.mjs',organization:'scripts/test-organization-integrity.cjs',learning_flow:'scripts/test-learning-flow-integration.mjs',learning_cycles:'scripts/test-learning-cycles-integration.cjs'};
const root=path.resolve('scratch/development-integration');
const variant=process.argv[4];
if(variant && !(suite==='leaderboard' && variant==='--v8'))throw Error('Unreviewed suite variant');
if(variant==='--v8')scripts.leaderboard='scripts/test-chapter-leaderboard-v8-integration.mjs';
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const redact=text=>String(text).replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g,'[redacted connection]');
async function main(){
  if(!scripts[suite]||!manifest.startsWith(root+path.sep))throw Error('Reviewed suite and manifest required');
  const receipt=JSON.parse(fs.readFileSync(manifest,'utf8'));
  const url=new URL(process.env.DIRECT_URL||process.env.DATABASE_URL);
  const ca=path.resolve('scratch/development-integration/supabase-ca.crt').replaceAll('\\','/');
  url.searchParams.set('schema',receipt.schema);url.searchParams.set('sslmode','require');url.searchParams.set('sslaccept','strict');url.searchParams.set('sslcert',ca);
  url.searchParams.set('connection_limit','3');url.searchParams.set('connect_timeout','15');url.searchParams.set('pool_timeout','15');url.searchParams.set('socket_timeout','60');
  const targetUrl=url.toString();
  const port=suite==='leaderboard'?3111:3112;
  const nonce=crypto.randomBytes(16).toString('hex'),attestation=path.join(root,receipt.schema+'-server.json');
  // Each Next process owns its own source/config/cache directory. Never share
  // a dev source directory with the mock browser Pilot (Next mutates metadata).
  const appDir=path.join(process.env.TEMP,`bbe-ui-integration-${suite}-${nonce}`);
  if(['leaderboard','learning_flow'].includes(suite)){
    fs.mkdirSync(appDir);
    for(const name of ['src','public','next.config.js','tsconfig.json','next-env.d.ts','package.json','postcss.config.js','tailwind.config.js','tailwind.config.ts']){
      if(fs.existsSync(name))fs.cpSync(name,path.join(appDir,name),{recursive:true});
    }
    fs.symlinkSync(path.resolve('node_modules'),path.join(appDir,'node_modules'),'junction');
    const hashes=[];
    function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())scan(file);else{const relative=path.relative('src',file);const h=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');const sha256=h(file);if(sha256!==h(path.join(appDir,'src',relative)))throw Error('HTTP snapshot differs from workspace');hashes.push({file:file.replaceAll('\\','/'),sha256});}}}
    scan('src');fs.writeFileSync(path.join(root,receipt.schema+'-http-source-hashes.json'),JSON.stringify(hashes,null,2)+'\n');
  }
  const childEnv={...process.env,BBE_DEVELOPMENT_INTEGRATION:'1',BBE_APPROVED_SUPABASE_PROJECT:receipt.projectRef,BBE_INTEGRATION_MANIFEST:manifest,BBE_INTEGRATION_SUITE:suite,BBE_SERVER_NONCE:nonce,BBE_SERVER_ATTESTATION:attestation,BBE_INTEGRATION_PORT:String(port),BBE_INTEGRATION_APP_DIR:appDir,TEST_APP_URL:`http://127.0.0.1:${port}`,TEST_DATABASE_URL:targetUrl,ORGANIZATION_TEST_DATABASE_URL:targetUrl,DATABASE_URL:targetUrl,DIRECT_URL:targetUrl,PRISMA_QUERY_LOG:'0'};
  // Guard all connection properties before loading Prisma or spawning the app.
  Object.assign(process.env,{BBE_DEVELOPMENT_INTEGRATION:'1',BBE_APPROVED_SUPABASE_PROJECT:receipt.projectRef,BBE_INTEGRATION_MANIFEST:manifest});
  const target=loadDevelopmentTarget(targetUrl,suite);
  const {PrismaClient}=require('@prisma/client');const prisma=new PrismaClient({datasourceUrl:targetUrl,log:[]});
  await assertPrismaIsolation(prisma,target);await prisma.$disconnect();
  let output='',server,code=null;
  const append=value=>{const safe=redact(value);output+=safe;process.stdout.write(safe);};
  try{
    if(['leaderboard','learning_flow'].includes(suite)){
      server=spawn(process.execPath,['scripts/development-integration-server.cjs'],{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
      server.stdout.on('data',append);server.stderr.on('data',append);
      for(let i=0;i<240;i++){
        if(server.exitCode!==null)throw Error('Dedicated server exited before attestation');
        if(fs.existsSync(attestation)){const a=JSON.parse(fs.readFileSync(attestation,'utf8'));if(a.nonce===nonce)break;}
        await new Promise(r=>setTimeout(r,500));
        if(i===239)throw Error('Dedicated server attestation timed out');
      }
    }
    const child=spawn(process.execPath,[scripts[suite]],{env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',append);child.stderr.on('data',append);
    code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  }finally{
    if(server){server.send({type:'shutdown'});await Promise.race([new Promise(r=>server.on('exit',r)),new Promise(r=>setTimeout(()=>{server.kill();r();},15000))]);}
    const stem=receipt.schema+(variant==='--v8'?'-v8':'');
    fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,stem+'-test.log'),output);
    const client=createVerifiedClient(targetUrl);await client.connect();
    try{
      const inventory=[];
      for(const table of receipt.tables){const count=Number((await client.query(`SELECT count(*)::text AS count FROM ${quote(receipt.schema)}.${quote(table)}`)).rows[0].count);if(count)inventory.push({table,rows:count});}
      const report={suite,status:code===0?'PASS':'FAIL',exitCode:code,projectRef:receipt.projectRef,database:receipt.database,schema:receipt.schema,finishedAt:new Date().toISOString(),scope:'Isolated fixture schema in authorized development database',fixtureInventory:inventory,cleanup:'Fixtures retained; no DROP SCHEMA; no public/auth/storage cleanup performed'};
      fs.writeFileSync(path.join(root,stem+'-result.json'),JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify({suite,status:report.status,schema:report.schema,retainedRows:inventory.reduce((n,t)=>n+t.rows,0)}));
    }finally{await client.end();}
  }
  if(code!==0)process.exitCode=1;
}
main().catch(error=>{console.error(JSON.stringify({status:'FAIL',message:redact(error.message).slice(0,350)}));process.exitCode=1;});
