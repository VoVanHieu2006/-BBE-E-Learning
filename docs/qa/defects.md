# Danh sách lỗi tìm được khi kiểm thử (QA)

Mỗi lỗi dưới đây có một test tự động mô tả **hành vi đúng theo tài liệu/ý đồ sản phẩm**. Test đó hiện đang đỏ có chủ đích
(Playwright: `test.fail`, unit: `todo`), nên bộ test vẫn chạy xanh. Khi lỗi được sửa, test sẽ báo "passed unexpectedly":
lúc đó bỏ đánh dấu lỗi trong test và xóa dòng tương ứng ở đây. Chạy `E2E_STRICT=1 npm run test:e2e` để thấy các lỗi này đỏ như test thường.

Bộ test **không sửa mã ứng dụng**. Mức độ: **Cao** = sai nghiệp vụ/bảo mật hoặc chặn một luồng chính; **Trung bình** = người dùng bị
hiểu sai hoặc phải làm thừa; **Thấp** = khó chịu nhỏ, chuẩn accessibility.

## Mức Cao

| Mã | Hiện tượng (đã tái hiện) | Mong đợi | Test |
|---|---|---|---|
| BUG-VIDEO-SPAM | Gửi dồn 150 heartbeat hoàn thành video 10 phút trong khoảng 3 giây: mỗi request được cộng 4 giây xem bất kể thời gian thật trôi qua. Học viên nhận sao mà không xem. | Thời gian xem chỉ được cộng theo thời gian thật do máy chủ đo (`docs/business-rules.md`, mục video). | `src/test/e2e/api/04-video.spec.ts` |
| BUG-INVITE-LEAD-500 | Admin mời Lead cho một Chapter mới luôn nhận lỗi 500 (vi phạm ràng buộc `invitations_exactly_one_scope_check`); trên giao diện không có lời mời nào được tạo. | Lời mời được tạo, người nhận kích hoạt thành LEAD của đúng Chapter. | `api/02-invitations.spec.ts`, `ui/04-admin-management.spec.ts` |
| BUG-AUTH-RATE | 40 lần đăng nhập sai liên tiếp từ một nguồn không bị giới hạn tần suất. Đã ghi trong `docs/known-issues.md`. | Trả 429 sau một ngưỡng hợp lý. | `api/01-auth.spec.ts` |

## Mức Trung bình

| Mã | Hiện tượng (đã tái hiện) | Mong đợi | Test |
|---|---|---|---|
| BUG-STALE-AFTER-RELOAD | Danh sách (ví dụ lời mời) được lưu trong `sessionStorage` tới 120 giây (`src/lib/api/client.ts`) và trang không yêu cầu dữ liệu mới khi tải lần đầu. Người được mời đã kích hoạt, Lead bấm F5 vẫn thấy "Đang chờ" và nút Hủy. | F5 luôn hiện dữ liệu mới. | `ui/03-lead-management.spec.ts` |
| BUG-UX-ACCEPT-LOGIN | Nút ghi "Kích hoạt tài khoản & Đăng nhập" nhưng kích hoạt xong lại đưa về trang đăng nhập, bắt gõ lại email và mật khẩu. | Vào thẳng trang học, hoặc đổi chữ trên nút. | `ui/01-guest-and-account.spec.ts` |
| BUG-UX-CALLBACK-STUDENT | Mở link `/student/...` khi chưa đăng nhập, đăng nhập xong bị đưa về trang chủ học viên thay vì trang đã mở. | Về đúng trang trong `callbackUrl`. | `ui/01-guest-and-account.spec.ts` |
| BUG-UX-ERROR-AS-EMPTY | Khi API danh sách thành viên trả 500, trang Lead không báo lỗi; Lead thấy màn hình như thể Chapter chưa có ai. | Báo "không tải được" kèm cách thử lại. | `ux/02-interaction.spec.ts` |
| BUG-UX-LOADING-FALSE-DATA | Trang khóa học của học viên khi mạng chậm (2,5 giây): trong lúc chờ, trang hiện "⚠️ Thành viên · Chưa có Ban" (dù thành viên đã thuộc một ban), "0 / 0 khóa", "0% (0/0 bài)", "Tất cả khóa học (0)" như dữ liệu thật, rồi mới nhảy sang số đúng. | Hiện trạng thái đang tải cho các số liệu và không hiện cảnh báo trước khi có dữ liệu. | `ux/02-interaction.spec.ts` |
| BUG-LEAD-MEMBER-DETAIL-UNIT | Lead Chapter mở hồ sơ một thành viên (cửa sổ ở "Thành viên & Tiến trình" và trang `/chapter-manager/members/<id>`): hồ sơ luôn ghi "Chưa gán Chapter" và "Ban Chưa phân ban", dù danh sách ngay bên dưới và bảng chuyển giao ghi đúng ban. API `GET /api/v1/chapters/<id>/members/<userId>/course-progress` không trả tên Chapter và Ban trong `user`. Tìm thấy khi dùng thử bằng tay. | Hồ sơ ghi đúng Chapter và Ban của thành viên. | `ui/03-lead-management.spec.ts` |
| BUG-PROFILE-500 | Admin sửa tên của tài khoản không tồn tại nhận lỗi 500. | 404. | `api/08-permission-matrix.spec.ts` |
| BUG-MOVE-SESSION-MSG | Thành viên bị chuyển ban: phiên cũ nhận thông báo như tài khoản bị vô hiệu hóa. | Thông báo tiếng Việt yêu cầu đăng nhập lại. | `api/07-organization.spec.ts` |
| BUG-QUIZ-IMPORT-GAP | Nhập quiz từ Google Sheet: nếu một cột lựa chọn bị bỏ trống ở giữa (A, trống, C, D) và đáp án là "C", hệ thống đánh dấu lựa chọn D là đúng, không báo lỗi. Đề thi có đáp án sai mà Admin không biết. | Đánh dấu đúng lựa chọn ở cột C, hoặc từ chối dòng đó. | `src/test/quiz-import.test.ts` |
| BUG-UI-HYDRATION-TRANSFER | Trang `/admin/transfer-seasons` sinh lỗi React #425 và #422 khi dữ liệu của trang đã được lưu trong tab (mở lại trang, hoặc đôi khi ngay lần đầu sau đăng nhập): `useState(() => readCachedProgress() === null)` đọc `sessionStorage` lúc dựng lần đầu nên nội dung trình duyệt dựng khác nội dung máy chủ dựng. React phải dựng lại cả trang. | Không có lỗi JavaScript. | `ux/01-every-page.spec.ts` |
| BUG-A11Y-LABELS | 14/35 trang có ô nhập hoặc ô chọn không gắn nhãn (131 ô trên máy tính, 317 trên điện thoại), gồm email và mật khẩu ở trang đăng nhập, ô tìm kiếm, ô chọn kỳ, ô chọn chương trình ở danh sách khóa học, ô số ngày ở ma trận bắt buộc. Trình đọc màn hình chỉ đọc "ô nhập". | Mỗi ô có `<label>` hoặc `aria-label`. | `ux/01-every-page.spec.ts` |
| BUG-UX-TOUCH-TARGET | Trên điện thoại nhiều nút nhỏ hơn 24px: "Đổi ban" 55×16 và "Bổ nhiệm LT" 78×16 ở trang chuyển giao (521 nút), nút xóa 22×40 ở danh sách khóa học (102), "Hủy" 23×16 ở lời mời, link "Quên mật khẩu?" cao 16px. | Tối thiểu 24×24px (WCAG 2.2), nên 44px cho thao tác chính. | `ux/01-every-page.spec.ts` |

## Mức Thấp

| Mã | Hiện tượng (đã tái hiện) | Mong đợi | Test |
|---|---|---|---|
| BUG-INVITE-EN | Mời với đơn vị không hợp lệ trả thông báo lỗi tiếng Anh. | Tiếng Việt. | `api/02-invitations.spec.ts` |
| BUG-QUIZ-SCORE-UNIT | `score` ở kết quả nộp bài là điểm thô (180), ở lịch sử lượt làm là phần trăm (90). | Cùng một đơn vị. | `api/05-quiz.spec.ts` |
| BUG-UX-NETWORK-MSG | Mất mạng lúc đăng nhập hiện "Lỗi kết nối: Failed to fetch". | Thông báo hoàn toàn bằng tiếng Việt. | `ux/02-interaction.spec.ts` |
| BUG-UX-LONG-WORD-OVERFLOW | Tên hiển thị chứa một từ 36 ký tự không dấu cách làm trang chủ học viên tràn ngang 144px trên máy tính (tên dài có dấu cách thì không sao). | Từ dài được ngắt dòng hoặc cắt bớt. | `ux/02-interaction.spec.ts` |
| BUG-A11Y-LANDMARK | 5/35 trang không có hoặc có hai vùng `main`: `/leaderboard`, bài học, bài kiểm tra (không có); `/student/stars`, `/chapter-manager/courses` (hai). | Đúng một `main`. | `ux/01-every-page.spec.ts` |
| BUG-A11Y-H1 | Trang bài kiểm tra và trang soạn khóa học không có `h1`. | Đúng một `h1`. | `ux/01-every-page.spec.ts` |
| BUG-UX-PAGE-TITLE | Cả 35 trang cùng tên tab "BBE E-Learning"; mở nhiều tab không phân biệt được. | Tên tab theo trang. | `ux/01-every-page.spec.ts` |
| BUG-UX-TINY-TEXT | 8/35 trang có chữ 9–10px, ví dụ "Khách cũng xem được" (9px), "Chương trình lõi", "Trưởng ban", "Cần làm" (10px). | Tối thiểu 11px. | `ux/01-every-page.spec.ts` |
| BUG-UX-CONTRAST | Màu chữ phụ `#737686` trên nền trang `#f8f9ff` có tỉ lệ tương phản 4,28:1. | Tối thiểu 4,5:1 (WCAG AA). | `src/test/small-lib-modules.test.ts` |
| BUG-YOUTUBE-LIVE-LINK | Link chia sẻ của bản lưu livestream (`youtube.com/live/<id>`) không được nhận diện, dù hệ thống hỗ trợ bản lưu livestream. | Đọc được ID video. | `src/test/youtube-duration.test.ts` |

## Quan sát chưa xếp thành lỗi

- BUG-LB-GUEST-SCOPE (khách xem được bảng xếp hạng kỳ DNA/Chapter) đã đóng là **hành vi chủ đích**, không sửa: chủ sản phẩm quyết định bảng xếp hạng kỳ là một bảng dùng chung, khách và mọi vai đã đăng nhập xem như nhau (Thành viên, LT, DNA, Chapter, lọc theo Chapter bất kỳ), không lộ email. Test ở `api/07-organization.spec.ts` nay kiểm tra hành vi này.
- Bảng lời mời và bảng xếp hạng trên điện thoại nằm trong khung cuộn ngang riêng: không vỡ trang, nhưng phải vuốt ngang để thấy cột cuối.
- Nút "bài tiếp theo" khi còn khóa chỉ trông như bị khóa (màu xám, có `title`), không có thuộc tính `disabled`.
- Chú thích đầu file `src/lib/quiz/import.ts` ghi 8 cột (có "Điểm") trong khi mẫu Google Sheet và mã đọc 7 cột; mã và mẫu khớp nhau, chỉ chú thích cũ.

Số liệu đo từng trang nằm ở `artifacts/e2e/ux-survey-<desktop|mobile>-*.json` sau mỗi lần chạy.
