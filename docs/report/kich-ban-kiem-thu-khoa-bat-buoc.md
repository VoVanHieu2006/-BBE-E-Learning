# Kịch bản kiểm thử khóa bắt buộc, hạn học và khóa quá hạn

Mục đích: kiểm các phần trang thật chưa thử được ngày 11/11/2026 (khóa nháp bị khóa ô tick, hạn/đếm ngược, nhãn "Mới", "Mở khóa & Gia hạn", nhãn nhóm học theo mã). Đối chiếu `docs/KHBB.md` mục 4, 5, 7, 9.

## Môi trường: chạy trên DB local, không chạy trên DB thật

Lý do: cần tạo tài khoản và "tua thời gian" (đưa hạn về quá khứ rồi chạy cron khóa quá hạn). Hai việc đó ghi vào hạn và trạng thái khóa của người thật nếu làm trên https://bbeelearning.vercel.app. Dùng DB loopback `bbe_test_*` (`TEST_DATABASE_URL`, xem `docs/testing.md`), chạy app local ở cổng test, nạp seed/fixture. Cron: `/api/internal/learning/deadlines/enforce`. Tua thời gian = sửa mốc hạn của nghĩa vụ trong DB local về quá khứ rồi gọi cron.

Trên trang thật chỉ làm các bước A (tick khóa đang có) khi chủ sản phẩm đã đồng ý, vì tick khóa bắt buộc tạo hạn cho mọi thành viên thuộc nhóm được tick.

## Dữ liệu cần dựng (local)

- 1 ADMIN, 1 LEAD chapter, 3 MEMBER: M1 (Ban Khách Mời), M2 (Ban Thư Ký), M3 (chưa có ban).
- Khóa C1 đã xuất bản (khóa hiện có, nhiều bài) và khóa C2 ở trạng thái bản nháp (tạo mới, một buổi một bài).

## Kịch bản

| # | Vai | Thao tác | Kết quả mong đợi |
|---|---|---|---|
| A1 | ADMIN | Vào ma trận bắt buộc; xem hàng C2 (nháp) | Ô tick của C2 bị khóa kèm lời giải thích; hàng C1 tick được. |
| A2 | ADMIN | Nhập 20 ngày cho hàng C1, tick cột "Ban Khách Mời", bấm Lưu | Lưu được; M1 có nghĩa vụ C1 hạn 20 ngày từ lúc tick; M2, M3 không có. |
| A3 | ADMIN | Xem nhãn nhóm | Đúng 18 nhóm: `DEPARTMENT_MEMBER_*`, `DEPARTMENT_LEAD_*`, `PRESIDENT`, `DNA_MEMBER_TT/SGDC/LDC`; ban Định Hướng là `BDHU`. Ghi lại nếu UI chỉ hiện tên tiếng Việt. |
| B1 | M1 | Mở `/student/courses` | Thẻ C1 hiện hạn và đếm ngược đúng; M2 và M3 không có đếm ngược. |
| B2 | ADMIN | Thêm một bài vào C1 | M1: hạn tính lại từ lúc thêm (KHBB mục 9 dòng 10); bài mới có nhãn "Mới", không chặn bài sau (dòng 11). |
| B3 | ADMIN | Thêm quiz vào bài M1 đã xong | Bài vẫn xong, quiz có nhãn "Mới", không hiện "Quiz đạt" sai (dòng 12). |
| B4 | ADMIN | Đổi thứ tự bài trong C1 (không xóa bài) | Tiến độ M1 không sai; bài đã xong vẫn xong. |
| C1 | LEAD | Đăng nhập, xem dashboard và bảng xếp hạng | Không có khóa bắt buộc hay đếm ngược; không email người khác. |
| C2 | LEAD | Mời thành viên mới | Bắt buộc chọn ban; nút gửi mờ khi chưa chọn. |
| D1 | (tua) | Đưa hạn của M1 về quá khứ; gọi cron enforce | M1 bị khóa quá hạn; ADMIN và LEAD không bị khóa (dòng 2). |
| D2 | ADMIN | Trang người dùng | "Mở khóa & Gia hạn" chỉ hiện với M1; không hiện với M2, M3 và tài khoản Inactive (dòng 14). |
| D3 | ADMIN | Bấm "Mở khóa & Gia hạn", nhập N ngày | Hạn mới = hôm nay + N; M1 vào lại được (dòng 14). |
| D4 | ADMIN | Hủy xuất bản C1 | Hạn M1 tạm dừng, M1 không bị khóa vì khóa không mở được (dòng 16). Xuất bản lại thì như thêm lại. |
| E1 | ADMIN | Mở khóa đã xuất bản, sửa tiêu đề, xem trạng thái | Có bản nháp thay đổi; "Cập nhật khóa học" áp dụng; không bắt hạ về nháp (dòng 15). |
| E2 | ADMIN | Gỡ khóa C1 khỏi M1, thêm lại trong 3 ngày | Hạn về đúng hạn cũ (dòng 20); còn khóa khác thì sàn 3 ngày (dòng 8). |
| F1 | M1 | Bảng xếp hạng tháng và nhiệm kỳ | Không email; tên đặt hoặc tên vui; dòng của M1 có nhãn "Bạn". |

## Ghi chú

- Mỗi dòng chạy được trên local thì ghi PASS/FAIL kèm ảnh chụp hoặc nội dung trang vào `docs/report/`.
- Bước D1 cần tạo tài khoản và đổi hạn: không làm trên DB thật.
- Các dòng B2-B4, D4, E2 có thể đã FAIL theo bảng "Code hiện tại" cũ của KHBB mục 9; kiểm trước khi kết luận lỗi.
