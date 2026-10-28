import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.dirname(ROOT);
export const RESULTS = path.join(REPO,'artifacts','load-tests','results');
export const REPORTS = path.join(REPO,'artifacts','load-tests','reports');
fs.mkdirSync(RESULTS,{recursive:true});
fs.mkdirSync(REPORTS,{recursive:true});
export const SANDBOX = path.join(ROOT,'.sandbox');
export function localDatabase(value) {
  if (!value) throw new Error('Set LOAD_DATABASE_URL to a dedicated local test DB (root .env is never used)');
  let u;try{u=new URL(value);}catch{throw new Error('Invalid local database URL; credentials suppressed');}
  if (!['postgres:','postgresql:'].includes(u.protocol) || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) ||
      !/^\/bbe_loadtest(?:_[a-z0-9]+)?$/.test(u.pathname) || !u.port || u.searchParams.has('host'))
    throw new Error('Only loopback dedicated bbe_loadtest databases allowed; remote Supabase disabled');
  // Reject URI parameters which could override network routing or SSL files.
  for (const k of u.searchParams.keys()) if (!['schema','connection_limit','pool_timeout','connect_timeout'].includes(k)) throw new Error('Unsupported database parameter');
  if (u.searchParams.has('schema') && u.searchParams.get('schema') !== 'public') throw new Error('Use a separate DB, public schema');
  u.searchParams.set('connection_limit','10'); u.searchParams.set('pool_timeout','5'); u.searchParams.set('connect_timeout','5');
  return u.href;
}
export function safeEnv(db) {
  const env = {};
  for (const k of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','ComSpec','PATHEXT','LOCALAPPDATA','APPDATA','USERPROFILE'])
    if (process.env[k]) env[k] = process.env[k];
  return Object.assign(env,{
    NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--max-old-space-size=2048',
    DATABASE_URL:db,DIRECT_URL:db,
    JWT_ACCESS_SECRET:'LOCAL-ONLY-'+crypto.randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET:'LOCAL-ONLY-'+crypto.randomBytes(32).toString('hex'),
    TOKEN_HASH_PEPPER:crypto.randomBytes(32).toString('hex'),
    R2_ENDPOINT:'http://127.0.0.1:1',R2_ACCESS_KEY_ID:'disabled',R2_SECRET_ACCESS_KEY:'disabled',R2_BUCKET_NAME:'disabled',
    AWS_EC2_METADATA_DISABLED:'true',NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3100',
  });
}
export function id() { return new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomBytes(4).toString('hex'); }
export function save(file,data) { fs.writeFileSync(file,JSON.stringify(data,null,2),{flag:'wx'}); }
export function freeGiB() { return os.freemem()/2**30; }
export async function command(exe,args,opts={}) {
  return new Promise((resolve,reject)=>{
    const p=spawn(exe,args,{cwd:ROOT,stdio:'inherit',...opts});
    p.once('error',reject); p.once('exit',(code,signal)=>resolve({code,signal}));
  });
}
export function fixture(name='users.private.json') {
  if(!/^[a-zA-Z0-9_-]+\.private\.json$/.test(name))throw new Error('Invalid fixture name');
  return JSON.parse(fs.readFileSync(path.join(ROOT,'fixtures',name),'utf8'));
}
export function assertFixture(db,f,minimum=1000) {
  if(f.offlineOnly)throw new Error('Offline validation fixtures cannot be used for load');
  if (f.databaseFingerprint !== crypto.createHash('sha256').update(db).digest('hex')) throw new Error('Fixture DB mismatch');
  if (!Array.isArray(f.users) || f.users.length < minimum || f.users.some(u=>!u.email.endsWith('@loadtest.invalid'))) throw new Error('Not enough synthetic learner fixtures');
}
