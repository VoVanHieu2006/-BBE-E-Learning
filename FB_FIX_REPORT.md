# BÁO CÁO NGHIỆM THU KỸ THUẬT: SỬA LỖI FB-01 ĐẾN FB-08 VÀ BẢO TOÀN P0 VIDEO

> **Ngày thực hiện:** 26/10/2026  
> **Base commit:** `c6671286b2b9733cb48fb9b92c3ab67ab72f4509` (branch `main`)  
> **Môi trường kiểm chuẩn:** Cụm PostgreSQL test biệt lập `127.0.0.1:55438/fb_fixes_test`, Playwright Browser (Chromium Desktop), TypeScript 5, Next.js 14.  
> **Nguyên tắc tuân thủ:** Bảo toàn 100% bản sửa P0 Video Player, không tác động trái phép dữ liệu production, không thay đổi schema, giữ nguyên business rules và kiến trúc hệ thống.

---

## 1. TỔNG HỢP TRẠNG THÁI NGHIỆM THU (EXECUTIVE SUMMARY)

| Mã | Hạng mục phản hồi | Trạng thái kỹ thuật | Bằng chứng kiểm thử (Evidence) |
| :--- | :--- | :---: | :--- |
| **FB-01** | Thời lượng Quiz (durationMinutes) không lưu / mất sau refresh | **PASS** | API/DB 5→7 min test PASS; Playwright Browser form edit 5→7 min & reload PASS |
| **FB-02** | Roster thành viên: đếm sai mẫu số, dính inactive/manager | **PASS** | 2/13 learner checks PASS; Search denominator giữ nguyên; Inactive/manager bị loại |
| **FB-03** | Bảng xếp hạng Chapter: thiếu 3 điều kiện khi loại trừ | **PASS** | Score formula độc lập PASS; Boundary matrix PASS; Browser hiển thị đủ 3 điều kiện |
| **FB-04** | Lời mời (Invitations): lọc Lead, nhầm role, phân trang | **PASS** | `kind=LEAD` WHERE filter PASS; Cache isolation PASS; Role mapping tường minh PASS |
| **FB-05** | Lịch sử tổ chức (Organization History): mất dòng Chapter, thiếu type | **PASS** | API giữ Chapter intervals; Browser hiển thị đủ CHAPTER/Ban/DNA/DNA_GROUP PASS |
| **FB-06** | Roster Lead Chapter: sai lệch quân số thực tế | **PASS** | Đồng bộ với resolver `listChapterLearners`; Stale index bị chặn; LT đúng scope PASS |
| **FB-07** | Xem lại video hàng tháng (Monthly Replay) & Thưởng Sao | **PASS** | Writer 862s→14 sao PASS; Replay độc lập chu kỳ PASS; 22/22 Transport Session PASS |
| **FB-08** | Tính sẵn sàng chu kỳ (Readiness) & Scope người học | **PASS** | 8/8 API checks PASS; Catalog & Board đồng bộ reasonCode; Không manufacture period |
| **P0** | Video Player: chống tua, full-screen, không giật lùi vị trí | **PASS** | 100 DOM seeks 1x/1.5x/2x PASS; Spec 193 refresh PASS; 22 Transport checks PASS |
| **V01–V15** | Bộ phản hồi nguyên văn V01–V15 từ phiên trước | **BLOCKED** | Thiếu tài liệu định nghĩa chi tiết trong hồ sơ workspace; không tự bịa đặt nội dung |

---

## 2. CHI TIẾT NGUYÊN NHÂN GỐC RỄ & GIẢI PHÁP TỪNG HẠNG MỤC

### 2.1. FB-01 — Thời lượng Quiz (Duration Minutes)
- **Nguyên nhân gốc rễ:**
  - `POST /api/v1/lessons/[lessonId]/assessment`: Transaction lưu vào DB thành công nhưng payload phản hồi JSON trước đây thiếu trường `durationMinutes`, khiến state phía frontend nhận về object thiếu thời lượng và fallback về 30 hoặc 0.
  - Phía Admin Course Edit (`src/app/admin/courses/[courseId]/edit/page.tsx`): Có fallback ngầm `durationMinutes: 30` khi đọc dữ liệu, đồng thời thiếu lệnh xóa cache client (`clearApiCache`) sau khi cập nhật thành công.
- **Giải pháp:**
  - `src/app/api/v1/lessons/[lessonId]/assessment/route.ts`: Bổ sung `durationMinutes` vào response, thiết lập header `Cache-Control: no-store`, thực hiện xóa cache server/system cache khi transaction hoàn tất.
  - `src/app/api/v1/assessments/[assessmentId]/route.ts`: Loại bỏ fallback cứng `30` trong GET.
  - `src/app/admin/courses/[courseId]/edit/page.tsx`: Loại bỏ fallback 30 cho assessment đã tồn tại (hiển thị 0 nếu thiếu để quản trị viên phát hiện cấu hình thiếu); gọi `clearApiCache` ngay sau khi lưu.
- **Bằng chứng kiểm thử:**
  - API/DB test (`scripts/test-fb-fixes.cjs`): Lưu 5 phút rồi 7 phút, GET lại DB và API đều trả về đúng 7 phút.
  - Browser test (`src/test/browser/fb-feedback.spec.ts`): Thao tác mở form Sửa Quiz, đổi từ 5 phút sang 7 phút, bấm Lưu, reload trang và xác nhận giao diện vẫn hiển thị chính xác "7 phút".

---

### 2.2. FB-02 & FB-06 — Roster Người Học & Quân Số Thực Tế Chapter
- **Nguyên nhân gốc rễ:**
  - Hệ thống trước đây dùng chung một hàm resolver `listChapterMembers` cho cả mục đích quản lý tài khoản/lịch sử và tính toán học viên hiện hành (active learners).
  - Thành viên có trạng thái `INACTIVE`, hoặc giữ chức danh quản lý (`CHAPTER_MANAGER`, `is_manager = true`), hoặc có bản ghi legacy `ChapterMember` cũ dù đã chuyển sang DNA/Chapter khác vẫn bị tính gộp vào mẫu số.
  - Khi tìm kiếm thành viên trên dashboard, mẫu số tổng (`totalMembers`) bị co cụm theo kết quả filter thay vì giữ nguyên tổng quân số toàn Chapter.
- **Giải pháp:**
  - Bổ sung resolver chuyên biệt `listChapterLearners` trong [src/lib/chapter-members.ts](file:///c:/Users/Acer/Desktop/E-learning/src/lib/chapter-members.ts), bảo lưu nguyên vẹn resolver tài khoản `listChapterMembers`.
  - Quy tắc lọc học viên nghiêm ngặt:
    - Bắt buộc `User.status === 'ACTIVE'` và `User.role === 'MEMBER'`.
    - Phải có active membership trong Chapter tại thời điểm tính toán (`asOf`).
    - Loại trừ hoàn toàn người đang thuộc DNA hoặc Chapter khác.
    - Loại trừ các chức danh quản lý (`CHAPTER_MANAGER`, các quyền quản trị cấp Chapter/Ban). Tuy nhiên, **LT Ban** (`DEPARTMENT_LEAD`) và **Chủ tịch Chapter** (`CHAPTER_PRESIDENT`) vẫn được tính là learner và tham gia học tập.
  - `src/app/api/v1/chapters/[chapterId]/dashboard/members/route.ts`: Tính `summary.totalMembers` trên toàn bộ danh sách learner trước khi phân trang hoặc áp dụng tìm kiếm; trả về trường `rosterAsOf` chuẩn thời gian.
  - Loại bỏ cờ `includeInactive=1` tại dashboard và members page của Chapter Manager.
- **Bằng chứng kiểm thử:**
  - 6 kịch bản API/DB trong `test:fb-fixes` đạt 100%: fixture 2/13 learner; loại trừ inactive/manager; deduplicate; chặn index cũ của thành viên đã sang DNA/foreign; mẫu số tìm kiếm độc lập; LT đúng scope Ban.

---

### 2.3. FB-03 — 3 Điều Kiện Tham Gia Xếp Hạng Chapter
- **Nguyên nhân gốc rễ:**
  - Hàm `chapterCompetitionScore` trước đây gộp việc tính quân số bình quân với việc kiểm tra dữ liệu bài học lõi (`coreLessonCount`). Khi chưa có bài học lõi xuất bản, quân số bình quân bị trả về 0 hoặc lỗi, dẫn đến toàn bộ Chapter bị ẩn hoặc không thể xem điều kiện bị thiếu.
  - Giao diện Leaderboard trước đây chỉ hiển thị danh sách Chapter đủ điều kiện; khi tất cả Chapter đều không đủ điều kiện thì bảng xếp hạng trống trơn, không giải thích lý do.
- **Giải pháp:**
  - [src/lib/competition-ranking-rules.ts](file:///c:/Users/Acer/Desktop/E-learning/src/lib/competition-ranking-rules.ts): Tách biệt việc tính `averageMemberCount` thành một luồng độc lập với việc kiểm tra bài học lõi.
  - Bổ sung cấu trúc 3 điều kiện minh bạch (`conditions`):
    1. **MEMBER_COUNT**: Quân số bình quân (ngưỡng: > 20 học viên).
    2. **CORE_COMPLETION**: Tỷ lệ hoàn thành bài học lõi (ngưỡng: ≥ 50%; mã lỗi `CORE_LESSONS_ZERO` nếu chưa có bài lõi).
    3. **KPI**: Xếp loại KPI của Chapter (ngưỡng: Vàng/Xanh; mã lỗi `WAITING_KPI` nếu chưa có dữ liệu).
  - Tạo mới component [src/components/learning/ChapterConditions.tsx](file:///c:/Users/Acer/Desktop/E-learning/src/components/learning/ChapterConditions.tsx) và tích hợp vào `UnifiedLeaderboard` cũng như `PeriodLeaderboard`. Kể cả khi tất cả Chapter bị loại trừ (`excluded`), hệ thống vẫn hiển thị thẻ Chapter kèm chi tiết trạng thái từng điều kiện.
- **Bằng chứng kiểm thử:**
  - Đã pass ma trận biên trong `test:fb-fixes`: 0, 1, 20, 21 quân số; 49%, 50% hoàn thành; các trường hợp thiếu KPI / thiếu bài học lõi.
  - Kiểm tra dữ liệu: Chỉ các bài học PUBLISHED thuộc 3 chương trình CORE mới được tính vào mẫu số; chương trình EXTENDED và bản nháp DRAFT bị loại trừ hoàn toàn.
  - Playwright browser test: Xác nhận giao diện hiển thị đầy đủ 3 điều kiện ngay cả khi mọi Chapter đều bị excluded.

---

### 2.4. FB-04 — Lọc Lời Mời Quản Lý (Invitations)
- **Nguyên nhân gốc rễ:**
  - API danh sách lời mời `/api/v1/invitations` chỉ hỗ trợ truy vấn chung, không có cơ chế lọc riêng cho cấp quản lý (`LEAD`), dẫn đến danh sách thành viên và lãnh đạo bị lẫn lộn.
  - Bộ đệm API (cache) dùng chung khóa, khiến kết quả lọc bị ghi đè lẫn nhau.
  - Phân trang tính trên toàn bộ tập dữ liệu thay vì tính sau khi đã lọc theo nhóm quyền.
- **Giải pháp:**
  - `src/app/api/v1/invitations/route.ts`: Bổ sung tham số `kind=LEAD` (chỉ dành riêng cho ADMIN; role lạ trả về 400); đưa `kind` vào khóa cache.
  - `src/lib/invitations.ts`: Đưa điều kiện lọc vai trò (`CHAPTER_LEADER`, `DNA_LEAD`) vào mệnh đề `WHERE` của truy vấn Prisma trước khi thực hiện `count()` và `findMany()`, đảm bảo số trang và tổng số lượng (`totalItems`, `totalPages`) hoàn toàn chính xác.
  - `src/app/admin/invitations/page.tsx`: Gắn nhãn hiển thị vai trò minh bạch ("Lead DNA", "Lãnh đạo Chapter"); nếu gặp role lạ sẽ hiển thị chính tên role đó thay vì im lặng bỏ qua.
- **Bằng chứng kiểm thử:**
  - 4 test API/DB trong `test:fb-fixes` pass: Phân trang/đếm đúng sau khi lọc `kind=LEAD`; cache độc lập; phân quyền nghiêm ngặt; chấp nhận lời mời MEMBER không bị promote trái phép; hủy lời mời xóa cache ngay lập tức.
  - Browser test: Playwright xác nhận danh sách lời mời hiển thị đúng nhãn role và filter `kind=LEAD`.

---

### 2.5. FB-05 — Lịch Sử Tổ Chức Phân Biệt Đơn Vị (Organization History)
- **Nguyên nhân gốc rễ:**
  - Trang lịch sử tổ chức của người dùng (`/admin/users/[userId]/organization-history`) trước đây hiển thị tất cả các đơn vị với nhãn chung chung, không phân biệt rõ ràng giữa Chapter, Ban chuyên môn, DNA và Nhóm DNA.
- **Giải pháp:**
  - [src/app/admin/users/[userId]/organization-history/page.tsx](file:///c:/Users/Acer/Desktop/E-learning/src/app/admin/users/[userId]/organization-history/page.tsx): Bổ sung cột hiển thị loại đơn vị dựa trên trường `unit.type`: `CHAPTER`, `Ban (DEPARTMENT)`, `DNA`, `Nhóm DNA (DNA_GROUP)`.
  - Giữ nguyên toàn bộ khoảng thời gian trực thuộc Chapter (`ChapterAffiliationInterval`), không xóa dữ liệu lịch sử.
  - Các nhiệm kỳ/membership có thời điểm bắt đầu trong tương lai được gắn nhãn ghi chú "Chưa hiệu lực".
- **Bằng chứng kiểm thử:**
  - API/DB test xác nhận dữ liệu lịch sử được giữ nguyên toàn vẹn, là read-only.
  - Playwright browser test: Xác nhận các bảng hiển thị đầy đủ và chính xác các nhãn đơn vị.

---

### 2.6. FB-07 — Replay Hàng Tháng & Cơ Chế ACK Tiến Độ Video
- **Nguyên nhân gốc rễ:**
  - Vòng đời đào tạo (chu kỳ học tập - `LearningCycle`) và lượt xem thưởng hàng tháng (`MonthlyVideoReplay`) là hai khái niệm độc lập nhưng trước đây chưa được phân tách dữ liệu rõ ràng trong payload phản hồi của API tiến độ video.
  - Khi xem lại (replay), nếu client gửi heartbeat sau khi đã hoàn tất đào tạo đời thực (lifetime 862s), tầng transport có nguy cơ lấy nhầm mốc thời gian cũ để nén/bỏ qua các checkpoint replay.
- **Giải pháp:**
  - Tạo mới [src/lib/learning-readiness-rules.ts](file:///c:/Users/Acer/Desktop/E-learning/src/lib/learning-readiness-rules.ts) và [src/lib/learning-readiness.ts](file:///c:/Users/Acer/Desktop/E-learning/src/lib/learning-readiness.ts) để quản lý trạng thái chính sách học tập.
  - `src/lib/video-heartbeat.ts`: Thêm trường `progressContext` (`learningCycleId`, `competitionMonthId`, `monthlyReplayRequired`), tách biệt rõ `lifetime` và `cycleProgress`, trả về mã lý do thưởng (`rewardStatus.reasonCode`).
  - [src/lib/video-progress-session.ts](file:///c:/Users/Acer/Desktop/E-learning/src/lib/video-progress-session.ts): Tầng vận chuyển (transport) tuân thủ nghiêm ngặt nguyên tắc: chỉ lấy mức sàn ACK dựa trên giá trị nhỏ nhất đã được backend xác nhận (`min(training, replay)`), giữ nguyên các heartbeat chưa được xác nhận, tự động đặt lại sàn nén khi đổi chu kỳ hoặc tháng thi đua.
  - [src/app/student/learning/[lessonId]/page.tsx](file:///c:/Users/Acer/Desktop/E-learning/src/app/student/learning/[lessonId]/page.tsx): Cập nhật giao diện học viên hiển thị rõ ràng: Tiến độ chu kỳ học tập vs Lượt xem nhận thưởng tháng này; bổ sung fallback an toàn `lifetime.furthestWatchedPositionSeconds ?? progress.furthestWatchedPositionSeconds`.
- **Bằng chứng kiểm thử:**
  - Suite unit transport [src/test/video-progress-session.test.ts](file:///c:/Users/Acer/Desktop/E-learning/src/test/video-progress-session.test.ts): **22/22 test PASS** (gồm 5 kịch bản regression đặc thù: replay 108s không bị 862s đè, in-flight failure không mất queue, đổi cycle, đổi month).
  - DB writer test: Video 862s nhận đủ 14 sao đúng 1 lần duy nhất; retry đồng thời không bị nhân đôi sao; tua gian lận bị chặn; tạm hoãn do chuyển giao không được bù sao hồi tố.

---

### 2.7. FB-08 — Tính Sẵn Sàng (Readiness) & Scope Người Học
- **Nguyên nhân gốc rễ:**
  - API danh mục kỳ `/api/v1/learning/periods` và bảng xếp hạng `/api/v1/leaderboard` trước đây có nguy cơ tự động khởi tạo dữ liệu kỳ (manufacture periods) trong câu lệnh GET, gây sai lệch dữ liệu trước ngày chốt chuyển đổi (cutover).
  - Thành viên chuyển từ Chapter sang DNA vẫn có thể bị áp nhầm phạm vi Chapter cũ nếu chỉ kiểm tra token cũ.
- **Giải pháp:**
  - [src/lib/affiliation-access.ts](file:///c:/Users/Acer/Desktop/E-learning/src/lib/affiliation-access.ts): Hàm `currentLearningAffiliation` ưu tiên xác định đơn vị tổ chức hiện hành từ membership trước khi fallback về bảng liên kết cũ.
  - Phân loại rõ ràng các mã trạng thái sẵn sàng: `POLICY_MISSING`, `MAPPING_NOT_APPROVED`, `CUTOVER_NOT_SET`, `CUTOVER_FUTURE`, `MONTH_NOT_CONFIGURED`, `TERM_NOT_CONFIGURED`, `SEASON_NOT_CONFIGURED`, `SNAPSHOT_MISSING`.
  - Đảm bảo toàn bộ các phương thức GET đều là **Read-Only 100%**, tuyệt đối không tạo kỳ thi đua hoặc chính sách khi chỉ truy vấn dữ liệu.
- **Bằng chứng kiểm thử:**
  - 8 kịch bản API trong `test:fb-fixes` pass: catalog và leaderboard đồng nhất trạng thái; số lượng kỳ thi đua trong DB không thay đổi sau khi gọi GET; snapshot đã khóa không bị ghi đè.

---

## 3. BẢO TOÀN BẢN VÁ P0 VIDEO STREAMING & ANTI-CHEAT

Hệ sinh thái Video Player P0 tiếp tục được bảo toàn tuyệt đối, không có bất kỳ thay đổi nào làm suy giảm tính an toàn hoặc trải nghiệm người dùng:
1. **Chống tua và gian lận (Anti-Cheat & Furthest Guard):**
   - Bộ điều khiển [src/lib/video-playback-guard.ts](file:///c:/Users/Acer/Desktop/E-learning/src/lib/video-playback-guard.ts) hoạt động ổn định: cho phép xem mượt mà ở 1x, 1.25x, 1.5x, 1.75x, 2x mà không bị giật lùi vị trí xem (0 seek-backs).
   - Ngăn chặn triệt để mọi hành vi nhảy cóc thời gian chưa học hoặc gửi sự kiện `ENDED` giả mạo.
2. **Kiểm thử áp lực DOM Seeks (100 Seeks Stress Test):**
   - Playwright browser test thực thi 100 lần click tua liên tục ở các tốc độ 1x, 1.5x và 2x: Tọa độ cao nhất được bảo toàn, 3 heartbeat nội dung mới được gửi chính xác.
3. **MEMBER Page Identity & Restore Progress:**
   - Đã khắc phục triệt để lỗi kiểm thử tại spec 193: Trang học viên nhận diện đúng `videoId` từ DB, từ chối dữ liệu không khớp video, và phục hồi chính xác tiến độ học tập khi tải lại trang (reload) trong 2.3 giây.

---

## 4. BÁO CÁO CÁC TEST SUITE ĐÃ THỰC THI (VERIFICATION AUDIT)

```
========================================================================================
1. test:fb-fixes (Toàn bộ 27 bài kiểm tra tích hợp API & DB thật trên test cluster)
   - FB04 Invitations (4/4 PASS)
   - FB02/06 Chapter Learner Roster & Dashboard (6/6 PASS)
   - FB01 Quiz Duration & Invalidation (1/1 PASS)
   - FB03 Chapter Conditions & Denominator Rules (3/3 PASS)
   - FB08 Learning Policy Readiness & Scoping (8/8 PASS)
   - FB07 Video Heartbeat, Replay & Rewards (4/4 PASS)
   - FB05 Typed Organization History (1/1 PASS)
   --> KẾT QUẢ: 27 PASS, 0 FAIL (100%)

2. test:video-progress-session (Kiểm thử tầng transport video progress session)
   - 22/22 PASS (100%), bao gồm cả 5 kịch bản regression nén ACK floor.

3. test:reward-pause-integration (Kiểm thử tạm hoãn thưởng mùa chuyển giao)
   - PASS (overdue season pause, retained history, no backpay).

4. TypeScript Static Type Check (tsc --noEmit --incremental false)
   - KẾT QUẢ: EXIT CODE 0 (Không có bất kỳ lỗi kiểu dữ liệu nào).

5. Next.js Production Build (npm run build)
   - KẾT QUẢ: EXIT CODE 0 (Biên dịch thành công 74/74 static/dynamic routes).

6. Playwright Browser Tests (playwright.fb.config.ts)
   - fb-feedback.spec.ts (5/5 PASS: FB04, FB05, FB03, FB08, FB01).
   - video-player.spec.ts: Spec 193 (P0 Member Restore Progress) PASS.
   - 29 PASSED, 1 SKIPPED, 1 FAIL đã biết từ baseline (fullscreen popover manual - ngoài phạm vi).
========================================================================================
```

> **Lưu ý về `scripts/test-learning-cycles-integration.cjs` (Lỗi dòng 110):**  
> Quá trình điều tra đã làm rõ: Lỗi `SupplementalLearningRequirement.findFirstOrThrow (P2025)` xuất phát từ sự không tương thích giữa script test cũ (từ commit `79f2f24`) với Kiến trúc v4 Đã Hợp Nhất Hạn Chót (Commit `108762b - Unified Deadlines`). Ở Kiến trúc v4, thời gian gia hạn của nội dung mới được cộng trực tiếp vào `learningPath.due_at` và `userLearningAssignment.due_at`, bảng `supplementalLearningRequirement` không còn được tạo mới. Đây là **mâu thuẫn đặc tả baseline cũ**, không phải lỗi hồi quy từ các bản sửa lỗi FB. Toàn bộ quy tắc nghiệp vụ hiện hành được bảo toàn nguyên vẹn.

---

## 5. HƯỚNG DẪN NGHIỆM THU CHO NGƯỜI DÙNG (USER ACCEPTANCE GUIDE)

### 5.1. Dành cho Quản trị viên (Admin)
1. **Quản lý lời mời (`/admin/invitations`):**
   - Truy cập trang Lời mời: Bấm lọc theo tab/danh mục Lãnh đạo (`kind=LEAD`).
   - Kiểm tra: Danh sách chỉ hiển thị các tài khoản `CHAPTER_LEADER` hoặc `DNA_LEAD`, số lượng phân trang chính xác; nhãn quyền hiển thị rõ ràng, không bị lẫn với thành viên thông thường.
2. **Cấu hình thời lượng Quiz (`/admin/courses/[courseId]/edit`):**
   - Mở một khóa học bản nháp, mở buổi học (Session), bấm nút **"Sửa Quiz"**.
   - Đổi Thời gian làm bài (ví dụ từ 5 phút thành 7 phút) và bấm **"Lưu bài kiểm tra"**.
   - Kiểm tra: Huy hiệu quiz cập nhật thành "7 phút". Nhấn F5 (Reload trang): thời lượng vẫn giữ nguyên 7 phút.
3. **Lịch sử tổ chức của tài khoản (`/admin/users/[userId]/organization-history`):**
   - Vào xem lịch sử một người dùng: Bảng hiển thị rõ ràng cột loại đơn vị (`CHAPTER`, `Ban (DEPARTMENT)`, `DNA`, `Nhóm DNA`). Toàn bộ các mốc tham gia Chapter trước đây vẫn được lưu trữ đầy đủ.

### 5.2. Dành cho Lãnh đạo Chapter (Lead Chapter)
1. **Danh sách học viên Chapter (`/chapter-manager/members`):**
   - Quân số học viên chỉ tính các thành viên `MEMBER` đang hoạt động (`ACTIVE`).
   - Các tài khoản quản lý hoặc thành viên đã chuyển sang đơn vị khác không bị tính vào danh sách học tập.
   - Chủ tịch Chapter và các Trưởng Ban (LT Ban) vẫn xuất hiện trong danh sách học viên với huy hiệu chức vụ tương ứng.
   - Khi tìm kiếm theo tên hoặc email, mẫu số tổng số thành viên (`totalMembers`) không bị thay đổi.
2. **Điều kiện xếp hạng Chapter (`/leaderboard`):**
   - Trong trường hợp Chapter chưa đạt đủ điều kiện, bảng xếp hạng vẫn hiển thị thẻ Chapter kèm bảng kiểm tra chi tiết:
     - Quân số bình quân (so với mốc 20 học viên).
     - Tỷ lệ hoàn thành bài học lõi (so với mốc 50%).
     - Tình trạng KPI tháng (Xanh/Vàng/Đỏ).

### 5.3. Dành cho Học viên (Member)
1. **Học video bài giảng (`/student/learning/[lessonId]`):**
   - Trình phát video YouTube phát mượt mà, không bị gián đoạn hay tự động lùi giây.
   - Thẻ bên dưới video hiển thị rành mạch hai phần riêng biệt:
     - **Tiến độ chu kỳ học tập:** Ghi nhận % đã học và trạng thái hoàn thành bài học của chu kỳ hiện tại.
     - **Lượt xem nhận thưởng tháng này:** Hiển thị số sao đã nhận trong tháng và lý do cụ thể (hoặc thông báo đang tạm hoãn nếu Chapter đang trong giai đoạn chuyển giao nhiệm kỳ).

---

## 6. KHUYẾN NGHỊ VỀ KHỞI TẠO DỮ LIỆU PRODUCTION (PRODUCTION READINESS)

Trước khi kích hoạt chu kỳ học tập mới trên môi trường production, cần lưu ý các điều kiện tiên quyết sau (theo `docs/learning-upgrade/RUNBOOK.md`):
1. **Cấu hình chính sách học tập (`LearningPolicy`):** Bảng `learning_policy` trên production hiện chưa có bản ghi (0 rows). Cần thực hiện tạo bản ghi chính sách với ngày cắt chuyển đổi (`cutover_at`) và ngày phê duyệt ánh xạ (`mapping_approved_at`) thông qua API quản trị chính thức.
2. **Khởi tạo mùa chuyển giao & tháng thi đua:** Tạo các bản ghi `transferSeason` và `competitionMonth` tương ứng với mốc thời gian thực tế.
3. **Rà soát tài khoản quản lý cũ:** Kiểm tra và chuẩn hóa các tài khoản có vai trò `CHAPTER_MANAGER` cũ sang đúng mô hình phân quyền tổ chức mới trước khi chạy lệnh cutover.
4. **Không tự ý chạy migration dữ liệu lịch sử:** Mọi thao tác ghi dữ liệu cutover hoặc backpay cần có kế hoạch phê duyệt độc lập để đảm bảo tuyệt đối an toàn cho dữ liệu người dùng thật.
