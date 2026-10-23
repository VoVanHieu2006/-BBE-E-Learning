# Kết quả triển khai Organization, ngân hàng đề và dữ liệu demo

## Việc người vận hành cần làm

1. Hai Google Sheet phải bật **Bất kỳ ai có liên kết – Người xem**.
2. Sheet phân Ban dùng mỗi ô theo mẫu **Họ tên (email@domain.com)**. Tên cột phải trùng tên Ban trong hệ thống. Người đầu tiên dưới mỗi cột là LT.
3. Chọn ngày giờ hiệu lực khi Lead Chapter xác nhận danh sách cuối nhiệm kỳ.
4. Thêm biến Vercel CLOUDINARY_FOLDER=course-covers và redeploy.

## Cloudinary và R2

- Cloudinary lưu ảnh bìa khóa học.
- R2 lưu tài liệu bài học.
- Hai dịch vụ có nhiệm vụ khác nhau nên hiện tại giữ cả hai.
- Code chỉ dùng CLOUDINARY_CLOUD_NAME ở server. Không cần NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME.
- CLOUDINARY_FOLDER là tùy chọn vì code có mặc định course-covers, nhưng đã thêm vào .env và .env.example để cấu hình rõ ràng.

### Thêm vào Vercel

Repository hiện chưa có .vercel/project.json, vì vậy chưa thể cập nhật tự động đúng project. Trong Vercel:

1. Chọn Project.
2. Vào **Settings → Environment Variables**.
3. Thêm Name CLOUDINARY_FOLDER, Value course-covers.
4. Chọn Production, Preview và Development.
5. Save rồi Redeploy.

## Dữ liệu demo

Seed an toàn npm run db:seed-demo chỉ bổ sung/cập nhật dữ liệu, không xóa database. Database hiện có 13 khóa học và 5 tài khoản kiểm tra:

| Vai trò hiệu lực | Email |
|---|---|
| Admin | admin.demo@bbe.vn |
| Lead DNA | dna.lead.demo@bbe.vn |
| Lead Chapter | chapter.lead.demo@bbe.vn |
| LT Ban | department.lead.demo@bbe.vn |
| Thành viên | member.demo@bbe.vn |

Lead DNA và LT Ban có role nền MEMBER; quyền quản lý đến từ chức vụ, đơn vị, permission và nhiệm kỳ đang hiệu lực.

Ba ảnh bìa tạo bằng ImageGen nằm trong public/images/course-covers. Các khóa học demo tham chiếu ảnh local nên không phụ thuộc hotlink.

## Phân Ban cuối nhiệm kỳ

- Có trang nhập Google Sheet trong workspace của người quản lý Chapter.
- Parser tách tên và email trong ngoặc, đối chiếu bằng email.
- Phát hiện tài khoản chưa tồn tại, email lặp ở nhiều Ban và tên cột không khớp.
- Hiển thị bản xem trước theo Ban.
- Người đầu tiên của mỗi cột được gán DEPARTMENT_LEAD.
- Khi đến ngày hiệu lực, hệ thống cập nhật tên hiển thị, membership Ban, nhiệm kỳ LT và tính lại lộ trình học.
- Thành viên tự sửa tên tại **Hồ sơ cá nhân**; Admin/Lead Chapter có API sửa tên trong phạm vi quản lý.

## Ngân hàng đề

- Link Sheet có các tab liên tiếp Nhóm 1, Nhóm 2, … được nhập thành các question pool.
- Admin cấu hình số câu mỗi lượt và tổng thời gian.
- Thuật toán chia số câu đều giữa các nhóm; phần dư được phân từ nhóm đầu, thiếu câu sẽ bù từ nhóm còn khả năng.
- Ví dụ 5 nhóm, mỗi nhóm 20 câu, cấu hình 10 câu sẽ lấy 2 câu mỗi nhóm.
- Câu hỏi trong form Admin được thu gọn, ghi rõ nhóm và nội dung tóm tắt.
- Attempt lưu danh sách câu đã chọn trong attempt_questions, nên tải lại không đổi đề và không hiện đáp án từ attempt cũ.

## Điều hướng

- Nhãn kỹ thuật ORG đã đổi thành tên dễ hiểu.
- Admin có lối tắt rõ cho Cơ cấu, Thành viên, Khóa học và Vận hành.
- Người quản lý DNA/Chapter/Ban dùng mục **Đội ngũ phụ trách**, chỉ thấy phạm vi được bổ nhiệm.
- Các layout Admin, Lead Chapter, Lead DNA và thành viên có transition khi đổi route cùng loading skeleton; Sidebar không bị remount trong lúc chuyển tab.

## Phân cấp quản lý đã chốt

- Admin quản lý tài khoản, bổ nhiệm Lead DNA và Lead Chapter.
- Lead Chapter quản lý roster trong đúng Chapter, bao gồm LT Ban và thành viên thường. Việc đổi Ban/LT được xác nhận qua quy trình phân Ban cuối nhiệm kỳ.
- Lead DNA quản lý membership của DNA qua quyền MANAGE_DNA_MEMBERS.
- Email là duy nhất trong bảng users.
- Mỗi user chỉ được có một ChapterMembership trên toàn hệ thống; database có unique constraint theo user_id và API trả lỗi rõ ràng nếu cố thêm sang Chapter khác.
- Membership DNA độc lập với Chapter, vì vậy một thành viên hoặc LT của Chapter vẫn có thể đồng thời thuộc DNA hoặc trở thành Lead DNA.
