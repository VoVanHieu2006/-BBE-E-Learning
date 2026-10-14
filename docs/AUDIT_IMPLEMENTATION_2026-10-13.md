# Audit triển khai E-learning — 13/10/2026

## Kết luận

Hệ thống đã có phần lớn luồng học, quản trị tiến độ, sao, KPI, đề kiểm tra và khóa học công khai. Tuy nhiên **chưa thể coi là hoàn thành toàn bộ yêu cầu ban đầu**. Các phần thiếu nằm ở vận hành chuyển Ban/LT bằng Google Sheet, seed dữ liệu demo đủ phong phú, và cấu hình Cloudinary cho upload ảnh bìa.

| Trạng thái | Ý nghĩa |
| --- | --- |
| Hoàn thành | Có giao diện/API và luồng thực thi phù hợp yêu cầu. |
| Một phần | Có nền tảng hoặc API nhưng còn thiếu trải nghiệm vận hành, kiểm thử tích hợp, hay một điều kiện cấu hình. |
| Chưa hoàn thành | Chưa có giao diện/luồng thực thi cần thiết. |

## Kết quả kiểm thử

- `npm run test:business-rules`: **56/56** kiểm thử đạt.
- `npx tsc --noEmit -p tsconfig.check.json`: đạt.
- Migration `20261014_learning_governance` đã được áp dụng trong lần triển khai trước; migration thêm KPI `BLACK`, `question_pools.draw_count` và dữ liệu tái cơ cấu Chapter.
- Production build đã từng đạt trước đó sau khi sửa `postinstall` chạy `prisma generate`. Vercel phải cài dependencies bình thường để script này sinh Prisma Client.

Các kiểm thử hiện chủ yếu là unit/business-rule. Chưa có test trình duyệt end-to-end cho các quyền Admin/Chapter/DNA, Google Sheet tái cơ cấu, hoặc upload Cloudinary.

## Đối chiếu yêu cầu nghiệp vụ

| Yêu cầu | Trạng thái | Cách hoạt động hiện tại | Điều còn thiếu / lưu ý |
| --- | --- | --- | --- |
| Admin xem tới từng bài học | Hoàn thành | Admin Users có modal chi tiết; Admin Chapter có nút **Lộ trình học**; API trả khóa → buổi → bài → video/test/sao. | Cần kiểm thử thủ công với dữ liệu thực tế của từng Chapter. |
| Trưởng Chapter / Lead DNA chỉ xem phạm vi mình quản lý | Một phần | API Chapter và Organization kiểm tra scope bằng `PositionAssignment` + `Permission`; Lead DNA có thể dùng trang Organization Manager. | Chưa có màn hình/role preset riêng, rõ ràng cho “Lead DNA”; quản trị viên phải tự tạo Position và Permission. |
| Xem 100% mới hoàn thành | Hoàn thành | Quy tắc video dùng thời lượng thật, không dùng ngưỡng 85%. | Cần video có `duration_seconds` hợp lệ. |
| Khóa theo từng bài | Hoàn thành | Video bài trước phải đủ, test bài trước phải đạt mới mở bài tiếp theo; test cuối khóa chỉ mở khi các bài trong khóa hoàn tất. | Một vài thông báo cũ còn dùng từ “module”, nên chỉ là lỗi câu chữ, không đổi logic. |
| Sao video | Hoàn thành | Chỉ ghi sổ khi xem xong; `max(1, floor(durationSeconds / 60))`: 0:30 = 1★, 2:59 = 2★, 3:00 = 3★, 9:00 = 9★. | Video dài có số sao cao; đây là công thức đã chốt, không còn giới hạn 5★. |
| Sao test và hiệu ứng nhận sao | Hoàn thành | Điểm quiz/final được quy đổi sao; mỗi reward có `reward_key` duy nhất để không cộng lặp; có `StarRewardCelebration`. | Cần kiểm tra cảm nhận giao diện trên điện thoại. |
| Ngân hàng đề/test cuối khóa | Hoàn thành | Mỗi Assessment có Question/Option; final exam dùng 5 pool, lấy ngẫu nhiên 3 câu/pool, tổng 15; danh sách câu được lưu theo Attempt. Google Sheet/Doc hiện hỗ trợ nhập ngân hàng đề. | `draw_count` đã tồn tại trong schema nhưng thuật toán final vẫn cố định 3 câu mỗi pool, chưa dùng để tùy biến số câu. |
| Sửa lỗi lưu đáp án cũ | Hoàn thành ở mức mã | Attempt đang làm dở được tiếp tục với đúng câu/đáp án đã lưu; attempt mới lưu `AttemptQuestion`, đáp án lưu `AttemptAnswer`. | Chưa có test E2E thật cho refresh trình duyệt và nhiều tab. |
| Vai trò DNA/Chapter/Ban/LT | Một phần | Có OrganizationUnit (DNA/CHAPTER/DEPARTMENT), Position, PositionAssignment, Permission và LearningRule theo đơn vị/chức vụ. | Chưa có bộ role mẫu tự động và luồng cấu hình thân thiện dành riêng cho DNA Lead, LT Ban và thành viên Ban. |
| Chuyển Ban/LT theo lịch | Một phần | Có bảng `chapter_reorganizations`, API tạo/lấy lịch, cron chạy 00:05 giờ Việt Nam và tái tính lộ trình học sau áp dụng. | **Chưa có UI nút lập lịch, import Google Sheet, preview lỗi/dữ liệu trước-sau, hủy lịch.** API hiện nhận các dòng đã được chuẩn hóa bằng `userId`, `departmentUnitId`, `positionId`; chưa tự đọc Sheet. |
| Khóa tài khoản quá hạn | Hoàn thành nền tảng | Đã có LearningRule với `due_days`, UserLearningAssignment, deadline cron, AccessRestriction; chỉ Admin mở restriction. | Cần cấu hình rule theo role/đơn vị và kiểm tra cron trên Vercel bằng `CRON_SECRET`. |
| KPI Đen/Đỏ/Vàng/Xanh | Hoàn thành | Admin chọn đủ 4 màu; Black/Red bị loại BXH, Yellow không bonus, Green bonus. Lịch sử KPI hiển thị người và thời gian cập nhật. | — |
| BXH Chapter | Một phần | Điều kiện: ≥20 thành viên, ≥50% thành viên hoàn thành ≥70%, KPI Yellow/Green. Trọng số 30% tiến độ, 30% sao, 20% KPI, 20% quy mô; quy mô đạt trần ở 30 người. | `updatedAt` là thời điểm API tính lại và cache tối đa 30 giây, chưa phải thời điểm thay đổi dữ liệu bền vững trong DB. |
| Trang chủ/carousel/ảnh khóa học | Một phần | Có trang chủ công khai, carousel tự chạy, ảnh bìa và ảnh fallback; list khóa học đã hiển thị ảnh. | Seed chỉ thêm ảnh mặc định cho các khóa đã có; **chưa thêm vài khóa mới**. Chạy `db:seed` hiện xóa toàn bộ dữ liệu trước khi tạo lại. |
| Khóa học công khai cho khách | Hoàn thành | Khách xem khóa `PUBLIC` đã `PUBLISHED`; API lesson trả video, không trả quiz/tài liệu. Không lưu tiến độ, sao hoặc cho làm test. | Khách có thể mở mọi video trong khóa public; đây là hành vi xem thử, không áp dụng thứ tự học của thành viên. |
| CTA/trải nghiệm trang chủ | Hoàn thành | Heading có line-height và khoảng cách lớn hơn; CTA nền trắng dùng chữ navy; nút xem khóa học và đăng nhập đã đổi nội dung/đích đến. | Nên review trực quan trên mobile sau deploy. |

## Luồng thực tế hiện tại

### Khách chưa đăng nhập

1. Vào trang chủ hoặc `/student/courses`.
2. Chỉ thấy khóa `PUBLIC` và `PUBLISHED`, có ảnh bìa.
3. Mở khóa và video công khai được phát.
4. Không tải tài liệu, không làm quiz, không lưu vị trí xem, không nhận sao.
5. CTA “Đăng nhập để xem nhiều khóa học hơn và lưu tiến độ” đưa tới `/login`.

### Thành viên

1. Nhận khóa học từ LearningRule/assignment theo đơn vị và chức vụ.
2. Mở bài học đầu tiên; video hoàn thành 100% mới đủ điều kiện làm test bài đó.
3. Qua test mới mở bài tiếp theo.
4. Sau tất cả bài học/test bài học, mở test cuối khóa.
5. Tiến độ, attempt và sao được ghi vào database.

### Quản trị

1. Admin quản lý ảnh bìa trong trang sửa khóa học.
2. Admin/Chapter/DNA manager xem tiến độ theo phạm vi quyền.
3. Admin cập nhật KPI tháng và xem lịch sử cập nhật.
4. Hệ thống cron áp dụng deadline và lịch tái cơ cấu đã được tạo qua API.

## Cấu hình cần sửa hoặc xác nhận

### Cloudinary

Upload ảnh bìa hiện đọc `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

File `.env` của bạn mới được xác nhận có `CLOUDINARY_CLOUD_NAME`. Vì vậy cần thêm:

```env
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=<giá trị CLOUDINARY_CLOUD_NAME>
CLOUDINARY_FOLDER=course-covers
```

Hoặc sửa code để server dùng `CLOUDINARY_CLOUD_NAME` thay vì biến public. Nếu không thêm biến này, Admin sẽ nhận `CloudinaryNotConfigured` khi upload ảnh bìa.

### Cron Vercel

Hai endpoint cron cần `CRON_SECRET` trên Vercel:

- `/api/internal/learning/deadlines/enforce`
- `/api/internal/organization/reorganizations/apply`

## Việc nên làm tiếp để đạt 100%

1. Xây UI lập lịch đổi Ban/LT cho Trưởng Chapter: nhập URL Google Sheet, template tải xuống, preview, lỗi từng dòng, xác nhận/hủy lịch và audit.
2. Chỉnh Cloudinary env/code, sau đó kiểm thử upload ảnh bìa thật.
3. Bổ sung ít nhất 3 khóa demo có ảnh khác nhau bằng seed **không xóa dữ liệu hiện có**, hoặc seed riêng cho môi trường development.
4. Thêm test E2E cho khách xem video public, upload ảnh, permission DNA/Chapter, khóa deadline và áp dụng lịch chuyển Ban/LT.
5. Đổi các chữ “module” còn sót thành “Buổi học”.
