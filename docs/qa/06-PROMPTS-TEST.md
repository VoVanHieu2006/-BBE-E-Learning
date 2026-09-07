# PROMPT TEST — BBE E-Learning QA Agent

## 0. Mục đích

File này là bộ prompt để AI tự kiểm thử project BBE E-Learning dựa trên 5 tài liệu QA:

```text
docs/
└── qa/
    ├── 01-test-plan.md
    ├── 02-test-cases.md
    ├── 03-traceability.md
    ├── 04-dashboard.md
    └── 05-bug-report.md
```

AI phải coi 5 file trên là **nguồn QA chính thức của project**.

### Quy tắc nguồn

- `01-test-plan.md`: mục tiêu, phạm vi, test levels, môi trường, entry/exit criteria.
- `02-test-cases.md`: test case chi tiết và Expected Result.
- `03-traceability.md`: liên kết Requirement ↔ Test Case.
- `04-dashboard.md`: cách tổng hợp trạng thái test.
- `05-bug-report.md`: format ghi nhận bug.
- Không tự thay đổi Expected Result để làm test pass.
- Không tự suy diễn requirement chưa có trong tài liệu.
- Nếu phát hiện mâu thuẫn giữa code và tài liệu: báo rõ **Requirement/Test Case conflict** thay vì tự sửa specification.

---

# 1. MASTER PROMPT — Chạy toàn bộ QA

> Dùng prompt này khi muốn AI kiểm thử toàn bộ project.

```text
Bạn là QA Engineer + Test Automation Engineer cho project BBE E-Learning.

Hãy kiểm thử project dựa trên toàn bộ tài liệu trong:

docs/qa/
├── 01-test-plan.md
├── 02-test-cases.md
├── 03-traceability.md
├── 04-dashboard.md
└── 05-bug-report.md

Mục tiêu:
1. Hiểu Test Plan.
2. Đọc toàn bộ Test Case.
3. Dùng Traceability để xác định coverage.
4. Kiểm tra implementation hiện tại.
5. Chạy test tự động nếu project đã có test framework.
6. Chạy API/integration test nếu có thể.
7. Chạy UI/E2E nếu có thể.
8. Không bỏ qua Negative, Security, Boundary và Regression test.
9. Ghi nhận mọi failure theo format Bug Report.
10. Không sửa code trước khi xác định nguyên nhân lỗi.

QUY TRÌNH:

PHASE 1 — DISCOVERY
- Kiểm tra cấu trúc project.
- Xác định backend, frontend, database, API và test framework.
- Xác định cách chạy project.
- Không thay đổi source code.

PHASE 2 — QA SPEC
- Đọc 01-test-plan.md.
- Đọc 02-test-cases.md.
- Đọc 03-traceability.md.
- Đọc 04-dashboard.md.
- Đọc 05-bug-report.md.
- Lập mapping Module → Test Cases cần chạy.

PHASE 3 — TEST EXECUTION
Với từng Test Case:
- Kiểm tra precondition.
- Chuẩn bị test data.
- Thực hiện đúng steps.
- So sánh Actual Result với Expected Result.
- Ghi PASS / FAIL / BLOCKED / NOT RUN.
- Nếu FAIL, tạo Bug ID.
- Không đánh dấu PASS nếu chỉ kiểm tra code mà chưa đủ bằng chứng runtime khi test yêu cầu runtime.

PHASE 4 — BUG ANALYSIS
Với mỗi FAIL:
- Test Case ID
- Requirement Ref
- Module
- Severity
- Root cause nếu xác định được
- File/code liên quan
- Reproduction steps
- Expected
- Actual
- Evidence
- Suggested fix

PHASE 5 — REGRESSION
Sau khi xác định/fix bug:
- Chạy lại test case bị lỗi.
- Chạy toàn bộ Priority = High liên quan đến module.
- Chạy các test case của module phụ thuộc trực tiếp nếu có.

PHASE 6 — FINAL REPORT

Xuất báo cáo:

## Test Summary
- Total
- Passed
- Failed
- Blocked
- Not Run
- High Priority Total
- High Priority Passed
- High Priority Pass Rate

## Failed Tests
| Test Case | Module | Requirement | Severity | Result |
|---|---|---|---|---|

## Bugs
| Bug ID | Test Case | Severity | Status | Root Cause |
|---|---|---|---|---|

## Coverage
Requirement → Test Case → Execution Result

## Exit Criteria
- High Priority = 100%?
- Critical/Major open bugs = 0?
- Có đủ điều kiện release không?

Không tuyên bố toàn bộ hệ thống PASS nếu vẫn còn test case High chưa chạy hoặc bug Critical/Major đang mở.
```

---

# 2. PROMPT — Test theo từng Module

Dùng khi AI vừa hoàn thành một module.

```text
Hãy kiểm thử MODULE: <MODULE_NAME>.

Đọc:
- docs/qa/01-test-plan.md
- docs/qa/02-test-cases.md
- docs/qa/03-traceability.md
- docs/qa/05-bug-report.md

Chỉ tập trung vào Test Case thuộc module <MODULE_NAME>.

Thực hiện:

1. Liệt kê tất cả Test Case của module.
2. Xác định Priority và Type.
3. Kiểm tra implementation.
4. Chạy test.
5. Đánh dấu:
   PASS / FAIL / BLOCKED / NOT RUN.
6. Với FAIL:
   - tạo Bug ID
   - xác định Severity
   - tìm root cause
   - không tự sửa ngay.
7. Kiểm tra regression của các module phụ thuộc.

Cuối cùng báo:

### Module Test Summary
Total:
Pass:
Fail:
Blocked:
Not Run:

### High Priority
Total:
Pass:
Pass Rate:

### Bugs
...

### Recommendation
READY / NOT READY
```

---

# 3. PROMPT — Test API

```text
Hãy API test project theo Test Case trong:

docs/qa/02-test-cases.md

Ưu tiên các Test Case có:
- API endpoint
- authentication
- authorization
- validation
- business rule
- security
- boundary condition

Trước khi test:
1. Xác định cách start backend.
2. Xác định base URL.
3. Xác định authentication mechanism.
4. Xác định test accounts/data.
5. Không dùng production data.

Với mỗi API test:
- Method
- Endpoint
- Headers
- Auth
- Request body
- Expected status
- Expected response
- Actual response
- Database side effect nếu có

Kiểm tra cả:
- Happy path
- Invalid input
- Unauthorized
- Forbidden
- Not found
- Duplicate
- Boundary
- Business rule violation

Nếu API trả kết quả không đúng Expected Result:
=> FAIL + tạo Bug Report.

Không chỉ đọc controller/service để kết luận PASS.
Nếu Test Case yêu cầu runtime thì phải thực thi request.
```

---

# 4. PROMPT — Test Authentication & Authorization

```text
Hãy kiểm thử toàn bộ AUTH + permission của project.

Đọc:
- 01-test-plan.md
- 02-test-cases.md
- 03-traceability.md

Đặc biệt kiểm tra:
- Login
- Wrong password
- Account lock
- Password reset
- Invitation
- Activation
- Role
- Chapter scope
- Unauthorized
- Forbidden
- Direct URL access

Test với các role:
- Admin
- BĐHU
- Member
- Khách

Đối với mỗi protected endpoint/resource:
1. Không login
2. Login đúng role
3. Login sai role
4. Đúng chapter
5. Khác chapter

Mục tiêu:
Không được có privilege escalation hoặc horizontal/vertical authorization bypass.

Nếu phát hiện:
- user A truy cập resource của user B
- BĐHU truy cập chapter khác
- Member gọi API Admin
- URL trực tiếp bypass authorization

=> Severity tối thiểu Major, đánh giá Critical nếu gây lộ dữ liệu nghiêm trọng.
```

---

# 5. PROMPT — Test Learning Progress / Video

```text
Hãy kiểm thử toàn bộ Learning Progress và Video Progress.

Đọc các Test Case LRN trong:
docs/qa/02-test-cases.md

Đặc biệt kiểm tra:
- positionSeconds
- furthestWatchedPositionSeconds
- completion threshold
- 85% completion
- không cộng progress trùng
- không tua tới để gian lận completion
- reload
- multi-device synchronization
- unauthorized video/document access

Test các boundary:
- 0%
- <85%
- =85%
- >85%
- 100%

Kiểm tra database state trước và sau mỗi action.

Nếu UI hiển thị đúng nhưng DB sai:
=> FAIL.

Nếu DB đúng nhưng API trả sai:
=> FAIL.

Nếu API đúng nhưng UI sai:
=> FAIL.

Không chỉ kiểm tra happy path.
```

---

# 6. PROMPT — Test Assessment / Quiz

```text
Hãy kiểm thử toàn bộ Assessment/Quiz theo các Test Case ASM.

Đọc 02-test-cases.md và 03-traceability.md.

Kiểm tra:
- Start attempt
- Attempt lifecycle
- Timer
- Submit
- Auto-submit khi hết giờ
- Pass/fail
- Score
- Retry
- Cooldown
- Maximum attempts
- Answer validation
- Correct answer exposure
- Concurrent/duplicate submission nếu Test Case yêu cầu

Đặc biệt kiểm tra security:

Nếu learner chưa pass:
- Không được nhận correctOptionId nếu specification yêu cầu ẩn.

Nếu timer hết:
- Attempt phải chuyển đúng trạng thái.
- Không được submit thêm nếu specification cấm.

Nếu retry:
- Không được bypass cooldown/attempt limit.

Test boundary:
- score ngay dưới passing score
- score đúng passing score
- score trên passing score
- thời gian = 0
- submit ngay trước timeout
- submit sau timeout

Kiểm tra cả API response và database state.
```

---

# 7. PROMPT — Security Test

```text
Hãy thực hiện security-focused testing dựa trên Test Plan và các Test Case có Type = Security.

Không thực hiện destructive testing trên production.

Kiểm tra:
1. Authentication bypass
2. Authorization bypass
3. IDOR
4. Horizontal privilege escalation
5. Vertical privilege escalation
6. Direct URL access
7. Sensitive data exposure
8. Correct answer exposure
9. Token/session misuse
10. Input validation
11. SQL injection nếu có input đi vào query
12. XSS nếu có user-generated content
13. File/document access bypass

Với mỗi phát hiện:
- Test Case
- Attack scenario
- Expected security behavior
- Actual behavior
- Impact
- Severity
- Reproduction

Ưu tiên kiểm tra authorization hơn cosmetic/security lint.
```

---

# 8. PROMPT — Boundary & Negative Testing

```text
Hãy chỉ chạy Negative + Boundary Test Case trong 02-test-cases.md.

Tìm các Test Case có Type:
- Negative
- Boundary

Với mỗi test:
- Xác định input boundary.
- Test giá trị nhỏ hơn.
- Test đúng boundary.
- Test lớn hơn.
- Test null/empty nếu phù hợp.
- Test duplicate.
- Test invalid state.

Không được bỏ qua Expected Result.

Báo cáo:

| TC | Boundary/Input | Expected | Actual | Result |
|---|---|---|---|---|

Mọi behavior không được specification cho phép phải được đánh dấu FAIL hoặc NEEDS CLARIFICATION, không tự cho là hợp lệ.
```

---

# 9. PROMPT — Regression Test

```text
Một thay đổi code vừa được thực hiện.

Hãy thực hiện regression test.

Thông tin thay đổi:
<DESCRIPTION>

Thực hiện:

1. Xác định module bị thay đổi.
2. Đọc các Test Case liên quan.
3. Đọc Requirement Ref.
4. Tìm dependency trực tiếp.
5. Chạy:
   - Test Case vừa thay đổi
   - Toàn bộ Priority = High của module
   - Test Case của dependency trực tiếp
6. Nếu có bug trước đó đã Fixed:
   - chạy lại regression.
7. Kiểm tra không tạo side effect.

Báo cáo:
- Tests executed
- Passed
- Failed
- New bugs
- Regression bugs
- Recommendation
```

---

# 10. PROMPT — AI Tự Sửa Bug Sau Khi Test

> Chỉ dùng sau khi đã có FAIL rõ ràng.

```text
Dựa trên kết quả test vừa thực hiện, hãy sửa các bug đã xác định.

QUY TẮC:

1. Không sửa Expected Result.
2. Không sửa Test Case chỉ để test PASS.
3. Không thay đổi requirement.
4. Tìm root cause trước khi sửa.
5. Thực hiện thay đổi nhỏ nhất cần thiết.
6. Không refactor không liên quan.
7. Sau khi sửa:
   - chạy lại test case bị lỗi
   - chạy regression Priority High liên quan
8. Nếu test vẫn fail:
   - không đánh dấu Fixed.
9. Nếu phát hiện specification conflict:
   - dừng và báo NEEDS CLARIFICATION.

Sau khi hoàn thành:

## Root Cause
...

## Changed Files
...

## Fix
...

## Tests
...

## Regression
...

## Remaining Issues
...
```

---

# 11. PROMPT — Full Release Gate

```text
Hãy đánh giá project có đạt QA Release Gate hay chưa.

Đọc:
- docs/qa/01-test-plan.md
- docs/qa/02-test-cases.md
- docs/qa/03-traceability.md
- docs/qa/04-dashboard.md
- docs/qa/05-bug-report.md

Kiểm tra:

1. 100% Priority High đã PASS?
2. Có Critical bug đang mở?
3. Có Major bug đang mở?
4. Có Test Case Blocked không?
5. Có Test Case High chưa chạy không?
6. Requirement nào chưa có Test Case?
7. Test Case nào chưa được execute?
8. Có regression failure không?

Kết luận chỉ được là:

### RELEASE READY
nếu:
- High Priority = 100% PASS
- Critical open bugs = 0
- Major open bugs = 0
- Không có blocker chưa được xử lý.

Hoặc:

### NOT RELEASE READY
nếu bất kỳ điều kiện trên không đạt.

Không được đánh giá dựa trên cảm tính.
```

---

# 12. PROMPT — Kiểm tra Test Coverage

```text
Hãy audit Requirements Traceability.

Đọc:
docs/qa/03-traceability.md
docs/qa/02-test-cases.md

Tạo mapping:

Requirement
→ Test Cases
→ Test Type
→ Priority
→ Execution Result
→ Bug

Tìm:
- Requirement không có Test Case
- Test Case không map Requirement
- Requirement chỉ có Happy Path
- Business Rule chưa có Negative Test
- Security requirement chưa được test
- High Priority requirement chưa PASS

Báo cáo coverage gap.

Không tự tạo requirement mới.
Nếu thấy requirement có vẻ thiếu nhưng source không có:
=> ghi "Not specified in QA documentation".
```

---

# 13. PROMPT — Test Data Validation

```text
Hãy audit test data trước khi chạy QA.

Đọc 01-test-plan.md và 02-test-cases.md.

Xác nhận tồn tại:

- 1 Admin
- 2 BĐHU ở 2 chapter khác nhau
- 4-5 Member ở 2 chapter
- 1 Guest
- Published + Public course
- Published + Private course
- Draft course
- Course có >=2 session
- Session có >=2 lesson
- Video
- Document
- Assessment

Nếu thiếu:
- Không tự tạo data tùy tiện.
- Báo BLOCKED.
- Chỉ đề xuất seed data cần thiết.

Với mỗi Test Case bị ảnh hưởng:
- TC ID
- Missing prerequisite
- Why blocked
```

---

# 14. PROMPT — Sau Mỗi Module AI Code Xong

> Đây là prompt nên dùng thường xuyên nhất trong workflow AI coding.

```text
Module vừa hoàn thành:

<MODULE>

Hãy QA module này trước khi tôi chuyển sang module tiếp theo.

Bắt buộc:

1. Đọc Test Plan.
2. Tìm toàn bộ Test Case liên quan module.
3. Tìm Requirement Ref.
4. Kiểm tra implementation.
5. Chạy automated tests.
6. Chạy API tests nếu có.
7. Kiểm tra database side effects.
8. Chạy Negative/Boundary/Security tests liên quan.
9. Không sửa code nếu chưa báo cáo FAIL.
10. Nếu phát hiện FAIL, phân tích root cause.
11. Sau khi fix, chạy regression.

Kết quả cuối:

MODULE: <MODULE>

| Metric | Result |
|---|---:|
| Total Tests | |
| Passed | |
| Failed | |
| Blocked | |
| Not Run | |
| High Priority | |
| High Priority Passed | |
| High Pass Rate | |

### Bugs
...

### Coverage
...

### Release status
READY / NOT READY
```

---

# 15. PROMPT — Chế độ QA Agent liên tục

```text
Từ bây giờ hãy hoạt động như QA Agent của project.

Nguồn QA chính thức:
docs/qa/

Mỗi khi tôi nói:
"test module X"
→ chạy test case của module X.

"test API"
→ chạy API/integration test.

"test security"
→ chạy security test.

"test regression"
→ chạy regression test.

"test all"
→ chạy toàn bộ test suite theo Test Plan.

"fix bugs"
→ chỉ sửa các bug đã xác định.

"release check"
→ chạy Release Gate.

Sau mỗi lần test:
- cập nhật trạng thái Test Case nếu hệ thống cho phép.
- cập nhật Bug Report nếu có bug.
- không thay đổi requirement.
- không tự biến FAIL thành PASS.
- luôn báo bằng chứng test.
```

---

# 16. Nguyên tắc bằng chứng

AI **không được nói PASS chỉ vì code nhìn có vẻ đúng**.

Mức bằng chứng:

### Level 0 — Static inspection

```text
Đọc source code.
```

Chỉ chứng minh implementation có vẻ phù hợp.

### Level 1 — Automated test

```text
Unit / Integration test PASS
```

### Level 2 — Runtime API

```text
Request → Response → DB state
```

### Level 3 — E2E

```text
Browser → UI → API → DB
```

Khi Test Case yêu cầu runtime, ưu tiên Level 2/3.

---

# 17. Format kết quả chuẩn

AI nên trả kết quả theo format:

```text
## QA Result

Module: AUTH

| TC | Priority | Result | Evidence |
|---|---|---|---|
| TC-AUTH-01 | High | PASS | API + DB |
| TC-AUTH-02 | High | PASS | API + DB |
| TC-AUTH-08 | High | FAIL | API response |

## Bugs

BUG-AUTH-001
- Test Case: TC-AUTH-08
- Severity: Major
- Expected: ...
- Actual: ...
- Root Cause: ...
- Evidence: ...

## Regression

Executed: ...
Passed: ...
Failed: ...

## Verdict

NOT READY
```

---

# 18. Quy tắc quan trọng nhất

```text
SPECIFICATION
     ↓
TEST CASE
     ↓
EXECUTION
     ↓
EVIDENCE
     ↓
RESULT
     ↓
BUG
     ↓
FIX
     ↓
REGRESSION
     ↓
RELEASE GATE
```

Không được đảo thứ tự thành:

```text
CODE
 ↓
"có vẻ đúng"
 ↓
PASS
```

AI phải phân biệt rõ:

- **PASS** = có bằng chứng test phù hợp.
- **FAIL** = Actual khác Expected.
- **BLOCKED** = không thể thực hiện vì thiếu dependency/data/environment.
- **NOT RUN** = chưa thực hiện.
- **NEEDS CLARIFICATION** = specification không đủ hoặc mâu thuẫn.
