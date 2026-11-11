# Quy tắc nghiệp vụ

Tài liệu hợp nhất quyết định đã có và đối chiếu mã hiện tại. Đợt dọn repo không đổi công thức, quyền, schema, video hoặc dữ liệu. Khi đặc tả và mã còn lệch, xem [known-issues](known-issues.md); mô tả mong muốn không có nghĩa đã sửa triển khai.

## Nguồn và quyết định thay thế

[Sổ tay Markdown gốc](reference/handbook-formulas.md), [Word có phương trình](reference/So_tay_BBE_Elearning_cong_thuc_edge_cases%20%281%29.docx) và [cẩm nang BBE](reference/BBE%20-%20TH%20cam%20nang%20cac%20ban%20-%20BH05.2024%20v08.pdf) là nguồn đối chiếu lịch sử. Markdown giữ nguyên cho checksum audit. Deadline chung đã được chốt, thay nhãn “chưa chốt” ở mục 18 và mô hình deadline riêng mục 17. Quyết định nhiệm kỳ đầu dưới đây cũng thay mô tả pause ban đầu trong báo cáo cũ. Mã/test chứng minh hành vi của fixture, không tự chứng minh deployment hay dữ liệu production.

## Người dùng và tổ chức

Mục tiêu là tập trung đào tạo và giúp người học/Lead theo dõi tiến độ. Chatbot, app mobile riêng, AI chấm tự luận, livestream và chứng chỉ chưa phải chức năng được bảo đảm bởi tài liệu này. Mục tiêu BA cũ “90% tạo tài khoản/hoàn thành một khóa trong tháng đầu” là mục tiêu kinh doanh, chưa có bằng chứng đo đạt.

| Người dùng | Phạm vi chính |
|---|---|
| Khách | PUBLISHED + PUBLIC, xem/tua/tải nội dung công khai; không quiz/tiến độ/sao |
| Thành viên Chapter / LT / President | Khóa đã xuất bản, lộ trình theo vị trí và tài nguyên của mình; BXH giới hạn affiliation |
| Thành viên DNA | Chương trình DNA và khóa published; học khóa Thành viên không tạo tư cách Chapter |
| Lead Chapter / Lead DNA | Quản lý đúng đơn vị/chức vụ có hiệu lực; không mặc nhiên là người thi đua |
| Admin | Quản trị toàn hệ thống, nội dung, tổ chức, tài khoản và vận hành |

Role chuẩn là `ADMIN`, `LEAD`, `MEMBER` (đã đổi từ `CHAPTER_LEADER`, prompt 03) và không thay kiểm tra chức vụ, thời hạn và đơn vị trong DB. LEAD có hai chức vụ `CHAPTER_LEAD`, `DNA_LEAD`; Admin/LEAD không học, không nhận sao/BXH và không bị khóa quá hạn. MEMBER có bốn chức vụ `PRESIDENT`, `DEPARTMENT_LEAD`, `DEPARTMENT_MEMBER`, `DNA_MEMBER`; mỗi người đúng một chức vụ tại một thời điểm, đổi chức vụ là thay thế, và không có đường nào đổi MEMBER thành LEAD (LEAD chỉ tạo qua lời mời LEAD cho tài khoản mới). Bảy Ban chuẩn: BTV, BTK, BND, BCL, BDHU, BKM, BTTSK; 18 nhóm học `DEPARTMENT_MEMBER_<ban>`, `DEPARTMENT_LEAD_<ban>`, `PRESIDENT`, `DNA_MEMBER_<TT|SGDC|LDC>`. Lead Chapter gắn cố định một Chapter, không sang DNA kể cả sau thu hồi. President là vị trí Chapter và thuộc LT. Vị trí và Ban lưu ở `organization_units`, `organization_memberships`, `positions`, `position_assignments` — **không** suy ra từ cột `role`.

Một người chỉ có một tư cách Chapter/DNA đang hoạt động. Chapter → DNA chấm dứt Ban/chức vụ/quyền Chapter hiện hành, giữ sao, tiến độ và lịch sử. Không xóa history hoặc tạo ledger giả để chuyển điểm. Raw import, chức vụ tương lai và concurrent writes cũng chịu guard tổ chức.

## Lời mời và tài khoản

- Lời mời dùng một lần, hạn 24 giờ; gửi lại vô hiệu token cũ. Email chuẩn hóa/kiểm tra tồn tại; chấp nhận hợp lệ thiết lập mật khẩu và kích hoạt tài khoản.
- Admin mời quản lý bằng luồng Admin; quản lý đơn vị mời thành viên theo scope. Không dùng luồng member để vượt quyền.
- ACTIVE vẫn cần affiliation hợp lệ. Backend đọc trạng thái/quyền hiện tại, không tin role/Chapter cũ trong JWT để bỏ qua thu hồi.
- Quản lý chỉ vô hiệu hóa tài khoản trong scope; chỉ Admin kích hoạt lại theo quy tắc hiện tại. Deadline có thể tạo restriction/khóa, không tự mở khi thêm khóa hoặc tăng hạn.
- Inactive quá thời gian giữ sẽ retirement thành tombstone, bảo toàn ledger/kết quả/snapshot, không khôi phục như tài khoản bình thường.
- Khóa mật khẩu theo KHBB 7.2: sai **5** lần thì `LOCKED` với `lock_reason = PASSWORD_LOCK`; mỗi lần sai trả `remainingAttempts`; không đặt `locked_until` (không tự mở theo thời gian). Chỉ mail đặt lại mật khẩu mới mở khóa này (và không bao giờ mở khóa quá hạn). Đăng nhập đúng chỉ đếm lại số lần sai, không đổi `status`.

## Nội dung và video

Course → Session → Lesson, video YouTube và 0..n tài liệu. DRAFT/PUBLISHED độc lập PUBLIC/PRIVATE. Admin quản lý; xuất bản phải đáp ứng validation session/lesson/video/assessment. Nội dung đang dùng và version/bank có guard riêng; không dùng BA cũ để suy ra được xóa/recreate attempt.

**Video phải xem hết**, không còn ngưỡng hoàn thành 85% của BA cũ. Backend xác nhận continuous observed time, tốc độ tối đa 2×, chống seek trước, kiểm tra viewing session/video identity. ENDED được chấp nhận có dung sai cuối video nhỏ theo duration; video trên 10 phút dùng dung sai 1% thời lượng (tương đương xem đủ >=99%), video ngắn hơn giữ tối đa 3s/2%. Client tự khai completed hoặc seek tới cuối không đủ. Duration không hợp lệ/không biết không chứng minh hoàn thành. ACK chỉ tiến khi server xác nhận; request cũ không được ghi đè session/bài mới. UI chỉ hiển thị 100% khi server xác nhận videoCompleted, không làm tròn từ 99.x%.

Bài sau mở khi video và quiz bài trước (nếu có) hoàn thành. Quiz dưới 85% vẫn khóa bài sau. Lifetime progress, training cycle completion và replay thưởng tháng là trạng thái riêng; không lấy lifetime completion thay cycle completion. Khách xem công khai tự do, không ghi tiến độ.

Tháng mới giữ training progress/bài đã mở. Muốn thi lại/kiếm sao cần xem đủ video lượt replay mới trong tháng; sau đó không phải xem lại sau mỗi quiz trượt. Video replacement/arbitrary edit bài cũ không tự tạo supplemental obligation; cơ chế hiện tại xử lý publish bài mới.

## Quiz và sao

- Đạt **≥85%**; dưới ngưỡng không có sao quiz. Đáp án đúng/giải thích chỉ lộ theo quyền/kết quả phía server.
- Snapshot đề, câu/lựa chọn và grading theo attempt. Deadline server; hết hạn auto-submit. Manual/auto dùng chung service, transaction/idempotency, không thưởng lặp.
- Số câu theo pool/bank; thời gian theo assessment `durationMinutes`. Không mặc định mọi đề là 15 câu hoặc hai phút/câu.
- Cooldown qua `NEXT_PUBLIC_QUIZ_COOLDOWN_MINUTES`, mặc định code **2 phút**, không phải 24 giờ của BA cũ; không đổi trong đợt dọn. Retake còn tùy trạng thái attempt/assessment trong handler.

Video thưởng một lần cho `(user,video,month,learningCycle)`. Quiz dùng `(user,quiz,month,learningCycle)`; khi đạt 85%, sao thêm `max(0, số câu đúng mới − mốc số câu đúng đã thưởng cao nhất)`. Ví dụ quiz 100 câu: 80→90→85→91→100→100 nhận 0,90,0,1,9,0 sao. Không áp phương án “2 sao/câu + bonus” cũ. Sao video dùng chính sách reward hiện tại, không đổi công thức.

Bảng xếp hạng đã chốt là snapshot bất biến; người rời nhiệm kỳ hoặc bị vô hiệu hóa vẫn hiện ở các bảng họ còn hoạt động đến lúc chụp, và ẩn khỏi bảng đang diễn ra (xem CKNK 5.10). Tháng mới tạo cửa sổ thưởng mới, giữ progress. Apply chuyển giao thành công tạo cycle mới và học lại mọi khóa kể cả mở rộng, giữ history. Suppressed activity khi pause không được cộng bù sau mở thưởng/chuyển DNA trong cùng cửa sổ. Reset thành công cho phép hoạt động học mới trong cycle mới nhận sao.

## Chương trình, deadline và dữ liệu legacy

Bốn chương trình: CORE_MEMBER, CORE_LEADER, CORE_DNA, EXTENDED. Có 18 target: bảy Ban × Thành viên/LT, President và DNA TT/SGDC/LDC. Extended không vào mẫu số bài lõi. Admin phải duyệt theo nội dung thật; gợi ý tên/mapping audit chưa phải phê duyệt. Không bịa số bài 8/8/4 từ catalog không đủ bằng chứng.

Lộ trình bắt buộc dùng **một deadline chung**. Khi đổi tập nghĩa vụ:

```text
D_new = max(D_start + T_new, D_change + T_added)
```

`T_new`: tổng ngân sách các khóa **chưa xong** của tập mới (khóa đã xong không kéo dài hạn); `T_added`: các khóa mới phát sinh chưa xong. A10+B10 đổi A10+C11 ngày 5 → ngày 21; ngày 20 → ngày 31. Người đã xong hết, thêm khóa 10 ngày → hạn = ngày thêm + 10. Không thêm hạn cũ thành số hạng thứ ba. Gỡ khóa: còn khóa chưa xong thì hạn không sớm hơn `D_change + 3d`; hết khóa chưa xong thì không còn hạn. Gia hạn thủ công không bao giờ bị tính lại làm rút ngắn (lấy lớn hơn giữa hạn tính lại và hạn đang có); fingerprint ngăn cộng lặp. Đổi vị trí/ban giữ progress, hạn có thể ngắn hơn hạn cũ; apply chuyển giao mới tạo cycle/nghĩa vụ mới. Quyết định này thay deadline riêng mục 17. Bản đọc dễ hiểu: [KHBB](KHBB.md); bổ sung sổ tay: phụ lục cuối [handbook-formulas](reference/handbook-formulas.md).

Admin giảm ngân sách có sàn ba ngày: `max(D_assigned+T_new,D_adminChange+3d)`; không áp sàn cho mọi lần tăng. Mở lại tài khoản quá hạn **chỉ** qua luồng "Mở khóa & Gia hạn": xem hạn mới, ghi lý do và giữ history restriction; kích hoạt thường không mở được khóa quá hạn. Khóa mật khẩu (sai 5 lần) chỉ mở bằng mail đặt lại mật khẩu. "Mở khóa & Gia hạn" chỉ dùng cho tài khoản đang bị khóa quá hạn (hạn mới = hôm nay + N ngày, N nguyên 1-365, bắt buộc có lý do); `PATCH /users/[userId]` (kích hoạt) và `POST /admin/restrictions` LIFT trả 409 với khóa quá hạn. Cron `deadlines/enforce` bỏ qua ADMIN, LEAD (role hoặc chức vụ), tài khoản INACTIVE và khóa không còn PUBLISHED. Gỡ rồi thêm lại một khóa trong 3 ngày (bỏ tick, đổi ban, hủy xuất bản rồi xuất bản lại) trả hạn về đúng hạn trước khi gỡ (KHBB 5.7). ADMIN và LEAD không bị khóa vì quá hạn và không có khóa bắt buộc. Thêm khóa không tự mở khóa.

Thêm `k` bài vào khóa bắt buộc đã hoàn thành có thời gian bổ sung `k × max(ceil(T_course/L_after),3)` ngày **tính từ lúc thêm**, không cộng trùng khi retry; khóa của người đã xong mở lại thành chưa xong (người đang học dở: cộng dồn vào hạn hiện tại). Bài/quiz mới có nhãn "Mới", không mất tiến trình và không chặn bài sau; điểm thi cuối khóa đã đạt vẫn tính. Mã còn lệch (cộng vào hạn cũ, không mở lại khóa); xem known-issues, không coi là đã sửa.

Dữ liệu cũ có sao thiếu month/cycle provenance giữ đường đọc lịch sử. Mô hình deadline chung luôn chạy; mapping và season áp dụng ngay khi cấu hình, không có bước kích hoạt. Release1: người chưa có cycle nhận `NATIVE` từ `now`, nhập video progress, `imported_due_at` và giữ đường đọc lộ trình lịch sử như trước. Cycle `LEGACY` đã tồn tại vẫn đọc attempt null; không tự nhập attempt null cũ vào cycle `NATIVE` mới. Giữ các trường provenance, không sửa ledger/history.

Tháng runtime dùng ranh giới tự nhiên `[00:00 đầu tháng, 00:00 đầu tháng kế tiếp)` UTC+7, không viết lại month rows/snapshots đã có. Mùa DNA xét `[reward_boundary_at, dnaSeasonEnd(season.reward_boundary_at))`, không có mốc cấu hình làm sàn. Mùa đã kết thúc không có ledger `NATIVE` trong cửa sổ **và không có đúng snapshot** `ranking:DNA:<season.id>` là lịch sử không khả dụng, không dựng snapshot ngược. Có `NATIVE` và chưa có snapshot thì đủ điều kiện cho scheduler chốt; snapshot đã có được giữ nguyên kể cả không có `NATIVE`.

## Chapter và bảng xếp hạng

| Đại lượng | Quy tắc |
|---|---|
| Chapter tháng thường | `S_m=A_m/N_m` |
| Tháng chuyển giao | `S_m=A_1/N_1+A_2/N_2` theo stage thật |
| Quân số bình quân | `(N_1*T_1+N_2*T_2)/(T_1+T_2)`, giữ timestamp thực |
| Tỷ lệ đạt có trọng số | `(Q_1*T_1+Q_2*T_2)/(N_1*T_1+N_2*T_2)` |
| Tiến độ lõi | Số bài lõi published hoàn thành / tổng bài lõi hợp lệ trong kỳ |
| Điều kiện Chapter tháng hiện hành | KPI Vàng/Xanh, quân số **>20**, ≥50% thành viên đạt ≥70% bài lõi |
| Nhiệm kỳ chính thức | Cộng tháng đủ điều kiện đã chốt; tháng mở chỉ tạm tính |
| Cá nhân | Tổng sao thuộc kỳ, phá hòa theo thời điểm đạt tổng sao, giữ độ chính xác thời gian theo API |

Không dùng trọng số 30/30/20/20 cũ. Roster hiện tại khác quân số bình quân thi đua; không lấy learner count quản lý làm mẫu số. Mẫu số core dựa trên publication/version hợp lệ. Thiếu core/KPI/snapshot có reason, không giả thành 0.

Nhóm gồm Thành viên, LT, DNA, Chapter. President thuộc LT; DNA TT không lên BXH DNA. Sang DNA giữa tháng loại toàn bộ sao/quân số người ấy khỏi Chapter tháng chuyển; tháng đã chốt trước đó giữ nguyên. DNA tính cả sao trước gia nhập trong cùng kỳ; không di chuyển ledger. Đổi tên không đổi ID/sao.

Bảng đóng đọc snapshot, không dựng lại bằng roles/affiliation hôm nay. Thiếu history phải báo thiếu evidence. Bổ sung KPI không mở lại reward budget hoặc tính lại facts đã chốt. `ACTUAL_TERM` là thống kê Chapter, không tự có thứ hạng chính thức. Legacy chưa phân bổ báo riêng tránh đếm lặp.

Xếp hạng kỳ dùng điểm chưa làm tròn, tolerance số thực `1e-12`. Chapter tháng phá hòa theo sao cuối đến giây; Chapter nhiệm kỳ theo số tháng đủ điều kiện nhiều hơn. Cá nhân so sao rồi elapsed time đến giây. Bằng cả tiêu chí thì đồng hạng 1–2–2–4; ID chỉ ổn định thứ tự hiển thị, không tạo hạng thắng giả. Nhánh leaderboard legacy có tie-break tương thích riêng, không suy payload legacy thành xếp hạng kỳ.

Lịch sử sao quiz gộp các positive ledger entry của **cùng attempt đã chứng minh**, assessment, cycle, month và loại lesson/final trước khi đếm/phân trang: chín entry +1 hiện một event +9. Attempt/cycle/month khác giữ riêng; video, adjustment, nonpositive và legacy thiếu attempt ID hợp lệ không đoán gộp theo tên/timestamp. Không sửa ledger/balance/reward formula. API personal history no-store, không dùng cache cũ.

## Chuyển giao và nhiệm kỳ đầu

- Cửa sổ giờ Việt Nam: **01/01–30/06** và **01/07–31/12**. Mọi thời điểm chuyển giao được **chuẩn hóa về mốc gần nhất**: `01/01–30/06` → `01/04`, `01/07–31/12` → `01/10`. Reward boundary 00:00 ngày 01/04 hoặc 01/10 trong season. **Schedule chưa reset**; apply thành công mới đóng cycle cũ, mở cycle mới, hủy attempt cũ, đồng bộ nghĩa vụ qua outbox.
- **Không có nghĩa vụ "đủ sáu tháng lịch"** — quy tắc cũ đã bỏ. Chapter vừa thành lập vẫn lên lịch chuyển giao được ngay; không có mốc đủ điều kiện nào, và việc vượt mốc không tự bắt buộc chuyển giao.
- Quyết định mới nhất: Chapter **chưa từng apply chuyển giao thành công** tiếp tục học/nhận sao tới apply đầu, kể cả nhãn quá hạn. Ngoại lệ này thay mô tả pause nhiệm kỳ đầu trong báo cáo cũ.
- Đã từng apply, tới boundary mà mùa tương ứng chưa apply hợp lệ thì pause sao video/quiz; vẫn học, không backpay. Thiếu season không được mở thưởng kỳ sau. Chuyển giao sớm hợp lệ mở cycle ngay, không reset lại ở boundary.
- Chuyển giao **1 lần mỗi cửa sổ** → tối đa 2 lần/năm. Cửa sổ sau không bị chặn bởi cửa sổ trước. Một **nhiệm kỳ thi đua** (`01/04→01/10` hoặc `01/10→01/04`) trải qua **hai cửa sổ**, nên một nhiệm kỳ có thể có **2 lần chuyển giao** — điều này hợp lệ. Người bỏ khỏi draft không mặc nhiên bị xóa Chapter. Lưu history/snapshot trước reset; retry không reset hai lần.
- Chapter ban đầu vẫn đóng kết quả thi đua **cuối nhiệm kỳ** (`01/10` hoặc `01/04`) mà không reset học/sao. Theo quy tắc chuẩn, nhiệm kỳ thi đua tính theo **mốc + 6 tháng**, không theo ngày apply: `01/04→01/10` và `01/10→01/04`; mã hiện vẫn mở nhiệm kỳ tại thời điểm apply (ngoài phạm vi P0–P4, xem [CKNK mục 1.5](CKNK.md#15-nhiệm-kỳ-khác-cửa-sổ)). Actual term từ thành lập/apply gần nhất tới apply kế tiếp; không gộp các khoảng thi đua rời nhau thành ranking.
- DNA reset độc lập ở April/October. Worker trễ dùng DB time sau lock, không backdate sao/reset.

Phân điểm stage/nhiệm kỳ cần đối chiếu audit đầy đủ dependency và đặc tả mới, xem [known-issues](known-issues.md). Không tự tái tính/ghi đè lịch sử.
