# PHASE 02 — FUNCTIONAL TEST REPORT
**Dự án:** BBE E-Learning Platform  
**Ngày thực hiện:** 2026-09-09  
**Người thực hiện:** Hệ thống Audit Tự động Antigravity  
**Môi trường thử nghiệm:** Local Development (`http://localhost:3000` + Supabase PostgreSQL + Cloudflare R2)  
**Trạng thái Phase 02:** **COMPLETED (PASS)**  

---

## 1. TỔNG QUAN KIỂM THỬ CHỨC NĂNG (QA FUNCTIONAL SUITE)
Phase 02 đóng vai trò kiểm thử chất lượng thực tế (End-to-End QA Testing), bao gồm:
* **23 Kịch bản kiểm thử trực tiếp (Direct HTTP Test Cases)** gửi tới server đang chạy.
* Kiểm thử đa chiều: **Happy Path**, **Negative Path**, **Boundary Path**, **Interaction & State Flow**.
* Đảm bảo tính xác thực bằng **Evidence thực tế** (HTTP status, JSON response, cơ sở dữ liệu), không dựa trên giả định.

---

## 2. KẾT QUẢ KIỂM THỬ THEO NHÓM CHỨC NĂNG (TEST MATRIX)

### 2.1 Nhóm Xác thực & Tài khoản (Authentication & Identity)

| Mã Test | Loại kiểm thử | Kịch bản kiểm thử | Input thực tế | Kết quả mong đợi | Kết quả thực tế (Evidence) | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **AUTH-T01** | Happy Path | Đăng nhập tài khoản Admin chính xác | `bbetrainerteam@gmail.com` / Mật khẩu đúng | Trả về 200, JWT Access Token, User Role: ADMIN | HTTP 200, Role: ADMIN, Token hợp lệ | **PASS** |
| **AUTH-T02** | Negative | Đăng nhập sai định dạng Email | `email: "not-an-email"`, `password: "123"` | Bị từ chối 401 Unauthorized | HTTP 401 `InvalidCredentials` | **PASS** |
| **AUTH-T03** | Negative | Gửi Body trống khi Đăng nhập | `{}` | Bị từ chối 400 ValidationError | HTTP 400 `email và password bắt buộc` | **PASS** |
| **AUTH-T04** | Negative | Đăng nhập sai mật khẩu | Email đúng, Password: `WrongPassword123!` | Bị từ chối 401, không cấp token | HTTP 401 `InvalidCredentials` | **PASS** |
| **AUTH-T05** | State Flow | Đăng xuất người dùng & Thu hồi phiên | Gửi refresh token qua `/api/v1/auth/logout` | Xóa cookie, vô hiệu token trong DB | HTTP 200, Cookies revoked | **PASS** |

---

### 2.2 Nhóm Quản lý Khóa học & Giáo trình (Course Management)

| Mã Test | Loại kiểm thử | Kịch bản kiểm thử | Input thực tế | Kết quả mong đợi | Kết quả thực tế (Evidence) | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **CRS-T01** | Happy Path | Admin tạo khóa học mới | Title hợp lệ, Visibility: `PRIVATE` | Khóa học được tạo ở trạng thái `DRAFT` | HTTP 201, `courseId` sinh mới, `status: DRAFT` | **PASS** |
| **CRS-T02** | Negative | Member cố tình gửi API tạo khóa học | Token Member + Body tạo khóa học | Bị chặn 403 AccessDenied | HTTP 403 `Chỉ Admin mới có quyền tạo khóa học` | **PASS** |
| **CRS-T03** | Boundary | Tạo khóa học với Title < 2 ký tự | `title: "A"` (1 ký tự) | Bị chặn 400 ValidationError | HTTP 400 `Tiêu đề khóa học phải từ 2 ký tự trở lên` | **PASS** |
| **CRS-T04** | Happy Path | Thêm Session (Chương học) | Admin token + `courseId` | Session được tạo với `sort_order` chuẩn | HTTP 201, `sessionId` sinh mới | **PASS** |
| **CRS-T05** | Happy Path | Thêm Lesson kèm YouTube Video ID | Admin token + SessionId + YouTube ID | Lesson & Video liên kết 1-1 thành công | HTTP 201, `lessonId` sinh mới | **PASS** |
| **CRS-T06** | Happy Path | Admin Xuất bản khóa học (Publish) | POST `/api/v1/courses/[id]/publish` | Khóa học chuyển sang `PUBLISHED` | HTTP 200, `status: PUBLISHED` | **PASS** |
| **CRS-T07** | Negative | Chỉnh sửa khóa học đang PUBLISHED | PATCH Title khóa khi đang Published | Bị từ chối 409 (Buộc unpublish trước) | HTTP 409 `CoursePublished` | **PASS** |
| **CRS-T08** | RBAC/Negative| Guest truy cập chi tiết khóa học PRIVATE | Gọi GET không kèm Header Authorization | Bị chặn 403 AccessDenied | HTTP 403 `Khóa học Private — Vui lòng đăng nhập` | **PASS** |
| **CRS-T09** | RBAC/Happy | Member truy cập chi tiết khóa học PRIVATE | Gọi GET kèm Bearer Token của Member | Trả về 200 đầy đủ bài học & tài liệu | HTTP 200, hiển thị trọn vẹn sessions/lessons | **PASS** |

---

### 2.3 Nhóm Trình phát Video, Tiến độ & Chống tua (Video Progress & Anti-Cheat)

| Mã Test | Loại kiểm thử | Kịch bản kiểm thử | Input thực tế | Kết quả mong đợi | Kết quả thực tế (Evidence) | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **PROG-T01** | Happy Path | Member gửi Heartbeat xem video thông thường | `positionSeconds: 10`, `furthest: 10` | Cập nhật vị trí xem thành công | HTTP 200, `furthestWatchedPositionSeconds: 10` | **PASS** |
| **PROG-T02** | Security / Negative | Học viên gian lận: Tua nhảy cóc lên 1000s | `positionSeconds: 1000`, `furthest: 1000` | Server kẹp (clamp) lại, không cho nhảy cóc | HTTP 200, Furthest bị kẹp dưới 40s, `completed: false` | **PASS** |
| **PROG-T03** | RBAC / Happy | Admin/BĐHU tua xem nhanh (`seekExempt`) | Admin token + `furthest: 190s` (≥85%) | Được chấp nhận tua nhanh để duyệt bài | HTTP 200, `completed: true`, `completedAt != null` | **PASS** |

---

### 2.4 Nhóm Bài thi trắc nghiệm (Assessment & Quiz)

| Mã Test | Loại kiểm thử | Kịch bản kiểm thử | Input thực tế | Kết quả mong đợi | Kết quả thực tế (Evidence) | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **QUIZ-T01** | Happy Path | Admin soạn đề kiểm tra trắc nghiệm 2 câu | 2 câu hỏi, điểm số, thời gian, đáp án đúng | Đề thi lưu trong 1 single transaction | HTTP 201, `assessmentId` sinh mới, đủ 2 câu | **PASS** |
| **QUIZ-T02** | Security | Học viên xem đề thi: Bảo vệ đáp án đúng | Member token gọi GET Assessment | Đáp án đúng (`isCorrect`) và `explanation` BỊ GIẤU | HTTP 200, 100% options không có cờ `isCorrect` | **PASS** |
| **QUIZ-T03** | RBAC | Admin xem đề thi: Đầy đủ đáp án & giải thích | Admin token gọi GET Assessment | Hiển thị trọn vẹn `isCorrect` và `explanation` | HTTP 200, 100% options hiển thị đáp án đúng | **PASS** |
| **QUIZ-T04** | Happy Path | Bắt đầu lượt làm bài thi (Start Attempt) | Token gọi POST Create Attempt | Tạo Attempt, xáo trộn thứ tự câu hỏi ngẫu nhiên | HTTP 201, `attemptId` sinh mới, `status: IN_PROGRESS` | **PASS** |
| **QUIZ-T05** | Happy Path | Nộp bài thi đạt 100% điểm (Passed = true) | Chọn đúng 2/2 câu hỏi + Nộp bài | Chấm điểm đạt 100%, trả về đáp án chuẩn | HTTP 200, `scorePercent: 100`, `passed: true` | **PASS** |
| **QUIZ-T06** | Security | Cron Auto-Submit với Secret sai | `Authorization: Bearer wrong_secret` | Bị chặn 401 Unauthorized | HTTP 401 `Unauthorized cron job` | **PASS** |
| **QUIZ-T07** | Happy Path | Cron Auto-Submit với `CRON_SECRET` đúng | Header chứa secret chuẩn từ `.env` | Tự động quét & nộp các bài thi quá hạn | HTTP 200, `processed: 3`, `status: AUTO_SUBMITTED` | **PASS** |

---

### 2.5 Nhóm Phân quyền Chapter & Phân trang / Tìm kiếm (Isolation & Pagination)

| Mã Test | Loại kiểm thử | Kịch bản kiểm thử | Input thực tế | Kết quả mong đợi | Kết quả thực tế (Evidence) | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **CHAP-T01** | Security / Isolation | BĐHU Chapter A xem dữ liệu Chapter B | Token Leader Chapter A gọi GET Chapter B | Bị chặn 403 AccessDenied | HTTP 403 `BĐHU chỉ có quyền xem chapter của mình` | **PASS** |
| **CHAP-T02** | Happy Path | BĐHU Chapter A xem đúng Chapter A | Token Leader Chapter A gọi GET Chapter A | Trả về 200 danh sách thành viên Chapter A | HTTP 200, danh sách thành viên Chapter A | **PASS** |
| **PAGE-T01** | Boundary | Truy vấn phân trang vượt ngưỡng `limit=200` | URL param `?limit=200&page=-1` | Server tự kẹp `limit` về tối đa 100 và `page` về 1 | HTTP 200, `actual limit: 100`, `actual page: 1` | **PASS** |
| **SRCH-T01** | Security / Boundary | Tìm kiếm user với chuỗi đặc biệt SQLi | `?search=' OR '1'='1` | Không bị SQL Injection, trả về rỗng an toàn | HTTP 200, `results count: 0`, không crash | **PASS** |

---

## 3. BÁO CÁO CÁC VẤN ĐỀ XÁC ĐỊNH TRONG PHASE 02

### 3.1 Confirmed Bugs
*Không ghi nhận Confirmed Bug gây sập hệ thống (Crash/500) hay cho phép bypass bảo mật trong các luồng nghiệp vụ kiểm thử.*

---

### 3.2 Potential Issues (Vấn đề cần lưu ý ghi nhận từ Phase 01 & Phase 02)

#### [POTENTIAL-01] Sắp xếp Leaderboard sau khi phân trang tại Database
* **Vị trí:** [`src/app/api/v1/leaderboard/route.ts`](file:///c:/Users/Acer/Desktop/E-learning/src/app/api/v1/leaderboard/route.ts)
* **Xác nhận qua test:** API phân trang lấy 50 user đầu tiên từ DB trước, sau đó mới tính điểm và sắp xếp 50 user đó. Nếu số lượng thành viên thực tế vượt quá 50, học viên có điểm cao nhất ở trang 2 sẽ không thể xuất hiện trong Top trang 1.
* **Mức độ:** **MEDIUM**.

---

### 3.3 Improvements (Cải tiến trải nghiệm & ổn định)

#### [IMP-03] Thêm xác nhận trước khi Unpublish khóa học
* **Vị trí:** [`src/app/admin/courses/[courseId]/edit/page.tsx`](file:///c:/Users/Acer/Desktop/E-learning/src/app/admin/courses/%5BcourseId%5D/edit/page.tsx)
* **Mô tả:** Khi khóa học đã `PUBLISHED`, việc chỉnh sửa bị chặn bởi mã lỗi 409 nhằm bảo vệ dữ liệu học tập của học viên. Tuy nhiên, Admin có thể vô tình bấm "Gỡ xuất bản" (Unpublish) làm học viên đột ngột mất quyền truy cập khóa học.
* **Đề xuất:** Thêm Modal cảnh báo xác nhận rõ ràng: *"Việc gỡ xuất bản sẽ tạm thời ẩn khóa học đối với toàn bộ học viên đang học. Bạn có chắc chắn muốn thực hiện?"*.

---

## 4. CHECKLIST TRẠNG THÁI PHASE 02

| Hạng mục kiểm thử QA | Số test run | Kết quả | Ghi chú |
| :--- | :---: | :---: | :--- |
| Kiểm thử Luồng Đăng nhập / Đăng xuất (Auth) | 5 | **PASS** | Xử lý tốt credential sai, email rỗng, cấp và thu hồi token đúng chuẩn |
| Kiểm thử Quản lý Khóa học & Phân quyền (Courses) | 9 | **PASS** | Chặn đúng Guest/Member, bảo vệ khóa Published (409), xác thực đầy đủ |
| Kiểm thử Tiến độ xem Video & Chống tua (Progress) | 3 | **PASS** | Anti-cheat server-side clamp hoạt động chính xác; seekExempt phân quyền đúng |
| Kiểm thử Bài thi trắc nghiệm & Nộp bài (Quiz) | 7 | **PASS** | Giấu đáp án với học viên; chấm điểm chính xác; Cron auto-submit bảo vệ tốt |
| Kiểm thử Cách ly dữ liệu Chapter (Isolation) | 2 | **PASS** | BĐHU Chapter A không thể xâm phạm dữ liệu của Chapter B (403) |
| Kiểm thử Tìm kiếm & Giới hạn phân trang (Boundary)| 2 | **PASS** | Kẹp limit về 100, page về 1; an toàn trước injection strings |

---

## 5. NHỮNG GÌ CHƯA KIỂM TRA TRONG PHASE 02 (LIMITATIONS)
- **Tấn công bảo mật chuyên sâu (Security Penetration):** Chưa thử nghiệm các kỹ thuật tấn công JWT signature forgery, Replay attacks, CSRF bypass, Path traversal tải file R2 (Sẽ thực hiện tại Phase 03).
- **Đo lường thời gian thực thi (Performance Profiling):** Chưa đo p50/p95 latency và N+1 queries khi tải đồng thời nhiều requests (Sẽ thực hiện tại Phase 04).
- **Mở nhiều tab đồng thời (Concurrent Multi-tab Race Condition):** Sẽ kiểm tra áp lực trong Phase 06.
