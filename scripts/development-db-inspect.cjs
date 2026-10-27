// Read-only inspection of the application's configured Supabase development target.
// Never prints connection URLs, usernames, passwords, tokens or row contents.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Client}=require('pg');
require('@next/env').loadEnvConfig(process.cwd());

function targetMetadata(raw){
  if(!raw)throw new Error('Missing application database configuration');
  const url=new URL(raw);
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Unexpected database protocol');
  const direct=url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  const pooled=/\.pooler\.supabase\.com$/.test(url.hostname)?decodeURIComponent(url.username).match(/^postgres\.([a-z0-9]+)$/)?.[1]:null;
  const projectRef=direct||pooled;
  if(!projectRef)throw new Error('Configured target is not an identifiable Supabase project');
  const database=decodeURIComponent(url.pathname.slice(1));
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify([url.hostname,url.port||'5432',decodeURIComponent(url.username),database])).digest('hex');
  return {projectRef,database,host:url.hostname,port:Number(url.port||5432),fingerprint};
}
async function main(){
  const target=targetMetadata(process.env.DATABASE_URL);
  const direct=process.env.DIRECT_URL?targetMetadata(process.env.DIRECT_URL):null;
  if(direct&&(direct.projectRef!==target.projectRef||direct.database!==target.database))throw new Error('DATABASE_URL and DIRECT_URL point to different projects/databases');
  const publicProjects=Object.keys(process.env).filter(key=>/SUPABASE.*URL/.test(key)).flatMap(key=>{try{return [new URL(process.env[key]).hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1]].filter(Boolean);}catch{return [];}});
  if(publicProjects.some(ref=>ref!==target.projectRef))throw new Error('Supabase API and database project references disagree');
  const client=createVerifiedClient(process.env.DATABASE_URL);
  await client.connect();
  try{
    await client.query('BEGIN READ ONLY');
    const identity=(await client.query('SELECT current_database() AS database, current_schema() AS schema, version() AS version')).rows[0];
    if(identity.database!==target.database)throw new Error('Connected database differs from configured database');
    const tables=(await client.query("SELECT relname AS table, n_live_tup::bigint AS estimated_rows FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname")).rows;
    const guards=(await client.query("SELECT p.proname AS name, md5(p.prosrc) AS body_hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('assert_organization_integrity','record_learning_chapter_affiliation','assert_chapter_lead_binding','enforce_chapter_lead_binding') ORDER BY p.proname")).rows;
    const schemas=(await client.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name<>'information_schema' ORDER BY schema_name")).rows.map(row=>row.schema_name);
    await client.query('ROLLBACK');
    const report={checkedAt:new Date().toISOString(),mode:'read-only',target,directTarget:direct,publicApiProjectMatched:publicProjects.length?true:null,identity,tables,guards,schemas,mutations:0};
    const dir=path.resolve('scratch/development-integration');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'target-inspection.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({mode:report.mode,projectRef:target.projectRef,database:identity.database,schema:identity.schema,tableCount:tables.length,estimatedRows:tables.reduce((sum,row)=>sum+Number(row.estimated_rows),0),guards:guards.map(row=>row.name),mutations:0}));
  }finally{await client.end();}
}
function createVerifiedClient(connectionString){
  targetMetadata(connectionString);
  const url=new URL(connectionString);
  // These names mean different things in Prisma and node-postgres. Always use
  // the explicitly verified CA object for pg, with hostname verification intact.
  for(const key of ['sslmode','sslcert','sslrootcert','sslkey','sslidentity','sslpassword','sslaccept'])url.searchParams.delete(key);
  const caPath=path.resolve('scratch/development-integration/supabase-ca.crt');
  const ca=fs.readFileSync(caPath,'utf8');
  const certificate=new crypto.X509Certificate(ca);
  if(certificate.fingerprint256!=='80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')throw new Error('Unexpected database CA certificate');
  return new Client({connectionString:url.toString(),connectionTimeoutMillis:15000,statement_timeout:45000,ssl:{ca,rejectUnauthorized:true}});
}
module.exports={targetMetadata,createVerifiedClient};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({status:'FAIL',code:error.code||'PREFLIGHT_FAILED',message:'Read-only target inspection failed; no credentials or connection strings logged.'}));process.exitCode=1;});
