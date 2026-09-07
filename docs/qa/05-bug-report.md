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
