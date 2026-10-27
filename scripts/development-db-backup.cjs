const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {spawnSync}=require('node:child_process');
const {targetMetadata,createVerifiedClient}=require('./development-db-inspect.cjs');
const root=path.resolve('scratch/development-integration');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
async function snapshotPublic(client){
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(row=>row.table_name);
    const data=[];
    for(const table of tables){
      const rows=(await client.query(`SELECT row_to_json(t)::text AS value FROM public.${quote(table)} t ORDER BY row_to_json(t)::text`)).rows.map(row=>row.value);
      data.push({table,rows});
    }
    const functions=(await client.query("SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e') ORDER BY p.proname,p.oid")).rows;
    const triggers=(await client.query("SELECT t.tgname AS name,c.relname AS table,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname")).rows;
    const indexes=(await client.query("SELECT indexname AS name,tablename AS table,indexdef AS definition FROM pg_indexes WHERE schemaname='public' ORDER BY indexname")).rows;
    const columns=(await client.query("SELECT table_name,column_name,data_type,udt_schema,udt_name,is_nullable,column_default,is_identity FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
    const constraints=(await client.query("SELECT c.conname AS name,r.relname AS table,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' ORDER BY r.relname,c.conname")).rows;
    const policies=(await client.query("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
    return {format:'public-rows-and-schema-metadata-v1',data,functions,triggers,indexes,columns,constraints,policies};
  }finally{await client.query('ROLLBACK');}
}
async function main(){
  const inspected=JSON.parse(fs.readFileSync(path.join(root,'target-inspection.json'),'utf8'));
  const target=targetMetadata(process.env.DATABASE_URL);
  if(inspected.target.fingerprint!==target.fingerprint||Date.now()-Date.parse(inspected.checkedAt)>3600000)throw Error('Fresh verified target required');
  const dir=path.join(root,'backup-'+new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(dir,{recursive:true});
  const principal=`${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  const acl=spawnSync('icacls.exe',[dir,'/inheritance:r','/grant:r',`${principal}:(OI)(CI)F`,'SYSTEM:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});
  if(acl.status!==0)throw Error('Cannot protect local backup directory');
  const client=createVerifiedClient(process.env.DATABASE_URL);await client.connect();
  let snapshot;
  try{snapshot=await snapshotPublic(client);}finally{await client.end();}
  const plain=Buffer.from(JSON.stringify(snapshot));
  if(plain.length>100*1024*1024)throw Error('Backup exceeds reviewed size budget');
  const compressed=zlib.gzipSync(plain),key=crypto.randomBytes(32),iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(compressed),cipher.final()]),tag=cipher.getAuthTag();
  const protect='$v=[Console]::In.ReadToEnd().Trim(); Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($v); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))';
  const sealed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',protect],{input:key.toString('base64'),encoding:'utf8',windowsHide:true});
  if(sealed.status!==0||!sealed.stdout.trim())throw Error('DPAPI key protection failed');
  const backup=Buffer.concat([Buffer.from('BBE-GCM1'),iv,tag,encrypted]);
  fs.writeFileSync(path.join(dir,'public-backup.gcm'),backup,{mode:0o600});
  fs.writeFileSync(path.join(dir,'key.dpapi'),Buffer.from(sealed.stdout.trim(),'base64'),{mode:0o600});
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);
  if(!zlib.gunzipSync(Buffer.concat([decipher.update(encrypted),decipher.final()])).equals(plain))throw Error('Backup round-trip verification failed');
  key.fill(0);
  const receipt={createdAt:new Date().toISOString(),projectRef:target.projectRef,database:target.database,targetFingerprint:target.fingerprint,scope:'public application tables only; no auth/storage data',directory:path.relative(process.cwd(),dir).replaceAll('\\','/'),cipherSha256:crypto.createHash('sha256').update(backup).digest('hex'),plaintextSha256:crypto.createHash('sha256').update(plain).digest('hex'),bytes:backup.length,rows:snapshot.data.reduce((sum,t)=>sum+t.rows.length,0),tables:snapshot.data.map(t=>({table:t.table,rows:t.rows.length})),functions:snapshot.functions.length,triggers:snapshot.triggers.length,roundTripVerified:true,encryption:'AES-256-GCM + Windows DPAPI CurrentUser wrapped key',acl:'Current user and SYSTEM only',mutations:0};
  fs.writeFileSync(path.join(root,'backup-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:'PASS',scope:receipt.scope,tables:receipt.tables.length,rows:receipt.rows,encryptedBytes:receipt.bytes,roundTripVerified:true,mutations:0}));
}
module.exports={snapshotPublic};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({status:'FAIL',code:error.code||'BACKUP_FAILED',message:'Backup did not complete; no database writes performed; credentials not logged.'}));process.exitCode=1;});
