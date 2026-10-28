import fs from 'node:fs';
import path from 'node:path';
import {ROOT,RESULTS,REPORTS} from './lib.mjs';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const f=(v,d=2)=>v===null||v===undefined?'—':Number(v).toFixed(d);
const runs=[];
for(const name of fs.readdirSync(RESULTS+'')){
  const dir=path.join(RESULTS,name);if(!fs.existsSync(dir+'/metadata.json')||!fs.existsSync(dir+'/summary.json'))continue;
  const m=read(dir+'/metadata.json');if(!m.mode||!m.base)continue;
  const s=read(dir+'/summary.json'),integrity=fs.existsSync(dir+'/integrity.json')?read(dir+'/integrity.json'):null;
  const process=[];
  if(fs.existsSync(dir+'/process.csv')){
    const lines=fs.readFileSync(dir+'/process.csv','utf8').trim().split(/\r?\n/),parse=l=>l.split(',').map(x=>x.replace(/^"|"$/g,''));
    const headers=parse(lines.shift().replace(/^\uFEFF/,''));for(const l of lines){const v=parse(l);process.push(Object.fromEntries(headers.map((k,i)=>[k,v[i]])));}
  }
  const cpu=name=>{const r=process.filter(x=>x.component===name);return r.length?Math.max(...r.map(x=>Number(x.cpuMachinePercent)||0))*m.logicalCpus:null;};
  const ram=name=>{const r=process.filter(x=>x.component===name);return r.length?Math.max(...r.map(x=>Number(x.workingSetBytes)))/2**20:null;};
  const db=fs.existsSync(dir+'/database.jsonl')?fs.readFileSync(dir+'/database.jsonl','utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
  runs.push({id:name,m,s,integrity,cpuBackend:cpu('backend'),cpuK6:cpu('k6'),ramBackend:ram('backend'),ramK6:ram('k6'),db});
}
runs.sort((a,b)=>a.m.startedAt.localeCompare(b.m.startedAt));
const profiles=runs.filter(r=>r.m.requestCpuProfiling&&r.m.k6Exit===0);
const modelPath=REPORTS+'/VERCEL_ESTIMATE.json';
if(!fs.existsSync(modelPath))throw new Error('Generate VERCEL_ESTIMATE first');
const model=read(modelPath),thousand=model.scenarios.at(-1);
const peak=Math.max(...runs.filter(r=>r.m.database!=='disabled').map(r=>r.s.metrics.vus?.values?.max||0));
const submissions=runs.reduce((n,r)=>n+(r.integrity?.newSubmissions||0),0);
const networkDirs=fs.readdirSync(RESULTS+'').filter(n=>n.startsWith('network_')).sort();
const network=networkDirs.length?read(RESULTS+'/'+networkDirs.at(-1)+'/calibration.json'):null;
const dbPeak=Math.max(...runs.flatMap(r=>r.db.map(d=>d.connections))),lockPeak=Math.max(...runs.flatMap(r=>r.db.map(d=>d.lock_waiters)));
const lines=['# BÁO CÁO ĐO LOCAL + SUPABASE VÀ ƯỚC LƯỢNG VERCEL — BBE E-LEARNING','',
'Cập nhật: '+new Date().toISOString()+' (ngày 25/10/2026 UTC+7). Báo cáo này thay thế kết luận trước khi chủ dự án cho phép dùng Supabase thật. Lịch sử ban đầu được giữ ở LOAD_TEST_REPORT_INITIAL.md.','',
'## 1. Tóm tắt điều hành','',
'| Câu hỏi | Kết quả |','|---|---|',
'| Đã đo tới 1.000 người chưa? | **Chưa.** Chỉ cấu hình/inspect tới 1.000 VU; không thực thi 1.000 VU. |',
`| Mức cao nhất thực sự đo với tài khoản học và Supabase? | **${peak} VU** trên production build localhost, DB Supabase thật. |`,
'| Mức cao nhất đạt mọi tiêu chí ban đầu? | **Chưa có mức nào được chứng minh đạt p95 <1.500ms cho các API được gọi.** Các run chẩn đoán hoàn tất dùng p95/timeout 30s. |',
'| Ngưỡng bắt đầu suy giảm? | Chưa xác định: không có đường cong tăng tải. Có latency cao ngay 1 VU; không được gọi đó là ngưỡng bão hòa. |',
`| Dữ liệu quiz/tiến độ/sao? | ${submissions} bài nộp thành công được đối chiếu ACK với DB; các lần gửi lại không trả thêm sao. Không thấy regression tiến độ/duplicate reward trong audit cohort; chưa chứng minh mọi heartbeat không mất. |`,
`| DB có cạn connection hoặc lock? | Các run ghi nhận tối đa ${dbPeak}/60 connection và ${lockPeak} lock waiter ở nhịp quan sát 5s; chỉ là bằng chứng dưới tải 1 VU. |`,
'| Điểm cần xử lý trước? | Nhiều SQL/round-trip trên heartbeat, quiz và read-model, kết hợp RTT local→DB cao. Chưa chứng minh bottleneck throughput của deployment Vercel/Supabase. |',
'| Độ tin cậy? | Cao với số đo cụ thể của các run; thấp với ngoại suy concurrency/CPU cloud vì chỉ 1 VU, ít mẫu và khác vị trí mạng/phần cứng. |','',
`Theo mô hình hành vi giả định, 1.000 người tạo khoảng **${f(thousand.apiRpsAssumed)} API request/s**, tương đương ${f(thousand.apiRequests15Minutes,0)} request/15 phút, chưa cộng login/refresh/khởi tạo/media. CPU tương đương từ các profile local là khoảng **${f(thousand.localCpuEquivalentCores)} core** nếu workload/cache giữ như sample; đây **không phải số CPU Vercel đã đo** và không chứng minh hỗ trợ 1.000 người. Xem [mô hình và độ nhạy đầy đủ](VERCEL_ESTIMATE.md).`,'',
'## 2. Môi trường, phạm vi được phép và dữ liệu test','',
'- Máy Windows i7-12700H, 20 logical CPU, RAM khoảng 15,71 GiB; Node v24.11.1, k6 v2.2.0. CPU/RAM được ghi riêng cho Next và k6. Người dùng đã đóng bớt ứng dụng, RAM trống tăng từ khoảng 1 GiB lên khoảng 5 GiB trước build/đo. Không tự dừng tiến trình công việc của người dùng.',
'- Next.js production snapshot build đã **thành công** khi dùng DB Supabase được chủ dự án cho phép. Build ID được lưu trong mỗi metadata.json. Bản sao trong load-tests/.sandbox; không chạy next dev để thay thế. Hai build worker, heap tối đa 2 GiB; runtime chưa bị ép thành container 1 vCPU/2 GB.',
'- HTTP chỉ đến 127.0.0.1:3100 do runner tự mở. Không có HTTP load test trên deployment Vercel, không deploy/commit/push. R2/email/YouTube credential tắt; không tải streaming media hoặc gọi health/R2 làm tải nền.',
'- DB hiện tại là Supabase Free, vùng suy ra từ pooler là us-west-1. vercel.json cấu hình sfo1; chưa truy xuất dashboard để xác nhận deployment đang chạy đúng vùng đó. URI thử nghiệm chỉ đổi giới hạn client pool thành 3; không sửa .env hoặc cấu hình project Supabase. Observer dùng tối đa một connection riêng.',
'- Chủ dự án xác nhận thêm đúng 10 tài khoản synthetic, một DNA và một Chapter riêng. Tài khoản chỉ thuộc DNA; Chapter giữ rỗng. Dùng nội dung công khai sẵn có, không tạo/sửa khóa hoặc câu hỏi: video xem 812s, video quiz 153s, quiz 6 câu/3 phút. Tiến độ và lịch sử sao seed chỉ thuộc tài khoản giả lập. Dữ liệu này có thể xuất hiện trong bảng xếp hạng tổng như đã được chủ dự án chấp thuận.',
'- Không reset, xóa, baseline/migrate DB thật, sửa policy/permission/formula hoặc dữ liệu người học thật. Fixture password chỉ ở file *.private.json bị gitignore. Raw results, SQL logs và snapshot cũng bị ignore. Không xuất token/cookie/mật khẩu vào báo cáo.',
'- Profile Supabase mới là opt-in, giới hạn guard 10 VU/hold 240s, không spike. Ceiling này do bộ test lựa chọn, không phải chứng nhận tải của Supabase. Thực tế chưa vượt 1 VU vì latency ban đầu không đạt. [Supabase AUP](https://supabase.com/aup) yêu cầu không làm suy giảm/gián đoạn dịch vụ; không dùng quyền sở hữu DB để bỏ qua giới hạn hạ tầng.','',
'## 3. Kết quả thực nghiệm','',
'RPS là trung bình **toàn run gồm ramp/think/recovery**, không phải throughput tối đa. Percentile ít mẫu chỉ mô tả sample. CPU là peak trung bình trên khoảng mẫu 5s, quy đổi tương đương % của một logical core bằng CPU toàn máy ×20; không phải CPU Vercel. RAM là working set peak MiB.','',
'| Run / mode | VU thực | HTTP | RPS | p95 ms | p99 ms | Lỗi HTTP % | CPU backend %/core | RAM backend MiB | Kết quả |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---|'];
for(const r of runs){const v=k=>r.s.metrics[k]?.values||{};const diagnostic=r.m.diagnosticOnly||r.m.thresholdAssumptions.p95Ms>1500;const verdict=r.m.k6Exit!==0?'Dừng / không đạt':r.m.mode==='static-smoke'?'Smoke trang login đạt':diagnostic?'Hoàn tất chẩn đoán; không đạt SLA 1,5s':'Đạt theo cấu hình';lines.push(`| [${r.id} / ${r.m.mode}](../results/${r.id}/REPORT.md) | ${v('vus').max??'—'} | ${v('http_reqs').count??0} | ${f(v('http_reqs').rate,4)} | ${f(v('http_req_duration')['p(95)'])} | ${f(v('http_req_duration')['p(99)'])} | ${f((v('http_req_failed').rate||0)*100)} | ${f(r.cpuBackend)} | ${f(r.ramBackend)} | ${verdict} |`);}
lines.push('','### CPU/RAM máy phát tải và DB','', '| Run | CPU k6 %/core peak | RAM k6 MiB peak | DB connection peak | Lock waiter peak | Audit cohort |','|---|---:|---:|---:|---:|---|');
for(const r of runs)lines.push(`| ${r.id} | ${f(r.cpuK6)} | ${f(r.ramK6)} | ${r.db.length?Math.max(...r.db.map(d=>d.connections)):'—'} | ${r.db.length?Math.max(...r.db.map(d=>d.lock_waiters)):'—'} | ${r.integrity?r.integrity.passed?'Qua trong phạm vi đã kiểm':'Không qua':'Không đo dữ liệu học'} |`);
lines.push('','### Diễn giải các run lỗi và chẩn đoán','',
'- Baseline strict dừng ở 1 VU: login đầu tiên 5.077,73ms > giả định 1.500ms. Một mẫu login không đủ ý nghĩa thống kê p95 hoặc capacity. Không có lỗi HTTP trong request này.',
'- Quiz với timeout mặc định 10s có một request mở bài timeout; không tăng VU. Run chẩn đoán giữ nguyên 1 VU, nâng p95/timeout lên 30s để đo đủ luồng, không coi đây là nới SLA cho kết luận đạt.',
'- Một lần lặp quiz nhận 409 vì think time của harness vượt hạn server 3 phút; không tính thành lỗi capacity. Đã sửa script đọc expiresAt và dành timeout +10s cho gửi bài, có unit test. Attempt hết hạn được giữ nguyên, không sửa hạn bài hoặc reset dữ liệu để làm đẹp kết quả.',
'- Fixture đầu gán đồng thời Chapter+DNA bị trigger SingleOrganizationAffiliationRequired từ chối, transaction user rollback. Đã sửa fixture thành DNA-only, giữ nguyên constraint và tái sử dụng đúng nhóm đã tạo. Đây là lỗi fixture được phát hiện, không phải lỗi nghiệp vụ DB.',
'- Các run có interrupted iteration lúc kết thúc/graceful stop cần đọc samples và profiler; có thể là sleep/flow chưa xong. Không tự suy ra đó là request treo hoặc mất dữ liệu. Không có soak 1.000 VU.','',
'### Theo endpoint','', '| Profile / endpoint | Mẫu | Avg ms | Median ms | p90 ms | p95 ms | p99 ms |','|---|---:|---:|---:|---:|---:|---:|');
for(const r of profiles)for(const [key,metric]of Object.entries(r.s.metrics))if(key.startsWith('http_req_duration{endpoint:')){
 const n=r.s.metrics[key.replace('http_req_duration','endpoint_requests')]?.values?.count||0;if(n)lines.push(`| ${r.m.mode} / ${key.match(/endpoint:([^}]+)/)[1]} | ${n} | ${['avg','med','p(90)','p(95)','p(99)'].map(k=>f(metric.values[k])).join(' | ')} |`);
}
lines.push('','Endpoint không có sample là **chưa đo**, không dùng số 0 của submetric rỗng để kết luận. Submit profile có cả lần đầu và retry; mô hình CPU chỉ lấy lần nộp đầu để tránh đánh giá thấp chi phí chấm bài. SQL logging/profiler có overhead, sample CPU Windows có độ lượng tử ~15–16ms; mẫu CPU 0 không có nghĩa xử lý miễn phí.','',
'## 4. Mạng, SQL và điểm nghẽn','',
`SELECT 1 trên một connection đã mở: ${network?f(Math.min(...network.roundTripsMs)): '—'}–${network?f(Math.max(...network.roundTripsMs)):'—'}ms từ máy tới Supabase. Hai EXPLAIN đơn giản theo user test có execution tại PostgreSQL 0,043ms và 0,057ms, trong khi wall khoảng 173–174ms. Đây là bằng chứng phần lớn thời gian của **hai truy vấn đó** nằm ngoài execution SQL; không được áp kết luận này cho mọi query phức tạp. [Calibration](../results/${networkDirs.at(-1)}/calibration.json).`,
'','Profiler 1 VU cho thấy learning/me có sample 74 SQL event/request; progress GET 28; heartbeat có các sample 32–40; submit đầu có sample 63. Đây là số event từ Prisma, có thể gồm BEGIN/COMMIT; không gồm SQL nội bộ trigger/function. SQL duration đã gồm thời gian driver/mạng và có thể chạy song song: không cộng chúng rồi coi tổng là latency endpoint.',
'','CPU/RAM Next và k6 chưa bão hòa trong các run 1 VU; DB chưa quan sát cạn connection hoặc lock wait. Bằng chứng hiện tại ưu tiên giả thuyết **nhiều round-trip nối tiếp + khoảng cách mạng** cho latency local. Chưa xác định giới hạn throughput của Next, CPU Supabase, pooler, locks hoặc injector khi có hàng trăm người.',
'','Source còn có rủi ro dùng Prisma global trong progression helper khi đang giữ connection transaction ở heartbeat; dưới concurrency/pool nhỏ có thể tăng pool wait. Đây là rủi ro qua source, chưa được tái hiện ở 1 VU. Không tự bỏ khóa user/attempt hoặc kiểm tra video để giảm thời gian.',
'','Endpoint leaderboard từng Chapter có take:500 trước tính hạng, cần kiểm tra correctness với Chapter >500 người. Cohort hiện thuộc DNA và đọc bảng tổng; chưa tái hiện vấn đề đó. Đây không phải bằng chứng website chỉ hỗ trợ 500 người.','',
'## 5. Khả năng theo quy mô và ước lượng','', '| Quy mô | Đã chứng minh / chưa đạt / chưa đủ dữ liệu |','|---|---|');
for(const n of [100,300,500,750,1000])lines.push(`| ${n} người | **Chưa đủ dữ liệu thực nghiệm.** Chỉ có mô hình giả định trong VERCEL_ESTIMATE.md; chưa chạy ${n} VU. |`);
lines.push('','Không có ngưỡng tải cao nhất đạt SLA hoặc điểm bắt đầu suy giảm để nội suy giữa các mức. Không khẳng định “không hỗ trợ nổi 1 người”: latency local xa DB và cold code khác production. Cũng không khẳng định “1.000 người chắc chắn đạt” từ CPU thấp ở một VU.','',
'Bảng [VERCEL_ESTIMATE.md](VERCEL_ESTIMATE.md) tách số đo CPU/SQL thực, tỷ lệ hành vi giả định và phép ngoại suy. CPU demand là điều kiện tài nguyên, không phải chứng nhận autoscale hay SLA. Concurrency HTTP theo Little\'s Law không phải DB connection. Các hệ số phần cứng 0,5×–2× là độ nhạy chưa hiệu chuẩn, không phải confidence interval.','',
'## 6. Đề xuất P0/P1/P2','', '| Ưu tiên | Việc cụ thể | Cách xác minh |','|---|---|---|',
'| P0 | Giữ test HTTP ở localhost; giới hạn tài khoản/DB như đã duyệt, bảo toàn guard dữ liệu và dừng khi lỗi. Không tăng VU để vượt qua latency hiện đang cao. | Raw metrics, audit ACK/DB, deadline quiz, role/affiliation, pool/locks đều có bằng chứng trước khi nâng tải. |',
'| P1 | Giảm SQL/round-trip trên heartbeat; kiểm tra lịch sử/replay/stars có cần đọc lại đầy đủ mỗi heartbeat không; memoize authorization trong cùng request, batch metadata, truyền transaction client khi phù hợp. | So số SQL, transaction/pool wait và latency trước/sau với cùng dataset; giữ video wall-clock, quyền và idempotency. |',
'| P1 | Tối ưu read-model learning/me và quiz mở/nộp dựa trên trace; kiểm tra reconciliation/outbox/read-through để tránh đọc/ghi trùng. | Profiling có SQL count, EXPLAIN query thực và audit không mất progress/sao; không chỉ đo HTTP 200. |',
'| P1 | Xác minh đúng vị trí function/DB và RTT từ môi trường gần SFO/us-west-1 trước khi ngoại suy latency. | So cùng thao tác test bình thường với Usage/Observability thật; không load test Vercel Hobby. |',
'| P1 | Xác minh và xử lý giới hạn 500 thành viên trước xếp hạng nếu nghiệp vụ yêu cầu Chapter lớn. | Fixture người điểm cao nằm ngoài tập 500 vẫn có hạng đúng; không thay công thức ranking tùy ý. |',
'| P2 | Thu thập DB CPU, pooler limits, pg_stat_statements/slow-query history, cache hit và HAR thực; test concurrency tại môi trường được phép sau tối ưu. | Ladder tới 1.000, mức trung gian, lặp quan trọng và stability 10–15 phút; tách injector khi cần. |','',
'Chưa đề xuất tăng pool hoặc tạo index bừa: hai lookup đã đo rất nhanh tại server, còn bottleneck concurrency/complex SQL chưa xác định. Không thay đổi nghiệp vụ, schema hoặc công thức sao trong đợt này.','',
'## 7. Recovery, correctness và giới hạn','',
`${submissions} lần submit thành công được đối chiếu DB và kiểm tra gửi lại không thưởng thêm. Quiz đúng toàn bộ đạt score 100%; mỗi bài 6 câu nhận 6 sao theo chính sách hiện tại. Audit không thấy tiến độ giảm hoặc duplicate reward trong cohort. Một attempt test hết hạn IN_PROGRESS được giữ làm bằng chứng lỗi pacing của harness; không sửa lại thành kết quả đạt.`,
'','Connection quan sát thấp và không có lock waiter ở 1 VU, nhưng pooler có thể giữ idle connection sau warmup, không bắt buộc quay đúng 9 connection ban đầu. Chưa chứng minh phục hồi sau overload vì chưa tạo overload. Chưa chạy hết video 812s để kiểm completion/nhận sao video mới qua API; 20 sao VIDEO trong cohort là lịch sử seed, không phải kết quả xem đủ video trong test. Chưa đo DB CPU/RAM, full slow-query history hoặc mỗi heartbeat riêng lẻ: API ghi đè vị trí mới nhất, không có event ID bền vững để đối chiếu từng lần. Không gọi scheduler toàn hệ thống để làm sạch dữ liệu test vì có thể tác động người khác.',
'','Fixture local tới 1.000 VU vẫn là generator/scenario chưa integration-test đầy đủ với DB riêng trong phiên này. Supabase profile chỉ dùng 10 tài khoản và thực thi 1 VU. Cache, request mix, thời gian nghĩ và schema dữ liệu có thể khác traffic thật. Profile CPU một VU không đo được behavior khi tranh chấp. Không có browser rendering/media throughput measurement.','',
'## 8. Vercel Hobby và quota','',
'Vercel Hobby có quota tài nguyên, không phải lời hứa 30.000 người học. 1 vCPU/2GB là cấu hình function Hobby với Fluid Compute theo tài liệu, không phải giới hạn tổng CPU của mọi instance trong deployment. Chưa xác nhận Fluid/config/quota còn lại của project. [Hobby](https://vercel.com/docs/plans/hobby), [Functions limits](https://vercel.com/docs/functions/limitations).',
'','Phép ngoại suy invocation/CPU theo [mô hình](VERCEL_ESTIMATE.md) không chứng minh Supabase Free chịu được lượng SQL dự kiến. Cache toàn hệ thống có thể giảm SQL, cold instances/queue có thể tăng; thời gian chờ DB không phải toàn bộ Active CPU. Memory billing của Fluid không được tính bằng RAM local × số request. Không có hệ số cố định để biến capacity máy i7 thành capacity Vercel.',
'','Không phát tải vào Hobby; chính sách hiện hành yêu cầu Enterprise hoặc thỏa thuận trước. [Vercel load-testing policy](https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments).','',
'## 9. Kết luận','',
'**Đã đo ứng dụng thật trên localhost kết nối Supabase thật, nhưng cao nhất là 1 VU. Chưa thể xác nhận phục vụ 1.000 người học đồng thời.** Có bằng chứng hoàn tất luồng học/quiz và chống thưởng lặp trong cohort; latency local cao và số SQL lớn cần xử lý. Báo cáo ước lượng định lượng nhu cầu cho 1.000 người theo điều kiện rõ ràng, không thay thế load test deployment.',
'','Bước tiếp theo có giá trị nhất là giảm round-trip trên heartbeat/quiz, đo RTT thật ở vùng function/DB và hiệu chỉnh CPU/cache bằng usage bình thường. Khi môi trường/policy cho phép và baseline đạt yêu cầu, mới chạy ladder, xác định ranh giới đạt/lỗi và stability.');
lines.push('','## 10. Kiểm tra bộ công cụ','',
'Kiểm tra cuối: 9/9 unit/security/profiler tests qua; 17/17 k6 inspect checks qua (10 mode cấu hình tới 1.000 VU, 3 URL ngoài whitelist bị chặn, 4 script legacy bị vô hiệu hóa). Smoke stub 1 lượt vẫn qua nhưng được tách khỏi 8 run ứng dụng. Syntax JS/MJS/CJS, parser PowerShell và git diff --check qua. Đối chiếu hash 6 file source quan trọng của snapshot với repository hiện tại khớp; không chỉnh src hoặc migration.',
'','Bằng chứng: [inspect cuối](../results/inspect_2026-10-24T19-03-19-075Z_60b45add/validation.json), [trạng thái cohort cuối, timestamp UTC](../results/test-state_2026-10-24T18-58-07-152Z_89263fd9/state.json). Trạng thái cohort ghi 2 bài SUBMITTED score 100%, 1 IN_PROGRESS đã hết hạn, 12 sao ASSESSMENT và 20 sao VIDEO lịch sử seed. Không lấy 20 sao seed làm số sao video kiếm được trong bài test.');
const out=REPORTS+'/LOAD_TEST_REPORT.md',archive=REPORTS+'/LOAD_TEST_REPORT_INITIAL.md';
if(fs.existsSync(out)&&!fs.existsSync(archive))fs.copyFileSync(out,archive,fs.constants.COPYFILE_EXCL);
fs.writeFileSync(out,lines.join('\n'));
console.log(JSON.stringify({report:out,runs:runs.length,authenticatedVuPeak:peak,successfulSubmissions:submissions,modelMissingEndpoints:model.missingEndpoints}));
