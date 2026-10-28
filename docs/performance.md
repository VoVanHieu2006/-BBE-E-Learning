# Hiệu năng và mô hình tải

**Chưa xác nhận năng lực 1.000 người học.** Kết quả gần nhất được hợp nhất từ đợt đo 24–25/10/2026: production build chạy localhost kết nối Supabase thật, tối đa **1 VU**. Không có load test deployment Vercel. Đây là bằng chứng lịch sử có timestamp, không phải số đo mới sau refactor.

## Môi trường và giới hạn

Máy Windows i7-12700H, 20 logical CPU, RAM khoảng 15,71 GiB; Node 24.11.1/k6 2.2.0 tại lúc đo. HTTP tới `127.0.0.1:3100` do runner mở, snapshot build riêng, không thay bằng next dev. Runtime chưa bị giới hạn tương đương cloud 1 vCPU/2 GB.

DB Supabase ở vùng suy ra us-west-1, client pool 3, observer thêm tối đa một connection. `vercel.json` cấu hình sfo1 nhưng chưa xác minh revision/region thực qua dashboard. Độ trễ local→DB khác app/DB gần nhau ở production.

Cohort được phép có đúng 10 tài khoản synthetic thuộc DNA, một Chapter rỗng; tái sử dụng nội dung công khai, không sửa khóa/câu hỏi/policy. Fixture private được giữ nhận diện cohort, không commit mật khẩu/token. R2/email/YouTube credentials tắt trong harness, không đo rendering/streaming media. Hai submit thành công được đối chiếu ACK/DB, resend không thưởng thêm. Không thấy progress giảm/duplicate reward trong cohort, không chứng minh mọi heartbeat đều được lưu.

Harness Supabase opt-in đặt ceiling 10 VU/240s/không spike, nhưng thực tế dừng ở 1 VU vì latency baseline không đạt. Ceiling là guard của công cụ, không phải capacity đã chứng nhận. Profile ngoài loopback/việc mở rộng tải cần phạm vi cho phép riêng; quyền đã có trong đợt đo cũ không được suy ra thành quyền phát tải mới.

## Kết quả thực

RPS là trung bình cả ramp/think/recovery, không phải throughput tối đa. Percentile ít mẫu chỉ mô tả sample. CPU là peak trung bình cửa sổ 5 giây quy đổi % một logical core, không phải CPU cloud; RAM là working set MiB.

| Run UTC / mode | VU | HTTP | RPS | p95 ms | p99 ms | HTTP lỗi % | CPU backend %/core | RAM MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 24/10 17:57:37 / static-smoke | 1 | 14 | 0,4653 | 6,68 | 7,85 | 0 | 0,61 | 96,74 |
| 24/10 18:04:20 / dashboard | 1 | 1 | 0,0278 | 5.077,73 | 5.077,73 | 0 | 5,90 | 100,56 |
| 24/10 18:08:16 / quiz | 1 | 2 | 0,0435 | 9.774,47 | 9.955,15 | 50 | 5,90 | 100,93 |
| 24/10 18:11:50 / quiz diagnostic | 1 | 17 | 0,0374 | 20.661,63 | 25.880,30 | 0 | 6,85 | 106,29 |
| 24/10 18:22:34 / diagnostic-read | 1 | 28 | 0,1244 | 8.646,67 | 8.916,62 | 0 | 6,51 | 125,73 |
| 24/10 18:30:20 / video | 1 | 19 | 0,0882 | 9.687,34 | 11.217,65 | 0 | 5,27 | 105,73 |
| 24/10 18:35:38 / quiz | 1 | 3 | 0,0124 | 25.821,12 | 27.607,91 | 33,33 | 5,90 | 102,39 |
| 24/10 18:43:40 / quiz diagnostic | 1 | 5 | 0,0177 | 27.501,07 | 28.882,52 | 0 | 6,21 | 103,83 |

Static login-page smoke đạt nhưng không chứng minh learner API đạt SLA. Chưa mức nào chứng minh p95 <1.500ms cho toàn API đã gọi. Diagnostic runs dùng timeout/p95 30s để thu đủ trace, **không đổi SLA thành 30s**. Quiz từng timeout mở bài và 409 do harness nghĩ quá hạn server ba phút; đã sửa pacing đọc `expiresAt`, không sửa attempt thật hoặc tính lỗi đó thành capacity bottleneck.

DB connection peak quan sát **11/60**, lock waiter 0 ở sample 5s, k6 RAM khoảng 30–32 MiB. Đây là dữ liệu 1 VU; chưa chứng minh không contention/saturation ở tải lớn. Không tạo overload nên chưa chứng minh recovery sau overload; idle pool không buộc quay đúng connection count trước run.

### Endpoint profile

| Endpoint | Số mẫu | CPU local TB ms | Wall local TB ms | SQL/request TB |
|---|---:|---:|---:|---:|
| login | 3 | 334,00 | 5.260,61 | 16,00 |
| member_courses | 3 | 67,33 | 8.103,98 | 37,33 |
| courses | 3 | 15,67 | 949,72 | 8,33 |
| deadlines | 3 | 5,33 | 891,48 | 8,00 |
| learning/me | 4 | 78,25 | 8.306,81 | 74,00 |
| progress GET | 4 | 46,75 | 3.587,94 | 28,00 |
| leaderboard | 3 | 265,67 | 6.150,97 | 35,33 |
| heartbeat | 13 | 81,69 | 8.252,20 | 35,15 |
| start_quiz | 1 | 171,00 | 29.226,44 | 117,00 |
| submit_quiz lần đầu | 1 | 157,00 | 20.593,31 | 63,00 |

CPU có profiler/SQL logging/cold code/GC overhead; Windows counter lượng tử khoảng 15–16ms, sample 0 không phải miễn phí. SQL event có thể gồm BEGIN/COMMIT, không gồm SQL nội bộ trigger. SQL duration gồm driver/mạng và có thể song song, không cộng rồi coi là latency endpoint. Không có mẫu là chưa đo, không điền 0 để tuyên bố nhanh.

SELECT 1 trên connection mở có RTT 170,10–171,93ms. Hai lookup EXPLAIN chạy 0,043/0,057ms tại DB nhưng wall 173–174ms; chỉ hai query đó có bằng chứng thời gian chủ yếu ngoài SQL execution. Không suy ra mọi query phức tạp đều nhanh hoặc không cần index.

## Mô hình giả định

Mix được dùng để ngoại suy: 25% dashboard/khóa học (6 GET/45s), 40% video (heartbeat 10s), 20% quiz (mở+nộp/180s), 15% BXH (45s/lượt). Không tính login/refresh/khởi tạo/media/burst. Nhóm quiz giả định phiên thay thế liên tục, khác closed cohort sau submit. k6 không sử dụng cache client giống UI nên phải đo lại cache hit/prefetch.

| Số người **giả định** | API RPS | Request/15 phút | CPU tương đương local core | SQL/s ngoại suy | HTTP pending nếu wall giữ nguyên |
|---|---:|---:|---:|---:|---:|
| 100 | 7,89 | 7.100 | 0,52 | 221 | 50 |
| 300 | 23,67 | 21.300 | 1,57 | 663 | 151 |
| 500 | 39,44 | 35.500 | 2,62 | 1.104 | 251 |
| 750 | 59,17 | 53.250 | 3,93 | 1.656 | 377 |
| 1.000 | 78,89 | 71.000 | 5,25 | 2.208 | 503 |

Trung bình 284 API request/giờ-người, 18,88 giây CPU local/giờ-người. CPU demand = tổng RPS × CPU seconds/request; HTTP pending = tổng RPS × wall seconds nếu throughput duy trì được. Pending HTTP **không phải DB connections**. Đây là nhu cầu theo model, không phải kết quả chạy các mức VU đó, không chứng minh autoscale/latency/RAM/cloud capacity.

Hệ số CPU cloud 0,5×–2× chỉ là độ nhạy chưa hiệu chuẩn, không confidence interval. Không đổi working set cả Node thành memory/VU. Function instance và tổng deployment có ranh giới khác nhau; không dùng số CPU local để chia ra số người cloud được bảo đảm. Quota/giá/chính sách nhà cung cấp thay đổi theo thời điểm: kiểm tra dashboard/tài liệu chính thức trước quyết định vận hành, không giữ số quota cũ thành cam kết hiện hành.

## Việc đo tiếp

Ưu tiên giảm round-trip heartbeat/learning/quiz bằng trace, batch/cache đúng scope và truyền transaction client khi phù hợp; kiểm chứng giữ watch-time, quyền, reward idempotency. Không bỏ locks/guards, đổi business formula, tăng pool/index tùy ý để lấy latency đẹp.

Đo RTT từ function/DB gần nhau, SQL count/pool wait, complex query EXPLAIN, cache hit và usage thông thường. Sau baseline đạt yêu cầu và phạm vi cho phép rõ ràng mới chạy ladder/stability 10–15 phút và correctness dưới concurrency. Chưa có đường cong tăng tải để xác định điểm suy giảm. `take:500` ở Chapter legacy là rủi ro correctness cần fixture lớn riêng.

Hai submit 6 câu đã nhận đúng 6 sao/lần; 20 VIDEO stars trong cohort là **history seed**, không phải completion reward được đo. Chưa xem hết video 812s trong load run; chưa đối chiếu từng heartbeat bằng durable event ID; chưa đo DB CPU/RAM/slow-query history đầy đủ hoặc browser/media throughput.

## Tái tạo bằng chứng

Hướng dẫn runner/guards: [load-tests/README](../load-tests/README.md). Offline safety/profiler/inspect/harness smoke kiểm tra công cụ, không phải performance ứng dụng. Inventory current API: [api](api.md), cache/auth current: [architecture](architecture.md); audit source ngày 25/10 có một số mô tả cache đã được thay thế.

Raw runs/reports/JSON hiện nằm dưới `artifacts/load-tests/{results,reports}` và được Git bỏ qua. Run IDs được giữ trong output, ví dụ `2026-10-24T18-22-34-740Z_08a2b22c`, `2026-10-24T18-30-20-514Z_e857472f`, `2026-10-24T18-43-40-908Z_f29ee846`. Không nhân bản raw/private dữ liệu vào tài liệu chuẩn; tái tạo bằng runner/analyze/estimate khi có môi trường được phép. Giữ manifest fixture private để tái sử dụng đúng cohort, không seed thêm mỗi run.
