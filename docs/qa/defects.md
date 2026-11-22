# Danh sách lỗi tìm được khi kiểm thử (QA)

Mỗi lỗi dưới đây có một test tự động mô tả **hành vi đúng theo tài liệu/ý đồ sản phẩm**. Test đó hiện đang đỏ có chủ đích
(Playwright: `test.fail`, unit: `todo`), nên bộ test vẫn chạy xanh. Khi lỗi được sửa, test sẽ báo "passed unexpectedly":
lúc đó bỏ đánh dấu lỗi trong test và xóa dòng tương ứng ở đây. Chạy `E2E_STRICT=1 npm run test:e2e` để thấy các lỗi này đỏ như test thường.

Bộ test **không sửa mã ứng dụng**. Mức độ: **Cao** = sai nghiệp vụ/bảo mật hoặc chặn một luồng chính; **Trung bình** = người dùng bị
hiểu sai hoặc phải làm thừa; **Thấp** = khó chịu nhỏ, chuẩn accessibility.

## Mức Cao

| Mã | Hiện tượng (đã tái hiện) | Mong đợi | Test |
|---|---|---|---|
| BUG-INVITE-LEAD-500 | Admin mời Lead cho một Chapter mới luôn nhận lỗi 500 (vi phạm ràng buộc `invitations_exactly_one_scope_check`); trên giao diện không có lời mời nào được tạo. | Lời mời được tạo, người nhận kích hoạt thành LEAD của đúng Chapter. | `api/02-invitations.spec.ts`, `ui/04-admin-management.spec.ts` |
| BUG-LB-GUEST-SCOPE | Khách chưa đăng nhập gọi được bảng xếp hạng kỳ của DNA/Chapter mà thành viên đã đăng nhập bị 403. | Khách không được xem nhiều hơn thành viên. | `api/07-organization.spec.ts` |

## Mức Trung bình

| Mã | Hiện tượng (đã tái hiện) | Mong đợi | Test |
|---|---|---|---|
| BUG-STALE-AFTER-RELOAD | Danh sách (ví dụ lời mời) được lưu trong `sessionStorage` tới 120 giây (`src/lib/api/client.ts`) và trang không yêu cầu dữ liệu mới khi tải lần đầu. Người được mời đã kích hoạt, Lead bấm F5 vẫn thấy "Đang chờ" và nút Hủy. | F5 luôn hiện dữ liệu mới. | `ui/03-lead-management.spec.ts` |
| BUG-PROFILE-500 | Admin sửa tên của tài khoản không tồn tại nhận lỗi 500. | 404. | `api/08-permission-matrix.spec.ts` |
| BUG-MOVE-SESSION-MSG | Thành viên bị chuyển ban: phiên cũ nhận thông báo như tài khoản bị vô hiệu hóa. | Thông báo tiếng Việt yêu cầu đăng nhập lại. | `api/07-organization.spec.ts` |
| BUG-UI-HYDRATION-TRANSFER | Trang `/admin/transfer-seasons` sinh lỗi React #425 và #422 khi dữ liệu của trang đã được lưu trong tab (mở lại trang, hoặc đôi khi ngay lần đầu sau đăng nhập): `useState(() => readCachedProgress() === null)` đọc `sessionStorage` lúc dựng lần đầu nên nội dung trình duyệt dựng khác nội dung máy chủ dựng. React phải dựng lại cả trang. | Không có lỗi JavaScript. | `ux/01-every-page.spec.ts` |

## Mức Thấp

| Mã | Hiện tượng (đã tái hiện) | Mong đợi | Test |
|---|---|---|---|
| BUG-INVITE-EN | Mời với đơn vị không hợp lệ trả thông báo lỗi tiếng Anh. | Tiếng Việt. | `api/02-invitations.spec.ts` |
| BUG-QUIZ-SCORE-UNIT | `score` ở kết quả nộp bài là điểm thô (180), ở lịch sử lượt làm là phần trăm (90). | Cùng một đơn vị. | `api/05-quiz.spec.ts` |
| BUG-YOUTUBE-LIVE-LINK | Link chia sẻ của bản lưu livestream (`youtube.com/live/<id>`) không được nhận diện, dù hệ thống hỗ trợ bản lưu livestream. | Đọc được ID video. | `src/test/youtube-duration.test.ts` |

## Quan sát chưa xếp thành lỗi

- Bảng lời mời và bảng xếp hạng trên điện thoại nằm trong khung cuộn ngang riêng: không vỡ trang, nhưng phải vuốt ngang để thấy cột cuối.
- Nút "bài tiếp theo" khi còn khóa chỉ trông như bị khóa (màu xám, có `title`), không có thuộc tính `disabled`.
- Chú thích đầu file `src/lib/quiz/import.ts` ghi 8 cột (có "Điểm") trong khi mẫu Google Sheet và mã đọc 7 cột; mã và mẫu khớp nhau, chỉ chú thích cũ.

Số liệu đo từng trang nằm ở `artifacts/e2e/ux-survey-<desktop|mobile>-*.json` sau mỗi lần chạy.
