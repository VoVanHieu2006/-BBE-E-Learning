// Read-only comparison against the pre-test encrypted backup's content digest.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const {targetMetadata,createVerifiedClient}=require('./development-db-inspect.cjs');
const {snapshotPublic}=require('./development-db-backup.cjs');
async function main(){
  const root=path.resolve('scratch/development-integration');
  const before=JSON.parse(fs.readFileSync(path.join(root,'backup-receipt.json')));
  const target=targetMetadata(process.env.DATABASE_URL);
  if(target.fingerprint!==before.targetFingerprint)throw Error('Target differs from backup');
  const client=createVerifiedClient(process.env.DATABASE_URL);await client.connect();
  try{
    const after=await snapshotPublic(client);
    const digest=crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex');
    const report={checkedAt:new Date().toISOString(),projectRef:target.projectRef,database:target.database,status:digest===before.plaintextSha256?'PASS':'FAIL',scope:'All public table rows and backed-up schema metadata; read-only',publicUnchanged:digest===before.plaintextSha256,tables:after.data.length,rows:after.data.reduce((n,t)=>n+t.rows.length,0),backupSha256:before.plaintextSha256,currentSha256:digest,systemSchemas:'No test path writes auth/storage; their row contents were not read or backed up'};
    fs.writeFileSync('docs/ui-cache-checkpoints/development-public-unchanged.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
    if(report.status!=='PASS')process.exitCode=1;
  }finally{await client.end();}
}
main().catch(error=>{console.error(JSON.stringify({status:'FAIL',message:'Read-only comparison could not complete',code:error.code||'COMPARE_FAILED'}));process.exitCode=1;});
