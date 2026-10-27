const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {spawnSync}=require('node:child_process');
try{
  const root=path.resolve('scratch/development-integration'),receiptFile=path.join(root,'backup-receipt.json');
  const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  const dir=path.resolve(receipt.directory);
  if(!dir.startsWith(root+path.sep))throw Error('Invalid backup location');
  const blob=fs.readFileSync(path.join(dir,'public-backup.gcm'));
  if(blob.subarray(0,8).toString()!=='BBE-GCM1'||crypto.createHash('sha256').update(blob).digest('hex')!==receipt.cipherSha256)throw Error('Invalid backup integrity');
  const unprotect='$v=[Console]::In.ReadToEnd().Trim(); Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String($v); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p))';
  const restored=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',unprotect],{input:fs.readFileSync(path.join(dir,'key.dpapi')).toString('base64'),encoding:'utf8',windowsHide:true});
  if(restored.status!==0)throw Error('DPAPI restore failed');
  const key=Buffer.from(restored.stdout.trim(),'base64');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,blob.subarray(8,20));decipher.setAuthTag(blob.subarray(20,36));
  const plain=zlib.gunzipSync(Buffer.concat([decipher.update(blob.subarray(36)),decipher.final()]));key.fill(0);
  if(crypto.createHash('sha256').update(plain).digest('hex')!==receipt.plaintextSha256)throw Error('Restored checksum mismatch');
  const snapshot=JSON.parse(plain);
  if(snapshot.data.length!==receipt.tables.length||snapshot.data.reduce((n,t)=>n+t.rows.length,0)!==receipt.rows)throw Error('Restored row count mismatch');
  receipt.dpapiRestoreVerified=true;receipt.restoreVerifiedAt=new Date().toISOString();fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:'PASS',dpapiRestoreVerified:true,tables:receipt.tables.length,rows:receipt.rows,credentialsLogged:false,databaseWrites:0}));
}catch(error){console.error(JSON.stringify({status:'FAIL',message:'Encrypted backup restore verification failed; no secret data logged.'}));process.exitCode=1;}
