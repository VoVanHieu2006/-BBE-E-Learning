// Explicit opt-in for the owner's existing Supabase, never an HTTP target.
import fs from 'node:fs';
import { REPO } from './lib.mjs';
export const SUPABASE_BASELINE_MAX_VUS=10;
export function configuredSupabase() {
  let value;
  for(const file of ['.env','.env.local']) {
    if(!fs.existsSync(REPO+'/'+file))continue;
    const line=fs.readFileSync(REPO+'/'+file,'utf8').match(/^DATABASE_URL\s*=\s*(.*)$/m);
    if(line)value=line[1].trim().replace(/^['"]|['"]$/g,'');
  }
  if(!value)throw new Error('Configured DATABASE_URL missing; no remote fallback');
  let u;try{u=new URL(value);}catch{throw new Error('Invalid configured Supabase URL; credentials suppressed');}
  if(!['postgres:','postgresql:'].includes(u.protocol) ||
    !(/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(u.hostname) || /^[a-z0-9.-]+\.supabase\.co$/.test(u.hostname)) ||
    !['5432','6543'].includes(u.port) || !u.username || !u.password || u.pathname!=='/postgres')
    throw new Error('Configured DB is not the expected Supabase endpoint');
  for(const key of u.searchParams.keys())if(!['pgbouncer','connection_limit','pool_timeout','connect_timeout','sslmode','schema'].includes(key))
    throw new Error('Unexpected DB routing parameter');
  if(u.searchParams.has('schema') && u.searchParams.get('schema')!=='public')throw new Error('Unexpected DB schema');
  u.searchParams.set('connection_limit','3');u.searchParams.set('pool_timeout','5');u.searchParams.set('connect_timeout','10');
  return u.href;
}
