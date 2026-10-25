# Báo cáo P0 tổ chức, controls và fullscreen

## A. Repository và phạm vi triển khai

- Branch: `main`.
- HEAD trước sửa và sau sửa: `da8a810a6d1c42bb2eea06facf7830e6390f6f56`.
- Đã đọc HEAD và trạng thái chưa commit trước phân tích. Không dùng baseline cũ `c33bdde…` làm giả định. Không commit/push/deploy ứng dụng trong phiên này.
- Hai migration **đã áp dụng vào database Supabase được cấu hình**: `20261025_organization_integrity`, `20261025_lead_binding_guards`. Prisma migration ledger xác nhận finished; [kiểm tra sau deploy](migration-after.json).
- Bản sửa dữ liệu duy nhất đã áp dụng là trường hợp giữ Chapter Demo được người dùng duyệt; xem mục C. Không xóa user, ledger, tiến độ hay snapshot.
- File người dùng đang sửa trong `load-tests/` và sổ tay gốc không bị thay đổi.
- [Danh sách file của bản sửa](changed-files.json). Các đường dẫn trong danh sách gồm source, migration, test, công cụ audit và bằng chứng; không gồm thay đổi load-tests của người dùng.

Quyết định mới nhất: Lead gắn vĩnh viễn một Chapter, không chuyển DNA; Admin toàn hệ thống không bị giới hạn này. Vì vậy test “thu hồi rồi gán Chapter khác thành công” của prompt đầu đã được thay bằng “vẫn từ chối Chapter khác, cho phép bổ nhiệm lại Chapter cũ và giữ lịch sử”. DNA tính toàn bộ sao trong cùng kỳ kể cả trước gia nhập. Deadline dùng công thức chung mục 18 theo xác nhận sau audit.

## B. Nguyên nhân và giải pháp

### 1. Một tài khoản có hai phạm vi Lead — đã chứng minh trên dữ liệu thật

Tài khoản được duyệt có position Lead thực sự ở **Chapter Demo**, nhưng legacy `chapter_members` trỏ sang **BBE Seed Xuất sắc Chapter**. Authorization cũ hợp nhất quyền từ assignment và legacy role `CHAPTER_LEADER`/Chapter index, làm lộ hai phạm vi quản lý. Dữ liệu này không phải hai position Lead active; cần phân biệt với khả năng tạo trùng ở tầng DB.

Database trước sửa thiếu invariant thống nhất giữa các nguồn quyền. Các luồng bổ nhiệm/import có thể tạo trạng thái mà frontend validation không ngăn được; chuẩn hóa email và ràng buộc đang hoạt động chưa đủ chống concurrent writes. Cache quyền phía server và cache danh sách client cũng có thể giữ trạng thái cũ.

Giải pháp:

- `chapter-lead.ts` là bộ phân giải duy nhất cho phạm vi Lead hiện tại: phải có tenure hợp lệ, khớp permanent binding; trạng thái mâu thuẫn bị từ chối. Legacy role/index không tự cấp quyền.
- `ChapterLeadBinding` lưu Chapter cố định; lịch sử position vẫn có khoảng hiệu lực. DB trigger không cho đổi/xóa binding hoặc tạo tenure lịch sử giả ở Chapter khác. Admin được miễn quy tắc Lead một Chapter.
- DB unique index email `lower(btrim(email))` và trigger canonical hóa; audit hiện không có nhóm email trùng sau chuẩn hóa. Trước constraint, email khác casing/whitespace có thể khác userId; không phát hiện trường hợp đó trong dữ liệu audit.
- Writer serialize theo user bằng cập nhật hàng user thực sự; deferred validation kiểm tra trạng thái cuối transaction, cả interval tương lai. Test concurrent ở READ COMMITTED, REPEATABLE READ và SERIALIZABLE không cho hai assignment hợp lệ.
- API bổ nhiệm trả 409 và tên Chapter đang ràng buộc. Backend kiểm tra Chapter thực được phân, không tin chapterId client. Thu hồi tenure có hiệu lực với cùng JWT ngay lần request kế tiếp.
- Các API roster/auth hiện tại bỏ cache quyền/ngữ cảnh cũ; client không dùng cache session cho đường org nhạy cảm. Cache khóa học thông thường vẫn hoạt động.

### 2. DNA vẫn hiện trong Chapter — dữ liệu thật chưa tái hiện dual-active

Audit database hiện tại phát hiện **0** tài khoản đồng thời Chapter/DNA active. Không có đủ bằng chứng để kết luận trường hợp UI người dùng từng thấy là A, B, C hay D trên dữ liệu tại thời điểm đó.

Source chứng minh các đường rủi ro: roster hợp nhất legacy Chapter index mà chưa loại DNA; kiểm tra exclusivity phụ thuộc cutover; transition chưa dọn đầy đủ position không có membership hoặc đã lên lịch. Script sửa cũ còn có fallback chọn Chapter và backfill ledger lịch sử, nên đã vô hiệu hóa đường suy đoán này.

Đã sửa transaction chuyển tổ chức để kết thúc membership/Ban/position Chapter không hợp lệ cùng timestamp, hủy assignment tương lai thành interval rỗng, xóa riêng current affiliation index và giữ Chapter affiliation intervals. DNA được kích hoạt trong cùng transaction; retry không nhân đôi. Lead Chapter cũ không đọc tiến độ hoặc thêm DNA về Ban. Lead gắn cố định bị chặn chuyển DNA, cả khi đã kết thúc tenure. DB guards áp dụng cho cả import/raw writes không đi qua UI.

Roster hiện tại loại DNA dù legacy index còn; API Admin trả active đúng khoảng hiệu lực. Thêm trang/API lịch sử Admin, ghi rõ “Đã rời Chapter” và mốc kết thúc; không suy diễn lịch sử khi thiếu dữ liệu cũ. [Ảnh giao diện với dữ liệu test](organization-history-ui.png).

Không thay đổi công thức sao cho bản sửa P0. Chỉ bỏ cache BXH sống để kết quả hiện tại không giữ affiliation cũ; snapshot đã chốt vẫn được dùng. Test xác nhận loại mọi sao Chapter trong tháng chuyển DNA, giữ sao cá nhân và tháng cũ; BXH DNA tính cả sao trước ngày vào trong cùng kỳ.

### 3. Controls và fullscreen

HEAD hiện tại đã chứa controller tách pointer focus/keyboard focus và bộ điều phối fullscreen của lần sửa trước. Không tái thiết kế player lần này. Các test fake timers và browser xác nhận pointer hover/click không ghim vô hạn, keyboard Tab vẫn giữ controls, seek ngoài vùng/cancel được giải phóng, buffering không làm timer kẹt. Khi pause controls tiếp tục hiện.

Android/desktop: native wrapper fullscreen được gọi trong user gesture khi API có hỗ trợ; promise rejection/fullscreenerror chuyển sang theater. iPhone bị giới hạn element fullscreen; CSS viewport expansion không thể chứng minh browser chrome đã ẩn. YouTube IFrame API không cung cấp lệnh native fullscreen cho video cross-origin mà app có thể dùng an toàn để giữ nguyên custom guard/controls.

Lần này bổ sung ba trạng thái báo đúng `NATIVE`, `THEATER`, `UNAVAILABLE`; theater có nhãn “Xem rộng trong trình duyệt”. Fallback kiểm tra wrapper đã kết nối và thực sự fixed; lỗi sẽ cleanup lock/history rồi báo unavailable, lần bấm sau có thể retry. Các mode hoạt động mới bật pointer safe-zone. Không đổi nguồn phát, không tạo player thứ hai, không đổi heartbeat/VideoPlaybackGuard.

Theater của HEAD sử dụng top layer/popover hoặc CSS escape khỏi stacking context và giữ cùng iframe. Test có cha transform, clip/overflow, aspect và position relative; xác nhận orientation/viewport thay đổi không tạo lại iframe. Nút thoát và Back dọn lock, chỉ tiêu thụ marker lịch sử do chính controller sở hữu; chuyển bài/pagehide không nhảy ngược về video trước.

Nguồn chính thức/primary đã đối chiếu: [WebKit bug 206854 về element fullscreen trên iPhone](https://bugs.webkit.org/show_bug.cgi?id=206854), [WebKit bug 212934](https://www2.webkit.org/show_bug.cgi?id=212934), [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference), [player parameters, playsinline và fs](https://developers.google.com/youtube/player_parameters). Trạng thái native thực tế được xác nhận bằng fullscreen element/event, không suy từ CSS hay kích thước màn hình.

## C. Dữ liệu thật, dry run và repair

| Chỉ tiêu | Trước | Sau | Diễn giải |
|---|---:|---:|---|
| Tài khoản có nhiều Chapter quản lý từ union nguồn cũ | 1 | 0 | Legacy index sai, assignment Demo đã đúng |
| Hai tenure Lead active chồng nhau | 0 | 0 | Không đồng nghĩa với chỉ tiêu union phía trên |
| Đồng thời DNA và Chapter active | 0 | 0 | Không chạy sửa membership DNA thật |
| Nhóm email trùng sau chuẩn hóa | 0 | 0 | Không merge user thật |
| Email chưa canonical | 0 | 0 | Trigger/index ngăn phát sinh mới |
| Legacy Lead không có tenure | 0 | 0 | Không tự tạo tenure suy đoán |
| Status ACTIVE nhưng ngoài khoảng hiện tại | 0 | 0 | Chỉ phản ánh dữ liệu lúc audit |
| Chapter history interval mở mồ côi | 0 | 0 | Không backdate lịch sử |
| Lead active | 10 | 10 | Permanent bindings sau migration: 10 |

Không đếm được số lỗi UI trong quá khứ chỉ từ database hiện tại; chỉ chứng minh một legacy index sai. Các trường hợp cần Admin chọn Chapter còn lại sau repair: 0 tại thời điểm audit. Không đưa email thật vào báo cáo/log.

Repair được duyệt giữ **Chapter Demo**. Plan hash `a5d5bd80d2649be7925d9c48f1eedc50c9d605ff38a369f273dda018fbfc9343`. Thực thi `2026-10-25T12:47:36.243Z`: sửa current index; không kết thúc tenure nào (0), không tạo assignment Demo mới vì đã tồn tại, không kết thúc organization membership nào (0). Trigger giữ interval Chapter cũ, kết thúc tại thời điểm quan sát sửa và mở interval mới; không bịa thời điểm quá khứ. Hash toàn bộ hàng LessonProgress và StarLedger của tài khoản trước/sau giống nhau.

Bằng chứng: [audit trước](organization-integrity-before.json), [audit sau](organization-integrity.json), [plan](lead-repair-plan.json), [kết quả repair](lead-repair-result.json), [dry-run migration đầu](migration-dry-run-first.json), [dry-run bổ sung](migration-dry-run.json). Dry run rollback toàn bộ; migrate deploy sau đó đã thực sự áp dụng hai migration mới, không sửa migration cũ hay ledger.

## D. Kiểm thử

### P0: PostgreSQL độc lập và API production trong test process

Chỉ chạy fixture trong database local `org_integrity_v3`, port 55439; script bắt buộc URL local/test, không fallback database ứng dụng. [Kết quả từng case](organization-tests.json), 22/22 PASS.

| Case | Expected | Actual | Status |
|---|---|---|---|
| Bổ nhiệm Lead đầu tiên, rồi Chapter thứ hai | Đầu thành công, sau bị chặn DB | Đúng | PASS |
| Thu hồi, bổ nhiệm lại Chapter cũ | Giữ lịch sử/binding; không sang Chapter khác | Đúng | PASS |
| Lead sang DNA kể cả sau thu hồi/future import | Từ chối | Từ chối | PASS |
| Đổi/xóa binding, giả tenure cũ khác Chapter | Từ chối | Từ chối | PASS |
| Đổi loại unit để né guard | Từ chối | Từ chối | PASS |
| Hai Lead imports đồng thời READ COMMITTED | Tối đa một hợp lệ | Đúng | PASS |
| Hai Lead imports đồng thời REPEATABLE READ | Tối đa một hợp lệ | Đúng | PASS |
| Hai Lead imports đồng thời SERIALIZABLE | Tối đa một hợp lệ | Đúng | PASS |
| API Admin gán Chapter thứ hai | 409, tên Chapter đã gắn | Đúng | PASS |
| JWT cũ sau thu hồi; đọc Chapter khác | Không còn quyền | Từ chối backend | PASS |
| Phoenix/Ban → DNA, cả chức vụ tương lai | Đúng một affiliation, giữ sao/progress/history | Đúng | PASS |
| Hai alias Lead cùng Chapter chồng tenure | Không tạo hai tenure active | DB từ chối | PASS |
| Retry chuyển DNA, Lead cũ đọc/thêm Ban | Không trùng, Lead cũ bị chặn | Đúng | PASS |
| BXH tháng/kỳ DNA và Chapter lịch sử | DNA tháng 12/kỳ 15; không sao ngoài kỳ; Chapter tháng chuyển loại hết | Đúng | PASS |
| Email hoa/thường/khoảng trắng | Không vượt uniqueness/binding | Đúng | PASS |
| API lịch sử | Admin được xem, thường 403, nhãn ended rõ | Đúng | PASS |
| Cache org/auth browser | Request sau lấy mới, cache course vẫn dùng | Đúng | PASS |
| Admin toàn hệ thống | Không bị giới hạn một Chapter | Đúng | PASS |
| Chapter/DNA raw import trước cutover | Vẫn chặn dual affiliation | Đúng | PASS |
| Concurrent Chapter/DNA READ COMMITTED | Không dual-active | Đúng | PASS |
| Concurrent Chapter/DNA REPEATABLE READ | Không dual-active | Đúng | PASS |
| Concurrent Chapter/DNA SERIALIZABLE | Không dual-active | Đúng | PASS |

Rehearsal sửa dữ liệu trên DB sạch `org_integrity_repair_v2`: **5/5 PASS**. Migration từ chối dữ liệu mơ hồ; dry run không ghi; repair giữ lịch sử/ledger; migration sau repair thành công; plan cũ không dùng lại được. [Bằng chứng](repair-tests.json).

### Controls và browser

| Thao tác | Expected khi đang phát | Actual | Status/phạm vi |
|---|---|---|---|
| Play/Pause/Play, pointer đứng trên nút | Tự ẩn sau idle, pause giữ hiện | Đúng | PASS browser regression |
| Tua +10/-10, 50 lần liên tiếp | Tự ẩn, không kẹt | Đúng | PASS desktop/touch contexts |
| Đổi tốc độ 50 lần | Tự ẩn, không đổi lặp bởi touch+click | Đúng | PASS |
| Click/drag seek, thả ngoài player | Kết thúc interaction, ẩn lại | Đúng | PASS |
| Pointercancel/lostcapture/window blur | Reset drag, không timer cũ bật lại | Đúng | PASS |
| Seek/buffering rồi rời player | Không ghim controls | Đúng | PASS |
| Tab vào nút; mouse click sau đó | Giữ focus keyboard; pointer trở lại idle hide | Đúng | PASS |
| Native reject/error → theater | Một lần fallback, cùng iframe | Đúng | PASS |
| Repeated fullscreen/Back/exit/switch/pagehide | Không rò lock/history, không remount | Đúng | PASS |
| Native wrapper desktop Chromium | Có fullscreen element, exit giữ player | Đúng | PASS |
| Fallback không khả dụng, retry | UNAVAILABLE rõ ràng, cleanup, retry được | Đúng | PASS |
| Heartbeat/session trong fullscreen và đổi tốc độ | Cùng sessionId, tiếp tục request, cùng iframe | Đúng | PASS với API mock, không ghi progress thật |
| Trang lịch sử Admin | Hiện Chapter đã rời và DNA active | Đúng, đã xem ảnh | PASS UI mock + API security test độc lập |

Các lượt chạy độc lập: bộ browser chính **65 PASS / 7 SKIP** trên 72 case; heartbeat bổ sung **5 PASS / 3 SKIP**; Admin history UI **1 PASS / 3 SKIP**. Skip native ở engine/context không hỗ trợ và skip case desktop-only ở mobile context là có chủ đích. Chromium/WebKit touch contexts là giả lập, không đại diện thiết bị thật. HTML report bộ chính: `scratch/player-browser-report/index.html`; source: `src/test/browser/video-player.spec.ts`.

Fake timers/UI coordinator: **23/23 PASS**; VideoPlaybackGuard **15/15 PASS**; video switching leak **9/9 PASS**; business rules **66/66 PASS**. Không bỏ xử lý keyboard focus hoặc sửa guard để đạt test.

YouTube thật trên desktop Chromium 156: native và theater đều PASS, thời gian phát 0:22 → 0:28, controls ẩn và còn nút thoát. [Native JSON](player-native-result.json), [ảnh native](player-native.png), [theater JSON](player-theater-result.json), [ảnh theater](player-theater.png). Một số request YouTube/telemetry bị chặn nhưng media vẫn chạy; không giấu failedHosts trong JSON.

### Build và công thức

- `npx tsc --noEmit -p tsconfig.check.json`: PASS sau sửa deadline.
- `npm run build`: PASS sau sửa deadline, 74 static pages; chi tiết tổng hợp tại [validation-summary.json](validation-summary.json).
- Deadline chung: **8/8 PASS** coordinator/persistence/retry.
- Formula regression cũ: **49/49 PASS**; không chứng minh mọi công thức đúng.
- Audit sổ tay độc lập: **8 PASS / 3 FAIL** còn tồn tại; exit 1 có chủ đích. [Báo cáo riêng](handbook-formula-audit.md).
- Dựng DB trống bằng toàn bộ migration cũ: **BLOCKED** bởi lỗi baseline migration `20261013_course_final_assessment` thiếu `assessments.lesson_id`. Không sửa lịch sử migration để che lỗi. Test DB dùng schema hiện tại bằng `prisma db push`, sau đó áp dụng guard cũ và hai migration mới. Migration deploy trên DB cấu hình sẵn thành công.

## E. Kết quả fullscreen theo nền tảng

| Nền tảng | Native thật | Fallback | Browser chrome | Guard/session/heartbeat |
|---|---|---|---|---|
| Desktop Chromium headless, YouTube thật | PASS có fullscreen element/event | PASS ép native không khả dụng | Headless không có thanh browser để nghiệm thu ẩn thanh | Video giữ thời gian; heartbeat cùng session PASS với mock |
| Desktop WebKit Playwright | Native không nghiệm thu trong engine này | PASS regression | Không kiểm tra browser chrome của Safari UI thật | Regression iframe/session PASS trong context mô phỏng |
| Android Chrome thiết bị thật | NOT VERIFIED, vẫn ưu tiên Native API khi hỗ trợ | Logic fallback PASS trên Chromium touch emulation | NOT VERIFIED | NOT VERIFIED trên Android thật |
| iPhone Safari thiết bị thật | NOT VERIFIED; wrapper native chịu giới hạn WebKit | PASS logic/layout trên WebKit touch emulation, chưa nghiệm thu máy thật | Theater có thể còn address bar/toolbars; không tuyên bố ẩn | NOT VERIFIED trên iPhone thật |
| Chrome iPhone thiết bị thật | NOT VERIFIED | Cùng giới hạn engine thực tế của thiết bị; cần kiểm tra trực tiếp | Không được suy từ tên Chrome rằng wrapper fullscreen hỗ trợ | NOT VERIFIED |

Không tích hợp fullscreen video native riêng bằng cách tắt inline YouTube: app không sở hữu HTMLVideoElement cross-origin, không có documented IFrame API để bật nó và vẫn bảo đảm BBE controls/seek policy. Không dùng scroll/viewport hack để tuyên bố fullscreen cấp thiết bị. Vẫn cần nghiệm thu Android/iPhone thực cho xoay màn hình, browser Back/tab switch, pause/buffer/rate/seek, browser chrome và session thực.

## F. Phân loại bàn giao

| Hạng mục | Trạng thái |
|---|---|
| Lead Chapter invariant, authorization, migration và dữ liệu conflict được duyệt | **ĐÃ SỬA VÀ KIỂM THỬ PASS** ở DB/API local; DB thật đã migrate/audit; app chưa deploy |
| Chapter → DNA exclusivity, roster, lịch sử, quyền cũ | **ĐÃ SỬA VÀ KIỂM THỬ PASS** bằng fixture; trường hợp UI cũ dữ liệu thật chưa tái hiện |
| Controls và desktop fullscreen | **KIỂM THỬ PASS** trong phạm vi browser đã nêu |
| Native/fallback trên điện thoại thật | **ĐÃ SỬA NHƯNG CHƯA NGHIỆM THU**; wrapper native iPhone có giới hạn nền tảng |
| Deadline chung mục 18 | **ĐÃ SỬA VÀ TEST PASS**, chưa deploy app, không backfill |
| Ba sai lệch còn lại trong sổ tay | **CHƯA SỬA**, có repro độc lập; không sửa lịch sử thật |
| Nghiệm thu sau triển khai app và thiết bị thật | **NOT VERIFIED**, không coi build thành công là hoàn tất |
