# Đối chiếu sổ tay công thức

Ngày audit: 25/10/2026. Nguồn: `So_tay_BBE_Elearning_cong_thuc_edge_cases.md`, SHA256 `11765145c4047b03a3bfe6999e2c87aee21a5ec782f816f61e1864ef3dc29510`.

## Kết luận và quyết định áp dụng

Hệ thống **chưa phù hợp toàn bộ sổ tay**. Audit gọi các hàm production với dữ liệu trong bộ nhớ, không ghi database thật. Ba sai lệch ban đầu đã được tái hiện. Sau quyết định của chủ sản phẩm dùng **deadline chung theo mục 18**, đã sửa một sai lệch và bổ sung kiểm thử. Khi rà tiếp quy tắc không có công thức, phát hiện thêm lỗi thiếu alias quản trị trong điều kiện nhận sao.

Hiện còn ba lỗi được tái hiện chưa sửa: phân điểm nhiệm kỳ Chapter, mốc gia hạn khi thêm bài, và quyền nhận sao của alias `CHAPTER_MANAGER`. Không chạy tính lại deadline, sao hoặc snapshot lịch sử. Sổ tay gốc được giữ nguyên; quyết định trong hội thoại thay thế trạng thái “chưa chốt” của mục 18 và mô hình deadline riêng ở mục 17.

Các quyết định khác đã đưa vào kiểm thử P0: Lead gắn cố định với một Chapter và không sang DNA; DNA tính toàn bộ sao trong cùng kỳ, kể cả trước khi gia nhập; Chapter loại toàn bộ sao/quân số của người chuyển DNA trong tháng chuyển.

## Các sai lệch có bằng chứng

| Mục | Dữ liệu tái hiện | Expected | Actual trước sửa | Tình trạng |
|---|---|---|---|---|
| 6, 13 | Chuyển giao 15/9; snapshot tháng 9 đủ điều kiện có hai giai đoạn 4 + 6 điểm | Toàn bộ 10 điểm thuộc kỳ thi đua kết thúc 30/9 | Chỉ 4 điểm thuộc kỳ cũ | FAIL, chưa sửa |
| 18 | A10+B10 đổi sang A10+C11 vào ngày 5 | `max(21, 5+11) = 21` | Ngày 31 | Đã sửa; ngày 21, PASS |
| 20 | Xuất bản thêm 2 bài vào ngày 20; hạn cũ ngày 10; khóa 20 ngày, tổng sau thêm 7 bài | `20 + 2*max(ceil(20/7),3) = 26` | Ngày 16, đã nằm trong quá khứ | FAIL, chưa sửa |
| VI | User MEMBER đang có chức vụ quản trị `CHAPTER_MANAGER`, khóa Published | Không đủ quyền nhận sao | `rewardEligibility()` trả true | FAIL với fixture production-function; chưa đo thiệt hại dữ liệu thật |

**Nhiệm kỳ:** `src/lib/competition-snapshots.ts`, `chapterSeasonRows()` gán từng stage theo midpoint và khoảng `chapter_competition_terms` thực tế. Cách này trộn chu kỳ đào tạo với kỳ thi đua cố định. Nhánh chốt snapshot nhiệm kỳ còn có cách phân tương tự. Test cũ “Oracle 07” cũng kỳ vọng chia stage như code, nên PASS của suite cũ không chứng minh phù hợp mục 13. Không sửa/xóa snapshot đã chốt trong audit này.

**Deadline:** `src/lib/shared-learning-path.ts` trước đây dispatch thay đổi tập khóa sang `MANDATORY_COURSE_ADDED`, cộng thời lượng mới vào hạn cũ. Nay thay đổi tập nghĩa vụ dùng công thức mục 18 qua `ROLE_CHANGED`; bỏ hạn cũ như một số hạng thứ ba không có trong công thức. Vẫn giữ khởi tạo chu kỳ, quy tắc Admin giảm ngân sách có sàn 3 ngày, deadline import lần đầu và cơ chế fingerprint chống cộng lặp. Tập khóa không đổi giữ deadline đã gia hạn thủ công; khi tập nghĩa vụ thay đổi, công thức mục 18 được áp dụng lại. Không chạy backfill deadline đang lưu.

**Thêm bài:** `src/lib/course-requirements.ts`, `executePublishCourseRequirements()` tính đúng số ngày bổ sung nhưng dùng `path.due_at` làm mốc. Sổ tay mục 20 dùng thời điểm xuất bản đối với khóa đã hoàn thành. Cần sửa luồng này riêng với test khóa đã hoàn thành/chưa hoàn thành, hạn cũ tương lai/quá khứ và publish retry trước khi triển khai; không tự suy rộng quy tắc của khóa đã hoàn thành sang mọi trường hợp.

**Alias quản trị:** `src/lib/learning-periods.ts`, `rewardEligibility()` loại `DNA_LEAD`, `DNA_MANAGER`, `CHAPTER_LEAD` nhưng thiếu `CHAPTER_MANAGER`. API bổ nhiệm có thể tạo position này cho tài khoản MEMBER mà không đổi legacy role. `competitionGroup()` đã loại alias đó khỏi BXH. Fixture kiểm tra trực tiếp production predicate; chưa audit ledger để xác định tài khoản thật bị ảnh hưởng. Không thu hồi sao hoặc sửa lịch sử trong lần này.

## Bảng tra cứu 13 công thức

PASS dưới đây chỉ áp dụng cho test được nêu, không thay thế nghiệm thu mọi đường ghi và dữ liệu lịch sử.

| # | Công thức | Kiểm tra và kết quả | Giới hạn |
|---|---|---|---|
| 1 | Chapter tháng thường `A/N` | PASS: 300/30 = 10 | Hàm production; không tính lại toàn bộ tháng production |
| 2 | Tháng chuyển giao `A1/N1+A2/N2` | PASS: 100/30+40/15 = 6 | Fixture hai stage, timestamp không làm tròn |
| 3 | Quân số bình quân thời gian | PASS: 350,5h và 369,5h, kết quả 22,302083… | Chưa xác minh tất cả snapshot cũ đủ evidence |
| 4 | Tỷ lệ đạt có trọng số | PASS: expected/actual 0,505589… | Suite cũ có test ngưỡng 50%; không nghiệm thu mọi cohort lịch sử |
| 5 | Hoàn thành core / tổng core Published | SOURCE REVIEW: dùng distinct lesson hoàn thành trước mốc, core requirement version | NOT VERIFIED độc lập toàn bộ trường hợp sửa/xóa nội dung giữa kỳ |
| 6 | Cộng tháng đủ điều kiện theo kỳ thi đua | FAIL ở chuyển giao sớm mục 13 | Chưa sửa, không tái tính snapshot |
| 7 | Phá hòa theo thời gian đạt sao | PASS: 15 ngày thắng 20 ngày; kiểm tra đồng timestamp trong suite hiện có | Chưa kiểm thử UI cả 8 bảng với cùng dataset |
| 8 | Quiz delta khi đạt 85% | PASS: 80→90→85→91→100→100 thưởng 0,90,0,1,9,0 | Kiểm tra grading + high-water, không submit mọi loại quiz qua browser |
| 9 | Video `(user,video,month,cycle)` | SOURCE REVIEW: unique replay tuple và reward_key; guard 15/15 PASS | NOT VERIFIED end-to-end trả thưởng qua chuyển tháng thật |
| 10 | Quiz `(user,quiz,month,cycle)` | SOURCE REVIEW: unique high-water tuple; test reset tháng/cycle PASS | Chưa stress concurrent quiz submission đầy đủ trong audit này |
| 11 | Deadline chung mục 18 | PASS: 8 test coordinator mới; hai ví dụ ngày 5→21 và ngày 20→31 | Quyết định người dùng thay thế deadline riêng; chưa triển khai app |
| 12 | Admin giảm hạn, sàn 3 ngày | PASS: ngày 20 giảm A30→A10 ra ngày 23 | Trường hợp một khóa; không nghiệm thu mọi kết hợp nhiều ngân sách |
| 13 | Thêm bài `k*max(ceil(T/L),3)` | Số ngày đúng; FAIL mốc cộng ngày 16 thay vì 26 | Chưa sửa công thức triển khai |

## Những quy tắc khác đã đối chiếu

| Quy tắc | Kết quả thực tế |
|---|---|
| Chapter → DNA chấm dứt Ban/quyền Chapter | PASS kiểm thử tích hợp PostgreSQL, API thật trong process; giữ tiến độ/ledger/history |
| Tháng chuyển DNA loại toàn bộ sao Chapter; kỳ DNA nhận cả sao trước gia nhập trong cùng kỳ | PASS fixture PostgreSQL: tháng DNA 12, kỳ DNA 15; ngoài kỳ bị loại; Chapter tháng chuyển bị loại; lịch sử tháng trước giữ nguyên |
| President thuộc LT; DNA TT không vào BXH | PASS hàm `competitionGroup()` trong suite hiện có |
| Quản trị không nhận sao/BXH | BXH có bộ lọc; FAIL alias nhận sao như nêu trên |
| Chuyển giao trễ tạm dừng nhận sao, DNA không bị pause | PASS pure boundary tests; SOURCE REVIEW suppression khi heartbeat; chưa E2E toàn bộ luồng nhận thưởng |
| Sang tháng giữ tiến độ, có cửa sổ replay mới | SOURCE REVIEW cycle progress tách monthly replay, unique tuple đúng; chưa chuyển tháng thật trên thiết bị |
| Mở bài sau khi hoàn thành video và quiz | PASS pure gating suite; SOURCE REVIEW `persistLearningUnlocks`; chưa full-course browser E2E |
| Đổi tên cập nhật BXH nhưng không đổi ID/sao | NOT VERIFIED hành trình đổi tên với snapshot cũ |
| Khách, tải tài liệu công khai, Admin kích hoạt lại tài khoản | Ngoài tập kiểm thử lần này, NOT VERIFIED độc lập |
| Đủ đúng tám bảng; deadline UI; reset toàn bộ nghĩa vụ khi chuyển giao | Đã rà source liên quan nhưng chưa có acceptance E2E đủ để đánh dấu PASS toàn bộ |

## Bằng chứng và cách chạy

- `npm run audit:handbook-formulas`: 8 PASS, 3 FAIL còn tồn tại; exit 1 là có chủ đích để không che lỗi.
- [Kết quả trước sửa](handbook-formula-tests-before.json), [kết quả hiện tại](handbook-formula-tests.json).
- `npm run test:shared-deadline`: 8/8 PASS, gọi coordinator thật với persistence fixture; kiểm tra retry và lịch sử thay đổi.
- `npm run test:formula-audit`: 49/49 PASS, gồm test kế thừa có kỳ vọng nhiệm kỳ chưa phù hợp sổ tay; không coi đây là chứng nhận toàn hệ thống.
- [22 kiểm thử tổ chức](organization-tests.json) và [báo cáo P0/fullscreen](p0-organization-and-fullscreen-report.md).

Ba lỗi còn lại cần một đợt sửa riêng kèm kế hoạch xử lý dữ liệu đã chốt. Audit này không thay đổi lịch sử thật để làm cho test xanh.
