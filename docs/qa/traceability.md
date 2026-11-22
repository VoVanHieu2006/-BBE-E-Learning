# Bảng đối chiếu quy tắc → test

Chuẩn "đúng ý đồ" là `docs/business-rules.md` và `docs/KHBB.md`. Mỗi dòng dưới đây nối một nhóm quy tắc với test kiểm tra nó trên
ứng dụng thật (bản build production + PostgreSQL tạm `bbe_test_*`, trình duyệt Chromium). Lỗi đã biết: xem [defects.md](defects.md).

## Cách chạy

| Lệnh | Nội dung |
|---|---|
| `npm run test:e2e` | Dựng DB tạm, seed, build, chạy app rồi chạy API → giao diện máy tính → trải nghiệm trên điện thoại |
| `npm run test:e2e -- --project=api` | Chỉ lớp API |
| `E2E_STRICT=1 npm run test:e2e` | Chạy các lỗi đã biết như test thường (đỏ) |
| `npm run test:unit` | Unit test, không cần DB |

`test:e2e` chỉ nhận PostgreSQL loopback có tên `bbe_test_*` và xóa sạch DB đó trước khi chạy.

## Quy tắc nghiệp vụ

| Quy tắc (`business-rules.md`) | Điều được kiểm tra | Test |
|---|---|---|
| Người dùng và tổ chức | Quyền lấy từ chức vụ/đơn vị trong DB ở mỗi request, không tin JWT cũ; Lead Chapter chỉ quản lý Chapter mình; Lead DNA chỉ quản lý DNA; Member không có phạm vi quản lý; chỉ Admin kích hoạt lại tài khoản | `api/07-organization`, `api/08-permission-matrix`, `ui/03-lead-management`, `ui/04-admin-management` |
| Ma trận quyền | 105 file route × 5 vai (Khách, Member, Lead Chapter, Lead DNA, Admin); route mới chưa phân loại làm test đỏ; truy cập chéo Chapter; cron cần secret | `api/08-permission-matrix` |
| Lời mời và tài khoản | Lời mời dùng một lần, hết hạn, đúng email, đúng đơn vị; mời hàng loạt lọc email sai/trùng; link dự phòng khi không gửi được mail; sai mật khẩu 5 lần thì khóa; thông báo không lộ email có tồn tại; đặt lại mật khẩu một lần | `api/01-auth`, `api/02-invitations`, `ui/01-guest-and-account`, `ui/03-lead-management` |
| Nội dung và video | Course → Session → Lesson; nháp không lộ cho khách và học viên; khóa riêng tư không lộ; phải xem hết video, máy chủ tự đo; chặn tua, tốc độ tối đa 2×; không hiện 100% khi chưa đủ; bài sau khóa đến khi xong bài trước | `api/03-courses`, `api/04-video`, `ui/02-member-learning`, `ui/04-admin-management` |
| Quiz và sao | Đạt từ 85%; đề và đáp án chụp lại theo lượt; chờ 2 phút sau khi trượt; sao video `max(1, floor(giây/60))`; sao quiz theo mốc cao nhất, không cộng trùng; trượt không có sao; Admin xem thử không nhận sao; Lead không học | `api/05-quiz`, `api/04-video`, `ui/02-member-learning`, `src/test/lib-data-access.test.ts` |
| Chương trình và deadline (`KHBB.md`) | Một hạn chung; `D_new = max(D_start + T_new, D_change + T_added)`; giảm ngân sách không kéo hạn sớm hơn `D_change + 3 ngày`; quá hạn thì khóa với `OVERDUE_LOCK`; chỉ "Mở khóa & Gia hạn" của Admin mở được, cần lý do; Admin/Lead không bị giao khóa bắt buộc; nội dung chưa xuất bản không gây khóa; lịch sử hạn chế được giữ | `api/06-deadlines`, `ui/04-admin-management`, `ui/01-guest-and-account`, `src/test/duration-calendar-urgency.test.ts` |
| Chapter và bảng xếp hạng | Xếp giảm dần theo sao; bảng thành viên không có Admin/Lead; phạm vi xem theo vai; học viên không thấy email người khác | `api/07-organization`, `ui/02-member-learning`, `ui/03-lead-management` |
| Chuyển giao nhiệm kỳ | Hai cửa sổ 01/01–30/06 và 01/07–31/12; mỗi cửa sổ một lần; chỉ Lead Chapter tạo/áp dụng/hủy, Admin chỉ xem; danh sách phải đủ, không trùng, không người ngoài, tối đa một Chủ tịch; áp dụng xong mở chu kỳ học mới, giữ sao lịch sử; worker cần secret | `api/07-organization`, `ui/04-admin-management` |

## Nhu cầu người dùng (hành trình trên giao diện thật)

| Vai | Hành trình | Test |
|---|---|---|
| Khách | Xem khóa công khai, không thấy khóa riêng tư, xem bài công khai mà không có quiz/tiến độ/sao, bị chặn khỏi 4 khu vực riêng | `ui/01-guest-and-account` |
| Người mới | Mở link mời → đặt mật khẩu (sai, không khớp, sai email) → kích hoạt → link dùng lại bị từ chối | `ui/01-guest-and-account` |
| Học viên | Đăng nhập → khóa học → xem video → nhận sao → làm quiz (đạt, trượt, hủy) → bài sau mở → tải lại vẫn giữ tiến độ → hồ sơ, lịch sử sao, bảng xếp hạng | `ui/02-member-learning` |
| Lead Chapter | Mời một người và mời hàng loạt, hủy lời mời, tìm thành viên, xem tiến độ, vô hiệu hóa (gõ đúng cụm xác nhận), không thấy Chapter khác | `ui/03-lead-management` |
| Lead DNA | Mời vào nhóm LDC/SGDC/TT, bảng xếp hạng DNA, bị đưa ra khỏi khu vực Chapter/Admin | `ui/03-lead-management` |
| Admin | Tạo/xuất bản/hạ nháp/xóa khóa, ma trận khóa bắt buộc, tìm người dùng, mở khóa quá hạn và gia hạn, vô hiệu hóa/kích hoạt lại, mùa chuyển giao | `ui/04-admin-management` |

## Trải nghiệm (máy tính 1280px và điện thoại Pixel 7)

| Tiêu chí | Cách đo | Test |
|---|---|---|
| 35 trang của 5 vai tải không lỗi JavaScript, không request lỗi máy chủ | Crawl từng trang, nghe `pageerror`, `console.error`, phản hồi ≥ 500 | `ux/01-every-page` |
| Không cuộn ngang; khai báo tiếng Việt; không lộ `undefined`/`NaN`/`null` | Đo `scrollWidth`, đọc mọi đoạn chữ đang hiện | `ux/01-every-page` |
| Nút/đường dẫn có tên, ảnh có mô tả, ô nhập có nhãn, một `main`, một `h1`, tên tab, cỡ chữ, vùng chạm | Đo trên DOM đã dựng | `ux/01-every-page` |
| Dùng được bằng bàn phím; thấy viền focus; hộp thoại giữ focus, Esc đóng và trả focus | Gõ phím thật | `ux/02-interaction` |
| Mạng chậm: nút khóa, ghi "Đang xác thực", bấm đúp không gửi hai lần; có trạng thái đang tải | Làm chậm request 1,5–2,5 giây | `ux/02-interaction` |
| Mất mạng / máy chủ lỗi / phiên hết hạn: báo lỗi tiếng Việt, giữ dữ liệu đã nhập, về trang đăng nhập | Chặn hoặc giả lỗi request | `ux/02-interaction` |
| Điện thoại: menu mở/đóng đúng; màn 320px không tràn; tên dài không vỡ bố cục | Viewport Pixel 7 và 320px | `ux/02-interaction` |

## Unit test bổ sung cho `src/lib`

| Module | Test |
|---|---|
| `quiz/import` (link Google chống SSRF, CSV, đọc câu hỏi, lỗi theo dòng) | `src/test/quiz-import.test.ts` |
| `youtube/duration` (tách ID, không bịa thời lượng, livestream, phân biệt "không tồn tại" và "lỗi mạng") | `src/test/youtube-duration.test.ts` |
| `validation/duration`, `vietnam-calendar`, `deadline-urgency` | `src/test/duration-calendar-urgency.test.ts` |
| `departments`, `invitation-link`, `design`, `member-leaderboard-cache`, `organization-view-cache`, `clipboard`, `audio-effects` | `src/test/small-lib-modules.test.ts` |
| `stars`, `inactive-member-access`, `active-chapters`, `progress/completed-lesson-counts`, `final-exam-bank`, `final-exam-version`, `account-retirement`, `normalize-learning-organization` | `src/test/lib-data-access.test.ts` |

## Chưa kiểm tra được tự động

- Upload thật lên Cloudflare R2 và Cloudinary, gửi mail thật qua Resend, trình phát YouTube thật (test dùng trình phát giả lập và nhánh dự phòng "copy link mời").
- Cảm nhận chủ quan (đẹp, dễ hiểu) ngoài các số đo ở trên; cần người dùng thử.
- Trình duyệt Safari/Firefox và trình đọc màn hình thật.
