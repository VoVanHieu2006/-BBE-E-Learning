# Triển khai tư cách Chapter và DNA độc lập

## Cấu trúc đã chốt

- Một tài khoản có thể đồng thời thuộc một Chapter/Ban và một nhóm DNA.
- DNA có ba nhóm `TT`, `LDC`, `SGDC`; cả ba do Lead DNA quản lý.
- DNA có hai vị trí nghiệp vụ: Lead DNA và Thành viên DNA.
- Thành viên DNA được học, làm bài kiểm tra và nhận sao ở nội dung Thành viên, LT và DNA.
- Người từng là LT giữ quyền học, thi và nhận sao với nội dung LT sau khi hết nhiệm kỳ.

## Trạng thái và đăng nhập

- Admin dùng `User.status` để khóa hoặc mở toàn bộ tài khoản.
- Lead Chapter kết thúc membership trong cây Chapter; tư cách DNA không bị ảnh hưởng.
- Lead DNA kết thúc membership trong cây DNA; tư cách Chapter không bị ảnh hưởng.
- Tài khoản không phải Admin chỉ đăng nhập được khi còn ít nhất một membership hoặc nhiệm kỳ quản lý đang hoạt động.
- Nếu cả Chapter và DNA đều kết thúc, đăng nhập bị từ chối. Admin khóa thì bị từ chối ngay dù còn membership.

## Khóa học bắt buộc và quyền tích lũy

- Khi một learning rule không còn áp dụng, assignment được chuyển thành không bắt buộc và bỏ hạn hoàn thành.
- Quyền xem, thi và nhận sao đã đạt được vẫn được giữ.
- Khi rule áp dụng trở lại, khóa đã hoàn thành vẫn được công nhận và không tạo đếm ngược mới.
- Khóa chưa hoàn thành được giao lại theo vai trò hiện tại và nhận hạn mới.

## Tài khoản kiểm tra

- Email: `dna.member.demo@bbe.vn`
- Mật khẩu: `Demo@123456`
- Chapter: `Chapter Demo`
- Ban: `Ban Nội dung`
- DNA: `DNA Điều hành`
- Nhóm DNA: `TT`
- Vị trí DNA: `Thành viên DNA`

Hồ sơ cá nhân, danh sách Admin và danh sách của Lead hiển thị riêng Chapter, Ban, vị trí và nhóm DNA.
