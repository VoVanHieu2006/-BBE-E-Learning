# BBE Pilot — UI/UX và hiệu năng

**Trạng thái: đã triển khai Pilot Lead Chapter; chưa rollout toàn hệ thống.** Hướng thiết kế đã được người dùng duyệt. Việc duyệt kết quả Pilot trước rollout là một bước riêng, sau các gate bắt buộc bên dưới.

Base / HEAD: `cf88238ffb015cab7798256e270175f602a9724d`. Thay đổi còn trong working tree, chưa commit, merge, push hoặc deploy. Không sửa schema ứng dụng hiện có, API contract, công thức nghiệp vụ hay dữ liệu `public`. Theo quyền người dùng cấp bổ sung, đã tạo năm schema fixture riêng trong Supabase phát triển hiện tại để kiểm thử.

## Xem kết quả

- [Bộ so sánh before/after, desktop/mobile và video motion](docs/ui-cache-checkpoints/review.html)
- [Dashboard desktop sau thay đổi](docs/ui-cache-checkpoints/comparison/after-dashboard-1440.png) · [trước thay đổi](docs/ui-cache-checkpoints/comparison/before-dashboard-1440.png)
- [Dashboard mobile sau thay đổi](docs/ui-cache-checkpoints/comparison/after-dashboard-390.png) · [trước thay đổi](docs/ui-cache-checkpoints/comparison/before-dashboard-390.png)
- [Courses desktop](docs/ui-cache-checkpoints/comparison/after-courses-1440.png) · [mobile](docs/ui-cache-checkpoints/comparison/after-courses-390.png)
- [Term Transition desktop](docs/ui-cache-checkpoints/comparison/after-term-transition-1440.png) · [mobile](docs/ui-cache-checkpoints/comparison/after-term-transition-390.png)
- [Motion desktop thực tế](docs/ui-cache-checkpoints/motion/pilot-1440.webm) · [mobile](docs/ui-cache-checkpoints/motion/pilot-390.webm)
- [Mẫu tương tác độc lập](docs/ui-cache-checkpoints/pilot.html)

Ảnh/video ứng dụng dùng API/YouTube giả lập và dữ liệu minh họa đã ghi rõ. Đây là bằng chứng frontend; không xác nhận backend, database, media thật hoặc quyền production.

## Thay đổi đã triển khai

**Cache:** mở rộng API client hiện có, không thêm state framework. Bốn URL chính xác của Chapter đã xác minh dùng session memory: dashboard members/courses, current-roster, reorganizations GET. Dashboard và Courses chia sẻ courses. Các endpoint nhạy cảm khác giữ chính sách luôn kiểm tra; `/learning/me` vẫn là business GET bắt buộc ở luồng cũ.

Cache dùng user/scope/epoch, không dùng token trong khóa; không lưu response API vào sessionStorage. Dọn riêng các entry `api_cache:` cũ mà không ghi khóa ra log. Deduplicate cả refresh; generation/controller/promise owner loại response cũ và cả side effect sau khi body trả muộn. Hủy một subscriber GET không hủy transport của subscriber khác. Giới hạn 128 query / 10 MiB payload UTF-8 có overhead kế toán; 32 snapshot tab. Đây không phải giới hạn toàn bộ JS heap.

**Phiên/quyền:** xác minh khi điều hướng Lead Chapter, quay lại ứng dụng, pageshow/BFCache và trước mutation; gộp kiểm tra trùng, không polling idle. Link Lead Chapter xác minh trước khi đổi route để giữ view hiện tại. Scope mới làm sạch dữ liệu cũ. Logout thu hồi memory ngay trước khi đợi network. Refresh token có owner guard. Modal portal nhận trạng thái kiểm tra qua React context, được ẩn/inert khi phiên đang kiểm tra hoặc thất bại, đồng thời giữ iframe trong DOM.

**Draft:** khóa mới User ID + Chapter ID, version + owner validation; giữ URL sheet, parse result/position selections, ngày hiệu lực và nhiệm kỳ. Memory cập nhật tại commit của input, ghi bền debounce 300ms, flush khi rời trang. Storage failure báo lỗi và cho thử lưu lại. Mã mới không đọc, tự khôi phục, migrate hay xóa draft legacy không rõ chủ. Nhiệm kỳ người dùng đã chọn được giữ cả khi server báo nhiệm kỳ hiện tại mới hơn; UI yêu cầu chọn lại trước xác nhận theo ràng buộc backend hiện hữu.

**Mutation/lịch:** invalidation theo resource Chapter; refresh chỉ view đang mở. Lịch đã biết được theo dõi từ cả Current và History, có timer chỉ cho view đang hiển thị và kiểm tra lại khi mở view. Chỉ khi có bằng chứng APPLIED / nhiệm kỳ đã chuyển thật mới invalidate aggregate học tập tương ứng. Schedule/cancel không tự khẳng định reset học tập.

**UI/motion:** giữ logo, navy/blue/orange, font và menu BBE. Dashboard có tiêu đề 24px, nhóm năm chỉ số tabular trong panel phẳng, phân cấp màu cho tiến độ/Star và timestamp đồng bộ. Mobile chuyển thành hàng nhãn–giá trị; control Pilot tối thiểu 44px. CSS mới opt-in ở ba trang. Route/dialog/disclosure dùng opacity 0,88 → 1 / 180ms; reduced motion tắt animation. Không thêm transform/filter/layout animation lên shell hoặc tổ tiên player. Accordion mở sẵn, giữ DOM bài học; video tiếp tục trong modal portal riêng. Không đổi iframe key để tạo hiệu ứng.

## Before / after đo trực tiếp

Điều kiện so sánh mới: Edge `156.0.4314.42`, Next dev + React Strict Mode, 1440×900, cùng fixtures và thao tác pointer qua menu có hover; làm nóng trước khi đếm 10 vòng Dashboard ↔ Courses.

| Chỉ số | Before cf88238 | After Pilot | Bằng chứng |
| --- | ---: | ---: | --- |
| Business GET trong 10 vòng | 90 | 0 | `comparison/*-measurement.json` |
| Auth GET trong 10 vòng | 0 | 20 | Xác minh protected navigation, tách khỏi business |
| Current ↔ History sau tải đầu, 10 vòng | 20 theo baseline kế hoạch | 0 trong kiểm thử Pilot | `runtime-verification.json` |
| Refresh Dashboard | 2 endpoint | Đúng 2 endpoint | C03 |
| Refresh History | Chưa đo lại baseline | Đúng 1 history GET | C03 |
| Hover Thành viên + idle 3,5 giây | Kế hoạch ghi 1 + 4 GET | 0 business GET; kiểm tra idle auth riêng | C04 |
| Mở/đóng accordion | Chưa có disclosure | 0 GET | `motion-verification.json` |

Không trộn 90 của phép đo mới với 30 trong kế hoạch: baseline kế hoạch dùng Chromium và không có trace/version/điều kiện Strict Mode đầy đủ. Request RSC/code/assets vẫn được giữ; loại business prefetch chỉ ở Lead Chapter. Số request auth tăng là kiểm tra an toàn được yêu cầu, không do animation.

Độ trễ của 20 lượt đã làm nóng (bỏ hai lượt warm-up đầu, nearest-rank): Before p50 **138ms**, p95 **155ms**; After p50 **187ms**, p95 **285ms**. Lần đo cuối không chứng minh navigation nhanh hơn; auth verification và tải development/host ảnh hưởng phép đo. Không suy diễn giảm request thành giảm latency. Mẫu runtime: CLS 0; một long task 127ms; heap cuối 39.8MB. Chưa đo tăng trưởng heap dài hạn hoặc cache-render timing riêng.

Hai full production build cùng Next 14.2.35, cùng dependency installation và DB fixture đều PASS. Gzip JS union của root layout + Chapter layout + route tăng: Dashboard **3,652 B**, Courses **4,238 B**, Term Transition **4,886 B**. Xem `bundle-comparison.json`; không tính đây là network bytes thực tế hoặc CSS. Có warning jose CompressionStream/DecompressionStream trên Edge Runtime ở cả hai build; không nâng dependency.

## Kiểm thử và gate

| Gate | Trạng thái / phạm vi |
| --- | --- |
| Checkpoint 1 audit | PASS cho source inventory; baseline kế hoạch được ghi riêng |
| Checkpoint 2 architecture | PASS tài liệu và lõi Pilot; các giới hạn nêu rõ trong architecture |
| Checkpoint 3 design | Hướng đã duyệt; có ảnh/clip thực tế để duyệt kết quả Pilot |
| TypeScript | PASS `npx tsc --noEmit` ở working tree |
| Unit / nghiệp vụ / leaderboard / video rules | PASS **239/239**, 14 suite; DB URLs khóa port 1 |
| C01 cache Dashboard/Courses | PASS mocked, 10 vòng / 0 business GET |
| C02 Current/History | PASS mocked, 10 vòng / 0 business GET sau tải đầu |
| C03 refresh | PASS endpoint chính xác; dedup bấm đôi được kiểm tra bằng deferred-promise unit test |
| C04 prefetch/idle | PASS mocked; không có business GET từ hover/idle |
| C05 lỗi / response cũ | PASS unit và partial-failure browser; giữ dữ liệu/timestamp thành công cũ |
| C06 draft | PASS navigation, refresh, F5 và quota failure/retry; bổ sung kiểm tra giữ nhiệm kỳ khi server đổi term |
| C07 account isolation | PASS mocked cross-tab A→B, legacy nguyên vẹn, không có API sessionStorage; token refresh/logout race có unit test |
| C08 quyền / BFCache | PASS mocked pageshow thu hồi quyền; portal pending/error có kiểm tra riêng trong motion |
| C09 schedule/apply với DB thật | **NOT VERIFIED**; learning-cycles thật dừng vì transaction 30s trước đoạn apply/reset |
| C10 real media / physical devices / bộ nhớ dài hạn | **NOT VERIFIED** |
| Responsive specimen | PASS Edge/Chrome/Chromium/WebKit, 84 view/viewport combinations; 360/390/430/768/1024/1440 và landscape |
| Motion thực tế | PASS cả Edge/WebKit × 1440/390; 0 frame trắng, 0 GET accordion, giữ iframe; CLS 0–0.000566 |
| Video browser suite | Xem phần chẩn đoán bên dưới và log kết quả cuối; không tuyên bố PASS từ unit test |
| Build đầy đủ | PASS Pilot và baseline trên DB fixture; lần build trước dùng DB không thể kết nối vẫn được lưu FAIL |
| DB organization integrity | PASS **22/22** với default transaction 30s của client test từ xa; lần đầu ba lỗi transaction vẫn được lưu |
| DB leaderboard hiện hành v8 | PASS **5/5**, fixture/oracle độc lập; suite legacy lỗi thời vẫn ghi FAIL riêng |
| DB learning-cycles / learning-flow | **FAIL**; chi tiết bên dưới, không sửa nghiệp vụ/assertion để ép PASS |
| Bảo toàn public sau test | PASS: digest 60 bảng / 2,711 dòng và schema metadata trùng backup trước test |

### Regression video và tính trung thực của bằng chứng

Lần chạy suite gốc: 91 PASS, 13 SKIP, 4 FAIL ở assertion `popover === 'manual'`. Chạy lại tám ca fullscreen trên **source cf88238 không sửa**: cùng bốn FAIL; bốn biến thể CSS fallback PASS. Controller hiện hữu dùng fixed CSS và neutralize ancestor, không dùng popover.

Sau review độc lập, chỉ sửa test: mô tả popover available/unavailable, kiểm tra giữ nguyên parent/iframe ở lúc vào fullscreen; giữ toàn bộ kiểm tra geometry, rotation, history, heartbeat, load count và exit. Không sửa `YouTubePlayer.tsx`, `video-fullscreen.ts` hay công thức progress.

Lần chạy toàn bộ sau sửa assertion: 93 PASS, 13 SKIP, 2 FAIL ở WebKit desktop stress 100 DOM seeks (timeout/controls timing). Rerun riêng hai ca khi không chạy browser workload đồng thời: **2/2 PASS**, log `video-webkit-rerun.txt`. Không sửa timeout, giảm số seek hoặc bỏ kiểm tra. Chưa có một lần chạy toàn suite sạch; giữ rủi ro không ổn định và 13 SKIP. Media/thiết bị thật vẫn NOT VERIFIED.

### Database và dependency

Người dùng cho phép sử dụng Supabase phát triển hiện tại. Đã xác minh project **rieqrjxatzoiqubxyhlw**, database **postgres** bằng cấu hình app và DIRECT, không đưa URL/credential vào báo cáo. Guard localhost cũ vẫn giữ mặc định; development mode yêu cầu đúng project, fingerprint, manifest schema READY, không FK ra ngoài, backup mới hợp lệ và server HTTP attestation. Không giả localhost hoặc tắt TLS.

Đã backup 60 bảng public / 2,711 dòng, mã hóa AES-256-GCM, khóa Windows DPAPI CurrentUser, ACL giới hạn; khôi phục giải mã từ file đã kiểm tra. Test chỉ ghi năm namespace `bbe_ui_it_*`, mỗi namespace clone model/constraint/function/trigger ứng dụng đã review. Không DROP SCHEMA, reset migration hay ghi auth/storage. So sánh read-only sau cùng xác nhận toàn bộ public rows + metadata trùng digest backup. Không đọc nội dung auth/storage để kết luận digest hai schema đó.

Kết quả thật và fixture inventory: [development-integration-results.json](docs/ui-cache-checkpoints/development-integration-results.json), [báo cáo integration](docs/ui-cache-checkpoints/DEVELOPMENT_INTEGRATION_REPORT.md). **1,171 dòng fixture còn giữ trong năm schema**, chưa dọn; không đếm cộng lại các receipt cũ của cùng schema. Bản sao lưu ở thư mục scratch bị git ignore, không đưa dữ liệu/khóa vào tài liệu.

- Leaderboard legacy FAIL ở fixture không có CompetitionMonth và oracle 20 thành viên/điểm thưởng cũ. Bổ sung suite hiện hành độc lập theo đặc tả: 126/28 = 4.5, 20/28 đạt chuẩn, alias dedup, Yellow/Green không bonus, RED exclusion. PASS 5 ca; không coi là thay thế toàn phạm vi suite cũ.
- Organization lần đầu FAIL ba ca transaction-not-found. Rerun với default transactionOptions của **client test** maxWait15s/timeout30s: 22/22 PASS. Không sửa backend, raw-import isolation/lock guard hay assertion.
- Learning-cycles FAIL P2028: transaction có timeout backend 30,000ms đã hết hạn ở khoảng 30,193ms trong enqueueAssignmentSync; chưa đến kiểm thử apply/reset. Không tăng timeout backend.
- Learning-flow ban đầu bị guard từ chối fixture Chapter+DNA trùng người; sửa dùng hai người riêng. Tiếp đó thiếu durationMinutes bắt buộc; thêm 10 phút vào payload fixture. Rerun vượt authoring/authorization/cover validation/anti-seek/sequential gate, rồi FAIL assertion fractional video percentage: test đòi số phân số nhưng API hiện làm tròn. Không sửa công thức tiến độ hoặc assertion; phần còn lại chưa chạy không PASS.

Build/test mock ban đầu dùng URL localhost port 1 có chủ đích không thể kết nối; build ban đầu FAIL được giữ ở `build-verification.txt`. Sau quyền Supabase bổ sung, full build Pilot và baseline PASS trong nguồn TEMP riêng, không có file .env, env datasource khóa schema fixture: `build-development-verification.txt`, `build-baseline-verification.txt`. Không sửa API prerender để ép build.

`npm audit` ở kế hoạch ghi 7 advisory nhưng hai lần audit hiện tại trả 0. Không có ID/path của bảy advisory để phân tích reachability; discrepancy **NOT VERIFIED**. Không nâng dependency hay dùng `--force`. Hai patch package của người dùng vẫn chỉ 1 + 57 dòng thêm ban đầu.

## File và bằng chứng

- Tài liệu: `UI_PERFORMANCE_AUDIT.md`, `TAB_CACHE_ARCHITECTURE.md`, `UI_DESIGN_SPEC.md`, báo cáo này.
- Cache/draft: `src/lib/api/client.ts`, `tab-query-cache.ts`, `use-api-query.ts`, `transition-draft-store.ts`.
- Pilot: layout và ba page Lead Chapter, `pilot.module.css`.
- Shared opt-in: Sidebar, ContentTransition, PageTransition, PilotVisibility, Modal và ModalMotion CSS. Default ngoài Pilot được giữ; logout memory revocation và xử lý abort an toàn có phạm vi client chung.
- Tests: ba file unit mới; sửa assertion browser video đã lỗi từ baseline như giải thích trên.
- Script, logs, JSON, ảnh và clip: `docs/ui-cache-checkpoints/`. Source của snapshot phục vụ UI được đối chiếu byte/hash với working tree qua `runtime-source-hashes.json`.
- [Ledger](docs/ui-cache-checkpoints/PROGRESS.md) ghi quyết định và review. Skills/configuration cài sẵn của người dùng không bị sửa.

**Quyết định rollout: BLOCKED.** Chưa áp dụng Admin → Lead DNA → Member → Guest. Cần đóng các gate critical còn FAIL/NOT VERIFIED, rồi trình bộ before/after cuối cùng để người dùng duyệt trước rollout.
