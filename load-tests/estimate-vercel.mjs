import fs from 'node:fs';
import path from 'node:path';
import {ROOT,save,id,RESULTS,REPORTS} from './lib.mjs';
const names=process.argv.slice(2);
if(!names.length||names.some(n=>!/^[a-zA-Z0-9_-]+$/.test(n)))throw new Error('Pass completed run IDs with request CPU profiles');
const all={},sourceRuns=[];
for(const name of names){
  const dir=path.join(RESULTS,name),meta=JSON.parse(fs.readFileSync(dir+'/metadata.json','utf8'));
  if(meta.vusConfigured!==1||!meta.requestCpuProfiling||meta.k6Exit!==0)throw new Error('Only successful 1-VU profiling runs can calibrate this model');
  const rows=fs.readFileSync(dir+'/request-cpu.jsonl','utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
  const groups={};
  for(const r of rows)if(r.completed&&!r.overlappingRequests&&r.status>=200&&r.status<300&&r.endpoint!=='login_page')(groups[r.endpoint]||=[]).push(r);
  for(const [endpoint,values]of Object.entries(groups)){
    // The second submit is an intentional idempotency retry, not normal demand.
    // First video PLAY includes the initial progression gate; prefer steady beats.
    const selected=endpoint==='submit_quiz'?values.slice(0,1):endpoint==='heartbeat'&&values.length>1?values.slice(1):values;
    (all[endpoint]||=[]).push(...selected);
  }
  sourceRuns.push({runId:name,mode:meta.mode,diagnosticOnly:meta.diagnosticOnly,thresholds:meta.thresholdAssumptions});
}
const mean=(a,k)=>a.reduce((n,r)=>n+r[k],0)/a.length;
const measured={};
for(const [endpoint,rows]of Object.entries(all))measured[endpoint]={samples:rows.length,cpuMeanMs:mean(rows,'cpuTotalMs'),cpuMinMs:Math.min(...rows.map(r=>r.cpuTotalMs)),cpuMaxMs:Math.max(...rows.map(r=>r.cpuTotalMs)),wallMeanMs:mean(rows,'wallMs'),sqlMeanCount:mean(rows,'sqlQueryCount')};
const rateFor=n=>({member_courses:n*.25/45,streak:n*.25/45,stars:n*.25/45,courses:n*.25/45,deadlines:n*.25/45,course:n*.25/45,heartbeat:n*.4/10,start_quiz:n*.2/180,submit_quiz:n*.2/180,leaderboard:n*.15/45});
const required=Object.keys(rateFor(1000)),missing=required.filter(k=>!measured[k]);
const scenarios=[100,300,500,750,1000].map(n=>{
  const rates=rateFor(n),rps=Object.values(rates).reduce((a,b)=>a+b,0);
  const cost=key=>required.filter(k=>measured[k]).reduce((sum,k)=>sum+rates[k]*measured[k][key],0);
  const cores=missing.length?null:cost('cpuMeanMs')/1000;
  return {learnersAssumed:n,apiRpsAssumed:rps,apiRequests15Minutes:rps*900,apiRequestsOneHour:rps*3600,
    localCpuEquivalentCores:cores,sqlPerSecondNaiveLinear:missing.length?null:cost('sqlMeanCount'),
    pendingHttpIfLocalLatencyUnchanged:missing.length?null:cost('wallMeanMs')/1000,
    hobbyInvocationBudgetHoursAtThisRate:1000000/rps/3600,
    cpuSensitivity:cores===null?[]:[0.5,1,2].map(factor=>({uncalibratedHardwareFactor:factor,projectedCpuCores:cores*factor,hobbyFourCpuHoursBudgetWallHours:4/(cores*factor)})),
  };
});
const model={createdAt:new Date().toISOString(),kind:'CONDITIONAL_MODEL_NOT_A_1000_VU_TEST',sourceRuns,measured,missingEndpoints:missing,scenarios,
  assumptions:{dashboardRequests:6,dashboardCycleSeconds:45,videoHeartbeatSeconds:10,quizSessionSeconds:180,quizQuestionCountMeasured:6,quizRequestsPerSession:2,leaderboardCycleSeconds:45,allApiRequestsReachFunctions:true,loginRefreshStartupMediaExcluded:true,cacheBehaviorHeldAsSampled:true,backendPoolLimit:3},
  caveats:['Local Windows CPU is not Vercel billable CPU; 0.5/1/2 factors are sensitivity assumptions, not a confidence interval.','CPU counters showed quantization around 15-16ms; zero samples are below resolution, not free execution.','Cold/warm caches, concurrent scheduling and DB pool behavior will change; SQL/request extrapolation is not measured DB throughput.','Latency was measured from Vietnam to Supabase us-west-1; Vercel sfo1 is only source configuration, not verified deployed placement/RTT.','No maximum supported users or SLA claim can be derived from this model.'],
};
const base=scenarios.at(-1),perUserCpuSecondsPerSecond=base.localCpuEquivalentCores===null?null:base.localCpuEquivalentCores/1000;
model.perLearner={basis:'Weighted average of the assumed 25/40/20/15 workload, extrapolated from endpoint profiles; not a measured one-hour user session',apiRequestsPerHour:base.apiRequestsOneHour/1000,cpuSecondsPerHour:perUserCpuSecondsPerSecond===null?null:perUserCpuSecondsPerSecond*3600,
  cpuMillisecondsPerWallSecond:perUserCpuSecondsPerSecond===null?null:perUserCpuSecondsPerSecond*1000};
model.capacityDivision={assumption:'Vercel CPU execution cost equals measured local CPU; ignores DB, RAM, scaling distribution and SLA constraints',learnersPerOneCpuAt100Percent:perUserCpuSecondsPerSecond?1/perUserCpuSecondsPerSecond:null,learnersPerOneCpuAt70Percent:perUserCpuSecondsPerSecond?0.7/perUserCpuSecondsPerSecond:null,
  equivalentOneCpuInstancesFor1000At70Percent:base.localCpuEquivalentCores===null?null:Math.ceil(base.localCpuEquivalentCores/.7),learnerHoursFromFourCpuHours:perUserCpuSecondsPerSecond?14400/(perUserCpuSecondsPerSecond*3600):null,learnerHoursFromOneMillionInvocations:1000000/model.perLearner.apiRequestsPerHour};
const out=REPORTS+'/VERCEL_ESTIMATE.json';
if(fs.existsSync(out))fs.copyFileSync(out,REPORTS+'/VERCEL_ESTIMATE_'+id()+'.json',fs.constants.COPYFILE_EXCL);
fs.writeFileSync(out,JSON.stringify(model,null,2));
const f=(v,d=2)=>v===null?'N/A':Number(v).toFixed(d);
const lines=['# Ước lượng có điều kiện cho Vercel Hobby','','**Không phải kết quả chạy 1.000 VU trên Vercel hoặc Supabase.** Các hàng số người bên dưới là đầu vào giả định, không phải quy mô đã kiểm thử.','',
'Mô hình: 25% dashboard/khóa học (6 GET mỗi 45s), 40% video (heartbeat 10s), 20% quiz (một phiên 180s với mở+nộp), 15% bảng xếp hạng (45s/lượt). Không tính đăng nhập/refresh, request khởi tạo, media hay burst. Nhóm quiz là các phiên được thay thế liên tục để giữ tỷ lệ; khác closed cohort k6 sau khi nộp bài.','',
'## Một người tốn bao nhiêu và lấy Vercel chia ra thế nào?','',
`Trung bình theo cơ cấu trên: **${f(model.perLearner.apiRequestsPerHour,0)} API request/giờ-người**, **${f(model.perLearner.cpuSecondsPerHour)} giây CPU/giờ-người**, tương đương **${f(model.perLearner.cpuMillisecondsPerWallSecond,3)} ms CPU mỗi giây một người đang hoạt động**. Đây là phép ngoại suy từ endpoint, chưa đo một phiên người dùng đủ một giờ.`,
'',`Giả sử chi phí CPU trên Vercel bằng máy đo: 1 vCPU cung cấp 1.000ms CPU/giây. Chia 1.000/${f(model.perLearner.cpuMillisecondsPerWallSecond,3)} ≈ **${f(model.capacityDivision.learnersPerOneCpuAt100Percent,0)} người/instance ở 100% CPU**; để CPU tối đa 70%: 700/${f(model.perLearner.cpuMillisecondsPerWallSecond,3)} ≈ **${f(model.capacityDivision.learnersPerOneCpuAt70Percent,0)} người/instance**. Đây chỉ là giới hạn CPU lý thuyết theo giả định, không chứng minh p95, RAM hoặc DB đáp ứng.`,
'',`Hobby Fluid Compute có cấu hình function 1 vCPU/2 GB và có thể mở rộng nhiều instance. Vì vậy ${f(model.capacityDivision.learnersPerOneCpuAt100Percent,0)} người không phải trần toàn deployment. 1.000 người tương đương khoảng **${model.capacityDivision.equivalentOneCpuInstancesFor1000At70Percent} đơn vị 1 vCPU** ở mức dùng CPU 70%, chưa tính phân bố các route/instance và hiệu quả autoscale. [Vercel Functions limits](https://vercel.com/docs/functions/limitations).`,
'',`Ngân sách Hobby 4 CPU-giờ = 14.400 giây CPU: 14.400/${f(model.perLearner.cpuSecondsPerHour)} ≈ **${f(model.capacityDivision.learnerHoursFromFourCpuHours,0)} giờ-người** trong kỳ quota. Ngân sách invocation: 1.000.000/${f(model.perLearner.apiRequestsPerHour,0)} ≈ **${f(model.capacityDivision.learnerHoursFromOneMillionInvocations,0)} giờ-người**. Theo mô hình điểm này, CPU hết ngân sách trước invocation; chưa tính tài nguyên khác và mức sử dụng sẵn có. Giờ-người là tổng thời lượng dùng, không phải số người đồng thời. [Vercel Hobby](https://vercel.com/docs/plans/hobby).`,
'','| Phiên giả định | CPU-giờ theo CPU local | API requests |','|---|---:|---:|',
...[[100,15],[500,15],[1000,15],[1000,60]].map(([people,minutes])=>`| ${people} người × ${minutes} phút | ${f(people*minutes/60*model.perLearner.cpuSecondsPerHour/3600)} | ${f(people*minutes/60*model.perLearner.apiRequestsPerHour,0)} |`),
'','1.000 người ×1 giờ tương ứng khoảng 5,25 CPU-giờ theo mô hình, vượt ngân sách CPU 4 giờ nếu quy đổi phần cứng đúng; không có nghĩa ứng dụng đã bị đo là không chịu được 1.000 người. RAM không thể tính bằng 2GB chia working set của cả Node process: cần đo phần RAM tăng thêm dưới concurrency. CPU chờ DB không được tính toàn bộ như Active CPU. [Cách tính Fluid Compute](https://vercel.com/docs/functions/usage-and-pricing).','',
'## Đầu vào đo thực ở 1 VU','', '| Endpoint | Mẫu | CPU TB local (ms) | Wall TB local (ms) | SQL/request TB |','|---|---:|---:|---:|---:|'];
for(const [endpoint,r]of Object.entries(measured))lines.push(`| ${endpoint} | ${r.samples} | ${f(r.cpuMeanMs)} | ${f(r.wallMeanMs)} | ${f(r.sqlMeanCount)} |`);
lines.push('','CPU là process CPU theo thời gian request không chồng lấp, có cả overhead profiler/SQL logging, cold code và GC. Counter trên Windows có lượng tử khoảng 15–16ms; giá trị 0 không có nghĩa không tốn CPU. Số mẫu ít, không dùng làm confidence interval. Submit chỉ lấy lần đầu; heartbeat bỏ PLAY đầu khi có mẫu tiếp theo.','',
'## Tải và quota theo mô hình','', '| Người giả định | API RPS giả định | Request/15 phút | CPU tương đương máy local (core) | SQL/s ngoại suy thô | HTTP pending nếu latency local giữ nguyên |','|---|---:|---:|---:|---:|---:|');
for(const s of scenarios)lines.push(`| ${s.learnersAssumed} | ${f(s.apiRpsAssumed)} | ${f(s.apiRequests15Minutes,0)} | ${f(s.localCpuEquivalentCores)} | ${f(s.sqlPerSecondNaiveLinear,0)} | ${f(s.pendingHttpIfLocalLatencyUnchanged,0)} |`);
lines.push('','Profile quiz là bài 6 câu; không tự áp chi phí này cho bài dài hơn. Video completion mới chưa được đo; không lấy lịch sử seed làm bằng chứng đã xem đủ video.');
if(missing.length)lines.push('','**Chưa đủ đầu vào CPU/SQL:** '+missing.join(', ')+'. Không điền số 0 cho phần thiếu.');
const thousand=scenarios.at(-1);
lines.push('','Request rate = tổng số người của từng nhóm × số request / thời gian chu kỳ. CPU demand = Σ(RPS endpoint × CPU giây/request). HTTP pending = Σ(RPS × wall giây), chỉ đúng như yêu cầu cân bằng nếu throughput đó được duy trì; **không phải DB connections**. Không có quy tắc lấy 30.000 concurrency chia cho một hằng số để ra số người học.','',
`Ở 1.000 người theo giả định này: khoảng ${f(thousand.apiRpsAssumed)} API request/s, ${f(thousand.apiRequests15Minutes,0)} request/15 phút, chưa cộng auth/khởi tạo. Nếu tất cả đều được tính function invocation và không có sử dụng khác, quota 1 triệu invocation tương ứng khoảng ${f(thousand.hobbyInvocationBudgetHoursAtThisRate)} giờ hoạt động liên tục ở mức này. Đây là **ước lượng quota**, không phải thời gian hệ thống chắc chắn chịu được tải.`,
'','Hobby hiện liệt kê 1 triệu Function Invocations, 4 CPU-hours Active CPU và 360 GB-hours Provisioned Memory trong included usage. Không phải quota còn lại của tài khoản. [Nguồn Vercel Hobby](https://vercel.com/docs/plans/hobby).',
'','## Độ nhạy CPU — chưa hiệu chuẩn phần cứng','', '| Hệ số giả định so với CPU local | CPU cần ở 1.000 người (core) | Thời gian dùng hết ngân sách 4 CPU-giờ nếu duy trì tải (giờ) |','|---|---:|---:|');
for(const s of thousand.cpuSensitivity)lines.push(`| ${s.uncalibratedHardwareFactor}× | ${f(s.projectedCpuCores)} | ${f(s.hobbyFourCpuHoursBudgetWallHours)} |`);
lines.push('','Các hệ số 0,5×–2× chỉ là phép thử độ nhạy, **không phải khoảng dự báo đã xác minh**. Đặc tính CPU máy bạn khác CPU cloud, sample còn ít và profiler có overhead. Nhiều instance có thể tự mở rộng; 1 vCPU/instance không phải 1 vCPU cho cả deployment. Không lấy working set local nhân theo VU để suy ra Provisioned Memory: Fluid Compute có thể chia sẻ instance giữa nhiều request. [Giới hạn Functions](https://vercel.com/docs/functions/limitations), [Fluid Compute pricing](https://vercel.com/docs/functions/usage-and-pricing).','',
'## Khác biệt mạng và DB','',
'Đã đo SELECT 1 khoảng 170–172ms từ máy tới Supabase us-west-1; hai EXPLAIN đơn giản có execution time 0,043–0,057ms tại server. Đây chỉ chứng minh các truy vấn đơn giản đó chủ yếu chờ ngoài execution SQL, không chứng minh mọi truy vấn đều nhẹ. Source cấu hình Vercel sfo1; cần đo RTT thật từ deployment trước khi hiệu chỉnh latency. Không lấy p95 local làm p95 Vercel.','',
'Ví dụ độ nhạy thuần mạng: với Q SQL/request và tối đa 3 connection, phần thời gian round-trip tối thiểu lý tưởng khoảng Q×RTT/3 và tuần tự khoảng Q×RTT, chưa tính execution/queue/transaction/CPU. Nếu *giả định* RTT cùng vùng 5ms thì dùng 5ms trong công thức; **5ms chưa được đo** và kết quả không phải latency toàn API.','',
'SQL/s ở bảng là ngoại suy tuyến tính từ sample, chưa áp cache hit/stampede hoặc queueing. Leaderboard/cache toàn hệ thống có thể giảm SQL dưới nhiều người cùng đọc; user khác nhau và cold instance có thể tăng áp lực. Chưa đo DB CPU, giới hạn pooler thực hoặc saturation, nên không kết luận Supabase Free phục vụ được con số SQL/s này.','',
'## Kết luận','',
'Có thể định lượng nhu cầu request, CPU giả định và quota cho mục tiêu 1.000 người. **Chưa thể xác nhận sức chịu tải hoặc số người tối đa của deployment.** Cần giảm round-trip trên đường heartbeat/quiz, hiệu chỉnh bằng Usage/latency thật và đo concurrency trong môi trường được phép trước khi cam kết.','',
'Nguồn các profile: '+sourceRuns.map(r=>`[${r.runId}](../results/${r.runId}/request-cpu.jsonl)`).join(', ')+'.');
fs.writeFileSync(REPORTS+'/VERCEL_ESTIMATE.md',lines.join('\n'));
console.log(JSON.stringify({modelFile:out,missingEndpoints:missing,scenario1000:thousand},null,2));
