# BÁO CÁO KIỂM THỬ TẢI BBE E-LEARNING

Ngày lập: 25/10/2026, UTC+7. Phạm vi: repository hiện tại và bộ công cụ mới trong `load-tests/`. **Đợt kiểm thử capacity ứng dụng chưa thực hiện được; báo cáo này ghi nhận bằng chứng khảo sát, kiểm tra công cụ và điều kiện còn thiếu.** Không dùng dữ liệu stub làm dữ liệu BBE.

## 1. Tóm tắt điều hành

| Câu hỏi | Kết luận có bằng chứng |
|---|---|
| Đã kiểm thử 1.000 người học chưa? | **Chưa.** Chỉ kiểm tra cấu hình tới 1.000 VU bằng k6 inspect, không khởi chạy 1.000 VU. |
| Mức cao nhất thực sự đo trên BBE? | **Chưa có mức nào; 0 phiên tải người học được thực thi trên BBE trong đợt này.** |
| Mức cao nhất đạt mọi tiêu chí? | **Chưa xác định.** Không có run ứng dụng đủ điều kiện đánh giá. |
| Bắt đầu suy giảm ở mức nào? | **Chưa xác định.** Không có dữ liệu ladder. |
| Có mất tiến độ/heartbeat hoặc sai sao không? | **Chưa kiểm chứng dưới tải.** Không ghi dữ liệu vào DB thật, không thể kết luận dữ liệu production đúng hay sai từ đợt này. |
| Bottleneck đã xác nhận? | Chưa xác nhận bottleneck hiệu năng của backend/DB/injector. Chặn thực thi đã xác nhận: thiếu DB test độc lập, build có truy vấn DB lúc prerender, RAM trống biến động thấp và chính sách Vercel Hobby. |
| Mức độ tin cậy? | Tin cậy với kết quả guard/inspect/harness và lỗi build ghi log; **không đủ bằng chứng về capacity BBE**. |

Đã tạo workload A/B/C, runner Windows, seed generator ≥1.000 tài khoản/cohort, chặn HTTP ngoài localhost và DB ngoài PostgreSQL test local, telemetry, audit và xuất JSON/CSV/Markdown. Đã khóa bốn script cũ thiếu bảo vệ. Chưa seed 1.000 tài khoản vào DB nào; generator chưa được integration-test với PostgreSQL thật trong phiên này. Không tự deploy, commit, push hoặc sửa nghiệp vụ trong `src/`, schema hay migration.

Người dùng đã cho phép dùng DB thật và xác nhận Supabase Free. Quyền sở hữu dữ liệu đã rõ; mức tải được nhà cung cấp cho phép chưa được xác minh. Website deploy đang ở Vercel Hobby; chính sách Vercel chỉ cho phép load testing trên Enterprise hoặc theo thỏa thuận trước. Không phát tải vào deployment đó. [Chính sách Vercel](https://vercel.com/kb/guide/what-s-vercel-s-policy-regarding-load-testing-deployments).

## 2. Môi trường và kiểm tra thực tế

- Windows, Intel Core i7-12700H, 20 logical CPU; RAM hệ điều hành báo 16.869.548.032 byte, khoảng 15,71 GiB. Node v24.11.1; k6 v2.2.0, Go 1.26.5, windows/amd64. Đây là máy phát tải dự kiến đồng thời chạy backend, không phải cấu hình Vercel.
- RAM trống quan sát trong các kiểm tra dao động khoảng 0,40–1,96 GiB; có nhiều tiến trình Node khác. Không dừng các tiến trình công việc của người dùng. Không suy ra mức CPU ứng dụng từ CPU tích lũy của các process chưa xác minh.
- Có Docker CLI 29.4.0 và process Docker Desktop; ban đầu daemon không sẵn sàng, sau đó truy cập pipe bị từ chối trong sandbox. Không tạo container/database, không coi Docker là môi trường test đã sẵn sàng. Không tìm được command PostgreSQL/Supabase native qua PATH ở lần kiểm tra ban đầu.
- `.env` trỏ Supabase Cloud, DATABASE_URL pooler 6543 với `pgbouncer=true`, DIRECT_URL 5432. Không có connection_limit tường minh trong URI khảo sát. Không xuất hostname, mật khẩu, token hoặc cookie. Không kết nối DB thật bằng bộ test.
- Scripts gốc: `build=next build`, `start=next start`; có business-rule/integration tests và workflow baseline DB rỗng. Migration history không replay từ đầu nguyên trạng được; repository có bootstrap riêng. Wrapper test sử dụng workflow này thay vì reset/db push.

### Production build

1. Snapshot source riêng dưới `load-tests/.sandbox`, bỏ `.env` và metadata cloud; lần build đầu bị `spawn EPERM` do sandbox Windows.
2. Retry với quyền phù hợp bị guard từ chối vì RAM trống <1,5 GiB. Đây là dừng trước tải, không phải backend thất bại ở một mức VU.
3. Khi RAM trống tăng, thử lại với hai build worker và heap Node tối đa 2 GiB. Next build tiến tới prerender, rồi exit 1: `/api/v1/learning/periods` gọi Prisma trong lúc build, DB `127.0.0.1:1` đã bị cố ý vô hiệu hóa nên không kết nối được. Log có cảnh báo jose dùng API không hỗ trợ Edge Runtime; chưa xác minh ảnh hưởng runtime.
4. Thử smoke ứng dụng qua runner đã dừng ở preflight vì không có `.next/BUILD_ID` của build thành công. Không chạy `next dev` thay cho production build và không quay sang DB/deployment thật.

Bằng chứng build: [`../.sandbox/build.log`](../.sandbox/build.log) và [`../.sandbox/build-2026-10-24T17-19-00-241Z_66abf428.log`](../.sandbox/build-2026-10-24T17-19-00-241Z_66abf428.log). Các file sinh/log nằm ngoài source control. `prepare.mjs` đã được cập nhật để chấp nhận **chỉ** LOAD_DATABASE_URL của DB local riêng khi có; chưa có DB đó để build lại thành công.

### Những kiểm tra đã chạy

| Kiểm tra | Kết quả | Điều được chứng minh |
|---|---|---|
| Node safety/audit unit tests | 6/6 qua | Chặn HTTP ngoài loopback, chặn DB sai đích/routing override, giới hạn VU, loại credential cloud khỏi child env, phát hiện regression/submit thất lạc/quiz over-award và trùng thưởng video dù key khác nhau trong dữ liệu kiểm tra |
| k6 inspect | 17/17 kiểm tra qua | 10 mode cấu hình tới 1.000 VU, 3 URL không an toàn bị chặn, 4 entrypoint cũ bị vô hiệu hóa; không gửi HTTP |
| Harness smoke | 1 VU, 1 request, exit 0 | k6 chạy và xuất summary/JSON/CSV trên stub localhost; không có auth/DB/video/quiz BBE |
| Smoke BBE production snapshot | Không chạy được | Runner từ chối build chưa hoàn tất |
| Ladder và stability | Chưa chạy | Không có bằng chứng 100–1.000 người học |

Một lần harness đầu lỗi cấu hình executor (`default` không được export), đã sửa và chạy lại thành công; giữ nguyên thư mục lỗi để audit. Không lấy lần inspect thành công hoặc số VU cấu hình làm VU thực đo.

## 3. Bảng kết quả chi tiết

**Ứng dụng BBE:** chưa có quan sát load test hợp lệ. Dấu “—” là chưa đo, không phải zero latency/error.

| VU | RPS | p95 | p99 | Lỗi % | CPU | RAM | Kết quả |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | Chưa chạy tải BBE; production build/DB test chưa sẵn sàng |

**Chỉ kiểm tra công cụ bằng stub**, run `harness_2026-10-24T17-16-00-949Z_474fa65b`:

| VU thực | HTTP request | RPS toàn run | avg/median/p90/p95/p99 | Lỗi HTTP | Thời gian run | Backend CPU/RAM |
|---|---|---|---|---|---|---|
| 1 | 1 | 0,497845 | 5,0938 ms cho cả năm thống kê (chỉ 1 mẫu) | 0% | 2,0086572s | Chưa đo; backend là stub |

Nguồn: [`summary.json`](../results/harness_2026-10-24T17-16-00-949Z_474fa65b/summary.json), [`samples.json`](../results/harness_2026-10-24T17-16-00-949Z_474fa65b/samples.json), [`samples.csv`](../results/harness_2026-10-24T17-16-00-949Z_474fa65b/samples.csv). Một mẫu không đủ ý nghĩa thống kê percentile. RPS thấp vì script ngủ 2s, không phải trần throughput. Successful transactions cũng 1 lượt, khoảng 0,497845/s, chỉ là giao dịch stub.

Kiểm tra cuối sau các sửa đổi: safety 6/6, inspect 17/17 và smoke stub chạy lại đều qua. [Inspect cuối](../results/inspect_2026-10-24T17-25-23-565Z_5fb4ab57/validation.json); [summary smoke cuối](../results/harness_2026-10-24T17-25-26-578Z_c024be14/summary.json): 1 request, 1 VU, 0,4977777 RPS, avg/median/p90/p95/p99 cùng 3,9175 ms, lỗi 0%, thời gian run 2,0089289s. Tất cả vẫn chỉ là stub. [Preflight cuối](../results/preflight_2026-10-24T17-25-28-857Z_0d0253e7/environment.json) xác minh version k6 và RAM trống 1.170.821.120 byte tại thời điểm ghi. Syntax check toàn bộ JS/MJS, parser hai script PowerShell và `git diff --check` đều qua; chưa thay thế được integration test với DB/app thật.

**Không dùng hàng này để đánh giá năng lực BBE.** CPU/RAM backend, CPU/RAM injector trong một đợt tải BBE, timeout, DB connections, slow-query history, lỗi auth/rate limit, correctness tiến độ/sao và recovery đều chưa có dữ liệu ứng dụng. Nguồn kiểm tra cấu hình: [`validation.json`](../results/inspect_2026-10-24T17-15-57-664Z_f7b9ec30/validation.json). Các kiểm tra lại sau đó được lưu bằng ID mới trong `results/`.

## 4. Phân tích theo quy mô

| Quy mô | Trạng thái | Căn cứ |
|---|---|---|
| 100 người | Chưa đủ dữ liệu | Chưa chạy application workload ở mức này |
| 300 người | Chưa đủ dữ liệu | Chưa chạy application workload ở mức này |
| 500 người | Chưa đủ dữ liệu | Chưa chạy application workload; giới hạn lấy 500 thành viên ở một endpoint không phải capacity 500 người |
| 750 người | Chưa đủ dữ liệu | Chưa chạy application workload ở mức này |
| 1.000 người | **Chưa thể xác nhận** | Config hỗ trợ 1.000 VU, chưa thực thi; không có hold 5 phút hoặc stability 10–15 phút |

Không có mức “đã chứng minh” hoặc “chưa đạt vì quá tải” nào. Chưa biết ranh giới đạt/lỗi, nên không có thử nghiệm trung gian hoặc mức suy giảm để báo cáo. Không có cơ sở kết luận backend, Supabase hay k6 là thành phần bão hòa.

## 5. Mô hình tải và phạm vi đo

Xem [ARCHITECTURE.md](ARCHITECTURE.md) cho endpoint/method/auth/model/tần suất và [API_INVENTORY.md](API_INVENTORY.md) cho 95 route files từ source. Inventory là tham chiếu tĩnh qua import, không phải trace SQL chính xác. Chưa có HAR/analytics để xác nhận tỷ lệ hành vi thực tế.

- A: 250 dashboard/course, 400 video, 200 quiz, 150 leaderboard ở 1.000 VU. Có think time, nhịp heartbeat 10s/3s từ player, JWT refresh, một account/VU và quiz không lặp vô hạn để vượt cooldown. Nhóm quiz sau submit chuyển sang đọc sao/nghỉ; phân bố là trạng thái ban đầu.
- B: login arrival-rate riêng, mở cùng khóa, heartbeat, submit và completion spike riêng, không kích hoạt chung. Barrier/missed_barrier loại run warmup không kịp. Login 1.000 lượt ở một rate cho trước không tương đương 1.000 login cùng một thời điểm.
- C: ramp-down, giữ 1 VU để đọc learning/stars và gửi heartbeat, kiểm tra dữ liệu trước/sau và quan sát pool/locks. Chưa thực thi nên chưa có thời gian phục hồi hoặc kết luận không mất dữ liệu.
- VU có cả ngủ, đọc và tương tác; **1 VU không bằng 1 HTTP request đồng thời**. API traffic và media delivery tách biệt: suite không tải stream YouTube, ảnh/R2 hoặc thực thi JS/RSC của trình duyệt.
- 40 heartbeat/s cho 400 video dài là phép tính 400/10 theo mô hình, không phải RPS đo được. Số request đang bay còn phụ thuộc độ trễ. Không quy đổi trực tiếp VU thành connection database.

Threshold giả định: HTTP lỗi <1%, p95 từng API có sample <1.500ms, không lỗi nghiệp vụ/5xx/timeout/dropped iterations, không thưởng trùng hoặc lùi tiến độ. Chưa được chủ sản phẩm phê duyệt thành SLA. Các guard tài nguyên có thể dừng sớm hơn điểm cực đại; run bị guard chặn không chứng minh backend không đạt mục tiêu.

## 6. Điểm nghẽn và nguyên nhân

**Bằng chứng thực nghiệm hiện chỉ xác nhận các điều kiện chặn kiểm thử:** lỗi spawn EPERM, RAM dưới guard ở một thời điểm, lỗi build tại endpoint truy vấn DB bị vô hiệu hóa, và runner không chấp nhận build thiếu BUILD_ID. Không phải bằng chứng về latency hay connection exhaustion dưới tải.

Các giả thuyết ưu tiên đo tiếp từ source:

1. **Heartbeat và submit giữ transaction/row lock lâu:** heartbeat có timeout transaction 60s, submit 30s; đọc/ghi nhiều model, có truy vấn tuần tự. Một số nhánh progression trong transaction gọi Prisma global, tăng nhu cầu connection khi pool nhỏ. Đo SQL/transaction, pool wait, duration và lock waiter trước khi quyết định sửa. Không bỏ khóa hoặc kiểm tra elapsed để làm đẹp p95.
2. **Leaderboard từng chapter:** `take: 500` trước xếp hạng có nguy cơ bỏ người top khi Chapter >500 thành viên; đây là rủi ro correctness xác định qua source, chưa chạy để chứng minh sai kết quả. Tổng hợp ledger/progress trong memory có thể tốn CPU/IO theo lịch sử. Chưa xác định là bottleneck chính.
3. **Cache miss/prefetch:** learning/me và dashboard gọi nhiều aggregate/read song song. Cache per-process 5/30s và warm/cold instance khác nhau có thể gây burst. Không gọi mọi vòng UI timer thành HTTP polling.
4. **Injector và môi trường chung:** RAM hiện thấp, nhiều Node process, build và phát tải chung máy có thể làm sai kết luận. JSON+CSV cũng tạo I/O. Cần telemetry riêng cho k6/backend/DB và tách máy khi cần; không gán mọi lỗi cho Next.js.

Các biện pháp bảo vệ đã thấy: unique reward_key, lock theo user/attempt, snapshot câu hỏi, monthly high-water mark, transaction và outbox. Chưa đủ để khẳng định không race/double-award dưới tải. Không phát hiện N+1 toàn hệ thống bằng suy đoán; vòng upsert đáp án tuần tự trong submit là vị trí cụ thể cần profile.

## 7. Đề xuất tối ưu và xác minh

| Mức | Việc cần làm | Kiểm tra lại |
|---|---|---|
| P0 | Dựng PostgreSQL local riêng, baseline + forward migration đúng workflow; seed và kiểm tra đủ 1.000 learners độc lập | Production build phải thành công; login/video/quiz/leaderboard smoke đều qua, audit có ACK và DB thực |
| P0 | Giải phóng tài nguyên do người dùng quyết định hoặc tách injector/backend; xác minh chính sách nếu dùng dịch vụ cloud | Ghi CPU/RAM từng process, DB connection/lock, disk; không tăng tải khi injector hụt tài nguyên |
| P0 | Hoàn thiện bằng chứng correctness: quiz 100%, video 20s nhận 1 sao, submit/ENDED lặp không thưởng; đối chiếu DB và outbox | Đo riêng B submit/completion rồi C; bất kỳ sai dữ liệu nào phải dừng ladder |
| P1 | Profile heartbeat/submit; giảm truy vấn trùng, cân nhắc truyền transaction client vào helper phù hợp, batch đáp án có validation | So SQL count, lock/pool wait và p95 trước/sau trên cùng dataset; giữ nguyên security/ordering/idempotency |
| P1 | Xác minh và xử lý cắt 500 thành viên trước ranking; xét aggregate/pagination ở DB theo spec | Fixture >500, người điểm cao ngoài tập 500 phải vẫn được xếp hạng đúng; đo cold/warm và lịch sử ledger lớn |
| P1 | Xem lại dependency DB trong prerender `/api/v1/learning/periods`; xác định chủ ý dynamic/static và cách build test | Build cô lập với DB test, kiểm tra response đúng theo actor/thời gian; không tự đổi cache trước khi có specification |
| P2 | Quan sát pg_stat_statements/slow-query logs, pool utilization và outbox; HAR để hiệu chỉnh prefetch/cache/think time | Đo cùng A/B/C sau instrumentation; không log token/password/query chứa dữ liệu nhạy cảm |
| P2 | Rerun ladder 1→10→25→50→100→200→300→500→750→1.000, tìm mức trung gian, lặp ≥2, stability 15 phút nếu đạt | Chỉ công bố mức được giữ đủ thời gian và đáp ứng cả latency/error/resource/correctness/recovery |

Chưa đề xuất nâng pool hoặc tạo index cụ thể chỉ từ suy đoán. Pool lớn hơn có thể tăng áp lực DB; index cần EXPLAIN/slow queries và dữ liệu đại diện. Không sửa công thức sao, quyền, schema hay business rule trong đợt này.

## 8. Khả năng triển khai trên Vercel Hobby

| Thành phần | Điều đã biết / chưa xác minh |
|---|---|
| Backend đã kiểm thử | Chưa có production build smoke thành công hoặc application capacity test |
| Database test | Chưa provision/seed PostgreSQL riêng; Supabase thật không được load test |
| Máy chủ thử nghiệm | Máy Windows 20 logical CPU/15,71 GiB RAM; đang chia sẻ tài nguyên, chưa có capacity run |
| Vercel Hobby | Không load test trực tiếp; cấu hình Fluid/region/runtime/quota còn lại của tài khoản chưa được truy xuất |
| Production | Cold starts, serverless scale, cache giữa instance, pool Supabase, RTT, media CDN, request mix và dữ liệu lớn chưa được kiểm chứng |

Tài liệu Hobby hiện liệt kê 4 CPU-giờ active CPU, 360 GB-giờ provisioned memory, 1 triệu function invocations, 100 GB Fast Data Transfer và 10 GB Fast Origin Transfer trong phần included usage. Đây là quota sử dụng, **không phải cam kết số người đồng thời**, không phải quota còn lại của dự án này. [Vercel Hobby](https://vercel.com/docs/plans/hobby).

Với Fluid Compute, tài liệu Functions hiện ghi Hobby 2 GB/1 vCPU và thời lượng mặc định/tối đa 300s; cấu hình legacy có thể khác. Không suy ra ứng dụng của người dùng đã bật Fluid, có cấu hình đó hoặc hỗ trợ 1.000 learners từ giới hạn nền tảng. [Vercel Functions Limits](https://vercel.com/docs/functions/limitations).

Supabase có cơ chế bảo vệ burst và hướng dẫn phối hợp hỗ trợ cho tải cao; chưa có xác nhận mức tải cụ thể được phép cho dự án Free này. Ứng dụng dùng auth tự xây nên không lấy quota Supabase Auth làm giới hạn login của BBE. [Supabase Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

Local Next một process khác serverless về CPU, cache, số instance/pool, network và quota. Ngay cả khi local đạt 1.000 VU cũng chưa chứng minh Vercel Hobby production phục vụ được 1.000 người. Muốn đo deployment thực phải dùng môi trường và chính sách cho phép.

## 9. Điều kiện để tiếp tục và kết luận

1. Cho phép/provision PostgreSQL riêng bằng native Windows hoặc Docker; không cần trả phí cloud. Không reset hoặc xóa DB thật. Tạo DB mới theo [README](../README.md), chạy baseline, seed rồi build với LOAD_DATABASE_URL local.
2. Đảm bảo máy có tài nguyên rảnh; kiểm tra injector tách riêng khi tăng 750–1.000 VU. Guard hiện là giả định vận hành ban đầu, không phải benchmark bộ nhớ cho k6.
3. Hoàn tất smoke nghiệp vụ và integration audit trước tải lớn. Seed/telemetry/audit mới hiện chưa được xác minh end-to-end trên PostgreSQL thật; output hiện tại không đáp ứng tiêu chí capacity.
4. Chạy A/B/C theo ladder; lưu đủ hold-only time series, per-endpoint latency/error, resource/pool/slow-query và correctness; lặp mức quan trọng. Chỉ chọn ngưỡng đạt khi tất cả tiêu chí có bằng chứng, không lấy một lần chạy không lỗi làm capacity.

**Kết luận: Chưa thể xác nhận BBE E-Learning phục vụ 1.000 người học đồng thời.** Bộ công cụ đã cấu hình được tới 1.000 VU và được kiểm tra guard/khởi tạo, nhưng chưa đo tải ứng dụng. Rủi ro cần đo ưu tiên là đường ghi heartbeat/quiz và nhu cầu connection; rủi ro correctness rõ qua source là giới hạn 500 thành viên trước ranking. Chưa có bằng chứng để công bố điểm nghẽn chính hoặc mức tải tối đa.
