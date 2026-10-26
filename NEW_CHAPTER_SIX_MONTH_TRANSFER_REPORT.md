# Báo Cáo Kỹ Thuật: Chu Kỳ Chuyển Giao 6 Tháng Lịch & Nhiệm Kỳ Đầu Của Chapter Mới

**Dự án:** BBE E-Learning  
**Mục tiêu:** Sửa lỗi Chapter mới thành lập bị tạm dừng thưởng sao do chưa có lịch sử chuyển giao, chuẩn hóa quy tắc tối thiểu 6 tháng lịch theo múi giờ Việt Nam (`Asia/Ho_Chi_Minh` UTC+7), kích hoạt nhiệm kỳ đầu tiên (`current_term_number = 1`, `ChapterCompetitionTerm`) và đối soát 19 sao video hoàn thành cho học viên.  
**Ngày thực hiện:** 26/10/2026  
**Trạng thái:** HOÀN THÀNH TOÀN DIỆN (100% Pass)

---

## 1. Tóm Tắt Vấn Đề & Nguyên Nhân Gốc (Root Cause)

### 1.1. Hiện tượng
- Chapter mới thành lập (`BBE Chapter 1`, `BBE Chapter 2`) không có `current_term_number` (giá trị `null`) và không có bản ghi `ChapterCompetitionTerm` ban đầu.
- Cơ chế tạm dừng thưởng sao (`chapterRewardState`) trước đây giả định mọi Chapter đều phải có sự kiện `ChapterReorganization` trạng thái `APPLIED` trong mùa chuyển giao. Đối với Chapter mới chưa từng chuyển giao, hệ thống đánh giá sai thành `CHAPTER_TRANSFER_OVERDUE` hoặc không thỏa điều kiện mở thưởng.
- Học viên `vobahoaan@gmail.com` xem hoàn thành 2 video bài học (862 giây và 309 giây) nhưng không nhận được 19 sao video (14 sao + 5 sao), chỉ nhận được 20 sao quiz.
- Trong `video-heartbeat.ts`, logic phân nhánh legacy thưởng video dựa vào `rewardComplete = false` ban đầu chỉ được cập nhật bên trong khối `if (context && replayKey)`, dẫn đến khi chưa có cutover context (`!context`), biến `rewardComplete` luôn bằng `false` và bỏ qua nhánh cộng sao legacy.

### 1.2. Nguyên nhân gốc
1. **Thiếu quy tắc vòng đời Chapter mới:** Chưa có module tính toán thời gian hoạt động tối thiểu 6 tháng lịch (`addCalendarMonthsVietnam`) để phân biệt Chapter mới đang trong nhiệm kỳ đầu với Chapter đã qua kỳ chuyển giao bắt buộc.
2. **Thiếu khởi tạo nhiệm kỳ 1 khi tạo Chapter:** Cả 2 luồng tạo Chapter (Admin Organization Route và Invitation Accept Route) chỉ tạo bảng `Chapter` và `OrganizationUnit` mà không thiết lập `current_term_number: 1`, không tạo `ChapterCompetitionTerm` (`starts_at = created_at, ends_at = null, season_id = null`), và không tự động chuẩn hóa 7 ban tiêu chuẩn.
3. **Logic gate tạm dừng sao chưa xét ngoại lệ Chapter mới:** `chapterRewardGate` kiểm tra gắt gao sự kiện chuyển giao mà không kiểm tra xem Chapter đã đủ 6 tháng lịch tại thời điểm mở mùa hay chưa.
4. **Logic video heartbeat gán cờ completion:** Biến `rewardComplete` không được gán fallback bằng `trainingVideoComplete` khi `!context`.

---

## 2. Quy Tắc Nghiệp Vụ Chính Thức & Bảng Đối Chiếu 20 Ca Biên (T01–T20)

### 2.1. Quy tắc tính 6 tháng lịch (Asia/Ho_Chi_Minh UTC+7)
- **Múi giờ:** UTC+7 cố định quanh năm, không có DST.
- **Ngày đủ điều kiện:** `firstEligibleAt = addCalendarMonthsVietnam(chapter.created_at, 6)`.
- **Cắt ngày cuối tháng (Clamping):** Nếu tháng đích có ít ngày hơn ngày thành lập (ví dụ thành lập 31/08), ngày đủ điều kiện sẽ được ghim vào ngày cuối cùng của tháng 2 (28/02 năm thường, 29/02 năm nhuận). Giờ, phút, giây, mili-giây được bảo toàn nguyên vẹn.
- **Điều kiện xét mùa:** `eligibleForSeason = firstEligibleAt <= season.starts_at`.
- **Thiếu 1 ngày / 1 giờ / 1 giây:** Nếu `firstEligibleAt > season.starts_at`, Chapter được **bỏ qua toàn bộ mùa hiện tại** (`INITIAL_SEASON_SKIPPED`), không bị ép chuyển giao giữa mùa và **không bị tạm dừng thưởng sao**.
- **Chuyển giao tự nguyện (Voluntary Transfer):** Nếu Chapter chủ động chuyển giao trước thời hạn 6 tháng, hệ thống vẫn chấp nhận hợp lệ (`TRANSFER_APPLIED`), kết thúc nhiệm kỳ 1 và mở nhiệm kỳ 2 bình thường.
- **Bảng xếp hạng:** Vẫn tính điểm và xếp hạng bình thường. Nếu Chapter mới không chuyển giao thì số liệu tích lũy đến thời điểm đó vẫn được ghi nhận và nhiệm kỳ sau cộng dồn tiếp chứ không bị reset sao của học viên hay Chapter.

### 2.2. Bảng đối chiếu 20 ca kiểm thử (T01–T20)

| Mã test | Mô tả kịch bản kiểm thử | Kỳ vọng nghiệp vụ | Kết quả kiểm thử |
| :--- | :--- | :--- | :--- |
| **T01** | Thành lập 15/01/2026 | `firstEligibleAt = 15/07/2026 00:00:00` | **PASS** (9.6ms) |
| **T02** | Thành lập 31/08/2026 (năm không nhuận) | Ghim ngày cuối tháng: `28/02/2027 15:30:45` | **PASS** (0.3ms) |
| **T03** | Thành lập 02/03/2026, xét mùa 01/09/2026 | Thiếu 1 ngày (`02/09 > 01/09`) -> Bỏ qua mùa, `paused = false` | **PASS** (0.2ms) |
| **T04** | Thành lập 02/03/2026, tại ngày 02/09/2026 (giữa mùa) | Vừa đủ 6 tháng giữa mùa -> Không ép chuyển giao giữa mùa, `paused = false` | **PASS** (0.1ms) |
| **T05** | Mùa tiếp theo (01/03/2027) sau ca T03 | Chapter đã > 6 tháng -> Bắt buộc chuyển giao; quá deadline bị pause | **PASS** (0.1ms) |
| **T06** | Thành lập 01/03/2026 00:00:00, mùa 01/09/2026 00:00:00 | Vừa đủ đúng 00:00:00 -> Đủ điều kiện xét chuyển giao mùa 9–10/2026 | **PASS** (0.1ms) |
| **T07** | Thành lập 01/03/2026 00:00:01, mùa 01/09/2026 00:00:00 | Thiếu đúng 1 giây -> Bỏ qua toàn bộ mùa 9–10/2026, `paused = false` | **PASS** (0.1ms) |
| **T08** | Năm nhuận 2028: Thành lập 29/02/2028 | `firstEligibleAt = 29/08/2028 12:00:00` | **PASS** (0.1ms) |
| **T09** | Năm nhuận 2028: Thành lập 31/08/2028 sang 2029 | 2029 không nhuận -> Ghim 28/02/2029 | **PASS** (0.1ms) |
| **T10** | Năm 2027 sang 2028: Thành lập 31/08/2027 sang 2028 | 2028 nhuận -> Ghim 29/02/2028 | **PASS** (0.1ms) |
| **T11** | Độ chính xác mili-giây: 23:59:59 vs 00:00:00 | Thành lập 28/02 23:59:59 hợp lệ; 01/03 00:00:01 bị lùi mùa | **PASS** (0.1ms) |
| **T12** | Chapter mới trong mùa chuyển giao nhưng < 6 tháng | Học viên học/xem video nhận sao bình thường (`paused = false`) | **PASS** (0.1ms) |
| **T13** | Chapter mới thuộc diện bỏ qua mùa | Xuyên suốt mùa không bị khóa sao (`paused = false`) | **PASS** (0.1ms) |
| **T14** | Chapter đến mùa bắt buộc đầu tiên, quá deadline | Quá hạn mà chưa chuyển giao -> Tạm dừng thưởng sao (`paused = true`) | **PASS** (0.1ms) |
| **T15** | Chapter đến mùa bắt buộc, thực hiện chuyển giao thành công | `TRANSFER_APPLIED` -> Mở lại sao ngay lập tức, bắt đầu nhiệm kỳ 2 | **PASS** (0.1ms) |
| **T16** | Chuyển giao tự nguyện (Chapter mới thành lập 2 tháng) | Lead nộp & áp dụng chuyển giao -> Chấp nhận hợp lệ, mở nhiệm kỳ 2 | **PASS** (0.1ms) |
| **T17** | Tạo Chapter mới qua Invitation | `current_term_number = 1`, tạo `ChapterCompetitionTerm`, sinh 7 ban | **PASS** (8.3s) |
| **T18** | Tạo Chapter mới qua Admin | `current_term_number = 1`, tạo `ChapterCompetitionTerm`, sinh 7 ban | **PASS** (6.3s) |
| **T19** | Kiểm tra 2 Chapter trong DB (`BBE Chapter 1`, `BBE Chapter 2`) | Đã có term 1, `ends_at = null`, trạng thái reward unpaused | **PASS** (3.3s) |
| **T20** | Đối soát học viên `vobahoaan@gmail.com` | Có đủ 19 sao video (14 sao cho 862s + 5 sao cho 309s) trong `StarLedger` | **PASS** (1.3s) |

---

## 3. Danh Sách File Thay Đổi & Lý Do

1. **`src/lib/chapter-term-rules.ts` (MỚI):**
   - Định nghĩa thuật toán ngày tháng lịch Việt Nam: `daysInVietnamMonth`, `addCalendarMonthsVietnam`, `getVietnamParts`.
   - Hàm đánh giá nghiệp vụ: `evaluateChapterTransferEligibility`. Phân định rõ ràng các trạng thái `INITIAL_NOT_DUE`, `INITIAL_SEASON_SKIPPED`, `FIRST_TRANSFER_DUE`, `TRANSFER_APPLIED`, `TRANSFER_OVERDUE`, `TRANSFER_SCHEDULED`.
2. **`src/lib/chapter-reward-gate.ts` (CẬP NHẬT):**
   - Tích hợp `evaluateChapterTransferEligibility` vào `chapterRewardState`.
   - Loại bỏ giả định cứng ép mọi Chapter phải có reorganizaton mới mở sao. Chapter mới chưa đủ 6 tháng không bị pause.
3. **`src/lib/invitations.ts` (CẬP NHẬT):**
   - Khi Chapter mới được tạo thông qua chấp nhận lời mời (`acceptInvitation`):
     - Gán `current_term_number: 1`.
     - Tạo bản ghi `ChapterCompetitionTerm` ban đầu (`starts_at = created_at, ends_at = null, season_id = null`).
     - Gọi `ensureChapterStandardDepartments` tạo 7 ban tiêu chuẩn.
4. **`src/app/api/v1/admin/organization/route.ts` (CẬP NHẬT):**
   - Khi Admin tạo đơn vị tổ chức có `type === 'CHAPTER'`:
     - Gán `current_term_number: 1`.
     - Tạo bản ghi `ChapterCompetitionTerm` ban đầu.
     - Gọi `ensureChapterStandardDepartments` tạo 7 ban tiêu chuẩn.
5. **`src/lib/video-heartbeat.ts` (CẬP NHẬT):**
   - Khắc phục lỗi `rewardComplete = false` khi `!context` bằng cách gán `rewardComplete = trainingVideoComplete`. Nhờ đó học viên xem xong video ở chế độ pre-cutover hoặc khi chưa cấu hình cycle vẫn được ghi nhận sao video đầy đủ.
6. **`scripts/reconcile-new-chapters.ts` (MỚI):**
   - Script tự động kích hoạt nhiệm kỳ 1 và khởi tạo `ChapterCompetitionTerm` cho `BBE Chapter 1` và `BBE Chapter 2`.
   - Đối soát và bù 19 sao video (14 sao + 5 sao) cho học viên `vobahoaan@gmail.com`.
   - Làm mới toàn bộ cache bảng xếp hạng và cây tổ chức.
7. **`src/test/chapter-six-month-transfer.test.ts` (MỚI):**
   - Test suite độc lập kiểm thử toàn diện 20 ca kiểm thử T01–T20.

---

## 4. Trạng Thái Cơ Sở Dữ Liệu Trước và Sau Bản Vá

### 4.1. Hai Chapter Hiện Có Trong DB
| Tiêu chí | Trước bản vá | Sau bản vá |
| :--- | :--- | :--- |
| **BBE Chapter 1** (`788a974a...`) `current_term_number` | `null` | **`1`** |
| **BBE Chapter 1** `ChapterCompetitionTerm` | Trống (`0` bản ghi) | **`1` bản ghi** (`starts_at = created_at`, `ends_at = null`) |
| **BBE Chapter 1** 7 ban tiêu chuẩn | Thiếu chuẩn hóa | **Đủ 7 ban ACTIVE** |
| **BBE Chapter 1** Trạng thái khóa sao | Bị khóa (`paused = true`) | **Mở hoàn toàn (`paused = false`)** |
| **BBE Chapter 2** (`9d7fb585...`) `current_term_number` | `null` | **`1`** |
| **BBE Chapter 2** `ChapterCompetitionTerm` | Trống (`0` bản ghi) | **`1` bản ghi** (`starts_at = created_at`, `ends_at = null`) |
| **BBE Chapter 2** 7 ban tiêu chuẩn | Thiếu chuẩn hóa | **Đủ 7 ban ACTIVE** |
| **BBE Chapter 2** Trạng thái khóa sao | Bị khóa (`paused = true`) | **Mở hoàn toàn (`paused = false`)** |

### 4.2. Học Viên `vobahoaan@gmail.com` (`e1986d7d-77a2-4993-9fdb-9c5513b02d2a`)
| Tiêu chí | Trước bản vá | Sau bản vá |
| :--- | :--- | :--- |
| Video 1: "BBE - Lịch sử ra đời" (862s) | Hoàn thành, 0 sao trong ledger | **Đã ghi nhận 14 sao** (`VIDEO_COMPLETION`) |
| Video 2: "BBE - Tầm nhìn" (309s) | Hoàn thành, 0 sao trong ledger | **Đã ghi nhận 5 sao** (`VIDEO_COMPLETION`) |
| Tổng sao video | 0 sao | **19 sao** |
| Sao bài tập trắc nghiệm | 20 sao (`MODULE_QUIZ_PASS`) | 20 sao (`MODULE_QUIZ_PASS`) |
| **Tổng sao tích lũy** | 20 sao | **39 sao** |
| Trạng thái học và nhận sao | Bị nghẽn do pause của Chapter | **Bình thường, cộng dồn vào bảng xếp hạng** |

---

## 5. Kết Quả Kiểm Thử Toàn Diện

1. **Test suite mới `chapter-six-month-transfer.test.ts` (T01–T20):**
   - **20 / 20 ca PASS (100%)**, 0 fail, thời gian chạy: 19.2s.
2. **Regression Test Suite `test:fb-fixes` (FB01–FB08):**
   - **27 / 27 ca PASS (100%)**, 0 fail.
3. **Regression Test Suite `test:business-rules`:**
   - **66 / 66 ca PASS (100%)**, 0 fail.
4. **Regression Test Suite `test:video-progress-session`:**
   - **22 / 22 ca PASS (100%)**, 0 fail.
5. **Kiểm tra kiểu dữ liệu TypeScript (`npx tsc --noEmit`):**
   - **0 lỗi biên dịch (Exit Code 0)**.
6. **Kiểm tra đóng gói Next.js (`npm run build`):**
   - **Thành công 100% (74/74 trang tĩnh & động được biên dịch tối ưu)**.

---

## 6. Hướng Dẫn Kiểm Tra Thủ Công Dành Cho PO / Tester

### Bước 1: Đăng nhập tài khoản học viên và kiểm tra sao
1. Đăng nhập bằng tài khoản `vobahoaan@gmail.com`.
2. Truy cập trang cá nhân hoặc xem biểu tượng sao ở thanh điều hướng:
   - Tổng sao hiển thị: **39 sao** (bao gồm 19 sao từ 2 video đã học + 20 sao từ quiz).
3. Vào trang Lịch sử nhận sao (`/student/stars`):
   - Bản ghi "Hoàn thành video: BBE - Lịch sử ra đời" (+14 sao).
   - Bản ghi "Hoàn thành video: BBE - Tầm nhìn" (+5 sao).

### Bước 2: Học tiếp video mới và nhận sao tức thì
1. Chọn bài học tiếp theo (ví dụ: "BBE - Sứ mệnh" - 713s).
2. Xem hết video liên tục đến cuối:
   - Hệ thống tự động ghi nhận hoàn thành và cộng ngay **11 sao** (Math.floor(713 / 60) = 11 sao).
   - Không xuất hiện cảnh báo "Tạm dừng thưởng sao do chuyển giao".

### Bước 3: Kiểm tra bảng xếp hạng Chapter
1. Vào mục Bảng xếp hạng (`/leaderboard` hoặc `/chapter-manager/leaderboard`).
2. Xem `BBE Chapter 1`:
   - Điểm số và sao của các thành viên được tính lũy kế đầy đủ.
   - Chapter hiển thị trạng thái đang hoạt động ở **Nhiệm kỳ 1**.
   - Không bị loại khỏi bảng xếp hạng hay bị gắn cờ quá hạn chuyển giao.

### Bước 4: Tạo Chapter mới (Kiểm tra tự động kích hoạt nhiệm kỳ 1)
1. Đăng nhập tài khoản Admin -> Quản lý tổ chức -> Thêm mới Chapter.
2. Kiểm tra thông tin Chapter vừa tạo:
   - Tự động có nhiệm kỳ 1 (`current_term_number = 1`).
   - Tự động sinh đủ 7 ban chuyên môn.
   - Thành viên mới tham gia vào Chapter có thể học và nhận sao ngay từ ngày đầu tiên mà không cần chờ hay làm thủ tục chuyển giao.
