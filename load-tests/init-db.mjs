import path from 'node:path';
import { REPO,localDatabase,safeEnv,command } from './lib.mjs';
const db=localDatabase(process.env.LOAD_DATABASE_URL);
const env={...safeEnv(db),BASELINE_DATABASE_URL:db,BASELINE_CONFIRM_DATABASE:new URL(db).pathname.slice(1)};
// Use the repository's explicit empty-DB baseline. Its migration history cannot
// be replayed from zero; do not replace this with db push/reset or edit history.
let r=await command(process.execPath,[path.join(REPO,'scripts/db/baseline-empty-database.mjs')],{cwd:REPO,env});
if(r.code!==0)throw new Error('Empty DB baseline refused/failed; no migrations or seed attempted');
r=await command(process.execPath,[path.join(REPO,'node_modules/prisma/build/index.js'),'migrate','deploy'],{cwd:REPO,env});
process.exitCode=r.code??1;
