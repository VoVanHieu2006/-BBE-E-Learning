# Prompt 08 — Sửa lỗi sau kiểm thử trang thật (11/11/2026)

Nguồn: kiểm thử bằng trình duyệt trên https://bbeelearning.vercel.app với ba vai ADMIN, LEAD chapter, MEMBER (commit `f58d4b4`). Đọc `docs/prompts/00-quy-tac-chung.md` trước. Không đụng DB thật.

## Việc cần làm

| # | Việc | Vị trí | Cách sửa gọn nhất | Trạng thái |
|---|---|---|---|---|
| 1 | Nhãn lặp "Ban Ban Khách Mời" ở trang khóa học học viên | `src/app/student/courses/page.tsx` dòng 311 và 313 | Tên đơn vị đã có chữ "Ban" nên bỏ tiền tố `Ban ` trong hai chuỗi mẫu. Kiểm tra tên Chủ tịch/DNA (không có chữ "Ban") vẫn hiển thị đúng. | Chờ sửa |
| 2 | Lời chào dashboard học viên dùng phần đầu email ("Chào mừng, vobahoaan") thay cho tên hiển thị | `src/app/student/dashboard/page.tsx` | Dùng tên hiển thị; khi chưa đặt tên thì dùng "Chưa cập nhật tên" như trang quản lý, hoặc tên vui mặc định (`funDisplayName`), tuyệt đối không dùng email. | Chờ sửa |
| 3 | Từ "Công khai" lẫn nghĩa xuất bản và nghĩa khách được xem (KHBB mục 9, dòng 21) | `src/app/admin/courses/page.tsx:579` (nút `Công khai` thực chất là xuất bản); nhãn chế độ xem ở `admin/courses/page.tsx:519`, `student/courses/[courseId]/page.tsx:122`, `admin/courses/new/page.tsx:116`, `admin/courses/[courseId]/edit/CourseInfo.tsx:109` | Nút xuất bản đổi thành `Xuất bản`. Nhãn chế độ xem đổi rõ nghĩa thành "Khách cũng xem được" / "Chỉ thành viên BBE" (hoặc chữ chủ sản phẩm chọn), không dùng "Công khai/Public" để chỉ trạng thái. Không đổi giá trị `visibility` trong DB. | Chờ sửa, chủ sản phẩm đã duyệt đổi |
| 4 | Trang `/admin/organization` chỉ là redirect sang `/admin/invitations`, không có trong menu | `src/app/admin/organization/page.tsx` | **Đã xóa file trong working tree (chưa commit).** API `/api/v1/admin/organization` không liên quan, giữ nguyên. | Xong, chờ commit |
| 5 | `/admin/learning-config` còn giao diện chương trình cũ ("Chương trình học cho Thành viên/LT/DNA", mốc 70%) | `src/app/admin/learning-config/page.tsx`, `src/components/learning/ProgramCourseTree.tsx` | **ĐÃ XÓA 11/11/2026 theo duyệt của chủ sản phẩm:** hai trang `learning-config`, `learning-policy` và test liên quan được sửa; API giữ để rollback. Phần dưới là lý do cũ (không còn đúng). KHBB mục 9 dòng 13 và `operations.md` mục release1 ghi rõ trang này vẫn cần, không xóa. Nó còn là chỗ duyệt gán khóa vào chương trình mà trang học viên (`Lộ trình theo Chương trình`) đang dựa vào; xóa sẽ làm hỏng nhóm khóa ở trang học viên. Chỉ xóa được khi release2 được duyệt: gỡ UI chương trình, `ProgramCourseTree`, API `/api/v1/admin/learning-config` và alias, rồi mới drop bảng. | Xong, chờ commit |

## Không phải lỗi (đã chốt)

- Thành viên chưa có ban: hợp lệ; cột ban/đơn vị hiện "—" là đúng tính năng.
- Tài khoản test trên DB thật (`test.member.dept.…@bbe.vn`, "TÀI KHOẢN FAKE"): chủ sản phẩm cho phép dùng để thử.

## Kiểm tra sau khi sửa

`npx tsc --noEmit`, `npm run test:unit`, rồi mở lại `/student/courses`, `/student/dashboard`, `/admin/courses` (xuất bản/hạ về nháp) và `/admin/organization` (phải 404, không lỗi build). Kịch bản kiểm thử khóa bắt buộc: `docs/report/kich-ban-kiem-thu-khoa-bat-buoc.md`.
