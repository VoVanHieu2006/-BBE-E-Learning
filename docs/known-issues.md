# Vấn đề còn mở và giới hạn kiểm chứng

Phân biệt lỗi nghiệp vụ, fixture test không tương thích và phần chưa nghiệm thu. Cleanup không sửa formulas, quyền, reward writer, policy hoặc data/snapshot production để ép test xanh.

## Audit sổ tay

`npm run audit:handbook-formulas` gọi production functions với persistence fixture trong bộ nhớ, không ghi DB thật. Nguồn [Markdown bất biến](reference/handbook-formulas.md); output `artifacts/audits/handbook-formula-tests.json`. Exit 1 giữ FAIL, audit không nằm trong regression mặc định phải ép xanh.

| ID | Tái hiện và bằng chứng | Tình trạng |
|---|---|---|
| HANDBOOK-DEADLINE-ADDED | Khóa 20 ngày, 5 bài, đã hoàn thành, hạn cũ ngày 10; publish thêm 2 bài ngày 20, tổng 7 bài. Expected `20+2*max(ceil(20/7),3)=26`; `executePublishCourseRequirements` cộng hạn cũ ra 16. | Lệch mốc tái hiện. Sửa riêng cần completed/incomplete, due future/past, publish retry; không suy rộng mọi khóa. |
| HANDBOOK-MANAGER-ALIAS | User MEMBER có vị trí `CHAPTER_MANAGER`, course published; `rewardEligibility` vẫn true, thiếu alias trong loại trừ. `competitionGroup` đã loại alias khỏi BXH. | Lỗi predicate tái hiện; chưa audit thiệt hại ledger thật. Không thu hồi sao/sửa history lần này. Chi tiết và cách sửa: [CKNK mục 7.4](CKNK.md#74-alias-chaptermanager-vẫn-được-nhận-sao). |
| HANDBOOK-TERM-EXPECTATION | Chuyển 15/9, stage 4+6; sổ tay (bản cũ) muốn 10 thuộc kỳ kết thúc 30/9. Baseline fixture thiếu dependency; sau bổ sung dependency, audit thực sự chạy và trả **4**, expected **10**. | **ĐÃ CHỐT ngày 29/10/2026: code trả 4 là ĐÚNG, expectation 10 là SAI.** Chuyển giao `15/9` chuẩn hóa về mốc `01/10`, nên nhiệm kỳ vừa kết thúc là `01/04→01/10` và nhiệm kỳ mới là `01/10→01/04`. Khung `30/9` đã bị bỏ khỏi [handbook-formulas](reference/handbook-formulas.md) mục 13. Audit vẫn đỏ cho tới khi expectation được cập nhật theo khung mới; không sửa production để ép expectation. |

Deadline chung mục 18 đã chốt `max(D_start+T_new,D_change+T_added)`, thay deadline riêng; ví dụ ngày 5→21/ngày 20→31 và retry/history có `test:shared-deadline`. Không backfill hạn đã lưu. Formula regression cũ PASS không chứng minh phù hợp toàn sổ tay, nhất là expectation stage midpoint cũ.

Lần chạy sau sửa fixture trong đợt cleanup: **8 PASS / 3 FAIL**, gồm actual4/expected10 ở phân điểm, actual16/expected26 ở thêm bài, actualtrue/expectedfalse ở alias. Hai sai lệch sau đã tái hiện rõ; phân điểm **đã có kết luận đặc tả** (code đúng, expectation sai — xem bảng trên), không gộp thành một fixture error chưa chạy hoặc tự sửa công thức.

## Hiệu năng và dữ liệu lớn

GET chuyển giao hiện có side effect: `reorganizations`, `current-roster` và `dashboard/members` gọi `applyDueChapterReorganizations`. Fixture có batch `SCHEDULED` đã đến hạn chuyển thành `APPLIED` sau các GET Admin. Đây là hành vi source hiện hữu, được giữ trong cleanup; nếu muốn GET chỉ đọc cần thay đổi riêng với kiểm chứng scheduler/cutover/retry. Browser countdown chỉ chứng minh client không gửi POST apply, không chứng minh backend GET không thay dữ liệu.

- Local→Supabase mới đo **1 VU**, latency login/progress/quiz cao; chưa xác nhận 100/300/500/1.000 người hoặc SLA production. Xem [performance](performance.md).
- Legacy `src/app/api/v1/leaderboard/chapters/[chapterId]/route.ts` còn `take:500` trước tính/sort standings. Cần fixture >500 phù hợp scope; đây là source risk chưa tái hiện bằng cohort đó.
- Heartbeat/progression có đường dùng Prisma global khi transaction giữ connection: rủi ro pool wait cần đo concurrency/pool nhỏ. Chưa thấy saturation 1 VU; không bỏ lock/auth/video guard để giảm latency.
- Audit cũ “global paginate trước sort”, “cookie thiếu flags”, “thiếu security headers” đã lỗi thời: source hiện sort rồi slice, có HttpOnly/Secure và headers. Không ghi thành lỗi đang mở. CSP chưa có trong header config: hardening cần thiết kế riêng, không phải bằng chứng khai thác.

## Chưa nghiệm thu

| Phạm vi | Giới hạn / bước tiếp |
|---|---|
| Production | Đối chiếu read-only revision/policy/mapping/season, provenance month/cycle và snapshots. Supabase timeout không có SELECT không chứng minh data đúng/sai; báo cáo phiên cũ không phải snapshot hiện tại. |
| Cutover | Xác nhận readiness/approval; tài liệu không khẳng định production đang bật/tắt. Không tự tạo policy/đổi position để bypass. |
| Lịch sử | Chưa chứng nhận đủ evidence mọi tháng/kỳ; thiếu trả reason, không dựng lại frozen snapshot theo affiliation hôm nay. |
| Điện thoại thật | Android/iPhone Safari/Chrome native/theater, xoay/Back/tab, browser chrome, rate/seek/buffer/session cần máy thật. Touch emulation không thay nghiệm thu thiết bị. |
| Video/DB/browser | Mock browser bảo vệ UI contract, không thay YouTube thật + learner DB thật. PASS chỉ đúng phạm vi đã chạy. |
| Đặc tả thiếu | Nguyên văn V01–V15, A–J/14 case trong handoff cũ không đủ; không chế ma trận để tuyên bố đã nghiệm thu. |
| Công thức/UX | Full timing/cohort 30→15, 22,30/50,56%; đổi tên qua snapshot cũ, đủ tám bảng cùng dataset và reset nghĩa vụ toàn bộ cần acceptance riêng khi chưa có evidence. |
| Nội dung | Gia hạn shared path hiện xử lý bài mới, không tự cho video replacement/arbitrary edits. Full bank-version authoring UI cho mọi lesson bank legacy chưa được bảo đảm. |
| Client token | Cookie flags có nhưng client còn localStorage tokens. Đổi auth storage/CSP là thay đổi riêng, cần xem UX/compatibility. |
| Rate limiting | Auth/reset handlers khảo sát không có throttling IP/gateway tại chỗ; bảo vệ ngoài ứng dụng chưa xác minh. Cần nghiệm thu anti-abuse riêng, không thêm middleware trong cleanup. |
| Route tương thích/debug | `/lessons/[lessonId]` vẫn có player thử token; cả `/invitations/accept` và `/accept-invitation` còn tồn tại. Giữ URL/tính năng trong cleanup; đóng/redirect cần quyết định riêng và kiểm tra người dùng còn gọi. |
| Bootstrap forward order | Báo cáo rehearsal trước ghi hai cặp phụ thuộc migration `profile_quiz_configuration`/`learning_governance` và `lead_binding_guards`/`organization_integrity` có thứ tự không phù hợp khi dựng cluster sạch. Không sửa migration history; bootstrap/rehearsal mới cần xác minh đúng baseline + phần forward ở revision triển khai. |
| President bỏ Ban | `updateChapterDepartment` với President đang không có department và `departmentUnitId:null` trả `unassigned`, kết thúc department membership nhưng giữ active President assignment qua nhánh idempotent return. Đây là hành vi hiện hữu phát hiện khi kiểm chứng; cần xác nhận ý nghĩa thao tác/bổ nhiệm riêng, không thay trong cleanup. |

Kết quả mới nằm trong artifact/log và bàn giao; không chép tổng PASS lịch sử thành kết quả hiện tại. Build/typecheck không chứng minh deployment, dịch vụ ngoài hoặc migration production. Xem [testing](testing.md).
