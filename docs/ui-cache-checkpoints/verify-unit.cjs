const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const files=['tab-query-cache','pilot-api-client','transition-draft','business-rules','learning-cycles','phase3-leaderboard-oracle','shared-learning-path','video-playback-guard','video-progress-session','video-fullscreen-controls','video-switching-leak','video-controls-youtube-ux','video-player-ui','video-continuity-security'];
const results=[];
let log='';
// This runner deliberately excludes integration suites. Defense in depth: even an
// unexpected transitive Prisma import cannot connect to an application database.
const isolated='postgresql://bbe_unit:bbe_unit@127.0.0.1:1/bbe_test_ui_cache_unit';
const childEnv={...process.env,DATABASE_URL:isolated,DIRECT_URL:isolated,TEST_DATABASE_URL:isolated,ORGANIZATION_TEST_DATABASE_URL:isolated,NODE_ENV:'test'};
for(const name of files){
  const file=`src/test/${name}.test.ts`;
  const run=spawnSync(process.execPath,[require.resolve('ts-node/dist/bin.js'),'-P','tsconfig.test.json',file],{encoding:'utf8',windowsHide:true,env:childEnv});
  const output=(run.stdout||'')+(run.stderr||'');
  const result={file,status:run.status===0?'PASS':'FAIL',tests:Number(output.match(/tests (\d+)/)?.[1]||0),pass:Number(output.match(/pass (\d+)/)?.[1]||0),fail:Number(output.match(/fail (\d+)/)?.[1]||0)};
  if(run.error)result.error=run.error.message;
  results.push(result);log+=`\n${file}\n${output}`;
  console.log(JSON.stringify(result));
}
fs.writeFileSync(path.join(__dirname,'unit-verification.txt'),log);
fs.writeFileSync(path.join(__dirname,'unit-verification.json'),JSON.stringify(results,null,2)+'\n');
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
