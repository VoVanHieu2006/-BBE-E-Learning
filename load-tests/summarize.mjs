import fs from 'node:fs';
import path from 'node:path';
export function writeRunReport(dir) {
  const read=(name)=>{const f=path.join(dir,name);return fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):null;};
  const m=read('metadata.json'),s=read('summary.json'),integrity=read('integrity.json');
  const metric=(name,key)=>s?.metrics?.[name]?.values?.[key]??'N/A';
  const failed=Object.values(s?.metrics||{}).some(x=>Object.values(x.thresholds||{}).some(t=>!t.ok));
  const verdict=m.failure||m.resourceAbort||m.k6Exit!==0||failed||(!integrity&&m.mode!=='static-smoke')||integrity?.passed===false?'CHƯA ĐẠT / KHÔNG ĐỦ BẰNG CHỨNG':m.diagnosticOnly?'HOÀN TẤT CHẨN ĐOÁN; KHÔNG CHỨNG MINH TIÊU CHÍ p95 1.500 ms':'ĐẠT TRONG PHẠM VI BÀI TEST';
  const lines=[`# Run ${m.runId}`,``,`${verdict}`,``,`Mode: ${m.mode}; HTTP: ${m.base}; DB: ${m.database}.`,
    `VU cấu hình ${m.vusConfigured}; VU cực đại ghi nhận ${metric('vus','max')}.`,
    `Giữ tải cấu hình ${m.hold}s; xem samples.json để xác minh thời gian VU thực đạt.`,
    `Threshold run: ${JSON.stringify(m.thresholdAssumptions)}; HTTP timeout ${m.requestTimeoutSeconds||10}s; diagnostic-only ${m.diagnosticOnly||false}.`,
    `RPS ${metric('http_reqs','rate')}; successful transactions/s ${metric('successful_transactions','rate')}.`,
    `HTTP lỗi ${metric('http_req_failed','rate')}; timeout ${metric('timeouts','count')}.`,
    `p95 ${metric('http_req_duration','p(95)')} ms; p99 ${metric('http_req_duration','p(99)')} ms.`,
    `Integrity: ${integrity?JSON.stringify(integrity):'Chưa kiểm chứng'}.`,
    `Lý do dừng: ${m.resourceAbort||m.failure||'Không có'}.`,
    '', '| Endpoint | avg | median | p90 | p95 | p99 (ms) |','|---|---:|---:|---:|---:|---:|'];
  for(const [name,x]of Object.entries(s?.metrics||{}))if(name.startsWith('http_req_duration{') && (s.metrics[name.replace('http_req_duration','endpoint_requests')]?.values?.count||0)>0)
    lines.push(`| ${name} | ${['avg','med','p(90)','p(95)','p(99)'].map(k=>x.values[k]??'N/A').join(' | ')} |`);
  lines.push('','CPU/RAM backend và k6: process.csv (CPU chia theo tổng logical cores; một core bão hòa có thể chỉ ~5% trên máy 20 cores).',
    'RAM toàn máy: resources.jsonl. DB connections/lock/long query: database.jsonl. N/A nghĩa là chưa đo, không phải 0.',
    'RPS/latency trung bình toàn run gồm ramp + hold + recovery; dùng samples.json/CSV theo timestamp để phân tích từng pha.',
    'Static smoke không chứng minh năng lực người học, auth, DB, heartbeat, quiz hoặc sao.');
  fs.writeFileSync(path.join(dir,'REPORT.md'),lines.join('\n'),{flag:'wx'});
}
