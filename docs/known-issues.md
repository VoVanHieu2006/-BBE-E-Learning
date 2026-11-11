# Vấn đề còn mở và giới hạn kiểm chứng

Phân biệt lỗi nghiệp vụ, fixture test không tương thích và phần chưa nghiệm thu. Không sửa formulas, quyền, reward writer, cấu hình học tập hoặc data/snapshot production để ép test xanh.

## Audit sổ tay

`npm run audit:handbook-formulas` gọi production functions với persistence fixture trong bộ nhớ, không ghi DB thật. Nguồn [Markdown bất biến](reference/handbook-formulas.md); output `artifacts/audits/handbook-formula-tests.json`. Exit 1 giữ FAIL, audit không nằm trong regression mặc định phải ép xanh.

| ID | Tái hiện và bằng chứng | Tình trạng |
|---|---|---|
| HANDBOOK-DEADLINE-ADDED | Fixture đã mô tả đủ assignment COMPLETED/bắt buộc và video+quiz. Khóa 20 ngày, 5→7 bài, hạn cũ ngày 10, cập nhật ngày 20: kết quả ngày 26. | PASS trong audit thuần sau prompt 02b. Unit bao phủ người học dở, hạn tương lai/quá khứ và idempotence; chưa kiểm chứng DB thật. |
| HANDBOOK-MANAGER-ALIAS | **Đã xử lý ở prompt 03:** alias `CHAPTER_MANAGER` không còn (gộp vào `CHAPTER_LEAD`, role `LEAD` bị loại khỏi nhận sao và BXH). Chưa audit ledger sao lịch sử của người từng giữ alias này. | Không thu hồi sao/sửa history. Chi tiết lịch sử: [CKNK mục 7.4](CKNK.md#74-alias-chaptermanager-vẫn-được-nhận-sao). |
| HANDBOOK-TERM-EXPECTATION | Chuyển 15/9, stage 4+6; sổ tay (bản cũ) muốn 10 thuộc kỳ kết thúc 30/9. Baseline fixture thiếu dependency; sau bổ sung dependency, audit thực sự chạy và trả **4**, expected **10**. | **ĐÃ CHỐT ngày 29/10/2026: code trả 4 là ĐÚNG, expectation 10 là SAI.** Chuyển giao `15/9` chuẩn hóa về mốc `01/10`, nên nhiệm kỳ vừa kết thúc là `01/04→01/10` và nhiệm kỳ mới là `01/10→01/04`. Khung `30/9` đã bị bỏ khỏi [handbook-formulas](reference/handbook-formulas.md) mục 13. Audit vẫn đỏ cho tới khi expectation được cập nhật theo khung mới; không sửa production để ép expectation. |

Deadline chung mục 18 đã chốt `max(D_start+T_new,D_change+T_added)`, thay deadline riêng; ví dụ ngày 5→21/ngày 20→31 và retry/history có `test:shared-deadline`. Không backfill hạn đã lưu. Formula regression cũ PASS không chứng minh phù hợp toàn sổ tay, nhất là expectation stage midpoint cũ.

Lần chạy prompt 02b: **9 PASS / 2 FAIL**. `HANDBOOK-DEADLINE-ADDED` PASS; hai case còn FAIL ngoài phạm vi: phân điểm actual4/expected10 và fixture alias quản lý thiếu dependency `count`. Kết quả cleanup trước đây là 8 PASS/3 FAIL; không dùng số liệu cũ để kết luận code hiện tại.

## Hạn học và khóa tài khoản (prompt 01, đối chiếu KHBB mục 9)

Đã xử lý trong nhánh `feat/han-va-khoa-tai-khoan` (chưa commit lúc ghi): dòng 2 (LEAD/ADMIN không bị khóa quá hạn; cron bỏ qua cả INACTIVE), 5 (khóa quá hạn chỉ mở bằng Mở khóa & Gia hạn), 6 (khóa mật khẩu 5 lần, `remainingAttempts`, không tự mở), 7 (chỉ tính khóa chưa xong), 8 (sàn `C + 3 ngày` ở đường `ROLE_CHANGED`), 9 (gia hạn tay không bị rút ngắn), 14 (gia hạn chỉ cho tài khoản đã bị khóa, hạn mới = hôm nay + N), 16 (hủy xuất bản/xuất bản lại khóa bắt buộc), 17 (chỉ tick khóa đã xuất bản), 20 (cửa sổ 3 ngày chống làm mới hạn).

Còn lệch hoặc cần theo dõi:

| Mục | Ghi chú |
|---|---|
| KHBB dòng 10, 11, 12, 15, 18 | Logic nền và phần còn lại prompt 02b đã được nối: draft editor/publish, OCC, giữ câu hỏi/pool/lịch sử, xóa có guard, video/ngân hàng/final version, nhãn Mới và quiz đạt. Có unit với transaction double; nghiệm thu DB/browser còn thiếu vì môi trường (xem HANDOFF.md). Chưa tuyên bố hoàn tất nghiệm thu. |
| KHBB dòng 1, 2, 3, 4 | **Đã làm ở prompt 03** (role `LEAD`, tên chức vụ/nhóm học/`BDHU`, một chức vụ, LEAD/ADMIN không học). Migration `20261110_standardize_roles_positions` đã chạy thử trên Postgres 16 tạm với dữ liệu mẫu tên cũ; chưa chạy trên DB thật/production. |
| Số lần sai tồn từ chính sách cũ | Tài khoản `ACTIVE` đang có `failed_login_count` từ 5 đến 9 (ngưỡng cũ là 10) sẽ bị khóa ngay ở lần sai kế tiếp. Không backfill. |
| Khóa nháp đã có ô tick | Quy tắc cũ cho tick khóa nháp. Ô đã tick vẫn còn, vẫn cho bỏ tick/sửa ngày; reconcile coi khóa nháp là ngoài bộ khóa, và người chưa có assignment sẽ chỉ được tạo assignment khi có lần reconcile sau khi xuất bản. |
| `learning_outbox` | Hủy xuất bản/xuất bản lại chỉ đặt việc vào outbox cho người đã có assignment của khóa; hạn chỉ đổi khi outbox được xử lý (cron/read-through). Giữa hai thời điểm, cron `enforce` đã bỏ qua khóa không còn PUBLISHED nên không ai bị khóa oan. |
| Kiểm chứng | Route `enforce`, `extend-deadline`, `login` được test qua double trong bộ nhớ (không DB). Chưa chạy được suite tích hợp có DB riêng trong phiên này. |

## Xóa nội dung và lịch sử BXH (prompt 05, 10/11/2026)

- DELETE khóa/buổi/bài dùng transaction Serializable và khóa course; trả 409 có hướng dẫn hủy xuất bản nếu khóa đã có attempt, progress legacy/cycle, replay, high-water mark, nghĩa vụ bổ sung hoặc assignment đã bắt đầu/hoàn thành. Assignment chỉ được giao, chưa học vẫn được xóa cùng khóa: đóng rule và ghi audit (có rule ID), enqueue người liên quan **trước** cascade để reconcile `learning_paths.due_at` từ budget cũ. Hạn cập nhật khi outbox/read-through xử lý, cần scheduler vận hành.
- Dọn các bảng không FK trong cùng transaction chỉ với nội dung chưa có lịch sử học. Không xóa `star_ledger`, không thêm soft-delete hay migration. Xóa R2/Cloudinary sau commit; lỗi chỉ ghi log, chưa có retry bền vững. Ảnh chỉ dọn được khi có `cover_public_id`; ảnh legacy chỉ có URL cần kiểm kê riêng, không suy public ID từ URL tùy ý.
- Audit đã thêm cho xóa khóa/buổi/bài, cập nhật khóa và hủy xuất bản. Reorder kiểm dữ liệu, ownership và guard xuất bản trong transaction. PUT pools thống nhất 1–20, kiểm mapping/capacity và attempt sau khóa course; ngân hàng đề chỉ Admin.
- Quiz bài học đã có attempt vẫn trả `AssessmentVersionRequired`. Hướng đề xuất (chưa triển khai): phiên bản quiz bất biến, attempt gắn revision, thay nội dung bằng revision mới qua luồng xuất bản; giữ điểm/tiến độ cũ và đối chiếu quy tắc thêm quiz trước khi thiết kế schema. Nếu cần gỡ khóa đã học khỏi danh mục, đề xuất soft-delete/archive cần đặc tả và duyệt riêng.
- BXH: snapshot không lọc trạng thái hiện tại; live dùng lịch sử hoạt động/affiliation tại mốc xét. Đã sửa tử số sao Chapter dùng cùng cohort với quân số; legacy tháng đóng đọc snapshot, thiếu thì trả chờ snapshot. Không dựng lại hay sửa snapshot cũ. Chi tiết [CKNK 5.10](CKNK.md#510-người-đã-rời-nhiệm-kỳ-hoặc-bị-vô-hiệu-hóa).
- Giới hạn kiểm chứng: test mới dùng doubles, chưa DB tích hợp, R2/Cloudinary thật hoặc race writer tiến độ/DELETE. Không sửa writer của worker 02b để thêm khóa chung; cần nghiệm thu đồng thời khi gộp. Full unit gặp `spawnSync ... EPERM` ở `database-safety`; profiler chạy riêng cũng thất bại khi tiến trình con không trả exit code. Không sửa guard/test nền để ép xanh. Kết quả cuối và giới hạn commit nằm trong `HANDOFF.md`.

## Hiệu năng và dữ liệu lớn

GET chuyển giao hiện có side effect: `reorganizations`, `current-roster` và `dashboard/members` gọi `applyDueChapterReorganizations`. Fixture có batch `SCHEDULED` đã đến hạn chuyển thành `APPLIED` sau các GET Admin. Đây là hành vi source hiện hữu, được giữ trong cleanup; nếu muốn GET chỉ đọc cần thay đổi riêng với kiểm chứng scheduler/retry. Admin không còn quyền đặt lịch/áp dụng/hủy (các endpoint trả `403 AdminReadOnly`); GET tự áp dụng là catch-up của hệ thống, không phải quyết định của Admin. Browser countdown chỉ chứng minh client không gửi POST apply, không chứng minh backend GET không thay dữ liệu.

- Local→Supabase mới đo **1 VU**, latency login/progress/quiz cao; chưa xác nhận 100/300/500/1.000 người hoặc SLA production. Xem [performance](performance.md).
- Legacy `src/app/api/v1/leaderboard/chapters/[chapterId]/route.ts` còn `take:500` trước tính/sort standings. Cần fixture >500 phù hợp scope; đây là source risk chưa tái hiện bằng cohort đó.
- Heartbeat/progression có đường dùng Prisma global khi transaction giữ connection: rủi ro pool wait cần đo concurrency/pool nhỏ. Chưa thấy saturation 1 VU; không bỏ lock/auth/video guard để giảm latency.
- Audit cũ “global paginate trước sort”, “cookie thiếu flags”, “thiếu security headers” đã lỗi thời: source hiện sort rồi slice, có HttpOnly/Secure và headers. Không ghi thành lỗi đang mở. CSP chưa có trong header config: hardening cần thiết kế riêng, không phải bằng chứng khai thác.

## Chưa nghiệm thu

| Phạm vi | Giới hạn / bước tiếp |
|---|---|
| Production | Đối chiếu read-only revision/mapping/season, index `chapter_transfers_one_applied_season`, provenance month/cycle và snapshots; audit affiliation và backup bảng rollback theo [runbook release1/release2](operations.md#prompt04--triển-khai-hai-release). Supabase timeout không có SELECT không chứng minh data đúng/sai; báo cáo phiên cũ không phải snapshot hiện tại. |
| Readiness | Readiness cơ sở release1 là `READY`/`asOf`, không có `policy`; API periods vẫn báo lý do thiếu kỳ nhưng không chứng nhận mapping/season hay evidence lịch sử. Vẫn cần kiểm tra cấu hình thực tế, không đổi position để bypass quyền. |
| Lịch sử | Chưa chứng nhận đủ evidence mọi tháng/kỳ; không dựng lại frozen snapshot theo affiliation hôm nay. Mùa DNA đã kết thúc không có `NATIVE` trong `[reward_boundary_at, dnaSeasonEnd(season.reward_boundary_at))` và không có đúng snapshot `ranking:DNA:<season.id>` là lịch sử không khả dụng; có `NATIVE`/chưa có snapshot thì scheduler được phép chốt; snapshot đã có giữ nguyên. |
| Điện thoại thật | Android/iPhone Safari/Chrome native/theater, xoay/Back/tab, browser chrome, rate/seek/buffer/session cần máy thật. Touch emulation không thay nghiệm thu thiết bị. |
| Video/DB/browser | Mock browser bảo vệ UI contract, không thay YouTube thật + learner DB thật. PASS chỉ đúng phạm vi đã chạy. |
| Đặc tả thiếu | Nguyên văn V01–V15, A–J/14 case trong handoff cũ không đủ; không chế ma trận để tuyên bố đã nghiệm thu. |
| Công thức/UX | Full timing/cohort 30→15, 22,30/50,56%; đổi tên qua snapshot cũ, đủ tám bảng cùng dataset và reset nghĩa vụ toàn bộ cần acceptance riêng khi chưa có evidence. |
| Nội dung | Thêm video/quiz riêng và bài thi cuối dùng công thức prompt 02; thay video có sẵn hoặc sửa nội dung tùy ý không tự cộng ngày. Quiz có attempt giữ ID/pool, cấm đổi nội dung/đáp án hoặc xóa câu đã dùng; muốn thay phải theo quy tắc lịch sử. Draft cũ thiếu cấu trúc an toàn được báo lỗi và cho bỏ để tạo lại. Upload vào draft bị bỏ có thể để lại asset cloud chưa liên kết; chưa có cleanup tự động. |
| Client token | Cookie flags có nhưng client còn localStorage tokens. Đổi auth storage/CSP là thay đổi riêng, cần xem UX/compatibility. |
| Rate limiting | Auth/reset handlers khảo sát không có throttling IP/gateway tại chỗ; bảo vệ ngoài ứng dụng chưa xác minh. Cần nghiệm thu anti-abuse riêng, không thêm middleware trong cleanup. |
| Route tương thích/debug | `/lessons/[lessonId]` vẫn có player thử token; cả `/invitations/accept` và `/accept-invitation` còn tồn tại. Giữ URL/tính năng trong cleanup; đóng/redirect cần quyết định riêng và kiểm tra người dùng còn gọi. |
| Bootstrap forward order | **Đã xử lý ở prompt 06:** `scripts/db/cut-baseline.mjs` replay theo thứ tự thật (`profile_quiz_configuration` sau `learning_governance`, `lead_binding_guards` sau `organization_integrity`) và cắt lại cặp `prisma/bootstrap/20261110_*`; `npm run test:fresh-deploy` xác minh baseline → `migrate deploy` (không còn migration chờ) → seed trên DB trống và DB đã xóa dữ liệu. Không sửa migration history. |
| President bỏ Ban | **Đã đổi ở prompt 03:** `updateChapterDepartment` với `departmentUnitId:null` ném `MemberPositionRequired` (mỗi người đúng một chức vụ, đổi là thay thế); chức vụ hiện tại giữ nguyên. `admin-program` kiểm hành vi này từ prompt 06. |
| Email trên BXH kỳ | `src/lib/period-leaderboard.ts` (`hydrateRanking`) thêm `email` vào mọi hàng BXH thành viên/DNA cho người đã đăng nhập (chỉ khách bị xóa); `UnifiedLeaderboard.tsx` hiển thị. `test-learning-security` (yêu cầu không có email) FAIL ở prompt 06: một MEMBER đọc được email mọi thành viên. Cần quyết định sản phẩm; đề xuất bỏ `email` khỏi hàng (UI đã nhận diện bản thân bằng `userId`, tên hiển thị có fallback). |

Kết quả mới nằm trong artifact/log và bàn giao; không chép tổng PASS lịch sử thành kết quả hiện tại. Build/typecheck không chứng minh deployment, dịch vụ ngoài hoặc migration production. Xem [testing](testing.md).
