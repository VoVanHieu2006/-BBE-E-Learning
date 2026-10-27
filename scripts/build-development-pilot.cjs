// Full build in a disposable source directory and verified fixture namespace.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd());
const {loadDevelopmentTarget,assertPrismaIsolation}=require('./development-integration-target.cjs');
async function main(){
  const baseline=process.argv[3]==='--baseline';
  if(process.argv[3]&&!baseline)throw Error('Unknown build variant');
  const source=baseline?path.join(process.env.TEMP,'bbe-ui-cache-baseline-20261027-source'):process.cwd();
  const manifest=path.resolve(process.argv[2]||'');
  if(!manifest.startsWith(path.resolve('scratch/development-integration')+path.sep))throw Error('Registered fixture manifest required');
  const descriptor=JSON.parse(fs.readFileSync(manifest));
  const url=new URL(process.env.DIRECT_URL||process.env.DATABASE_URL);
  url.searchParams.set('schema',descriptor.schema);url.searchParams.set('sslmode','require');url.searchParams.set('sslaccept','strict');url.searchParams.set('sslcert',path.resolve('scratch/development-integration/supabase-ca.crt').replaceAll('\\','/'));url.searchParams.set('connection_limit','2');
  Object.assign(process.env,{BBE_DEVELOPMENT_INTEGRATION:'1',BBE_APPROVED_SUPABASE_PROJECT:descriptor.projectRef,BBE_INTEGRATION_MANIFEST:manifest});
  const target=loadDevelopmentTarget(url.toString(),descriptor.suite);
  const prisma=new(require('@prisma/client').PrismaClient)({datasourceUrl:url.toString()});await assertPrismaIsolation(prisma,target);await prisma.$disconnect();
  const dir=path.join(process.env.TEMP,'bbe-ui-build-'+crypto.randomBytes(6).toString('hex'));fs.mkdirSync(dir);
  for(const name of ['src','public','next.config.js','tsconfig.json','next-env.d.ts','package.json','postcss.config.js','tailwind.config.ts'])if(fs.existsSync(path.join(source,name)))fs.cpSync(path.join(source,name),path.join(dir,name),{recursive:true});
  fs.symlinkSync(path.resolve('node_modules'),path.join(dir,'node_modules'),'junction');
  const child=spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'build'],{cwd:dir,env:{...process.env,NODE_ENV:'production',DATABASE_URL:url.toString(),DIRECT_URL:url.toString(),TEST_DATABASE_URL:url.toString(),ORGANIZATION_TEST_DATABASE_URL:url.toString(),NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';const append=x=>{const value=String(x).replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g,'[redacted connection]');log+=value;process.stdout.write(value);};child.stdout.on('data',append);child.stderr.on('data',append);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  const stem=baseline?'build-baseline-verification':'build-development-verification';
  fs.writeFileSync(`docs/ui-cache-checkpoints/${stem}.txt`,log);
  fs.writeFileSync(`docs/ui-cache-checkpoints/${stem}.json`,JSON.stringify({status:code===0?'PASS':'FAIL',exitCode:code,projectRef:target.projectRef,database:target.database,schema:target.schema,source:dir,base:baseline?'cf88238':'working-tree Pilot',finishedAt:new Date().toISOString()},null,2)+'\n');
  if(code!==0)process.exitCode=1;
}
main().catch(error=>{console.error(JSON.stringify({status:'FAIL',message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]').slice(0,200)}));process.exitCode=1;});
