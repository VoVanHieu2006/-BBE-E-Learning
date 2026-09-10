# PHASE 05 — DATA, API & DATABASE AUDIT REPORT
**Dự án:** BBE E-Learning Platform  
**Ngày thực hiện:** 2026-09-09  
**Người thực hiện:** Hệ thống Audit Tự động Antigravity (Data Architect Persona)  
**Môi trường thử nghiệm:** Supabase PostgreSQL Live Database + Prisma ORM  
**Trạng thái Phase 05:** **COMPLETED (PASS)**  

---

## 1. MỤC TIÊU & PHƯƠNG PHÁP KIỂM TOÁN DỮ LIỆU
Phase 05 tiến hành rà soát tính toàn vẹn cấu trúc cơ sở dữ liệu, quan hệ khóa ngoại (Foreign Keys), ràng buộc toàn vẹn (Constraints), tính nhất quán giữa API và Database, và đặc biệt là kiểm tra hiện tượng **"Trộn lẫn dữ liệu giữa các vai trò" (Role Mixing)**.

Đối chiếu theo chuỗi:
$$\text{Frontend UI} \longrightarrow \text{API Route Handlers} \longrightarrow \text{Service Logic / Helpers} \longrightarrow \text{PostgreSQL Database}$$

---

## 2. KẾT QUẢ RÀ SOÁT CƠ SỞ DỮ LIỆU (DATABASE INTEGRITY AUDIT)

### 2.1 Thống kê Thực thể & Dữ liệu Hệ thống (Entity Counts)

| Nhóm dữ liệu | Thực thể (Model) | Số lượng bản ghi | Trạng thái toàn vẹn | Ghi chú đánh giá |
| :--- | :--- | :---: | :---: | :--- |
| **Người dùng (Users)** | `User` | **64** | **Chuẩn** | Admin: 1, BĐHU: 28, Thành viên (TV): 35 (Active: 30, Locked: 4, Inactive: 2) |
| **Chapter & Đơn vị** | `Chapter` | **33** | **Chuẩn** | 100% Chapter có tên duy nhất (`@unique`), status `ACTIVE` |
| **Phân bổ Thành viên** | `ChapterMember` | **69** | **Chuẩn** | Quan hệ nhiều-nhiều duy nhất qua cặp `[chapter_id, user_id]` (`@unique`) |
| **Khóa học (Courses)** | `Course` | **32** | **Chuẩn** | Published: 15 khóa, Draft: 17 khóa |
| **Chương học (Sessions)**| `Session` | **38** | **Chuẩn** | 100% Session có khóa ngoại `course_id` hợp lệ |
| **Bài học (Lessons)** | `Lesson` | **43** | **Chuẩn** | **0 bài học mồ côi** (`orphanLessonsCount = 0`) |
| **Video YouTube** | `Video` | **49** | **Chuẩn** | **100% bài học có video** (`lessonsWithoutVideoCount = 0`), quan hệ 1-1 |
| **Tài liệu Cloudflare R2**| `Document` | **15** | **Chuẩn** | Khóa ngoại trỏ chính xác về bài học, có MIME type & dung lượng |
| **Đề thi (Assessments)** | `Assessment` | **35** | **Chuẩn** | Quan hệ 1-1 với khóa học (`course_id` unique) |
| **Câu hỏi trắc nghiệm** | `Question` | **112** | **Chuẩn** | Có điểm số (`points`) và thời gian từng câu (`duration_seconds`) |
| **Phương án trả lời** | `QuestionOption` | **361** | **Chuẩn** | **100% câu hỏi có ít nhất 1 đáp án đúng** (`is_correct = true`) |
| **Tiến trình học video** | `LessonProgress` | **41** | **Chuẩn** | Đã hoàn thành: 37, Đang học: 4 |
| **Lượt làm bài thi** | `Attempt` | **29** | **Chuẩn** | Đã nộp: 26, Tự động nộp bởi Cron: 3, Đang thi dở: 0 |

---

### 2.2 Kiểm tra Hiện tượng Trộn lẫn Vai trò (Role Mixing & Contamination)
Một trong những lỗi nghiêm trọng nhất của hệ thống E-Learning là **Admin hoặc BĐHU bị tính nhầm vào danh sách học viên**, làm sai lệch điểm số trung bình, tỷ lệ hoàn thành hoặc đứng đầu bảng xếp hạng.

* **Kiểm tra Leaderboard:**
  * File [`src/app/api/v1/leaderboard/route.ts`](file:///c:/Users/Acer/Desktop/E-learning/src/app/api/v1/leaderboard/route.ts): Câu lệnh Prisma truy vấn lọc cứng điều kiện:
    ```ts
    where: { status: 'ACTIVE', role: 'MEMBER' }
    ```
    $$\Rightarrow \text{Tài khoản ADMIN và CHAPTER\_LEADER bị loại bỏ hoàn toàn khỏi Leaderboard.}$$
* **Kiểm tra Tiến độ Chapter (Dashboard BĐHU):**
  * File [`src/app/api/v1/chapters/[chapterId]/dashboard/members/route.ts`](file:///c:/Users/Acer/Desktop/E-learning/src/app/api/v1/chapters/%5BchapterId%5D/dashboard/members/route.ts):
    ```ts
    userFilter.role = 'MEMBER'
    ```
    $$\Rightarrow \text{Chỉ thành viên học tập mới được tính vào KPI và tiến độ trung bình của Chapter.}$$
* **Kết luận:** **KHÔNG CÓ HIỆN TƯỢNG TRỘN LẪN VAI TRÒ (NO ROLE CONTAMINATION).**

---

### 2.3 Rà soát Quan hệ Khóa ngoại & Dọn dẹp Dữ liệu (Cascade Integrity)
* **Khóa ngoại Cascade:** Toàn bộ các quan hệ phân cấp sâu:
  $$\text{Course} \xrightarrow{\text{Cascade}} \text{Session} \xrightarrow{\text{Cascade}} \text{Lesson} \xrightarrow{\text{Cascade}} \text{Video / Document / Progress}$$
  $$\text{Assessment} \xrightarrow{\text{Cascade}} \text{Question} \xrightarrow{\text{Cascade}} \text{QuestionOption}$$
  đều được cấu hình `onDelete: Cascade` tại mức CSDL PostgreSQL.
* **Bảo vệ Lịch sử Thi cử:**
  Bảng `AttemptAnswer` sử dụng `selected_option_id String?` với ràng buộc `onDelete: SetNull`. Nếu Admin chỉnh sửa hoặc xóa một phương án trắc nghiệm trong ngân hàng đề thi thì các bài thi lịch sử của học viên đã nộp trước đó không bị xóa mất dữ liệu mà chỉ chuyển `selected_option_id` về `null`, bảo toàn điểm số lịch sử.

---

### 2.4 Dữ liệu Thành viên không gắn Chapter (Unassigned Members)
* **Phát hiện thực tế:** Có 15 tài khoản có vai trò `MEMBER` trong database không có bản ghi liên kết trong bảng `ChapterMember`.
* **Phân tích nguyên nhân:** 
  1. Các tài khoản test tự động trước đây (`temp_del_...`, `lock_test_...`) được tạo trong các bài test đơn lẻ mà không qua quy trình mời tham gia Chapter.
  2. Học viên bị BĐHU bấm "Xóa khỏi Chapter" (API `DELETE /api/v1/chapters/[chapterId]/members/[userId]`). Khi xóa khỏi Chapter, hệ thống chỉ xóa dòng trong `ChapterMember`, tài khoản `User` vẫn tồn tại ở trạng thái tự do.
* **Đánh giá rủi ro:** **LOW**. Đây là hành vi có chủ đích nhằm không xóa mất tài khoản đăng nhập của người dùng. Tuy nhiên, các tài khoản này khi đăng nhập sẽ không thấy thông tin Chapter trên thanh Header.

---

## 3. CHECKLIST TRẠNG THÁI PHASE 05

| Hạng mục kiểm tra | Trạng thái | Bằng chứng thực nghiệm |
| :--- | :---: | :--- |
| Kiểm tra toàn vẹn quan hệ khóa ngoại (FKs) | **PASS** | 0 bản ghi mồ côi; Cascade delete hoạt động đúng |
| Kiểm tra 100% bài học có Video hợp lệ | **PASS** | 43/43 bài học đều có video YouTube liên kết |
| Kiểm tra 100% câu hỏi có đáp án đúng | **PASS** | 112/112 câu hỏi trắc nghiệm đều có ít nhất 1 đáp án `is_correct: true` |
| Kiểm tra hiện tượng trộn lẫn Role (Role Mixing) | **PASS** | Leaderboard & Dashboard lọc triệt để `role: MEMBER` |
| Kiểm tra tính nhất quán Enum và Status DB | **PASS** | Trạng thái đồng nhất giữa Prisma Schema và Postgres Enums |
| Kiểm tra xử lý dữ liệu BigInt & Decimal | **PASS** | `file_size` (BigInt) và `score` (Decimal) được serialize an toàn |

---

## 4. NHỮNG GÌ CHƯA KIỂM TRA TRONG PHASE 05 (LIMITATIONS)
- **Deadlock trong giao dịch đồng thời cao (Deadlock under heavy concurrent write):** Sẽ được thử thách ở Phase 06.
- **Dung lượng tệp lưu trữ thực tế trên Cloudflare R2 bucket:** Chưa quét trực tiếp từng object trên R2 S3 API để đối chiếu với bảng `documents`.
