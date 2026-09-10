# PHASE 01 — FEATURE & ROLE AUDIT REPORT
**Dự án:** BBE E-Learning Platform  
**Ngày thực hiện:** 2026-09-09  
**Người thực hiện:** Hệ thống Audit Tự động Antigravity  
**Trạng thái Phase 01:** **COMPLETED (PASS WITH FINDINGS)**  

---

## 1. MỤC TIÊU VÀ PHẠM VI AUDIT
Phase 01 tiến hành kiểm tra toàn diện **51 Features** đã được xác định từ Feature Inventory của Phase 00, đối chiếu chặt chẽ trên 4 nhóm đối tượng:
1. **Khách (Guest / Unauthenticated)**
2. **Thành viên học tập (TV / MEMBER)**
3. **Ban Định Hướng Chapter (BĐHU / CHAPTER_LEADER)**
4. **Quản trị viên toàn hệ thống (Admin / ADMIN)**

Tiêu chí đánh giá cho mỗi tính năng:
* **Tồn tại:** Có file UI & Backend API tương ứng hay không?
* **Hoạt động:** Luồng thực thi có thông suốt từ Frontend → API → Service → Database không?
* **Phân quyền (RBAC):** Có chặn đúng vai trò không được phép hay không? Có rò rỉ dữ liệu chéo giữa các Chapter không?
* **Giao diện (UI):** Giao diện có đầy đủ nút bấm, form, state xử lý (loading/error/empty) không?
* **Dữ liệu & Flow:** Có thiếu sót bước nào trong quy trình nghiệp vụ (Business Rules) không?

---

## 2. FEATURE COVERAGE MATRIX

*Ký hiệu:*  
* `✅ FULL`: Có tính năng, phân quyền đúng, UI & API đồng bộ  
* `🔒 RESTRICTED`: Quyền bị giới hạn theo đúng Business Rules  
* `❌ BLOCKED`: Bị chặn hoàn toàn (401/403/Redirect)  
* `⚠️ ISSUE`: Hoạt động nhưng có tiềm ẩn lỗi logic/luồng  
* `N/A`: Không áp dụng cho vai trò này  

| Mã ID | Tên tính năng (Feature) | Khách (Guest) | Học viên (TV) | Ban Điều Hành (BĐHU) | Quản trị viên (Admin) | Đánh giá tổng thể |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **AUTH-01** | Đăng nhập hệ thống (Email/Password) | ✅ FULL | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **AUTH-02** | Đăng xuất & Thu hồi Refresh Token | ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **AUTH-03** | Tự động làm mới Access Token (Refresh) | ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **AUTH-04** | Yêu cầu cấp lại mật khẩu (Forgot Pass) | ✅ FULL | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **AUTH-05** | Đặt mật khẩu mới bằng Token Reset | ✅ FULL | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **AUTH-06** | Kích hoạt tài khoản từ lời mời (Accept) | ✅ FULL | N/A | N/A | N/A | **PASS** |
| **AUTH-07** | Kiểm tra tính hợp lệ của Token mời | ✅ FULL | N/A | N/A | N/A | **PASS** |
| **USER-01** | Xem thông tin hồ sơ của tôi (`users/me`) | ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **USER-02** | Xem danh sách User toàn hệ thống | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **USER-03** | Khóa / Kích hoạt / Đổi trạng thái User | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Chỉ TV chapter)* | ✅ FULL *(Trừ Admin khác)* | **PASS** |
| **CHAP-01** | Xem danh sách Chapter toàn quốc | ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **CHAP-02** | Dashboard KPI & Tiến độ Chapter | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Chỉ Chapter mình)* | ✅ FULL *(Mọi Chapter)* | **PASS** |
| **CHAP-03** | Xem danh sách thành viên Chapter | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Chỉ Chapter mình)* | ✅ FULL *(Mọi Chapter)* | **PASS** |
| **CHAP-04** | Xem tiến trình học chi tiết 1 thành viên | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Chỉ TV Chapter mình)* | ✅ FULL | **PASS** |
| **CHAP-05** | Xóa học viên khỏi Chapter | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Chỉ TV Chapter mình)* | ✅ FULL | **PASS** |
| **INV-01** | Mời Trưởng Chapter mới (BĐHU) | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **INV-02** | Mời Thành viên học tập vào Chapter | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Vào Chapter mình)* | ⚠️ ISSUE *(API chặn Admin - BA-01)* | **POTENTIAL ISSUE** |
| **INV-03** | Xem danh sách lời mời đã gửi | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Chỉ lời mời Chapter)* | ✅ FULL *(Toàn hệ thống)* | **PASS** |
| **INV-04** | Gửi lại email lời mời (Resend) | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Chỉ lời mời Chapter)* | ✅ FULL | **PASS** |
| **INV-05** | Hủy / Thu hồi lời mời chưa nhận | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Chỉ lời mời Chapter)* | ✅ FULL | **PASS** |
| **CRS-01** | Xem danh mục khóa học (Course Catalog) | 🔒 RESTRICTED *(Chỉ Public)* | ✅ FULL *(Public & Private)* | ✅ FULL | ✅ FULL *(Bao gồm cả Draft)* | **PASS** |
| **CRS-02** | Xem đề cương chi tiết khóa học | 🔒 RESTRICTED *(Chỉ Public)* | ✅ FULL *(Public & Private)* | ✅ FULL | ✅ FULL | **PASS** |
| **CRS-03** | Tạo khóa học mới | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **CRS-04** | Cập nhật thông tin khóa học | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | 🔒 RESTRICTED *(Chỉ sửa khi Draft)* | **PASS** |
| **CRS-05** | Xóa khóa học | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **CRS-06** | Xuất bản khóa học (Publish) | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **CRS-07** | Bỏ xuất bản khóa học (Unpublish) | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **SES-01** | Thêm Session (Chương học) | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **SES-02** | Sửa / Xóa Session | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **SES-03** | Sắp xếp thứ tự các Session (Reorder) | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **LES-01** | Thêm bài học mới (Lesson) | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **LES-02** | Sửa / Xóa bài học | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **LES-03** | Học bài & Xem video YouTube | ❌ BLOCKED | ✅ FULL *(Có chống tua)* | ✅ FULL *(Miễn trừ chống tua)* | ✅ FULL *(Miễn trừ chống tua)* | **PASS** |
| **LES-04** | Tự động lấy YouTube Duration/Title | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **DOC-01** | Tải lên tài liệu Cloudflare R2 | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **DOC-02** | Tải tài liệu về máy (Presigned Download)| ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **DOC-03** | Xóa tài liệu khỏi R2 & Database | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **PROG-01**| Ghi nhận Heartbeat tiến độ video (12s) | ❌ BLOCKED | ✅ FULL *(Chống tua nghiêm ngặt)*| ✅ FULL | ✅ FULL | **PASS** |
| **PROG-02**| Xem tiến độ 1 bài học (`progress`) | ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **PROG-03**| Xem tiến độ cả khóa (`my-progress`) | ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **PROG-04**| Danh sách khóa học của tôi (`me/courses`)| ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **STRK-01**| Tính chỉ số ngày học liên tục (Streak) | ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **QUIZ-01**| Soạn đề thi trắc nghiệm & Đáp án | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |
| **QUIZ-02**| Bắt đầu thi (Start Attempt) | ❌ BLOCKED | 🔒 RESTRICTED *(Học xong 100% video + Cooldown 24h)* | ✅ FULL *(Miễn điều kiện)* | ✅ FULL *(Miễn điều kiện)* | **PASS** |
| **QUIZ-03**| Xem đề & Làm bài (Giấu đáp án đúng) | ❌ BLOCKED | ✅ FULL *(Giấu đáp án đúng)* | ✅ FULL *(Xem được đáp án)* | ✅ FULL *(Xem được đáp án)* | **PASS** |
| **QUIZ-04**| Lưu câu trả lời từng câu (Auto-save) | ❌ BLOCKED | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **QUIZ-05**| Nộp bài & Nhận kết quả | ❌ BLOCKED | ✅ FULL *(≥85% mới lộ đáp án đúng)* | ✅ FULL | ✅ FULL | **PASS** |
| **QUIZ-06**| Tự động nộp bài hết giờ (Cron Job) | ❌ BLOCKED | N/A | N/A | 🔒 Webhook Secret | **PASS** |
| **LEAD-01**| Bảng xếp hạng toàn hệ thống | ✅ FULL | ✅ FULL | ✅ FULL | ✅ FULL | ⚠️ ISSUE *(Pagination trước sort)* |
| **LEAD-02**| Bảng xếp hạng theo từng Chapter | ✅ FULL | ✅ FULL | ✅ FULL | ✅ FULL | **PASS** |
| **DASH-01**| Dashboard Tổng quan Toàn quốc | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ FULL | **PASS** |

---

## 3. PHÂN TÍCH CHI TIẾT SỰ KHÁC BIỆT GIỮA CÁC VAI TRÒ (ROLE-BASED COMPARISON)

### 3.1 Khách vãng lai (Guest) vs Người dùng đã đăng nhập
1. **Khóa học:** Khách chỉ nhìn thấy và truy cập được những khóa học có trạng thái `status = 'PUBLISHED'` và `visibility = 'PUBLIC'`. Các khóa nội bộ `PRIVATE` bị ẩn khỏi catalog của khách và trả về `403 AccessDenied` nếu khách cố truy cập trực tiếp bằng URL.
2. **Video & Tài liệu:** Khách không thể xem video bài học hay tải tài liệu từ Cloudflare R2 (API yêu cầu Bearer JWT).
3. **Bảng xếp hạng:** Khách được phép xem bảng xếp hạng vinh danh (Leaderboard) để kích thích sự quan tâm, nhưng không có dữ liệu cá nhân.

---

### 3.2 Thành viên học tập (TV / MEMBER) vs Ban Định Hướng (BĐHU / CHAPTER_LEADER)
1. **Quyền hạn Chapter:** 
   * **TV:** Thuộc về một Chapter, chỉ có quyền học tập, xem tiến độ cá nhân, làm bài kiểm tra và xuất hiện trên Leaderboard của Chapter đó. Không có menu hay quyền truy cập vào khu vực `/chapter-manager/*`.
   * **BĐHU:** Được ủy quyền quản lý Chapter của mình. Có trang Dashboard quản lý học viên, xem tiến trình chi tiết của từng thành viên, xóa thành viên khỏi Chapter, và gửi lời mời học viên mới tham gia Chapter.
2. **Cách ly dữ liệu (Chapter Isolation):**
   * BĐHU của Chapter A **hoàn toàn bị chặn** khi cố gắng xem danh sách thành viên, dashboard hoặc xóa thành viên thuộc Chapter B. Backend kiểm tra nghiêm ngặt `auth.context.chapterId === chapterId`, nếu khác sẽ lập tức trả về `403 AccessDenied`.
3. **Cơ chế Video Player & Chống tua:**
   * **TV:** Bị kiểm soát chặt chẽ bởi thuật toán chống tua gian lận: không thể tua vượt quá vị trí đã xem; vị trí xem `furthest` chỉ được server chấp nhận tăng tối đa theo thời gian thực trôi qua (`elapsedSec * 2 + 25s`). Phải tích lũy tối thiểu 85% thời lượng video mới được hệ thống ghi nhận hoàn thành bài học.
   * **BĐHU:** Được cấp cờ `seekExempt = true` trên backend (`src/app/api/v1/lessons/[lessonId]/progress/route.ts`), cho phép tua tự do để kiểm tra và duyệt nhanh nội dung bài giảng trước khi giao cho học viên.
4. **Quy chế Bài thi trắc nghiệm (Assessment):**
   * **TV:** Bắt buộc phải hoàn thành 100% video bài học trong khóa mới được mở đề thi. Nếu thi trượt (dưới 85%), bị kích hoạt thời gian chờ Cooldown 24 giờ mới được thi lại. Khi nộp bài trượt, chỉ được biết câu nào đúng/sai chứ không được xem đáp án chuẩn.
   * **BĐHU:** Được xem trước đề thi kèm đáp án đúng và phần giải thích chi tiết (`canSeeCorrect = true` trong `/api/v1/courses/[courseId]/assessment`) để phục vụ công tác hướng dẫn học viên. Được miễn trừ điều kiện hoàn thành video và cooldown khi thi thử.
5. **Cách tính xếp hạng:**
   * Chỉ tài khoản có `role === 'MEMBER'` mới được tính điểm và xếp hạng trên Leaderboard. Tài khoản BĐHU không bao giờ bị tính nhầm vào danh sách học viên hay làm sai lệch điểm trung bình của Chapter.

---

### 3.3 Ban Định Hướng (BĐHU) vs Quản trị viên (Admin)
1. **Phạm vi quản lý:**
   * **BĐHU:** Chỉ có quyền trên phạm vi 1 Chapter duy nhất được phân công. Không được chỉnh sửa nội dung bài giảng, không được tạo khóa học, không được mời Trưởng Chapter khác.
   * **Admin:** Toàn quyền trên toàn hệ thống (Super Admin): Quản lý mọi Chapter, tạo/sửa/xóa khóa học, tải lên tài liệu R2, tạo đề kiểm tra đánh giá, quản lý tài khoản người dùng và xem thống kê tổng thể toàn quốc (`/admin/dashboard`).
2. **Quy tắc mời thành viên (Invitation Rule BA-01):**
   * **BĐHU:** Chuyên trách gửi lời mời thành viên học tập vào Chapter của mình (`/api/v1/invitations/member`).
   * **Admin:** Chuyên trách mời Trưởng Chapter mới (`/api/v1/invitations/chapter-leader`). Theo thiết kế hệ thống, Admin bị hạn chế gọi API mời Member trực tiếp để phân định rõ trách nhiệm quản lý nhân sự thuộc về BĐHU từng Chapter.
3. **Bảo vệ tài khoản quản trị:**
   * Không người dùng nào (kể cả Admin) có thể vô hiệu hóa một Admin khác thông qua API (`src/app/api/v1/users/[userId]/route.ts` - `target.role === 'ADMIN' && status === 'INACTIVE'` -> `403 InvalidTransition`).

---

## 4. CHI TIẾT CÁC PHÁT HIỆN TRONG PHASE 01 (FINDINGS)

### 4.1 Confirmed Bugs
*Hiện tại chưa phát hiện Confirmed Bug nào làm sập hệ thống (Crash/500) hoặc cho phép leo quyền trái phép trong luồng hoạt động bình thường.*

---

### 4.2 Potential Issues (Vấn đề tiềm ẩn rủi ro)

#### [POTENTIAL-01] Thuật toán Phân trang Leaderboard phân trang trước khi sắp xếp điểm toàn cục
* **Vị trí:** [`src/app/api/v1/leaderboard/route.ts:L21-L63`](file:///c:/Users/Acer/Desktop/E-learning/src/app/api/v1/leaderboard/route.ts#L21-L63)
* **Mô tả:** API thực hiện phân trang trực tiếp trên bảng User:
  ```ts
  const members = await prisma.user.findMany({
    where: { status: 'ACTIVE', role: 'MEMBER' },
    take: limit,
    skip,
  })
  ...
  results.sort((a, b) => b.leaderboardPoint - a.leaderboardPoint)
  ```
* **Hệ quả:** Nếu hệ thống có hơn 50 thành viên, trang 1 (`take: 50, skip: 0`) chỉ lấy 50 thành viên đầu tiên theo ID của database rồi mới sắp xếp điểm số nội bộ trong 50 người đó. Thành viên có điểm số cao nhất hệ thống nhưng nằm ở bản ghi số 51 trong database sẽ bị rơi vào trang 2 thay vì đứng Top 1 trên bảng vàng.
* **Mức độ:** **MEDIUM** (Ảnh hưởng tính công bằng và chính xác của bảng xếp hạng khi quy mô học viên tăng lên).

#### [POTENTIAL-02] Admin không có luồng UI để mời học viên hỗ trợ BĐHU
* **Vị trí:** [`src/app/api/v1/invitations/member/route.ts:L21-L31`](file:///c:/Users/Acer/Desktop/E-learning/src/app/api/v1/invitations/member/route.ts#L21-L31) và [`src/app/admin/invitations/page.tsx`](file:///c:/Users/Acer/Desktop/E-learning/src/app/admin/invitations/page.tsx)
* **Mô tả:** Theo Business Rule BA-01, API `POST /api/v1/invitations/member` chủ động chặn Admin (`role !== 'CHAPTER_LEADER' -> 403`). Giao diện Admin chỉ có modal mời BĐHU.
* **Hệ quả:** Khi một Chapter Leader gặp sự cố kỹ thuật hoặc nhờ Ban Quản Trị mời hộ danh sách học viên vào Chapter, Admin không có cách nào hỗ trợ từ Dashboard quản trị mà bắt buộc phải đăng nhập bằng tài khoản của BĐHU đó.
* **Mức độ:** **LOW** (Hạn chế về tính linh hoạt vận hành).

---

### 4.3 Improvements (Đề xuất cải tiến trải nghiệm & bảo mật)

#### [IMP-01] Vô hiệu hóa hoặc ẩn trang Playground `/lessons/[lessonId]`
* **Vị trí:** [`src/app/lessons/[lessonId]/page.tsx`](file:///c:/Users/Acer/Desktop/E-learning/src/app/lessons/%5BlessonId%5D/page.tsx)
* **Mô tả:** Trang này là giao diện test dành cho nhà phát triển (có ô nhập Access Token thủ công). Tuy không có liên kết công khai từ Menu, nhưng nếu học viên vô tình truy cập URL này có thể gây hiểu lầm hoặc lộ giao diện debug.
* **Đề xuất:** Thêm Middleware chuyển hướng trang này về `/student/learning/[lessonId]` hoặc chỉ cho phép truy cập khi `process.env.NODE_ENV === 'development'`.

#### [IMP-02] Hợp nhất route `/accept-invitation` và `/invitations/accept`
* **Vị trí:** [`src/app/invitations/accept/page.tsx`](file:///c:/Users/Acer/Desktop/E-learning/src/app/invitations/accept/page.tsx)
* **Mô tả:** Hiện tại đang duy trì 2 URL cùng làm một nhiệm vụ (file tại `invitations/accept` re-export trang `accept-invitation`).
* **Đề xuất:** Cấu hình Next.js Redirect 301 chuẩn từ `/invitations/accept` về `/accept-invitation` để thống nhất URL duy nhất trên toàn hệ thống.

---

## 5. CHECKLIST TRẠNG THÁI PHASE 01

| Hạng mục kiểm tra | Trạng thái | Ghi chú bằng chứng |
| :--- | :---: | :--- |
| Kiểm tra Module Xác thực (Auth) theo các Role | **PASS** | Đăng nhập, Đăng xuất, Token Refresh, Password Reset hoạt động đúng |
| Kiểm tra Phân quyền Khóa học (Course Catalog & Detail) | **PASS** | Chặn đúng Guest với khóa Private; Admin quản lý được khóa Draft |
| Kiểm tra Quản lý Chương & Bài học (Sessions & Lessons) | **PASS** | Chỉ Admin được sửa đổi; khóa Published bị khóa chỉnh sửa (409) |
| Kiểm tra Trình phát Video YouTube & Chống tua | **PASS** | Server-side clamp hoạt động; TV bị chặn tua trước, BĐHU/Admin được miễn trừ |
| Kiểm tra Kho tài liệu Cloudflare R2 | **PASS** | Chỉ Admin upload/xóa; học viên tải qua Presigned URL an toàn |
| Kiểm tra Bài kiểm tra trắc nghiệm (Assessment) | **PASS** | TV giấu đáp án đúng; yêu cầu học 100% video và Cooldown 24h; BĐHU/Admin xem được key |
| Kiểm tra Phân quyền Chapter & Cách ly dữ liệu | **PASS** | BĐHU Chapter A không thể xem hay xóa thành viên Chapter B |
| Kiểm tra Bảng xếp hạng (Leaderboard & Streak) | **PASS** | Chỉ xếp hạng `MEMBER` Active; phát hiện vấn đề phân trang trước sort |
| Kiểm tra Quản lý Người dùng & Trạng thái | **PASS** | Phân quyền cập nhật trạng thái chuẩn, có audit log và xóa cache ngay |

---

## 6. NHỮNG GÌ CHƯA KIỂM TRA TRONG PHASE 01 (LIMITATIONS)
- **Kiểm thử áp lực & Edge Cases:** Chưa thực hiện gửi dữ liệu biên cực lớn, spam submit cùng lúc từ nhiều tab (Sẽ thực hiện tại Phase 02 & Phase 06).
- **Khai thác bảo mật:** Chưa thực hiện tấn công SQLi, XSS, token tampering hay SSRF (Sẽ thực hiện tại Phase 03).
- **Đo lường thời gian đáp ứng (Latency):** Chưa đo thời gian truy vấn DB khi có lượng dữ liệu lớn (Sẽ thực hiện tại Phase 04).
