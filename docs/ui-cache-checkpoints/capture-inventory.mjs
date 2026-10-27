// Read-only source inventory. No imports from the application, no environment/DB access.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function walk(directory) {
  return readdirSync(directory, { withFileTypes:true }).flatMap(entry => {
    const path=join(directory,entry.name);
    return entry.isDirectory() ? walk(path) : /\.[jt]sx?$/.test(path) ? [path] : [];
  });
}
const roots=['src/app/admin','src/app/chapter-manager','src/app/organization-manager','src/app/student','src/components'];
const files=roots.flatMap(walk).concat(['src/lib/api/client.ts']);
let output='# Request / lifecycle source inventory\n\nGenerated from HEAD cf88238 plus unchanged runtime working files, 2026-10-27.\n';
output+='This is a textual call-site inventory, not an execution trace. Includes shared components and all role pages. Guest/public pages appear in the route list below; indirect request helpers require separate review before migration.\n\n';
output+='## Route inventory\n\n';
for(const path of walk('src/app').filter(p=>/(?:^|[\\/])page\.tsx$/.test(p)).sort()) output+=`- \`${path.replaceAll('\\','/').replace(/^src\/app/,'').replace(/\/page\.tsx$/,'')||'/'}\`\n`;
output+='\n## Calls, effects and timers\n\n';
for(const file of files.sort()) {
  const lines=readFileSync(file,'utf8').split(/\r?\n/);
  const matches=lines.flatMap((line,i)=>/\b(apiFetch(?:<[^>]+>)?\(|fetch\(|useEffect\(|setInterval\(|setTimeout\(|clearApiCache\(|getCachedApiData(?:<[^>]+>)?\()/.test(line)?[{line:i+1,text:line.trim()}]:[]);
  if(!matches.length)continue;
  output+=`### ${file.replaceAll('\\','/')}\n\n`;
  for(const match of matches) output+=`- L${match.line}: \`${match.text.replaceAll('`','\\`')}\`\n`;
  output+='\n';
}
writeFileSync('docs/ui-cache-checkpoints/REQUEST_SOURCE_INVENTORY.md',output);
console.log(`Inventoried ${files.length} files; wrote route/call-site evidence.`);
