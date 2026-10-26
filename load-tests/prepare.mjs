import fs from 'node:fs';
import path from 'node:path';
import { ROOT, REPO, SANDBOX, safeEnv, command, freeGiB, id, localDatabase } from './lib.mjs';
import { configuredSupabase } from './supabase-profile.mjs';

// Snapshot source without .env, .vercel, git metadata, existing build or credentials.
// Never delete an existing snapshot: each build has explicit provenance.
const resume=process.argv.includes('--resume-build');
if (fs.existsSync(SANDBOX) && !resume) throw new Error('Sandbox already exists; retain it for provenance or rename it before rebuilding');
if (freeGiB() < 1.5) throw new Error('Less than 1.5 GiB free; release resources before production build');
if (!resume) {
fs.mkdirSync(SANDBOX);
for (const name of ['src','public','prisma','next.config.js','package.json','package-lock.json','tsconfig.json','next-env.d.ts','tailwind.config.ts','postcss.config.js']) {
  const source=path.join(REPO,name);
  if (fs.existsSync(source)) fs.cpSync(source,path.join(SANDBOX,name),{recursive:true});
}
// Local dependency junction, no downloads and no changes to app source.
fs.symlinkSync(path.join(REPO,'node_modules'),path.join(SANDBOX,'node_modules'),'junction');
}
// Limit build workers on this shared Windows machine; runtime server stays unchanged.
const configPath=path.join(SANDBOX,'next.config.js');
const marker='// BBE_LOADTEST_BUILD_WORKERS';
if(!fs.readFileSync(configPath,'utf8').includes(marker))fs.appendFileSync(configPath,'\n'+marker+'\nmodule.exports = { ...module.exports, experimental: { ...module.exports.experimental, cpus: 2 } };\n');
const logPath=path.join(SANDBOX,`build-${id()}.log`);
const log=fs.openSync(logPath,'wx');
// Some GET routes prerender and query DB during next build. Use only the
// explicitly provisioned local DB; without it the disabled address fails closed.
const remote=process.argv.includes('--supabase-baseline');
const db=remote?configuredSupabase():process.env.LOAD_DATABASE_URL?localDatabase(process.env.LOAD_DATABASE_URL):'postgresql://disabled:disabled@127.0.0.1:1/bbe_loadtest';
const result=await command(process.execPath,[path.join(REPO,'node_modules/next/dist/bin/next'),'build'],{
  cwd:SANDBOX,env:safeEnv(db),stdio:['ignore',log,log],
});
fs.closeSync(log);
console.log(JSON.stringify({buildExit:result.code,sandbox:SANDBOX,log:logPath}));
process.exitCode=result.code ?? 1;
