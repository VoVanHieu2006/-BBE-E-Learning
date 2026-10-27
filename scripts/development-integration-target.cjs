const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
function metadata(raw){
  const url=new URL(raw);
  if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('PostgreSQL URL required');
  const projectRef=url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]||(/\.pooler\.supabase\.com$/.test(url.hostname)?decodeURIComponent(url.username).match(/^postgres\.([a-z0-9]+)$/)?.[1]:null);
  if(!projectRef)throw Error('Identifiable Supabase project required');
  const database=decodeURIComponent(url.pathname.slice(1));
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify([url.hostname,url.port||'5432',decodeURIComponent(url.username),database])).digest('hex');
  return {url,projectRef,database,fingerprint,schema:url.searchParams.get('schema')};
}
function validateDevelopmentDescriptor(raw,suite,descriptor,inspection,backup){
  if(!['leaderboard','organization','learning_flow','learning_cycles','chapter_term'].includes(suite))throw Error('Unreviewed suite');
  const target=metadata(raw);
  if(descriptor.status!=='READY'||descriptor.suite!==suite||!new RegExp(`^bbe_ui_it_${suite}_[0-9a-f]{8}$`).test(descriptor.schema)||target.schema!==descriptor.schema||descriptor.foreignKeysOutsideSchema!==0)throw Error('Registered isolated fixture schema required');
  if([descriptor,inspection.target,backup].some(v=>v.projectRef!==target.projectRef||v.database!==target.database))throw Error('Project/database mismatch');
  if(![inspection.target.fingerprint,inspection.directTarget?.fingerprint].includes(target.fingerprint)||descriptor.connectionFingerprint!==target.fingerprint)throw Error('Unverified database connection target');
  if(!backup.roundTripVerified||!backup.dpapiRestoreVerified||descriptor.backupSha256!==backup.cipherSha256||!Number.isFinite(Date.parse(backup.createdAt))||Date.now()-Date.parse(backup.createdAt)>4*3600000||Date.parse(backup.createdAt)>Date.now())throw Error('Fresh matching verified backup required');
  return {...target,suite,descriptor};
}
function loadDevelopmentTarget(raw,suite){
  if(process.env.BBE_DEVELOPMENT_INTEGRATION!=='1')return null;
  if(!raw)throw Error('Explicit test URL required; no application URL fallback');
  const root=path.resolve('scratch/development-integration');
  const manifest=path.resolve(process.env.BBE_INTEGRATION_MANIFEST||'');
  if(!manifest.startsWith(root+path.sep)||!manifest.endsWith('.json'))throw Error('Explicit local integration manifest required');
  const descriptor=JSON.parse(fs.readFileSync(manifest,'utf8'));
  const inspection=JSON.parse(fs.readFileSync(path.join(root,'target-inspection.json'),'utf8'));
  const backup=JSON.parse(fs.readFileSync(path.join(root,'backup-receipt.json'),'utf8'));
  const target=validateDevelopmentDescriptor(raw,suite,descriptor,inspection,backup);
  if(process.env.BBE_APPROVED_SUPABASE_PROJECT!==target.projectRef)throw Error('Explicit approved development project required');
  const backupFile=path.resolve(backup.directory,'public-backup.gcm');
  if(!backupFile.startsWith(root+path.sep)||crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex')!==backup.cipherSha256)throw Error('Backup file integrity failed');
  return target;
}
async function assertPrismaIsolation(prisma,target){
  if(!target)return;
  const [actual]=await prisma.$queryRawUnsafe('SELECT current_database() AS database,current_schema() AS schema');
  if(actual.database!==target.database||actual.schema!==target.schema)throw Error('Actual Prisma database/schema differs from approved development target');
  const [foreign]=await prisma.$queryRawUnsafe("SELECT count(*)::int AS count FROM pg_constraint c JOIN pg_namespace own ON own.oid=c.connamespace JOIN pg_class ref ON ref.oid=c.confrelid JOIN pg_namespace other ON other.oid=ref.relnamespace WHERE own.nspname=$1 AND c.contype='f' AND other.nspname<>$1",target.schema);
  if(foreign.count!==0)throw Error('Fixture foreign keys escape the isolated schema');
}
function assertServerAttestation(target,appUrl){
  if(!target)return;
  const file=path.resolve(process.env.BBE_SERVER_ATTESTATION||'');
  const root=path.resolve('scratch/development-integration');
  if(!file.startsWith(root+path.sep))throw Error('Dedicated server attestation required');
  const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
  if(receipt.schema!==target.schema||receipt.database!==target.database||receipt.connectionFingerprint!==target.fingerprint||receipt.origin!==appUrl.origin||receipt.nonce!==process.env.BBE_SERVER_NONCE||Date.now()-Date.parse(receipt.createdAt)>3600000)throw Error('Server target attestation mismatch');
  process.kill(receipt.pid,0);
}
module.exports={validateDevelopmentDescriptor,loadDevelopmentTarget,assertPrismaIsolation,assertServerAttestation,metadata};
