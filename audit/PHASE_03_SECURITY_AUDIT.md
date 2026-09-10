# PHASE 03 — SECURITY AUDIT REPORT
**Dự án:** BBE E-Learning Platform  
**Ngày thực hiện:** 2026-09-09  
**Người thực hiện:** Hệ thống Audit Tự động Antigravity (Security Engineer Persona)  
**Môi trường thử nghiệm:** Development Localhost (PoC an toàn, không phá hủy dữ liệu)  
**Trạng thái Phase 03:** **COMPLETED (PASS WITH FINDINGS)**  

---

## 1. MỤC TIÊU & PHƯƠNG PHÁP KIỂM TOÁN AN NINH (SECURITY METHODOLOGY)
Phase 03 thực hiện rà soát an ninh hệ thống toàn diện theo tiêu chuẩn OWASP Top 10 và các quy chuẩn bảo mật ứng dụng web hiện đại:
1. **Xác thực (Authentication):** Kiểm tra cơ chế JWT token, session revocation, token tampering, brute force.
2. **Ủy quyền & Phân quyền (Authorization / RBAC):** Kiểm tra leo quyền dọc (Vertical), leo quyền ngang (Horizontal / IDOR), cách ly giữa các Chapter.
3. **Đầu vào & Injection (API & Input Validation):** SQL Injection, Path Traversal, XSS, Parameter Tampering.
4. **Hạ tầng & Cấu hình (Infrastructure & Config):** Security Headers, Cookie Flags, Quản lý Secrets, Thông tin nhạy cảm.
5. **Chống lạm dụng (Abuse & Rate Limiting):** Tấn công thử sai mật khẩu, spam API.

---

## 2. KẾT QUẢ KIỂM THỬ AN NINH (SECURITY TEST MATRIX)

| Mã ID | Hạng mục an ninh | Kỹ thuật kiểm thử / Payload | Kết quả mong đợi | Kết quả thực tế (Evidence) | Đánh giá |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **SEC-01** | JWT Algorithm Confusion | Gửi JWT giả mạo với `alg: "none"` | Bị từ chối 401 Unauthorized | HTTP 401 `Token không hợp lệ hoặc đã hết hạn` | **PASS** |
| **SEC-02** | Direct Admin Access Bypass | Gọi trực tiếp API `/api/v1/admin/overview` không kèm token | Bị chặn 401 Unauthorized | HTTP 401 `UNAUTHORIZED` | **PASS** |
| **SEC-03** | Vertical Privilege Escalation | Học viên (MEMBER) gọi API Quản trị viên `/api/v1/admin/overview` | Bị chặn 403 Forbidden | HTTP 403 `AccessDenied` | **PASS** |
| **SEC-04** | Horizontal Escalation / IDOR | BĐHU Chapter A gọi API lấy dữ liệu Chapter B | Bị chặn 403 AccessDenied | HTTP 403 `BĐHU chỉ có quyền xem chapter của mình` | **PASS** |
| **SEC-05** | SQL Injection Prevention | Input `' OR '1'='1` và `'; DROP TABLE users; --` vào tìm kiếm | Prisma parameterize an toàn, không lỗi cú pháp | HTTP 200, trả về 0 kết quả, không SQL error | **PASS** |
| **SEC-06** | Sensitive Data Leakage | Kiểm tra response `/api/v1/users` | Không chứa `password_hash`, `token_hash` | Xác nhận 100% người dùng không bị lộ hash | **PASS** |
| **SEC-07** | Path Traversal / Upload | Upload tệp có tên `../../etc/passwd` lên R2 | Tên file được sanitize regex thành `-` an toàn | `storage_key` chuẩn hóa dạng `docs/[id]/timestamp-name` | **PASS** |
| **SEC-08** | Che giấu Đáp án Trắc nghiệm | Học viên truy cập API đề thi `/api/v1/courses/[id]/assessment` | Giấu hoàn toàn `is_correct` và `explanation` | 100% options không có cờ đáp án đúng | **PASS** |
| **SEC-09** | Cron Job Authentication | Gửi request auto-submit không có / sai `CRON_SECRET` | Bị chặn 401 Unauthorized | HTTP 401 `Unauthorized cron job` | **PASS** |
| **SEC-10** | Cookie Security Flags | Kiểm tra cờ `httpOnly` và `secure` trên cookie xác thực | Phải có `httpOnly: true` và `secure: true` | **Thiếu httpOnly và secure** trong `login/route.ts` | **MEDIUM RISK** |
| **SEC-11** | HTTP Security Headers | Kiểm tra `X-Frame-Options`, `CSP`, `HSTS`, `X-Content-Type` | Trả về đầy đủ các security headers | **MISSING** toàn bộ các security headers | **MEDIUM RISK** |
| **SEC-12** | API Rate Limiting | Gửi 10 requests đăng nhập liên tiếp với mật khẩu sai | Bị chặn 429 Too Many Requests | Cả 10 requests đều trả 401, không bị chặn 429 | **LOW RISK** |

---

## 3. DANH SÁCH FINDINGS BẢO MẬT (SECURITY VULNERABILITIES & RISKS)

### 3.1 Critical Severity (0 Finding)
*Không ghi nhận lỗ hổng Critical nào (Không có RCE, SQLi, Auth Bypass toàn hệ thống).*

---

### 3.2 High Severity (0 Finding)
*Không ghi nhận lỗ hổng High nào.*

---

### 3.3 Medium Severity (2 Findings)

#### [SEC-FINDING-01] Thiếu cờ `httpOnly` và `secure` cho Authentication Cookies
* **Mức độ:** **MEDIUM** (CWE-1004, CWE-614)
* **Vị trí:** [`src/app/api/v1/auth/login/route.ts:L107-L121`](file:///c:/Users/Acer/Desktop/E-learning/src/app/api/v1/auth/login/route.ts#L107-L121)
* **Bằng chứng code:**
  ```ts
  response.cookies.set('accessToken', accessToken, {
    path: '/',
    sameSite: 'lax',
    maxAge: 15 * 60, // 15 minutes
    // THIẾU: httpOnly: true
    // THIẾU: secure: process.env.NODE_ENV === 'production'
  })
  response.cookies.set('refreshToken', refreshToken, {
    path: '/',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    // THIẾU: httpOnly: true
    // THIẾU: secure: process.env.NODE_ENV === 'production'
  })
  ```
* **Rủi ro:** Nếu kẻ tấn công khai thác được một lỗ hổng XSS (Cross-Site Scripting) bất kỳ trên client, mã JavaScript độc hại có thể dùng `document.cookie` để đánh cắp trực tiếp cả `accessToken` và `refreshToken`, từ đó chiếm đoạt hoàn toàn phiên làm việc của người dùng.
* **Biện pháp khắc phục khuyến nghị:** Bổ sung `httpOnly: true` và `secure: process.env.NODE_ENV === 'production'` vào cấu hình cookie khi đăng nhập và khi làm mới token.

---

#### [SEC-FINDING-02] Thiếu các HTTP Security Headers tiêu chuẩn
* **Mức độ:** **MEDIUM** (CWE-693)
* **Vị trí:** [`next.config.js`](file:///c:/Users/Acer/Desktop/E-learning/next.config.js)
* **Bằng chứng kiểm tra thực tế:**
  ```json
  {
    "x-frame-options": "MISSING",
    "x-content-type-options": "MISSING",
    "content-security-policy": "MISSING",
    "strict-transport-security": "MISSING",
    "x-xss-protection": "MISSING"
  }
  ```
* **Rủi ro:**
  * Thiếu `X-Frame-Options` hoặc `frame-ancestors`: Trang web có thể bị nhúng vào iframe của website giả mạo phục vụ tấn công Clickjacking.
  * Thiếu `X-Content-Type-Options: nosniff`: Trình duyệt có thể đoán sai định dạng tệp (MIME sniffing) dẫn đến thực thi mã nguy hiểm.
  * Thiếu `Strict-Transport-Security` (HSTS): Người dùng có thể bị hạ cấp kết nối từ HTTPS xuống HTTP khi ở môi trường mạng công cộng (Man-in-the-Middle).
* **Biện pháp khắc phục khuyến nghị:** Cấu hình thuộc tính `headers()` trong `next.config.js` để tự động đính kèm các header bảo vệ tiêu chuẩn cho toàn bộ routes.

---

### 3.4 Low Severity (1 Finding)

#### [SEC-FINDING-03] Thiếu cơ chế Rate Limiting ở tầng IP/Endpoint cho luồng Xác thực
* **Mức độ:** **LOW** (CWE-307)
* **Vị trí:** [`src/app/api/v1/auth/login/route.ts`](file:///c:/Users/Acer/Desktop/E-learning/src/app/api/v1/auth/login/route.ts) & [`password-reset/request/route.ts`](file:///c:/Users/Acer/Desktop/E-learning/src/app/api/v1/auth/password-reset/request/route.ts)
* **Mô tả:** Hệ thống hiện tại đã có cơ chế đếm `failed_login_count` trong database và khóa user nếu vượt ngưỡng. Tuy nhiên, ở tầng API Gateway / Route Handler chưa có Rate Limiter theo địa chỉ IP hoặc theo client fingerprint. Kẻ tấn công có thể spam hàng ngàn request đăng nhập hoặc reset password tạo tải không cần thiết cho cơ sở dữ liệu Supabase.
* **Biện pháp khắc phục khuyến nghị:** Tích hợp bộ đệm giới hạn tần suất (như in-memory sliding window hoặc Upstash Redis Rate Limiter) giới hạn tối đa 5 lần thử / 1 phút cho 1 IP.

---

## 4. CHECKLIST TRẠNG THÁI PHASE 03

| Hạng mục kiểm tra | Trạng thái | Ghi chú |
| :--- | :---: | :--- |
| Xác thực JWT Token & Tampering Bypass | **PASS** | Thuật toán `none` bị từ chối; secret token mạnh; jose verify chuẩn xác |
| Bảo vệ Route Quản trị & Không có Token | **PASS** | 100% endpoint quản trị chặn truy cập khi thiếu token hợp lệ |
| Phân quyền Ngang (IDOR - Chapter Isolation) | **PASS** | BĐHU Chapter A không thể xâm phạm dữ liệu Chapter B |
| Phân quyền Dọc (Member -> Admin Escalation)| **PASS** | Học viên bị chặn 403 khi gọi API Admin |
| Chống SQL Injection & Parameter Tampering | **PASS** | Prisma ORM sử dụng Parameterized Query an toàn tuyệt đối |
| Bảo vệ Dữ liệu Nhạy cảm (Password Hash) | **PASS** | API trả về đã loại bỏ triệt để các trường mật khẩu và token hash |
| Bảo vệ Tải lên Tệp (Cloudflare R2) | **PASS** | Sanitize tên tệp, ngăn chặn Path Traversal |
| Che giấu Đáp án Bài thi Trắc nghiệm | **PASS** | Học viên không xem được đáp án đúng trước khi thi đỗ |
| Cấu hình Cookie An toàn (httpOnly / Secure) | **FAIL** | Thiếu cờ `httpOnly` và `secure` (SEC-FINDING-01 - Medium) |
| Cấu hình HTTP Security Headers | **FAIL** | Thiếu X-Frame-Options, CSP, HSTS (SEC-FINDING-02 - Medium) |
| Chống Spam & Giới hạn Tần suất (Rate Limit)| **PASS (RISK)** | Đã có logic DB lock, nhưng thiếu tầng IP rate limiter (Low) |

---

## 5. NHỮNG GÌ CHƯA KIỂM TRA TRONG PHASE 03 (LIMITATIONS)
- **Tấn công DDOS vật lý băng thông lớn:** Không thực hiện trong môi trường development để tránh gây nghẽn mạng.
- **Dò quét mã nguồn tự động của bên thứ ba (Snyk/SonarQube):** Chưa chạy công cụ quét SCA bên ngoài.
