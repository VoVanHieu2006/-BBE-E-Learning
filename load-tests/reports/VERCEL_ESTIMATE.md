# Ước lượng có điều kiện cho Vercel Hobby

**Không phải kết quả chạy 1.000 VU trên Vercel hoặc Supabase.** Các hàng số người bên dưới là đầu vào giả định, không phải quy mô đã kiểm thử.

Mô hình: 25% dashboard/khóa học (6 GET mỗi 45s), 40% video (heartbeat 10s), 20% quiz (một phiên 180s với mở+nộp), 15% bảng xếp hạng (45s/lượt). Không tính đăng nhập/refresh, request khởi tạo, media hay burst. Nhóm quiz là các phiên được thay thế liên tục để giữ tỷ lệ; khác closed cohort k6 sau khi nộp bài.

## Một người tốn bao nhiêu và lấy Vercel chia ra thế nào?

Trung bình theo cơ cấu trên: **284 API request/giờ-người**, **18.88 giây CPU/giờ-người**, tương đương **5.245 ms CPU mỗi giây một người đang hoạt động**. Đây là phép ngoại suy từ endpoint, chưa đo một phiên người dùng đủ một giờ.

Giả sử chi phí CPU trên Vercel bằng máy đo: 1 vCPU cung cấp 1.000ms CPU/giây. Chia 1.000/5.245 ≈ **191 người/instance ở 100% CPU**; để CPU tối đa 70%: 700/5.245 ≈ **133 người/instance**. Đây chỉ là giới hạn CPU lý thuyết theo giả định, không chứng minh p95, RAM hoặc DB đáp ứng.

Hobby Fluid Compute có cấu hình function 1 vCPU/2 GB và có thể mở rộng nhiều instance. Vì vậy 191 người không phải trần toàn deployment. 1.000 người tương đương khoảng **8 đơn vị 1 vCPU** ở mức dùng CPU 70%, chưa tính phân bố các route/instance và hiệu quả autoscale. [Vercel Functions limits](https://vercel.com/docs/functions/limitations).

Ngân sách Hobby 4 CPU-giờ = 14.400 giây CPU: 14.400/18.88 ≈ **763 giờ-người** trong kỳ quota. Ngân sách invocation: 1.000.000/284 ≈ **3521 giờ-người**. Theo mô hình điểm này, CPU hết ngân sách trước invocation; chưa tính tài nguyên khác và mức sử dụng sẵn có. Giờ-người là tổng thời lượng dùng, không phải số người đồng thời. [Vercel Hobby](https://vercel.com/docs/plans/hobby).

| Phiên giả định | CPU-giờ theo CPU local | API requests |
|---|---:|---:|
| 100 người × 15 phút | 0.13 | 7100 |
| 500 người × 15 phút | 0.66 | 35500 |
| 1000 người × 15 phút | 1.31 | 71000 |
| 1000 người × 60 phút | 5.25 | 284000 |

1.000 người ×1 giờ tương ứng khoảng 5,25 CPU-giờ theo mô hình, vượt ngân sách CPU 4 giờ nếu quy đổi phần cứng đúng; không có nghĩa ứng dụng đã bị đo là không chịu được 1.000 người. RAM không thể tính bằng 2GB chia working set của cả Node process: cần đo phần RAM tăng thêm dưới concurrency. CPU chờ DB không được tính toàn bộ như Active CPU. [Cách tính Fluid Compute](https://vercel.com/docs/functions/usage-and-pricing).

## Đầu vào đo thực ở 1 VU

| Endpoint | Mẫu | CPU TB local (ms) | Wall TB local (ms) | SQL/request TB |
|---|---:|---:|---:|---:|
| login | 3 | 334.00 | 5260.61 | 16.00 |
| member_courses | 3 | 67.33 | 8103.98 | 37.33 |
| streak | 3 | 5.33 | 1962.81 | 8.00 |
| stars | 5 | 21.60 | 4490.17 | 21.20 |
| courses | 3 | 15.67 | 949.72 | 8.33 |
| deadlines | 3 | 5.33 | 891.48 | 8.00 |
| course | 3 | 15.67 | 1060.28 | 4.33 |
| learning | 4 | 78.25 | 8306.81 | 74.00 |
| progress | 4 | 46.75 | 3587.94 | 28.00 |
| leaderboard | 3 | 265.67 | 6150.97 | 35.33 |
| lesson | 1 | 31.00 | 4301.49 | 20.00 |
| heartbeat | 13 | 81.69 | 8252.20 | 35.15 |
| start_quiz | 1 | 171.00 | 29226.44 | 117.00 |
| submit_quiz | 1 | 157.00 | 20593.31 | 63.00 |

CPU là process CPU theo thời gian request không chồng lấp, có cả overhead profiler/SQL logging, cold code và GC. Counter trên Windows có lượng tử khoảng 15–16ms; giá trị 0 không có nghĩa không tốn CPU. Số mẫu ít, không dùng làm confidence interval. Submit chỉ lấy lần đầu; heartbeat bỏ PLAY đầu khi có mẫu tiếp theo.

## Tải và quota theo mô hình

| Người giả định | API RPS giả định | Request/15 phút | CPU tương đương máy local (core) | SQL/s ngoại suy thô | HTTP pending nếu latency local giữ nguyên |
|---|---:|---:|---:|---:|---:|
| 100 | 7.89 | 7100 | 0.52 | 221 | 50 |
| 300 | 23.67 | 21300 | 1.57 | 663 | 151 |
| 500 | 39.44 | 35500 | 2.62 | 1104 | 251 |
| 750 | 59.17 | 53250 | 3.93 | 1656 | 377 |
| 1000 | 78.89 | 71000 | 5.25 | 2208 | 503 |

Profile quiz là bài 6 câu; không tự áp chi phí này cho bài dài hơn. Video completion mới chưa được đo; không lấy lịch sử seed làm bằng chứng đã xem đủ video.

Request rate = tổng số người của từng nhóm × số request / thời gian chu kỳ. CPU demand = Σ(RPS endpoint × CPU giây/request). HTTP pending = Σ(RPS × wall giây), chỉ đúng như yêu cầu cân bằng nếu throughput đó được duy trì; **không phải DB connections**. Không có quy tắc lấy 30.000 concurrency chia cho một hằng số để ra số người học.

Ở 1.000 người theo giả định này: khoảng 78.89 API request/s, 71000 request/15 phút, chưa cộng auth/khởi tạo. Nếu tất cả đều được tính function invocation và không có sử dụng khác, quota 1 triệu invocation tương ứng khoảng 3.52 giờ hoạt động liên tục ở mức này. Đây là **ước lượng quota**, không phải thời gian hệ thống chắc chắn chịu được tải.

Hobby hiện liệt kê 1 triệu Function Invocations, 4 CPU-hours Active CPU và 360 GB-hours Provisioned Memory trong included usage. Không phải quota còn lại của tài khoản. [Nguồn Vercel Hobby](https://vercel.com/docs/plans/hobby).

## Độ nhạy CPU — chưa hiệu chuẩn phần cứng

| Hệ số giả định so với CPU local | CPU cần ở 1.000 người (core) | Thời gian dùng hết ngân sách 4 CPU-giờ nếu duy trì tải (giờ) |
|---|---:|---:|
| 0.5× | 2.62 | 1.53 |
| 1× | 5.25 | 0.76 |
| 2× | 10.49 | 0.38 |

Các hệ số 0,5×–2× chỉ là phép thử độ nhạy, **không phải khoảng dự báo đã xác minh**. Đặc tính CPU máy bạn khác CPU cloud, sample còn ít và profiler có overhead. Nhiều instance có thể tự mở rộng; 1 vCPU/instance không phải 1 vCPU cho cả deployment. Không lấy working set local nhân theo VU để suy ra Provisioned Memory: Fluid Compute có thể chia sẻ instance giữa nhiều request. [Giới hạn Functions](https://vercel.com/docs/functions/limitations), [Fluid Compute pricing](https://vercel.com/docs/functions/usage-and-pricing).

## Khác biệt mạng và DB

Đã đo SELECT 1 khoảng 170–172ms từ máy tới Supabase us-west-1; hai EXPLAIN đơn giản có execution time 0,043–0,057ms tại server. Đây chỉ chứng minh các truy vấn đơn giản đó chủ yếu chờ ngoài execution SQL, không chứng minh mọi truy vấn đều nhẹ. Source cấu hình Vercel sfo1; cần đo RTT thật từ deployment trước khi hiệu chỉnh latency. Không lấy p95 local làm p95 Vercel.

Ví dụ độ nhạy thuần mạng: với Q SQL/request và tối đa 3 connection, phần thời gian round-trip tối thiểu lý tưởng khoảng Q×RTT/3 và tuần tự khoảng Q×RTT, chưa tính execution/queue/transaction/CPU. Nếu *giả định* RTT cùng vùng 5ms thì dùng 5ms trong công thức; **5ms chưa được đo** và kết quả không phải latency toàn API.

SQL/s ở bảng là ngoại suy tuyến tính từ sample, chưa áp cache hit/stampede hoặc queueing. Leaderboard/cache toàn hệ thống có thể giảm SQL dưới nhiều người cùng đọc; user khác nhau và cold instance có thể tăng áp lực. Chưa đo DB CPU, giới hạn pooler thực hoặc saturation, nên không kết luận Supabase Free phục vụ được con số SQL/s này.

## Kết luận

Có thể định lượng nhu cầu request, CPU giả định và quota cho mục tiêu 1.000 người. **Chưa thể xác nhận sức chịu tải hoặc số người tối đa của deployment.** Cần giảm round-trip trên đường heartbeat/quiz, hiệu chỉnh bằng Usage/latency thật và đo concurrency trong môi trường được phép trước khi cam kết.

Nguồn các profile: [2026-10-24T18-22-34-740Z_08a2b22c](../results/2026-10-24T18-22-34-740Z_08a2b22c/request-cpu.jsonl), [2026-10-24T18-30-20-514Z_e857472f](../results/2026-10-24T18-30-20-514Z_e857472f/request-cpu.jsonl), [2026-10-24T18-43-40-908Z_f29ee846](../results/2026-10-24T18-43-40-908Z_f29ee846/request-cpu.jsonl).