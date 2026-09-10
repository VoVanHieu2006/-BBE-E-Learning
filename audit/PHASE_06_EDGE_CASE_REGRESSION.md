# PHASE 06 — EDGE CASE & REGRESSION TESTING REPORT
**Dự án:** BBE E-Learning Platform  
**Ngày thực hiện:** 2026-09-09  
**Người thực hiện:** Hệ thống Audit Tự động Antigravity (QA Automation & Chaos Engineer Persona)  
**Môi trường thử nghiệm:** Development Localhost (`http://localhost:3000` + Supabase PostgreSQL + Concurrent HTTP Probes)  
**Trạng thái Phase 06:** **COMPLETED (1 CONFIRMED BUG FOUND)**  

---

## 1. MỤC TIÊU & PHƯƠNG PHÁP KIỂM THỬ BIÊN (CHAOS & STRESS TESTING)
Phase 06 tập trung thử thách các tình huống cực đoan, điều kiện biên và tương tác bất đồng bộ mà người dùng có thể vô tình hoặc cố ý tạo ra:
1. **Giao dịch đồng thời (Concurrency & Race Condition):** Double click nộp bài thi, spam click, gửi đồng thời nhiều requests cùng milli-giây.
2. **Phiên làm việc & Token hết hạn:** Xử lý khi token JWT hết hạn giữa chừng hoặc token mồ côi.
3. **Tập dữ liệu biên (Zero-Data / Large Data):** Học viên mới toanh chưa có tiến độ (nguy cơ chia cho 0, null pointer).
4. **Tài nguyên bị xóa hoặc không tồn tại (404 Handling):** Truy cập UUID giả lập.
5. **Hồi quy tính năng (Regression Matrix):** Kiểm tra xem việc thực hiện một chức năng này có vô tình làm hỏng dữ liệu của chức năng khác hay không.

---

## 2. BẢNG KẾT QUẢ KIỂM THỬ TRƯỜNG HỢP BIÊN (EDGE CASE TEST MATRIX)

| Mã Test | Tình huống biên thử thách | Kỹ thuật kiểm thử | Kết quả mong đợi | Kết quả thực tế (Evidence) | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **EDGE-01** | Double Click / Spam Click Nộp bài thi Quiz | Gửi đồng thời 5 requests `POST .../submit` cùng 1 `attemptId` | Chỉ 1 request đầu tiên được 200; 4 requests sau trả 400 | **Cả 5 requests đều trả về HTTP 200** `[200, 200, 200, 200, 200]` | ❌ **FAIL (BUG)** |
| **EDGE-02** | Spam Heartbeat tiến độ video cùng lúc | Gửi đồng thời 5 requests `PATCH .../progress` cho 1 bài học | Database xử lý an toàn (Upsert), không Deadlock | Cả 5 requests trả về HTTP 200 thành công | ✅ **PASS** |
| **EDGE-03** | Token JWT đã hết hạn (Expired Token) | Ký token với `exp = now - 3600` gửi tới Admin API | Bị từ chối 401 Unauthorized ngay lập tức | HTTP 401 `Token không hợp lệ hoặc đã hết hạn` | ✅ **PASS** |
| **EDGE-04** | Học viên mới chưa có bất kỳ dữ liệu học nào | Gọi API `/streak` và `/members/me/courses` với Member zero-data | Xử lý an toàn, streak = 0, status `NOT_STARTED`, không crash | HTTP 200, Streak: 0, 15 courses `NOT_STARTED`, không crash | ✅ **PASS** |
| **EDGE-05** | Token có User ID không tồn tại trong Database | Ký token với `sub: "00000000-0000-0000-0000-000000000099"` | Bị từ chối 401 AccountInactive (Chống token mồ côi) | HTTP 401 `AccountInactive` | ✅ **PASS** |
| **EDGE-06** | Truy cập tài nguyên không tồn tại (UUID ảo) | Gọi GET Khóa học, Bài học, Attempt với UUID không tồn tại | Trả về 404 sạch sẽ, không crash 500 | 100% endpoints trả về HTTP 404 | ✅ **PASS** |

---

## 3. MA TRẬN KIỂM TOÁN HỒI QUY (REGRESSION MATRIX)

| Chức năng thực hiện thay đổi | Chức năng phụ thuộc được kiểm tra | Hành vi dự kiến | Kết quả thực tế | Trạng thái |
| :--- | :--- | :--- | :--- | :---: |
| **Gỡ xuất bản khóa học (Unpublish)** | Lịch sử tiến trình bài học (`LessonProgress`) | Khóa học về Draft nhưng dữ liệu học viên cũ không bị mất | 42 bản ghi `LessonProgress` giữ nguyên vẹn | **PASS** |
| **Gỡ xuất bản khóa học (Unpublish)** | Bài thi đã nộp (`Attempt`) của học viên | Điểm số và bài thi đã nộp giữ nguyên vẹn | 29 lượt thi giữ nguyên vẹn trong DB | **PASS** |
| **Xóa học viên khỏi Chapter (Delete Member)**| Tài khoản người dùng (`User`) | Chỉ xóa liên kết Chapter, giữ nguyên tài khoản User | User chuyển sang trạng thái tự do, không mất account | **PASS** |
| **Xóa học viên khỏi Chapter (Delete Member)**| Bảng xếp hạng Chapter (`Leaderboard`) | Điểm trung bình Chapter tự động loại bỏ thành viên đã rời | Chapter Leaderboard tự động cập nhật lại sĩ số | **PASS** |
| **Chấm bài tự động bởi Cron (Auto-submit)** | Các Attempt đang thi bình thường còn hạn | Chỉ chấm các attempt có `expires_at < now` | Attempt còn hạn vẫn ở `IN_PROGRESS` an toàn | **PASS** |

---

## 4. CHI TIẾT BÁO CÁO LỖI PHÁT HIỆN (CONFIRMED BUG REPORT)

### [BUG-CONFIRMED-01] Race Condition (TOCTOU) khi gửi đồng thời nhiều requests Nộp bài thi
* **Mã Bug:** `BUG-CONFIRMED-01`
* **Mức độ nghiêm trọng (Severity):** **MEDIUM**
* **Vai trò ảnh hưởng:** Học viên (MEMBER)
* **Tính năng:** QUIZ-05 (Nộp bài kiểm tra trắc nghiệm & Chấm điểm)
* **Tệp nguồn:** [`src/app/api/v1/attempts/[attemptId]/submit/route.ts:L15-L86`](file:///c:/Users/Acer/Desktop/E-learning/src/app/api/v1/attempts/%5BattemptId%5D/submit/route.ts#L15-L86)
* **Các bước tái hiện (Steps to Reproduce):**
  1. Đăng nhập học viên và bắt đầu một bài thi trắc nghiệm (Attempt ở trạng thái `IN_PROGRESS`).
  2. Gửi đồng thời 5 requests `POST /api/v1/attempts/[attemptId]/submit` trong cùng một khoảng thời gian micro-giây (Mô phỏng học viên spam click nút "Nộp bài" hoặc nộp bài từ nhiều tab trình duyệt).
  3. Ghi nhận mã phản hồi HTTP của cả 5 requests.
* **Kết quả mong đợi (Expected):**
  * Chỉ duy nhất 1 request đầu tiên được chấp nhận xử lý nộp bài (HTTP 200).
  * 4 requests tiếp theo phải bị từ chối ngay lập tức với mã lỗi HTTP 400 (`AttemptNotInProgress: Bài thi đã được nộp hoặc không còn hiệu lực`).
* **Kết quả thực tế (Actual - Evidence):**
  ```json
  {
    "statuses": [200, 200, 200, 200, 200],
    "passCount": 5,
    "rejectCount": 0
  }
  ```
  Cả 5 requests đều trả về HTTP 200 thành công. Server đã thực hiện tính toán điểm số và gọi hàm cập nhật cơ sở dữ liệu lặp lại 5 lần trên cùng một lượt thi.
* **Nguyên nhân gốc rễ (Root Cause):**
  Lỗi **Time-of-Check to Time-of-Use (TOCTOU)**:
  Code thực hiện kiểm tra `attempt.status !== 'IN_PROGRESS'` thông qua câu lệnh `prisma.attempt.findUnique()` ở đầu hàm, sau đó mới tính điểm và thực hiện `prisma.attempt.update()`. Trong khoảng thời gian giữa lệnh đọc và lệnh ghi, các requests đồng thời khác đọc được trạng thái `IN_PROGRESS` từ database nên đều vượt qua vòng kiểm tra.
* **Đề xuất khắc phục (Recommended Fix):**
  Chuyển sang sử dụng **Atomic Conditional Update** trong Prisma:
  ```ts
  const updateResult = await prisma.attempt.updateMany({
    where: {
      id: params.attemptId,
      status: 'IN_PROGRESS', // Chỉ update nếu còn đang IN_PROGRESS
    },
    data: {
      status: 'SUBMITTED',
      submitted_at: new Date(),
      score: scoreRatio,
      passed,
    },
  })

  if (updateResult.count === 0) {
    return NextResponse.json(
      { error: { code: 'AttemptNotInProgress', message: 'Bài thi đã được nộp từ trước' } },
      { status: 400 }
    )
  }
  ```

---

## 5. CHECKLIST TRẠNG THÁI PHASE 06

| Hạng mục kiểm tra | Trạng thái | Bằng chứng thực nghiệm |
| :--- | :---: | :--- |
| Kiểm tra Double Click / Race Condition nộp bài thi | **FAIL (BUG)** | Cả 5 requests đồng thời đều trả 200 (`BUG-CONFIRMED-01`) |
| Kiểm tra Gửi đồng thời Heartbeat video (Upsert) | **PASS** | 5 requests heartbeat đồng thời xử lý an toàn không lỗi |
| Kiểm tra Token JWT hết hạn (Expired Token) | **PASS** | Bị chặn 401 Unauthorized chuẩn xác |
| Kiểm tra Học viên Zero-Data (Học viên mới toanh) | **PASS** | Không có lỗi chia cho 0, streak = 0, state = NOT_STARTED |
| Kiểm tra Tài nguyên không tồn tại (UUID ảo 404) | **PASS** | 100% trả về 404 sạch sẽ, không crash server 500 |
| Kiểm tra Hồi quy tính năng (Regression Matrix) | **PASS** | Unpublish khóa học hay xóa member không làm mất lịch sử dữ liệu |

---

## 6. NHỮNG GÌ CHƯA KIỂM TRA TRONG PHASE 06 (LIMITATIONS)
- **Mất kết nối mạng giữa chừng (Network Disconnect during Transaction):** Chưa mô phỏng ngắt card mạng vật lý đột ngột trong lúc client gửi stream upload file dung lượng 100MB lên Cloudflare R2.
- **Sập nguồn Database (Database Crash mid-write):** Chưa mô phỏng crash container Postgres trong lúc chạy migration.
