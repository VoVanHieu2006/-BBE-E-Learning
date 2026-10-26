# BBE E-Learning — k6 tới 1.000 VU

**Trạng thái hiện tại: chưa xác nhận năng lực 1.000 người học.** Xem [báo cáo](reports/LOAD_TEST_REPORT.md), [kiến trúc/mô hình tải](reports/ARCHITECTURE.md) và [inventory API từ source](reports/API_INVENTORY.md).

Suite chỉ chấp nhận HTTP loopback. Runner tự khởi động bản production snapshot, từ chối port đã có process, không nhắm tới dev server/proxy không xác minh. Mặc định database phải là PostgreSQL riêng trên loopback, tên `bbe_loadtest` hoặc `bbe_loadtest_<chữ/số>`. **Không chạy HTTP load test trên Vercel Hobby, preview hoặc custom domain.** Theo chỉ thị bổ sung của chủ dự án, có profile Supabase baseline opt-in giới hạn nhỏ bên dưới; không tự coi đây là quyền phát tải tới 1.000 VU trên Supabase Free.

## Profile Supabase hiện tại đã được chủ DB cho phép

`--supabase-baseline` dùng đúng DATABASE_URL Supabase trong `.env`/`.env.local`, giới hạn client pool 3, tối đa 10 VU, không spike, hold tối đa 240s. Đây là **ceiling an toàn do bộ test chọn**, không phải mức tải Supabase xác nhận. Vẫn đọc [AUP Supabase](https://supabase.com/aup), theo dõi DB và dừng nếu có dấu hiệu làm suy giảm dịch vụ. Các run đã thực thi hiện chỉ tới **1 VU**, chưa tăng 10 vì tiêu chí latency ban đầu không đạt.

Build chỉ kế thừa DB được chọn, còn JWT sinh riêng, R2/email/YouTube credential tắt. Không chạy migration/reset trên Supabase. Chủ DB đã xác nhận thêm đúng 10 tài khoản synthetic; file fixture private lưu trong `fixtures/`. Tái sử dụng file đó, **không seed lại mỗi run**. `--user-offset 0..9` chọn tài khoản chưa làm quiz để tôn trọng cooldown.

```powershell
node load-tests/inspect-supabase.mjs
node load-tests/prepare.mjs --resume-build --supabase-baseline
# Thay <fixture> bằng tên file .private.json đã được tạo/duyệt, không đặt credential trong lệnh.
node load-tests/run.mjs --supabase-baseline --fixture <fixture> --mode dashboard --vus 1 --hold 120
```

`inspect-supabase-content.mjs` chỉ đọc nội dung, không chứa nhánh ghi. `fixtures/seed-supabase-baseline.mjs` là lệnh **ghi**: tạo 10 tài khoản thuộc DNA, tái sử dụng khóa/quiz công khai có sẵn, không sửa nội dung hay policy. Một Chapter rỗng được giữ lại từ bước chuẩn bị, không gán đồng thời Chapter+DNA vì DB cấm dual affiliation. Resume bằng `--resume <fixture>` kiểm tra fingerprint, tên nhóm và số user để tránh tạo thêm cohort ngoài ý muốn. Không xóa dữ liệu khi thất bại.

Nếu cần tìm nguyên nhân latency cao, giữ đúng 1 VU và ghi rõ diagnostic-only:

```powershell
node load-tests/run.mjs --supabase-baseline --fixture <fixture> --mode diagnostic-read --vus 1 --hold 120 --recovery 10 --p95-ms 30000 --request-timeout 30 --sql-log --profile-cpu --user-offset 1
```

Mở rộng timeout >10s và CPU profiling chỉ được chạy ở 1 VU. `diagnostic-read` đọc các API dashboard/course/learning/progress/leaderboard; không phải mixed workload. Ngưỡng 30s là để thu thập chẩn đoán, **không phải đạt SLA 1.500ms**. `request-profiler.cjs` là Node preload trong server test, không sửa src: ghi endpoint chuẩn hóa, wall/CPU/SQL count, không ghi header/cookie/body/query string; loại request chồng lấp khi ước lượng CPU. Counter Windows có độ lượng tử ~15–16ms, sample 0 không có nghĩa miễn phí CPU.

Quiz đọc `expiresAt` của server và chừa timeout +10s khi chọn think time; không sửa hạn bài. Các lỗi ở lần chạy trước do think time vượt deadline được giữ làm bằng chứng harness lỗi, không tính thành capacity backend. `calibrate-supabase.mjs <fixture>` và `inspect-test-state.mjs <fixture>` chỉ đọc, đều giới hạn vào cohort hoặc phép đo SELECT/EXPLAIN đơn giản.

Sau khi run hoàn tất: `node load-tests/analyze-run.mjs <run-id>`. Để ngoại suy từ các run profile 1 VU thành công: `node load-tests/estimate-vercel.mjs <read-run-id> <video-run-id> <quiz-run-id>`. Xem [ước lượng](reports/VERCEL_ESTIMATE.md): số người trong bảng là giả định, không phải VU đã đo; phần cứng, cache, RTT và DB concurrency chưa được hiệu chuẩn production.

## Thành phần

- `config.js`: whitelist, giới hạn 1–1.000 VU, threshold.
- `scenarios/learners.js`: A mixed/flow riêng, B spikes và C recovery.
- `fixtures/seed.mjs`: 1.000 learner synthetic/cohort, khóa/bài/quiz/progress/star history.
- `prepare.mjs`: snapshot source và production build, bỏ `.env`/`.vercel`/metadata.
- `init-db.mjs`: baseline DB rỗng và forward migrations bằng workflow có sẵn của repository.
- `run.mjs`, `monitor.ps1`, `audit.mjs`, `summarize.mjs`: chạy, đo, kiểm tra dữ liệu và xuất bằng chứng.
- `suite.ps1`: tăng tải có dừng khi lỗi, không mặc định dừng ở 100.
- `tests/`: guard tests, cấu hình 1.000 VU bằng inspect, smoke công cụ với stub.
- Bốn script k6 cũ đã khóa bằng `legacy-disabled.js`: chúng thiếu kiểm tra upstream, có script gọi health/R2 hoặc cho phép URL tùy ý. Dùng runner mới.

## Chuẩn bị PostgreSQL local trên Windows PowerShell (phương án tùy chọn)

Cần Node.js, dependencies của repo đã cài, k6, PostgreSQL riêng. Docker **không bắt buộc**: có thể cài PostgreSQL native trên Windows và tạo DB trống bằng pgAdmin/psql. Không có script tự cài hay tự mở Docker trong bộ này. Không tự thay đổi gói cloud/deploy.

1. Tạo DB **mới** `bbe_loadtest` trên máy kiểm soát; ví dụ service PostgreSQL riêng bind `127.0.0.1:55432`. Dùng user có quyền tạo schema/baseline trên DB này. Không dùng DB tên `postgres`, DB thật hoặc production URL. Cấu hình PostgreSQL log slow query nếu cần; không bật extension bằng script tự động.
2. Đặt chuỗi kết nối trong process PowerShell cục bộ; tránh ghi credential vào command history bằng cách nhập kín:

```powershell
Set-Location C:\Users\Acer\Desktop\E-learning
$dbSecret = Read-Host 'URL PostgreSQL local cho bbe_loadtest' -AsSecureString
$env:LOAD_DATABASE_URL = [System.Net.NetworkCredential]::new('', $dbSecret).Password
node load-tests/init-db.mjs
node load-tests/fixtures/seed.mjs
```

URL có dạng `postgresql://<user>:<password>@127.0.0.1:55432/bbe_loadtest`. `init-db` không chạy nếu tên/host không hợp lệ. Workflow baseline hiện có rất quan trọng: lịch sử migration của repo không replay nguyên trạng từ DB rỗng; xem `prisma/bootstrap/README.md`. Không dùng `db reset`, `db push --accept-data-loss`, sửa migration cũ hoặc baseline DB có dữ liệu. Wrapper áp dụng vào DB local riêng, không sửa schema production.

3. Build snapshot một lần với memory khả dụng:

```powershell
node load-tests/preflight.mjs
node load-tests/prepare.mjs
```

Build cần ít nhất 1,5 GiB RAM trống theo guard ban đầu, Node heap tối đa 2 GiB; đây là mức chặn an toàn, không phải đảm bảo build đủ RAM. Nếu Windows sandbox chặn spawn, cho phép tiến trình build qua cơ chế approval. Với snapshot đã tạo nhưng build gián đoạn: `node load-tests/prepare.mjs --resume-build`. Snapshot không được cập nhật source bởi resume. Khi code thay đổi, **đổi tên/giữ snapshot cũ rồi tạo mới**; tool không tự xóa nó. Mỗi build log có tên riêng.

Build dùng `LOAD_DATABASE_URL` local đã được xác minh; một số GET như learning/periods truy vấn DB trong prerender. Nếu chưa cấu hình DB local, build dùng địa chỉ vô hiệu hóa `127.0.0.1:1` và có thể thất bại; không tự rơi về `.env` Supabase. Snapshot giới hạn hai build worker để giảm áp lực RAM, không đổi nghiệp vụ runtime.

Child env được dựng bằng allowlist: không kế thừa Supabase/R2/Resend/YouTube credentials, JWT/pepper sinh riêng, R2 trỏ port loopback không hoạt động, telemetry Next/k6 tắt. Không sao chép `.env`. Các luồng upload/email/media không nằm trong workload này. Không bật route health để thử tải.

## Smoke và kiểm tra bộ công cụ

```powershell
node --test load-tests/tests/safety.test.mjs
node load-tests/tests/inspect.mjs
node load-tests/tests/harness-smoke.mjs
node load-tests/run.mjs --mode static-smoke --vus 1 --hold 10 --ramp 2 --recovery 10
```

Ba lệnh đầu không chạm BBE DB: inspect xác minh cấu hình nhưng **không chạy 1.000 VU**; harness dùng stub localhost 1 VU/1 HTTP request, không phải ứng dụng. Lệnh static-smoke cần production snapshot đã build, chỉ GET trang login, tối đa 5 VU; không chứng minh auth/DB/nghiệp vụ.

Sau khi seed và build thành công, chạy smoke nghiệp vụ từng flow với cohort mới cho các flow ghi, rồi mới chạy ladder. Một VU mixed thuộc dashboard nên **không đại diện đủ bốn luồng**. 10 VU mixed phân nhóm có cả video, quiz và leaderboard. Quiz cần >180s để hoàn tất; giữ tải 120s có thể hoàn tất nhờ graceful/recovery nhưng không được coi là smoke quiz đủ nếu không có `submit_acks` và audit tương ứng.

```powershell
node load-tests/run.mjs --mode dashboard --vus 1 --hold 120
node load-tests/run.mjs --mode video --vus 1 --hold 120
node load-tests/run.mjs --mode quiz --vus 1 --hold 240
node load-tests/run.mjs --mode leaderboard --vus 1 --hold 120
```

## Test A — ladder và stability

```powershell
powershell -NoProfile -File load-tests/suite.ps1 -MaxVus 1000 -Mode mixed -Repeats 2 -Stability
```

Mốc: 1, 10, 25, 50, 100, 200, 300, 500, 750, 1.000; ramp mặc định 30s; hold 120s tại ≤10, 180s tại 25–300, 300s tại ≥500. Mỗi run hạ dần 30s về 1 VU, giữ recovery 120s và hạ về 0. Stability 1.000 VU giữ 900s. Không chạy tiếp nếu run lỗi, không có summary/audit, telemetry lỗi hoặc guard chặn. Ở mức quan trọng mặc định lặp 2 lần.

Mỗi run suite seed **cohort mới 1.000 người**, tránh login chung tài khoản và tránh vượt cooldown quiz ở lần chạy lại. Dữ liệu lịch sử/courses tăng dần, không tự xóa. Do đó các lần chạy không cùng cardinality DB: cần ghi nhận tổng số row và, khi so sánh tối ưu nghiêm ngặt, dùng các DB local mới có cùng baseline/fixture. Không diễn giải biến thiên này hoàn toàn là tác động VU. Chuẩn bị cohort tuần tự cũng tốn thời gian, cần quan sát dung lượng DB; không xem seeding là kết quả load test.

Chạy mức riêng hoặc tìm khoảng giữa hai mức:

```powershell
node load-tests/fixtures/seed.mjs --out middle625.private.json
node load-tests/run.mjs --mode mixed --vus 625 --hold 300 --fixture middle625.private.json
```

Nếu 500 đạt, 750 lỗi: xử lý/đợi tài nguyên hồi phục, chạy cohort mới ở 625, rồi chia tiếp khoảng phù hợp (ví dụ độ phân giải 25 VU); lặp ≥2 lần tại mức ranh giới. **Không** thử mức trung gian nếu hệ thống chưa hồi phục hoặc có sai dữ liệu. Script không tự tìm ranh giới khi nguyên nhân dừng còn chưa rõ.

## Test B — từng spike độc lập

Chuẩn bị cohort mới cho mỗi test ghi, truyền `--fixture <tên>.private.json`. Không chạy tất cả spike cùng lúc.

```powershell
node load-tests/run.mjs --mode spike-login --vus 1000 --login-rate 10
node load-tests/run.mjs --mode spike-course --vus 1000
node load-tests/run.mjs --mode spike-heartbeat --vus 1000
node load-tests/run.mjs --mode spike-submit --vus 1000
node load-tests/run.mjs --mode spike-completion --vus 1000
```

Login dùng `constant-arrival-rate`: 10 lượt bắt đầu/s, tổng tối đa 1.000 identities; 1.000 là giới hạn VU của injector, **không khẳng định** đã có 1.000 login đồng thời. Có thể nâng login-rate từng mức trên local khi tài nguyên cho phép. Các spike còn lại dùng `per-vu-iterations` và barrier 120s, có warmup login trước. Completion xem 20s với heartbeat 3s trước mốc ENDED. Chuẩn bị trễ sẽ làm `missed_barrier` lỗi. Submit/completion gửi lặp để xác minh không cộng sao lần hai. Chưa có tùy chọn tăng barrier trong runner; với startup/auth >120s, coi run không hợp lệ và chỉnh cấu hình sau khi phân tích, không bỏ qua metric.

## Threshold và cơ chế dừng

Giả định ban đầu, **chưa phải SLA đã xác nhận**: HTTP error <1%; p95 mỗi endpoint được gọi <1.500ms; business error =0, critical 5xx =0, timeout=0, dropped iteration=0, missed barrier=0. Endpoint không có sample là **chưa đo**, không dùng giá trị zero mặc định của k6 để kết luận.

```powershell
node load-tests/run.mjs --mode mixed --vus 100 --error-limit 0.01 --p95-ms 1500
```

`abortOnFail` dừng theo lần đánh giá của k6; không phải circuit breaker tức thời cho từng request. Observer mỗi 5s: dừng khi RAM trống <0,75 GiB kéo dài 3 mẫu, DB connection >80% `max_connections`, active query >30s, disk còn <2 GiB, backend chết hoặc mất quan sát. Pool app bị giới hạn 10, pool_timeout 5s, HTTP timeout 10s. Ngưỡng này có thể chặn trước điểm cực đại backend; báo cáo phải phân biệt giới hạn an toàn và capacity thật. Đặt conservative min-free RAM trước chạy: 2 GiB mức nhỏ, 4 GiB từ 300, 6 GiB từ 750 VU (static 1 GiB). Không khẳng định máy này không bao giờ phát được 1.000 VU chỉ vì guard chặn trong phiên hiện tại.

CPU process/RAM được ghi riêng; CPU cao không tự chứng minh cạn tài nguyên. Máy 20 logical cores có một Node core bão hòa ở khoảng 5% CPU toàn máy. Chưa có auto-abort CPU; latency, RAM, DB và lỗi là guard vận hành. Không chạy k6/backend chung máy nếu injector thiếu CPU/RAM hoặc output JSON/CSV gây I/O bottleneck. Khi tách máy: suite hiện giữ loopback-only; cần SSH tunnel tới server test độc lập, xác minh tunnel, chặn upstream cloud và bổ sung telemetry máy chủ. Không mở whitelist Internet để tiện chạy.

## Kết quả, bảo mật và giới hạn

Mỗi run có thư mục timestamp UTC + random suffix, không ghi đè: `results/<id>/summary.json`, `samples.json`, `samples.csv`, `REPORT.md`, `metadata.json`, `process.csv`, `resources.jsonl`, `database.jsonl`, `before.json`, `after.json`, `integrity.json`. Một số file chỉ có sau khi khởi động/đo thành công. CPU/RAM và DB metrics là time series riêng, không được giả điền vào k6 summary. RPS/percentile summary gồm ramp+hold+recovery, không phải hold-only. Lọc `samples` theo timestamp/scenario/phase để đánh giá từng pha; chưa có dashboard Grafana tự động.

`process.csv`: CPU trung bình khoảng mẫu, working set/private memory backend và k6. `database.jsonl`: connections, active queries, lock waiters, longest active query — **không phải thống kê đầy đủ slow-query history**. Cần log PostgreSQL/pg_stat_statements cấu hình trước khi đo và quyền quan sát phù hợp; tool không tự cài extension hoặc bật query log. Audit chỉ kiểm tra cohort, regression tiến độ, quiz ACK, chấm điểm và giới hạn sao; không chứng minh toàn bộ heartbeat/no-data-loss. Pool recovery, outbox và các tiêu chí chưa đo cần được xác nhận trước khi tuyên bố tất cả tiêu chí đạt.

Credentials nằm trong `fixtures/*.private.json`, bị gitignore; không in token/password/cookie/HTTP debug. Raw results và sandbox bị ignore vì có identity test/logs. Báo cáo tổng hợp có thể lưu source control sau khi review; tool không commit/push. Offline validation fixture không có người dùng thật, được đánh dấu và không được runner chấp nhận để chạy tải.

Đọc kết quả local như bằng chứng của **snapshot + DB fixture + pool + máy chủ + injector cụ thể**. Không quy đổi thẳng sang khả năng Vercel Hobby, Supabase Free, CDN hoặc YouTube. Muốn xác minh deployment Vercel phải làm theo [chính sách load test hiện hành](https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments); không dùng số quota function concurrency làm số người học hỗ trợ.
