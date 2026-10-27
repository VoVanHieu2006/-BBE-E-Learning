// Registered, complete SQL plan -> exact-plan apply. Fresh fixture schemas only.
// Never modifies public/auth/storage and never drops any schema.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {targetMetadata,createVerifiedClient}=require('./development-db-inspect.cjs');
const root=path.resolve('scratch/development-integration');
const quote=s=>'"'+s.replaceAll('"','""')+'"';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function approvedConnection(){
  const app=targetMetadata(process.env.DATABASE_URL),selectedRaw=process.env.DIRECT_URL||process.env.DATABASE_URL,selected=targetMetadata(selectedRaw);
  const inspection=JSON.parse(fs.readFileSync(path.join(root,'target-inspection.json'),'utf8'));
  const backup=JSON.parse(fs.readFileSync(path.join(root,'backup-receipt.json'),'utf8'));
  if(app.fingerprint!==inspection.target.fingerprint||selected.projectRef!==app.projectRef||selected.database!==app.database||![inspection.target.fingerprint,inspection.directTarget?.fingerprint].includes(selected.fingerprint))throw Error('Write connection differs from inspected project/database');
  if(backup.targetFingerprint!==app.fingerprint||!backup.roundTripVerified||!backup.dpapiRestoreVerified||!Number.isFinite(Date.parse(backup.createdAt))||Date.now()-Date.parse(backup.createdAt)>4*3600000)throw Error('Fresh recoverable backup required');
  const backupFile=path.resolve(backup.directory,'public-backup.gcm');
  if(!backupFile.startsWith(root+path.sep)||hash(fs.readFileSync(backupFile))!==backup.cipherSha256)throw Error('Backup integrity failed');
  const client=createVerifiedClient(selectedRaw);await client.connect();
  const identity=(await client.query('SELECT current_database() AS database')).rows[0];
  if(identity.database!==app.database){await client.end();throw Error('Actual database differs from inspected database');}
  return {app,selected,backup,client};
}
async function applyPlan(suite,file){
  const manifest=path.resolve(file||'');
  if(!manifest.startsWith(root+path.sep)||!manifest.endsWith('.json'))throw Error('Explicit registered plan manifest required');
  const receipt=JSON.parse(fs.readFileSync(manifest,'utf8'));
  if(receipt.status!=='PLAN_ONLY'||receipt.suite!==suite||!new RegExp(`^bbe_ui_it_${suite}_[0-9a-f]{8}$`).test(receipt.schema))throw Error('Fresh registered plan required');
  const sql=fs.readFileSync(path.join(root,`${receipt.schema}-plan.sql`),'utf8');
  if(hash(sql)!==receipt.sqlSha256)throw Error('Reviewed SQL plan changed');
  const {app,selected,backup,client}=await approvedConnection();
  try{
    if(process.env.BBE_APPROVED_SUPABASE_PROJECT!==app.projectRef||receipt.projectRef!==app.projectRef||receipt.database!==app.database||receipt.connectionFingerprint!==selected.fingerprint||receipt.backupSha256!==backup.cipherSha256)throw Error('Explicit approved project/plan/backup mismatch');
    // The complete reviewed plan contains BEGIN, bounded timeouts, all DDL,
    // isolation validation and COMMIT. No extra DDL is synthesized during apply.
    try{await client.query(sql);receipt.status='READY';receipt.foreignKeysOutsideSchema=0;receipt.completedAt=new Date().toISOString();}
    catch(error){await client.query('ROLLBACK');receipt.status='ROLLED_BACK';receipt.errorCode=error.code||'DDL_FAILED';receipt.errorPosition=error.position||null;receipt.errorMessage=String(error.message||'').replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]').slice(0,200);throw error;}
    finally{fs.writeFileSync(manifest,JSON.stringify(receipt,null,2)+'\n');}
    console.log(JSON.stringify({status:receipt.status,suite,schema:receipt.schema,projectRef:app.projectRef,database:app.database,tables:receipt.tables.length,publicWrites:0,systemSchemaWrites:0}));
  }finally{await client.end();}
}
async function generatePlan(suite){
  const {app,selected,backup,client}=await approvedConnection();
  try{
    let ddl=fs.readFileSync(path.join(root,'empty-schema.sql'),'utf8').replace(/^\uFEFF/,'');
    if(!ddl.includes('CREATE SCHEMA IF NOT EXISTS "public";')||/\b(DROP|TRUNCATE|DELETE FROM|INSERT INTO|UPDATE)\b/.test(ddl.replace(/ON (?:DELETE|UPDATE) (?:CASCADE|RESTRICT|SET NULL|NO ACTION)/g,'')))throw Error('Unexpected base DDL operations');
    ddl=ddl.replace('CREATE SCHEMA IF NOT EXISTS "public";','');
    const schema=`bbe_ui_it_${suite}_${crypto.randomBytes(4).toString('hex')}`;
    const tables=Array.from(ddl.matchAll(/CREATE TABLE "([^"]+)"/g),m=>m[1]);
    const enums=Array.from(ddl.matchAll(/CREATE TYPE "([^"]+)"/g),m=>m[1]);
    const baseConstraints=new Set(Array.from(ddl.matchAll(/CONSTRAINT "([^"]+)"/g),m=>m[1]));
    const baseIndexes=new Set(Array.from(ddl.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g),m=>m[1]));
    await client.query('BEGIN READ ONLY');await client.query('SET LOCAL search_path=pg_catalog');
    const functions=(await client.query("SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e') ORDER BY p.proname,p.oid")).rows;
    const triggers=(await client.query("SELECT t.tgname AS name,c.relname AS table,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname")).rows.filter(r=>tables.includes(r.table));
    const indexes=(await client.query("SELECT indexname AS name,tablename AS table,indexdef AS definition FROM pg_indexes WHERE schemaname='public' ORDER BY indexname")).rows.filter(r=>tables.includes(r.table));
    const constraints=(await client.query("SELECT c.conname AS name,r.relname AS table,c.contype AS type,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' ORDER BY r.relname,c.conname")).rows.filter(r=>tables.includes(r.table));
    const rls=(await client.query("SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND (c.relrowsecurity OR c.relforcerowsecurity)")).rows.filter(r=>tables.includes(r.table));
    await client.query('ROLLBACK');
    if(rls.length)throw Error('RLS definitions require additional review');
    const names=new Set([...tables,...enums,...functions.map(f=>f.name)]);
    const remap=sql=>sql.replace(/\bpublic\.(?:"([^"]+)"|([a-zA-Z_][a-zA-Z_0-9]*))/g,(match,a,b)=>names.has(a||b)?`${quote(schema)}.${quote(a||b)}`:match);
    const functionSql=functions.map(f=>{
      if(/\b(?:auth|storage)\./i.test(f.definition))throw Error('System-schema function dependency requires review');
      return remap(f.definition)+`;\nALTER FUNCTION ${quote(schema)}.${quote(f.name)}(${remap(f.arguments)}) SET search_path TO ${quote(schema)},pg_catalog;`;
    }).join('\n');
    // Constraint triggers are installed from pg_get_triggerdef below. Their
    // pg_constraint rows render as TRIGGER, not legal ADD CONSTRAINT clauses.
    const extraConstraints=constraints.filter(c=>['c','f','p','u','x'].includes(c.type)&&!baseConstraints.has(c.name)&&!baseIndexes.has(c.name));
    const extraNames=new Set(extraConstraints.map(c=>c.name));
    const constraintSql=extraConstraints.map(c=>`ALTER TABLE ${quote(schema)}.${quote(c.table)} ADD CONSTRAINT ${quote(c.name)} ${remap(c.definition)};`).join('\n');
    const extraIndexes=indexes.filter(i=>!baseIndexes.has(i.name)&&!baseConstraints.has(i.name)&&!extraNames.has(i.name));
    const indexSql=extraIndexes.map(i=>remap(i.definition)+';').join('\n');
    const triggerSql=triggers.map(t=>remap(t.definition)+';').join('\n');
    const validation=`DO $fixture_guard$ BEGIN
      IF current_database()<>${"'"+app.database.replaceAll("'","''")+"'"} OR current_schema()<>${"'"+schema+"'"} THEN RAISE EXCEPTION 'FixtureTargetMismatch'; END IF;
      IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_namespace own ON own.oid=c.connamespace JOIN pg_class ref ON ref.oid=c.confrelid JOIN pg_namespace other ON other.oid=ref.relnamespace WHERE own.nspname='${schema}' AND c.contype='f' AND other.nspname<>'${schema}') THEN RAISE EXCEPTION 'FixtureForeignKeyEscape'; END IF;
    END $fixture_guard$;`;
    const sql=`BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='30s';\nCREATE SCHEMA ${quote(schema)};\nSET LOCAL search_path TO ${quote(schema)},pg_catalog;\n${ddl}\n${functionSql}\n${constraintSql}\n${indexSql}\n${triggerSql}\n${validation}\nCOMMIT;\n`;
    const receipt={suite,schema,projectRef:app.projectRef,database:app.database,targetFingerprint:app.fingerprint,connectionFingerprint:selected.fingerprint,backupSha256:backup.cipherSha256,sqlSha256:hash(sql),createdAt:new Date().toISOString(),status:'PLAN_ONLY',tables,functions:functions.map(f=>f.name),triggers:triggers.map(t=>t.name),constraints:constraints.length,extraConstraints:extraConstraints.map(c=>c.name),extraIndexes:extraIndexes.map(i=>i.name),rlsTables:rls.length,cleanup:'No DROP SCHEMA; fixture namespace retained for inspection'};
    fs.writeFileSync(path.join(root,`${schema}-plan.sql`),sql);fs.writeFileSync(path.join(root,`${schema}.json`),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify({status:receipt.status,suite,schema,manifest:path.relative(process.cwd(),path.join(root,`${schema}.json`)).replaceAll('\\','/'),tables:tables.length,functions:functions.length,triggers:triggers.length,extraConstraints:extraConstraints.length,extraIndexes:extraIndexes.length,sqlSha256:receipt.sqlSha256}));
  }finally{await client.end();}
}
const suite=process.argv[2];
const operation=async()=>{if(!['leaderboard','organization','learning_flow','learning_cycles','chapter_term'].includes(suite))throw Error('Unknown reviewed suite');const apply=process.argv.indexOf('--apply');if(apply>=0)await applyPlan(suite,process.argv[apply+1]);else await generatePlan(suite);};
operation().catch(error=>{console.error(JSON.stringify({status:'FAIL',code:error.code||'ISOLATION_FAILED',message:'Isolation preparation stopped; credentials not logged.'}));process.exitCode=1;});
