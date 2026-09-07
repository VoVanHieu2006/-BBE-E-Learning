# BBE E-Learning System — Test Plan

> **Phiên bản:** MVP-1 / MVP-2  
> **Người lập:** QA/Tester  
> **Ngày cập nhật:** điền khi dùng

## 1. Mục tiêu kiểm thử

Xác nhận từng module do AI code hoàn thành đúng theo BA document, DBML schema và API design đã đặc tả — đúng luồng nghiệp vụ, đúng phân quyền, đúng các business rule (BR-01 → BR-08), và không phá vỡ các module đã pass trước đó (regression).

## 2. Phạm vi

### Trong phạm vi (MVP-1)

Invitation/đăng nhập, phân quyền theo role (Admin/BĐHU/Member/Khách), quản lý course-session-lesson-video-tài liệu, học viên xem nội dung & tự theo dõi tiến độ, làm bài kiểm tra cuối khóa, BĐHU xem tiến độ chapter mình.

### Trong phạm vi (MVP-2)

Dashboard Admin, Streak, Leaderboard, Chatbot BBE — kiểm thử khi các module này được code, dùng cùng khuôn mẫu test case ở Sheet 'Test Cases'.

### Ngoài phạm vi

Ứng dụng mobile, lớp học livestream, chapter tự tạo bài học nội bộ, chấm tự luận bằng AI, tạo chứng chỉ, tích hợp hệ thống bên ngoài.

## 3. Các mức kiểm thử (Test Levels)

- **Unit test:** AI code tự viết kèm mỗi module (đã yêu cầu ở playbook prompt). Tester không viết lại, chỉ xác nhận có tồn tại và chạy pass trước khi nhận module.
- **API / Integration test:** Tester thực hiện thủ công qua Postman/Thunder Client theo từng Test Case ở Sheet 'Test Cases' — đây là lớp kiểm thử chính của tài liệu này.
- **UI / E2E test:** Sau khi nối UI (Prompt 9), lặp lại các kịch bản chính bằng thao tác tay trên trình duyệt, tối thiểu 1 lần/role (Admin, BĐHU, Member, Khách).
- **Regression test:** Sau mỗi lần AI sửa code (kể cả sửa bug nhỏ), chạy lại toàn bộ Test Case Priority = High của MODULE đó + các module có phụ thuộc trực tiếp (xem cột 'Requirement Ref' ở Sheet Test Cases để biết module nào dùng chung permission/service).

## 4. Môi trường & dữ liệu kiểm thử

- **Môi trường:** Một Supabase project riêng cho staging/test, KHÔNG dùng chung DB với production. Bucket R2 riêng (vd `bbe-elearning-docs-staging`).
- **Tài khoản mẫu cần tạo trước khi test:** 1 Admin, 2 BĐHU (2 chapter khác nhau, để test rule 'không truy cập chapter khác'), 4-5 Member rải ở 2 chapter, 1 Khách (không tài khoản).
- **Dữ liệu mẫu cần có:** Ít nhất: 1 course PUBLISHED+PUBLIC, 1 course PUBLISHED+PRIVATE, 1 course DRAFT, mỗi course có ≥2 session, mỗi session ≥2 lesson kèm video + tài liệu, 1 course có assessment gắn kèm.

## 5. Tiêu chí bắt đầu / kết thúc

- **Entry criteria:** Migration DB chạy thành công, seed data có sẵn, AI xác nhận đã tự chạy qua phần 'Test để tự kiểm tra' trong playbook và pass.
- **Exit criteria:** 100% test case Priority = High ở module đó Pass; không còn bug Severity = Critical/Major đang mở; các bug Minor được ghi nhận lại vào Sheet 'Bug Report' để xử lý sau, không chặn tiến độ.

## 6. Quy ước mức độ

- **Priority:** `High` = luồng chính + business rule cốt lõi; `Medium` = luồng phụ, validate input; `Low` = edge case hiếm gặp.
- **Severity:** `Critical` = sập hệ thống/mất dữ liệu/lộ quyền truy cập; `Major` = sai nghiệp vụ nhưng có workaround; `Minor` = sai lệch nhỏ không ảnh hưởng luồng chính; `Cosmetic` = UI/chính tả.


---

# BBE E-Learning System — Test Cases

> Đây là bản Markdown chuyển trực tiếp từ danh sách `CASES` trong test plan Python được cung cấp. Nội dung nghiệp vụ của test case được giữ nguyên.

## Quy ước

- **Status mặc định:** `Not Run`
- **Priority:** `High` / `Medium` / `Low`
- **Type:** `Functional` / `Negative` / `Security` / `Boundary` / `Performance`


## Module `AUTH`

### TC-AUTH-01 — Admin gửi lời mời BĐHU thành công

- **Module:** `AUTH`
- **Requirement Ref:** `FR-AUTH-01`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Đăng nhập với tài khoản Admin

#### Các bước thực hiện

1) Gọi POST /invitations/chapter-leader với email hợp lệ + tên chapter mới
2) Kiểm tra DB

#### Dữ liệu test

email chưa từng có tài khoản

#### Kết quả mong đợi

Tạo mới 1 chapter (ACTIVE) + 1 invitation (PENDING, hết hạn sau 24h); email nhận được link

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-02 — Không cho mời email đã Active

- **Module:** `AUTH`
- **Requirement Ref:** `BR-02`
- **Priority:** `High`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

Có sẵn 1 tài khoản Active

#### Các bước thực hiện

Gọi POST /invitations/chapter-leader hoặc /invitations/member với email của tài khoản Active đó

#### Dữ liệu test

email đã Active

#### Kết quả mong đợi

Trả lỗi EmailAlreadyActive, không tạo invitation mới

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-03 — Chấp nhận invitation & kích hoạt tài khoản

- **Module:** `AUTH`
- **Requirement Ref:** `BR-02`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Có 1 invitation PENDING chưa hết hạn

#### Các bước thực hiện

1) Gọi POST /invitations/accept với token hợp lệ + password
2) Login bằng tài khoản vừa tạo

#### Dữ liệu test

token hợp lệ, password hợp lệ

#### Kết quả mong đợi

Tài khoản chuyển ACTIVE, invitation chuyển ACCEPTED, login thành công

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-04 — Token invitation dùng lại lần 2 bị từ chối

- **Module:** `AUTH`
- **Requirement Ref:** `BR-02`
- **Priority:** `High`
- **Type:** `Security`
- **Status:** `Not Run`

#### Tiền điều kiện

Đã accept 1 invitation ở TC-AUTH-03

#### Các bước thực hiện

Gọi lại POST /invitations/accept với CÙNG token vừa dùng

#### Dữ liệu test

token đã dùng 1 lần

#### Kết quả mong đợi

Trả lỗi TokenAlreadyUsed, không tạo thêm tài khoản/không đổi password tài khoản cũ

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-05 — Invitation tự hết hạn sau 24h

- **Module:** `AUTH`
- **Requirement Ref:** `BR-02`
- **Priority:** `Medium`
- **Type:** `Boundary`
- **Status:** `Not Run`

#### Tiền điều kiện

Có 1 invitation PENDING đã tạo > 24h (chỉnh created_at/expires_at trong DB test để giả lập)

#### Các bước thực hiện

Gọi GET /invitations, kiểm tra status; thử accept token đó

#### Dữ liệu test

invitation quá hạn 24h

#### Kết quả mong đợi

Status hiển thị EXPIRED; accept bằng token đó bị từ chối TokenExpired

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-06 — Resend invitation vô hiệu hoá link cũ

- **Module:** `AUTH`
- **Requirement Ref:** `BR-02`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Có 1 invitation đang PENDING

#### Các bước thực hiện

1) Gọi resend
2) Thử accept bằng token CŨ
3) Thử accept bằng token MỚI (lấy từ email/log)

#### Dữ liệu test

invitation PENDING

#### Kết quả mong đợi

Token cũ bị từ chối; token mới accept thành công; expiresAt được gia hạn

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-07 — BĐHU chỉ được mời vào chapter của chính mình

- **Module:** `AUTH`
- **Requirement Ref:** `BR-02`
- **Priority:** `High`
- **Type:** `Security`
- **Status:** `Not Run`

#### Tiền điều kiện

BĐHU thuộc chapter A đăng nhập

#### Các bước thực hiện

Gọi POST /invitations/member, cố truyền chapterId của chapter B (nếu API cho truyền tay)

#### Dữ liệu test

actor là BĐHU chapter A

#### Kết quả mong đợi

Invitation luôn được tạo với chapterId = chapter A, bỏ qua/chặn giá trị chapterId client truyền

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-08 — Khoá tài khoản sau 10 lần đăng nhập sai

- **Module:** `AUTH`
- **Requirement Ref:** `FR-AUTH`
- **Priority:** `High`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

Tài khoản ACTIVE, biết đúng email

#### Các bước thực hiện

Gọi login sai password liên tiếp 10 lần, sau đó thử lần 11 với password ĐÚNG

#### Dữ liệu test

9 lần sai + 1 lần sai (đủ 10) rồi login đúng

#### Kết quả mong đợi

Từ lần thứ 10 tài khoản chuyển LOCKED; lần 11 dù đúng password vẫn bị từ chối AccountLocked

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-09 — Reset password mở khoá tài khoản LOCKED

- **Module:** `AUTH`
- **Requirement Ref:** `FR-AUTH`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Tài khoản đang ở trạng thái LOCKED (dùng lại từ TC-AUTH-08)

#### Các bước thực hiện

1) Request password reset
2) Confirm với password mới
3) Login lại bằng password mới

#### Dữ liệu test

token reset hợp lệ trong 15 phút

#### Kết quả mong đợi

Tài khoản chuyển ACTIVE, failed_login_count reset về 0, login bằng password mới thành công

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-10 — Token reset password hết hạn sau 15 phút

- **Module:** `AUTH`
- **Requirement Ref:** `FR-AUTH`
- **Priority:** `Medium`
- **Type:** `Boundary`
- **Status:** `Not Run`

#### Tiền điều kiện

Có request reset password > 15 phút trước

#### Các bước thực hiện

Gọi confirm reset với token đó

#### Dữ liệu test

token quá 15 phút

#### Kết quả mong đợi

Trả lỗi TokenExpired, password không bị đổi

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-11 — Không lộ thông tin email có tồn tại hay không

- **Module:** `AUTH`
- **Requirement Ref:** `FR-AUTH`
- **Priority:** `Medium`
- **Type:** `Security`
- **Status:** `Not Run`

#### Tiền điều kiện

1 email có tài khoản, 1 email không tồn tại

#### Các bước thực hiện

Gọi request password reset lần lượt với 2 email trên, so sánh response

#### Dữ liệu test

email tồn tại và email không tồn tại

#### Kết quả mong đợi

Cả 2 trường hợp trả về CÙNG một message chung, không phân biệt được email nào tồn tại

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-AUTH-12 — Gọi API cần đăng nhập mà không có token

- **Module:** `AUTH`
- **Requirement Ref:** `-`
- **Priority:** `High`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

Không có Bearer token

#### Các bước thực hiện

Gọi GET /users/me không kèm header Authorization

#### Dữ liệu test

không có token

#### Kết quả mong đợi

Trả 401 Unauthorized, không trả 500 hay lộ dữ liệu

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---


## Module `CHAP`

### TC-CHAP-01 — BĐHU không xem được chapter khác

- **Module:** `CHAP`
- **Requirement Ref:** `3.2 Permission matrix`
- **Priority:** `High`
- **Type:** `Security`
- **Status:** `Not Run`

#### Tiền điều kiện

BĐHU chapter A đăng nhập; có chapter B tồn tại

#### Các bước thực hiện

Gọi GET /chapters/{id-chapter-B}/members

#### Dữ liệu test

chapterId thuộc chapter khác actor

#### Kết quả mong đợi

Trả 403/AccessDenied, không trả danh sách member chapter B

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CHAP-02 — Admin xem được mọi chapter

- **Module:** `CHAP`
- **Requirement Ref:** `3.2`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Admin đăng nhập

#### Các bước thực hiện

Gọi GET /chapters và GET /chapters/{bất kỳ id}/members

#### Dữ liệu test

-

#### Kết quả mong đợi

Trả đầy đủ danh sách chapter và member không giới hạn theo chapter

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CHAP-03 — Rời chapter vẫn giữ tài khoản

- **Module:** `CHAP`
- **Requirement Ref:** `BR-02`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Member đang thuộc 1 chapter

#### Các bước thực hiện

1) Gọi DELETE /chapters/{id}/members/{userId}
2) Login lại bằng tài khoản đó

#### Dữ liệu test

-

#### Kết quả mong đợi

Tài khoản KHÔNG bị xoá/Inactive, vẫn login được, chỉ mất liên kết chapter (membership LEFT)

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CHAP-04 — Đổi trạng thái tài khoản (Active↔Inactive)

- **Module:** `CHAP`
- **Requirement Ref:** `3.2`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Có 1 Member ACTIVE

#### Các bước thực hiện

Admin/BĐHU gọi PATCH /users/{id}/status với status=INACTIVE, sau đó login thử

#### Dữ liệu test

-

#### Kết quả mong đợi

status đổi thành công, ghi audit_logs; login bằng tài khoản INACTIVE bị từ chối

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CHAP-05 — BĐHU không đổi được status tài khoản chapter khác

- **Module:** `CHAP`
- **Requirement Ref:** `3.2`
- **Priority:** `High`
- **Type:** `Security`
- **Status:** `Not Run`

#### Tiền điều kiện

BĐHU chapter A; Member thuộc chapter B

#### Các bước thực hiện

BĐHU chapter A gọi PATCH /users/{member-chapter-B}/status

#### Dữ liệu test

-

#### Kết quả mong đợi

Trả AccessDenied, không đổi được status

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CHAP-06 — Không tự khoá/mở khoá Admin qua API status

- **Module:** `CHAP`
- **Requirement Ref:** `3.2`
- **Priority:** `Medium`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

2 tài khoản Admin

#### Các bước thực hiện

Admin A gọi PATCH /users/{Admin-B}/status

#### Dữ liệu test

-

#### Kết quả mong đợi

Trả lỗi/chặn, API này không áp dụng cho tài khoản Admin

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---


## Module `COURSE`

### TC-CRS-01 — Không publish course rỗng

- **Module:** `COURSE`
- **Requirement Ref:** `3.2 / BR-01`
- **Priority:** `High`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

Course mới tạo, chưa có session/lesson

#### Các bước thực hiện

Gọi POST /courses/{id}/publish

#### Dữ liệu test

course không có session nào

#### Kết quả mong đợi

Trả lỗi EmptyCourse, status vẫn giữ DRAFT

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CRS-02 — Không publish session không có lesson

- **Module:** `COURSE`
- **Requirement Ref:** `5.2`
- **Priority:** `High`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

Course có 1 session nhưng session đó chưa có lesson

#### Các bước thực hiện

Gọi POST /courses/{id}/publish

#### Dữ liệu test

-

#### Kết quả mong đợi

Trả lỗi EmptySession, status vẫn DRAFT

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CRS-03 — Lesson bắt buộc đúng 1 video

- **Module:** `COURSE`
- **Requirement Ref:** `5.2`
- **Priority:** `High`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

Đang tạo lesson mới

#### Các bước thực hiện

Gọi POST /sessions/{id}/lessons KHÔNG kèm object video

#### Dữ liệu test

thiếu trường video

#### Kết quả mong đợi

Trả ValidationError, không tạo được lesson thiếu video

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CRS-04 — Course visibility đúng cho từng role

- **Module:** `COURSE`
- **Requirement Ref:** `BR-01`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

1 course PUBLISHED+PUBLIC, 1 course PUBLISHED+PRIVATE, 1 course DRAFT

#### Các bước thực hiện

Gọi GET /courses lần lượt bằng: không token (Khách), token Member, token Admin

#### Dữ liệu test

-

#### Kết quả mong đợi

Khách chỉ thấy PUBLISHED+PUBLIC; Member thấy mọi PUBLISHED (Public+Private); Admin thấy cả DRAFT

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CRS-05 — Course PUBLISHED có người học không cho sửa trực tiếp

- **Module:** `COURSE`
- **Requirement Ref:** `3.4`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Course PUBLISHED, có ít nhất 1 member đã có lesson_progress trong course

#### Các bước thực hiện

Gọi PATCH /courses/{id} sửa nội dung, hoặc thử publish/unpublish trực tiếp

#### Dữ liệu test

-

#### Kết quả mong đợi

Hệ thống yêu cầu chuyển về DRAFT trước khi sửa (theo rule đã thống nhất) — xác nhận đúng hành vi thực tế của module trước khi đánh Pass

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-CRS-06 — Reorder session giữ đúng thứ tự

- **Module:** `COURSE`
- **Requirement Ref:** `-`
- **Priority:** `Low`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Course có ≥3 session

#### Các bước thực hiện

Gọi PATCH /courses/{id}/sessions/reorder với thứ tự mới

#### Dữ liệu test

mảng sortOrder mới

#### Kết quả mong đợi

GET lại course detail trả đúng thứ tự session vừa set

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---


## Module `DOC`

### TC-DOC-01 — Upload tài liệu qua presigned URL thành công

- **Module:** `DOC`
- **Requirement Ref:** `3.11/NFR-SEC-01`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Có 1 lesson tồn tại, Admin đăng nhập

#### Các bước thực hiện

1) Xin presigned PUT URL
2) PUT file thật lên URL đó
3) Gọi confirm
4) Kiểm tra bucket R2

#### Dữ liệu test

file mẫu <10MB

#### Kết quả mong đợi

File xuất hiện trong bucket R2; record documents được tạo đúng fileName/size/mimeType

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-DOC-02 — Không truy cập tài liệu bằng URL trực tiếp không có quyền

- **Module:** `DOC`
- **Requirement Ref:** `NFR-SEC-01`
- **Priority:** `High`
- **Type:** `Security`
- **Status:** `Not Run`

#### Tiền điều kiện

Có 1 document thuộc course PRIVATE

#### Các bước thực hiện

Lấy storage_key rồi thử ghép URL R2 trực tiếp (không qua presigned GET) để tải

#### Dữ liệu test

-

#### Kết quả mong đợi

Không truy cập được (bucket không public); chỉ tải được qua endpoint có xác thực + presigned GET

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-DOC-03 — Presigned GET URL hết hạn sau thời gian ngắn

- **Module:** `DOC`
- **Requirement Ref:** `3.11`
- **Priority:** `Medium`
- **Type:** `Boundary`
- **Status:** `Not Run`

#### Tiền điều kiện

Đã xin 1 presigned GET URL

#### Các bước thực hiện

Đợi quá thời hạn (~5 phút) rồi mở link

#### Dữ liệu test

-

#### Kết quả mong đợi

Link báo lỗi hết hạn/access denied từ phía R2

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-DOC-04 — Xoá document xoá cả object trên R2

- **Module:** `DOC`
- **Requirement Ref:** `3.12`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Có 1 document đã upload

#### Các bước thực hiện

Gọi DELETE /documents/{id}, sau đó kiểm tra bucket R2

#### Dữ liệu test

-

#### Kết quả mong đợi

Record trong DB bị xoá VÀ object trên R2 cũng biến mất, không còn rác trong bucket

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-DOC-05 — Từ chối file sai định dạng/quá lớn

- **Module:** `DOC`
- **Requirement Ref:** `3.11`
- **Priority:** `Medium`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

-

#### Các bước thực hiện

Thử xin presigned URL / upload với file vượt giới hạn size hoặc mime type không cho phép

#### Dữ liệu test

file .exe hoặc file >giới hạn cấu hình

#### Kết quả mong đợi

Trả lỗi FileTooLarge/UnsupportedFileType, không tạo record document

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---


## Module `LRN`

### TC-LRN-01 — Đánh dấu Completed khi xem ≥85%

- **Module:** `LRN`
- **Requirement Ref:** `BR-03`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Member Active, có quyền xem lesson

#### Các bước thực hiện

Gọi PATCH /lessons/{id}/progress nhiều lần tăng dần tới ≥85% duration

#### Dữ liệu test

furthestWatchedPositionSeconds ≥ 0.85*duration

#### Kết quả mong đợi

completed=true, completed_at được set

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-LRN-02 — Không cộng lặp khi xem lại đoạn đã xem

- **Module:** `LRN`
- **Requirement Ref:** `BR-03`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Đã xem xong 0-50% của video

#### Các bước thực hiện

Tua lại xem lại đoạn 0-50% một lần nữa, gọi progress heartbeat

#### Dữ liệu test

vị trí xem nằm trong đoạn đã xem

#### Kết quả mong đợi

furthest_watched_position_seconds KHÔNG tăng thêm cho phần overlap, % tiến độ không bị tính sai

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-LRN-03 — Không cho tua tới phần chưa xem (UI)

- **Module:** `LRN`
- **Requirement Ref:** `BR-03`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Đang xem dở video ở vị trí X

#### Các bước thực hiện

Thử kéo thanh tua/nút tua nhanh tới vị trí > X (chưa xem)

#### Dữ liệu test

-

#### Kết quả mong đợi

Player tự động kéo về lại vị trí furthest_watched gần nhất, không cho phát ở đoạn chưa xem

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-LRN-04 — Tăng tốc độ video x1.5/x2

- **Module:** `LRN`
- **Requirement Ref:** `BR-03`
- **Priority:** `Low`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Đang xem video

#### Các bước thực hiện

Đổi tốc độ phát trong player

#### Dữ liệu test

-

#### Kết quả mong đợi

Video phát nhanh hơn tương ứng, tiến độ vẫn tính đúng theo thời lượng thực (không theo thời gian đồng hồ)

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-LRN-05 — Đồng bộ tiến độ giữa 2 thiết bị

- **Module:** `LRN`
- **Requirement Ref:** `NFR-PERF-02`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Cùng 1 tài khoản đăng nhập ở 2 trình duyệt khác nhau

#### Các bước thực hiện

Xem tiến độ ở trình duyệt A, sau đó GET progress ở trình duyệt B (reload trang)

#### Dữ liệu test

-

#### Kết quả mong đợi

Trình duyệt B thấy đúng vị trí/trạng thái completed mới nhất sau khi tải lại trang

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-LRN-06 — Member không xem được course PRIVATE khi chưa Active

- **Module:** `LRN`
- **Requirement Ref:** `-`
- **Priority:** `High`
- **Type:** `Security`
- **Status:** `Not Run`

#### Tiền điều kiện

Tài khoản INACTIVE, course PRIVATE

#### Các bước thực hiện

Gọi GET /courses/{id}/my-progress

#### Dữ liệu test

-

#### Kết quả mong đợi

Trả AccessDenied/Unauthorized, không lộ nội dung course

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-LRN-07 — Tiến độ course tính đúng theo số lesson hoàn thành

- **Module:** `LRN`
- **Requirement Ref:** `5.3`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Course có 4 lesson, đã hoàn thành 1 lesson

#### Các bước thực hiện

GET /courses/{id}/my-progress

#### Dữ liệu test

-

#### Kết quả mong đợi

progressPercentage = 25% (làm tròn theo rule), tăng đúng sau mỗi lesson hoàn thành thêm

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---


## Module `ASM`

### TC-ASM-01 — Không cho bắt đầu bài kiểm tra khi chưa học hết lesson

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `High`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

Course có 3 lesson, mới hoàn thành 2/3

#### Các bước thực hiện

Gọi POST /assessments/{id}/attempts

#### Dữ liệu test

-

#### Kết quả mong đợi

Trả lỗi LessonsNotCompleted, không tạo attempt

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-02 — Câu hỏi & đáp án được xáo trộn mỗi attempt

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Đã hoàn thành hết lesson, assessment có ≥5 câu

#### Các bước thực hiện

Start 2 attempt riêng biệt (dùng 2 tài khoản hoặc sau khi huỷ+chờ), so sánh thứ tự câu hỏi/đáp án trả về

#### Dữ liệu test

-

#### Kết quả mong đợi

Thứ tự câu hỏi và/hoặc đáp án khác nhau giữa 2 attempt (không cố định 1 thứ tự)

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-03 — Thời gian làm bài = số câu x 2 phút

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `High`
- **Type:** `Boundary`
- **Status:** `Not Run`

#### Tiền điều kiện

Assessment có N câu hỏi

#### Các bước thực hiện

Start attempt, kiểm tra expiresAt trả về

#### Dữ liệu test

N câu hỏi

#### Kết quả mong đợi

expiresAt - startedAt = N * 2 phút chính xác

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-04 — Hệ thống tự nộp bài khi hết giờ (AUTO_SUBMITTED)

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Có attempt IN_PROGRESS đã quá expires_at (giả lập bằng cách chỉnh expires_at về quá khứ)

#### Các bước thực hiện

Gọi thủ công (hoặc đợi cron) POST /internal/attempts/auto-submit

#### Dữ liệu test

attempt đã hết giờ, đã trả lời 1 số câu

#### Kết quả mong đợi

attempt chuyển AUTO_SUBMITTED, câu đã trả lời được chấm, câu chưa trả lời tính sai, có điểm số

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-05 — Cron pg_cron gọi endpoint auto-submit đúng lịch

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Đã setup pg_cron theo tài liệu hạ tầng, có 1 attempt hết giờ thật (không giả lập)

#### Các bước thực hiện

Chờ tối đa 1 phút sau khi attempt hết giờ, không gọi tay endpoint

#### Dữ liệu test

-

#### Kết quả mong đợi

attempt tự chuyển AUTO_SUBMITTED trong vòng ~1 phút mà không cần gọi tay

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-06 — Pass (≥85) hiển thị đáp án đúng + giải thích

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Submit attempt đạt điểm ≥85/100

#### Các bước thực hiện

Gọi POST /attempts/{id}/submit, xem response

#### Dữ liệu test

trả lời đúng ≥85% câu

#### Kết quả mong đợi

Response trả kèm correctOptionId + explanation cho TẤT CẢ câu hỏi

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-07 — Fail (<85) KHÔNG lộ đáp án đúng

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `High`
- **Type:** `Security`
- **Status:** `Not Run`

#### Tiền điều kiện

Submit attempt đạt điểm <85/100

#### Các bước thực hiện

Gọi POST /attempts/{id}/submit, xem response

#### Dữ liệu test

trả lời đúng <85% câu

#### Kết quả mong đợi

Response chỉ trả đúng/sai từng câu (isCorrect), KHÔNG có correctOptionId/explanation

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-08 — Cooldown 24h trước khi làm lại

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Vừa submit 1 attempt không đạt điểm tuyệt đối

#### Các bước thực hiện

Gọi start attempt mới ngay lập tức

#### Dữ liệu test

-

#### Kết quả mong đợi

Trả lỗi CooldownActive, phải chờ đủ 24h kể từ lần nộp trước mới start được attempt mới

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-09 — Điểm tuyệt đối (100) bỏ qua cooldown

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Vừa submit 1 attempt đạt điểm 100/100

#### Các bước thực hiện

Gọi start attempt mới ngay lập tức

#### Dữ liệu test

score = 100

#### Kết quả mong đợi

Cho phép start attempt mới ngay, không bị chặn CooldownActive

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-10 — Huỷ giữa chừng không tính vào lịch sử điểm nhưng vẫn chịu cooldown

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Đang có attempt IN_PROGRESS

#### Các bước thực hiện

1) Gọi cancel attempt
2) GET attempt history
3) Thử start attempt mới ngay

#### Dữ liệu test

-

#### Kết quả mong đợi

Attempt CANCELLED không xuất hiện trong lịch sử điểm; vẫn bị CooldownActive khi start lại trước 24h

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-11 — Không sửa được câu trả lời sau khi đã nộp

- **Module:** `ASM`
- **Requirement Ref:** `BR-04`
- **Priority:** `High`
- **Type:** `Negative`
- **Status:** `Not Run`

#### Tiền điều kiện

Attempt đã SUBMITTED/AUTO_SUBMITTED

#### Các bước thực hiện

Gọi PUT /attempts/{id}/answers/{questionId}

#### Dữ liệu test

-

#### Kết quả mong đợi

Trả lỗi AttemptNotInProgress, không cập nhật được câu trả lời

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-ASM-12 — Course PUBLIC không sửa được assessment khi đang có người học

- **Module:** `ASM`
- **Requirement Ref:** `5.4`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Course PUBLISHED có member đang làm dở/đã làm assessment

#### Các bước thực hiện

Admin gọi PATCH /assessments/{id}

#### Dữ liệu test

-

#### Kết quả mong đợi

Bị chặn hoặc yêu cầu chuyển course về DRAFT trước — xác nhận đúng hành vi thực tế trước khi Pass

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---


## Module `DASH`

### TC-DASH-01 — BĐHU chỉ xem chapter của mình trên dashboard

- **Module:** `DASH`
- **Requirement Ref:** `5.5/FR-DB`
- **Priority:** `High`
- **Type:** `Security`
- **Status:** `Not Run`

#### Tiền điều kiện

BĐHU chapter A đăng nhập

#### Các bước thực hiện

Gọi GET /chapters/{id-chapter-B}/dashboard/members

#### Dữ liệu test

-

#### Kết quả mong đợi

Trả AccessDenied

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-DASH-02 — Số liệu tiến độ dashboard khớp dữ liệu thật

- **Module:** `DASH`
- **Requirement Ref:** `5.5`
- **Priority:** `High`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Chapter có ≥5 member với tiến độ khác nhau đã biết trước (đếm tay)

#### Các bước thực hiện

GET /chapters/{id}/dashboard/members, so khớp % tiến độ từng member với số đếm tay

#### Dữ liệu test

-

#### Kết quả mong đợi

Số liệu trả về khớp 100% với số đếm tay

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---

### TC-DASH-03 — Admin overview tổng hợp đúng số liệu toàn hệ thống

- **Module:** `DASH`
- **Requirement Ref:** `7.1`
- **Priority:** `Medium`
- **Type:** `Functional`
- **Status:** `Not Run`

#### Tiền điều kiện

Biết trước tổng số tài khoản theo từng status (đếm tay qua DB)

#### Các bước thực hiện

GET /admin/overview, so khớp accountStats với số đếm tay

#### Dữ liệu test

-

#### Kết quả mong đợi

accountStats.active/inactive/locked khớp đúng số đếm tay

#### Kết quả thực tế / Bug ID

<!-- Tester cập nhật khi chạy test -->

#### Tester

<!-- Điền tên -->

#### Ngày test

<!-- YYYY-MM-DD -->

---



---

# BBE E-Learning System — Requirements Traceability Matrix

| Mã yêu cầu | Mô tả | Test Case ID liên quan | Số TC bao phủ |
|---|---|---|---:|
| `BR-01` | Course visibility theo status/visibility | `TC-CRS-04` | 1 |
| `BR-02` | Invitation & account activation | `TC-AUTH-01, TC-AUTH-02, TC-AUTH-03, TC-AUTH-04, TC-AUTH-05, TC-AUTH-06, TC-AUTH-07, TC-CHAP-03` | 8 |
| `BR-03` | Learning completion (85%, không cộng lặp, không tua tới) | `TC-LRN-01, TC-LRN-02, TC-LRN-03, TC-LRN-04` | 4 |
| `BR-04` | Assessment & retake (cooldown, pass/fail, auto-submit) | `TC-ASM-01, TC-ASM-02, TC-ASM-03, TC-ASM-04, TC-ASM-05, TC-ASM-06, TC-ASM-07, TC-ASM-08, TC-ASM-09, TC-ASM-10, TC-ASM-11` | 11 |
| `FR-AUTH-01` | Login, lock sau 10 lần sai, password reset | `TC-AUTH-08, TC-AUTH-09, TC-AUTH-10, TC-AUTH-11, TC-AUTH-12` | 5 |
| `FR-DB-01` | BĐHU dashboard — không truy cập chapter khác | `TC-DASH-01, TC-DASH-02, TC-CHAP-01, TC-CHAP-05` | 4 |
| `NFR-SEC-01` | Không truy cập tài liệu/video qua URL trực tiếp không có quyền | `TC-DOC-02, TC-DOC-03, TC-LRN-06` | 3 |
| `NFR-PERF-02` | Đồng bộ tiến độ đa thiết bị trong ~1s (sau reload) | `TC-LRN-05` | 1 |
| `3.2` | Permission matrix (toàn bộ role) | `TC-CHAP-01, TC-CHAP-02, TC-CHAP-04, TC-CHAP-05, TC-CHAP-06` | 5 |


---

# BBE E-Learning System — Test Dashboard

Dashboard gốc trong Python sử dụng công thức Excel `COUNTIF/COUNTIFS` trên Sheet `Test Cases`.

## Module metrics

| Module | Tổng số TC | Pass | Fail | Blocked | Not Run |
|---|---:|---:|---:|---:|---:|
| AUTH | 12 | — | — | — | — |
| CHAP | 6 | — | — | — | — |
| COURSE | 6 | — | — | — | — |
| DOC | 5 | — | — | — | — |
| LRN | 7 | — | — | — | — |
| ASM | 12 | — | — | — | — |
| DASH | 3 | — | — | — | — |
| **TỔNG CỘNG** | **51** | — | — | — | — |

## Priority High

- **Số TC Priority High:** 34
- **Số TC Priority High đã Pass:** cập nhật sau khi chạy test
- **% Pass (Priority High):** `High đã Pass / Tổng High`
- **Exit Criteria:** cần `100%` mới đạt.


---

# BBE E-Learning System — Bug Report Template

| Bug ID | Test Case ID | Module | Mô tả lỗi | Bước tái hiện | Kết quả thực tế | Kết quả mong đợi | Severity | Status | Người báo | Ngày báo |
|---|---|---|---|---|---|---|---|---|---|---|
| BUG-001 | TC-ASM-07 | ASM | Response khi Fail vẫn trả về correctOptionId | 1) Submit attempt với điểm <85; 2) Xem response JSON | `answers[].correctOptionId` có giá trị dù `passed=false` | `answers[].correctOptionId` phải null/không xuất hiện khi `passed=false` | Major | Open | Tester | vd: 2026-09-05 |

## Allowed values

### Severity

- `Critical`
- `Major`
- `Minor`
- `Cosmetic`

### Status

- `Open`
- `In Progress`
- `Fixed`
- `Reopened`
- `Closed`
- `Won't Fix`
