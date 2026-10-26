// Static route inventory. Models are conservative source references, not SQL traces.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT,REPO } from './lib.mjs';
const slash=p=>p.replaceAll('\\','/');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=walk(path.join(REPO,'src')).filter(f=>/\.(tsx?|jsx?)$/.test(f));
const source=new Map(files.map(f=>[slash(f),fs.readFileSync(f,'utf8')]));
function deps(f){
  const s=source.get(f)||'', found=[];
  for(const m of s.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)) {
    const p=m[2].startsWith('@/')?path.join(REPO,'src',m[2].slice(2)):m[2].startsWith('.')?path.resolve(path.dirname(f),m[2]):null;
    if(p)for(const ext of ['.ts','.tsx','/index.ts'])if(source.has(slash(p+ext))){found.push(slash(p+ext));break;}
  }
  return found;
}
function models(root){const seen=new Set(),result=new Set(),queue=[root];while(queue.length){const f=queue.pop();if(seen.has(f))continue;seen.add(f);for(const m of (source.get(f)||'').matchAll(/\b(?:prisma|tx|db)\.([a-zA-Z]+)\.(?:find|create|update|upsert|count|aggregate|groupBy|delete)/g))result.add(m[1]);queue.push(...deps(f));}return [...result].sort();}
const lines=['# API inventory from current source','','Generated '+new Date().toISOString()+'. Methods extracted from exported handlers. Auth column applies to the route file; optional/public GETs require reading the handler. Model list is conservative transitive source reference, not measured query count. Frequency is documented for learner flows in ARCHITECTURE.md; admin/internal endpoints are excluded from load.','','| Endpoint | Methods | Auth reference in route | Model references through imports | Source |','|---|---|---|---|---|'];
for(const [f,s]of source)if(f.includes('/src/app/api/')&&f.endsWith('/route.ts')){
  const methods=[...s.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map(m=>m[1]);
  const endpoint=f.slice(f.indexOf('/src/app/')+8).replace(/\/route\.ts$/,'');
  lines.push(`| ${endpoint} | ${methods.join(', ')} | ${s.includes('authenticate(')?'authenticate (Bearer/cookie)':/CRON_SECRET|INTERNAL|Bearer/.test(s)?'internal/manual guard; inspect source':'no authenticate call; inspect source'} | ${models(f).join(', ')} | ${slash(path.relative(REPO,f))} |`);
}
const actions=[...source].filter(([,s])=>/['"]use server['"]/.test(s)).map(([f])=>slash(path.relative(REPO,f)));
lines.push('','Server action directive matches: '+(actions.join(', ')||'none found')+'.');
fs.mkdirSync(ROOT+'/reports',{recursive:true});
fs.writeFileSync(ROOT+'/reports/API_INVENTORY.md',lines.join('\n'));
console.log('Inventory written: '+(lines.filter(x=>x.startsWith('| /api/')).length)+' route files');
