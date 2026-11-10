# Prompt 01 — Quy tắc hạn học và khóa tài khoản

Đọc `docs/prompts/00-quy-tac-chung.md` trước. Nhánh gợi ý: `feat/han-va-khoa-tai-khoan`.

## Mục tiêu
Đưa code về đúng `docs/KHBB.md` mục 5 (cách tính hạn), mục 7 (khóa tài khoản) và các dòng 2, 5, 6, 7, 8, 9, 14, 16, 17, 20 của bảng mục 9. **Không đổi schema, không thêm migration.** Nếu thấy buộc phải đổi schema thì dừng và hỏi người dùng.

## Bối cảnh (code hiện tại)
- Hạn học là **một hạn chung** cho mỗi chu kỳ: bảng `learning_paths` (`due_at`, `starts_at`), lịch sử ở `learning_path_changes` (có `due_at` mới, `previous_budget`, `next_budget`, `reason`; **không** có cột hạn cũ, muốn biết hạn trước đó thì lấy `due_at` của bản ghi liền trước).
- Công thức thuần: `src/lib/learning-cycle-rules.ts` (`calculateSharedDeadline`). Bộ điều phối ghi DB: `src/lib/shared-learning-path.ts` (`reconcileSharedPath`). Tạo/kết thúc/hồi sinh assignment: `src/lib/learning-assignments.ts` (`reconcileAssignments`).
- Cron khóa quá hạn: `src/app/api/internal/learning/deadlines/enforce/route.ts`. Quy tắc: `src/lib/account-restriction-rules.ts`.
- Test công thức: `src/test/shared-learning-path.test.ts`, `src/test/learning-cycles.test.ts`, `src/test/business-rules.test.ts`.

## Việc cần làm

### A. Công thức hạn (`learning-cycle-rules.ts`, `shared-learning-path.ts`)
Ký hiệu: S = ngày bắt đầu lộ trình (`starts_at`), C = thời điểm thay đổi, T = số ngày của khóa (`courses.mandatory_default_due_days`).
1. **Đổi tập khóa / thêm khóa / đổi ban** (lý do `ROLE_CHANGED`): `hạn = max(S + tổng T các khóa CHƯA XONG của bộ mới, C + tổng T các khóa mới thêm chưa xong)`. Hiện code dùng tổng T của **mọi** khóa kể cả đã xong; sửa thành chỉ khóa chưa xong. Khóa đã xong không kéo dài hạn.
2. **Gỡ khóa**: nếu bộ mới còn khóa chưa xong thì hạn không được sớm hơn `C + 3 ngày`; nếu bộ mới không còn khóa chưa xong thì hạn là `null`. Hiện sàn 3 ngày chỉ nằm ở nhánh "không có reason" mà production không đi vào, nên nhánh `ROLE_CHANGED` có thể trả hạn đúng bằng lúc gỡ. Sửa sao cho đường đi thật của production có sàn.
3. **Giảm số ngày** (`ADMIN_BUDGET_SHORTENED`): giữ nguyên sàn `C + 3 ngày`, nhưng tổng T cũng chỉ tính khóa chưa xong.
4. **Gia hạn tay không bao giờ bị rút ngắn**: sau mọi lần tính lại, `hạn cuối = max(hạn tính lại, hạn của lần gia hạn tay gần nhất)`. Lần gia hạn tay gần nhất = bản ghi `learning_path_changes` có `reason = 'ADMIN_MANUAL_EXTENSION'` mới nhất của lộ trình, lấy `due_at` của nó. Chỉ áp khi hạn đó còn trong tương lai tại thời điểm tính.
5. **Chống làm mới hạn (cửa sổ 3 ngày)**: khi một assignment đã kết thúc (`ended_at` không null) trong cùng chu kỳ bị hồi sinh lại (thêm lại khóa) **trong vòng 3 ngày kể từ `ended_at`**, thì khóa đó **không** được tính vào "khóa mới thêm" (`C + T_added`), và hạn cuối không được thấp hơn hạn trước thời điểm gỡ (lấy `due_at` của bản ghi `learning_path_changes` đứng ngay trước bản ghi gỡ). Sau hơn 3 ngày thì thêm lại tính như thêm mới. Áp dụng cho bỏ tick, đổi ban qua lại, hủy xuất bản rồi xuất bản lại (mục 5 của khối này).
   Ví dụ phải chạy được: A=10, X=10, S=0, hạn ngày 20. Ngày 18 bỏ tick X rồi tick lại cùng ngày → hạn vẫn là ngày 20 (hiện tại ra ngày 28). Tick lại X ngày 25 → X tính như mới, hạn = 25 + 10 = ngày 35 nếu A đã xong; còn nếu A chưa xong thì `max(0+20, 25+10) = 35`.
6. Giữ nguyên: công thức khởi tạo `S + tổng T`, công thức "thêm bài" (thuộc prompt 02, **không** làm ở đây), và việc hoàn thành khóa không làm hạn ngắn lại (fingerprint ngân sách `budgetFingerprint` bỏ trạng thái hoàn thành).

### B. Gia hạn tay (`src/app/api/v1/admin/users/[userId]/extend-deadline/route.ts`, modal trong `src/app/admin/users/page.tsx`)
1. Chỉ cho tài khoản **đang bị khóa quá hạn** (có restriction `DEADLINE` mở hoặc `lock_reason = 'OVERDUE_LOCK'`). Tài khoản khác: trả `409` kèm mã lỗi rõ ràng và ẩn/khóa nút ở giao diện.
2. Hạn mới = `hôm nay + N ngày` (hạn cũ đã qua nên luôn tính từ hôm nay). Bỏ nhánh `max(now, hạn hiện tại)`.
3. Kiểm tra đầu vào: `N` nguyên, từ 1 đến 365 (trần ở backend, không chỉ UI); `userId` sai định dạng, user không có chu kỳ/lộ trình → trả `4xx` (400/404/409) chứ không ném lỗi 500; lý do là **bắt buộc**; chống bấm đúp (hai request gần nhau chỉ cộng một lần, ví dụ dựa vào `learning_path_changes`/khóa dòng đang có trong transaction).
4. Giữ nguyên: gỡ restriction `DEADLINE`, đưa assignment chưa xong về `IN_PROGRESS`, ghi `learning_path_changes` (`ADMIN_MANUAL_EXTENSION`) và audit `EXTEND_DEADLINE`.

### C. Hai đường mở khóa không được mở khóa quá hạn
1. `PATCH /api/v1/users/[userId]` (`src/app/api/v1/users/[userId]/route.ts`, nhánh đổi trạng thái sang `ACTIVE` kèm `extensionDays`): nếu tài khoản đang bị khóa quá hạn thì từ chối (409) và hướng dẫn dùng "Mở khóa & Gia hạn". Bỏ việc nó đặt `due_at` cho assignment `OVERDUE` mà không cập nhật `learning_paths`.
2. `POST /api/v1/admin/restrictions` với `LIFT` (`src/app/api/v1/admin/restrictions/route.ts`): không được gỡ restriction loại `DEADLINE`; từ chối kèm hướng dẫn. Cập nhật test integration đang chấp nhận đường này (`scripts/test/test-learning-flow-integration.mjs`, đoạn quanh "LIFT").

### D. Khóa mật khẩu
1. `src/app/api/v1/auth/login/route.ts`: sai mật khẩu **5 lần** thì `LOCKED` với `lock_reason = 'PASSWORD_LOCK'` (hiện là 10). Mỗi lần sai trả `401` kèm `remainingAttempts` (số lần còn lại); lần thứ 5 trả mã lỗi khóa tài khoản và hướng dẫn dùng "Quên mật khẩu".
2. Bỏ cơ chế tự mở theo thời gian (`locked_until` +30 phút): không đặt `locked_until` nữa. Đọc toàn bộ route login để chắc rằng người đang `LOCKED` (cả `PASSWORD_LOCK` lẫn `OVERDUE_LOCK`) không đăng nhập được kể cả khi nhập đúng mật khẩu, và đoạn "đăng nhập đúng thì reset `status: 'ACTIVE'`" (khoảng dòng 112) không mở nhầm khóa.
3. Khóa mật khẩu **chỉ** mở bằng mail đặt lại mật khẩu: `src/app/api/v1/auth/password-reset/confirm/route.ts` (đã xóa `failed_login_count`, `lock_reason`; kiểm tra nó **không** mở khóa quá hạn) và nút gửi mail ở `src/app/api/v1/users/[userId]/password-reset/route.ts`. Nút "kích hoạt" thường không được mở `PASSWORD_LOCK`.
4. `src/app/login/page.tsx`: hiển thị "Bạn còn N lần thử" từ `remainingAttempts`; khi bị khóa hiển thị thông báo yêu cầu đặt lại mật khẩu.
5. Nếu một tài khoản bị **cả hai khóa**: mở lần lượt, gia hạn trước rồi mail đặt lại mật khẩu; `extend-deadline` không được làm tài khoản `ACTIVE` khi còn `PASSWORD_LOCK` (code hiện đã có kiểm tra tương tự, đổi cho khớp bỏ `locked_until`).
6. Cập nhật `docs/business-rules.md` (dòng nói "10 lần sai") nếu còn lệch.

### E. Cron khóa quá hạn (`enforce/route.ts`, `account-restriction-rules.ts`)
1. Không khóa: role `ADMIN`, role `LEAD`/`CHAPTER_LEADER`, người giữ chức vụ `DNA_LEAD`/`CHAPTER_LEAD`/`CHAPTER_MANAGER`, và tài khoản `INACTIVE`. Hiện chỉ bỏ qua `ADMIN` và còn biến `INACTIVE` thành `LOCKED`.
2. Bỏ qua assignment của khóa không còn `PUBLISHED`.
3. Xử lý theo lô (ví dụ 100 assignment mỗi lượt), mỗi người một `try/catch` để lỗi một người không làm hỏng cả lượt; trả về số đã xử lý/bỏ qua/lỗi.
4. Cập nhật test: dòng khẳng định `canDeadlineLockAccount('CHAPTER_LEADER') === true` trong `src/test/business-rules.test.ts` phải đảo lại.

### F. Hủy xuất bản và xuất bản lại khóa bắt buộc
1. `POST /api/v1/courses/[courseId]/unpublish` (và `publish`, `draft/publish`): sau khi đổi trạng thái, enqueue reconcile cho mọi người có assignment của khóa (dùng `learning_outbox` như `mandatory-matrix/route.ts`). `reconcileAssignments` phải coi khóa không `PUBLISHED` là **không thuộc bộ khóa** (như bị gỡ): hạn áp quy tắc A.2, không ai bị khóa vì nó, ô tick và tiến độ giữ nguyên.
2. Xuất bản lại → khóa trở lại bộ khóa, áp quy tắc A.5 (trong 3 ngày thì về hạn cũ, sau 3 ngày tính như thêm mới). Làm mới cache khóa (`invalidateCoursesServerCache` + `invalidateSystemDataCache`) ở unpublish và publish.

### G. Chỉ tick được khóa đã xuất bản
- `src/app/api/v1/admin/mandatory-matrix/route.ts` (PUT): từ chối `409` khi tick/bật ô cho khóa `DRAFT`. Bỏ tick vẫn cho phép.
- `src/app/admin/courses/mandatory/page.tsx`: khóa ô tick của khóa nháp, kèm chú thích "Khóa chưa xuất bản".

## Test phải thêm hoặc sửa
- `shared-learning-path.test.ts` / `learning-cycles.test.ts`: ví dụ trong KHBB 5.2-5.4 và 5.7: (1) bộ A=10,B=5, đổi ngày 12 sang A(xong)+C=10 → ngày 22; đổi ngày 2 khi cả hai chưa xong → ngày 20; (2) A=100 xong, thêm C=10 ngày 5 → ngày 15; (3) gỡ khóa còn khóa khác → `C+3`; gỡ khóa cuối → `null`; (4) gia hạn tay hạn 30, tính lại ra 25 → 30; (5) cửa sổ 3 ngày: gỡ rồi thêm lại trong 3 ngày → hạn cũ; sau 3 ngày → như mới; chuỗi bỏ tick/tick lại ba lần không tăng hạn.
- Test mới cho `extend-deadline` (đủ các nhánh lỗi 4xx), `enforce` (ADMIN, LEAD, INACTIVE, khóa nháp, lỗi một người), login 5 lần (remainingAttempts, khóa, đăng nhập đúng không mở khóa). Nếu route khó test thuần, tách logic thành hàm thuần trong `src/lib/` và test hàm đó, theo mẫu `account-restriction-rules.ts`.
- Đăng ký test mới trong `scripts/test/run-tests.cjs`. Chạy `npm run test:unit` và `npx tsc --noEmit`.

## Nghiệm thu
Các dòng 2, 5, 6, 7, 8, 9, 14, 16, 17, 20 của bảng mục 9 trong `docs/KHBB.md` đúng với code. Cập nhật `docs/known-issues.md` (bỏ/đánh dấu đã xử lý các mục liên quan) và nói rõ những dòng còn lệch.

## Không được đụng tới
Công thức và ngày cộng khi **thêm bài/quiz** (prompt 02), đổi tên role/chức vụ/nhóm học (prompt 03), `learning_policy`/cutover (prompt 04), xóa khóa học (prompt 05), mọi file migration cũ.
