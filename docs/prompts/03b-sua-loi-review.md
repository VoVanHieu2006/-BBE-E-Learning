# Prompt 03b — Sửa các lỗi review chéo của prompt 03

Đọc `docs/prompts/00-quy-tac-chung.md`, `docs/prompts/00b-worker-ngoai.md` (worktree này có `node_modules` riêng, được chạy `npx prisma generate`; không migrate/db push/install/DB thật ngoài DB thử nêu dưới), `HANDOFF.md`. Nhánh `feat/p03-vai-tro`. Commit checkpoint lên nhánh (không push).

Reviewer chéo (Qoder Ultimate, đã thử migration trên PostgreSQL thật) kết luận chưa nên duyệt. Các mục **7 và 12 đã sửa** (commit `ab5e3e2`); làm các mục còn lại **1-6, 8-11, 13**, mỗi mục có test, sau mỗi mục chạy `npx tsc --noEmit` và cập nhật `HANDOFF.md`.

## Quyết định nghiệp vụ của chủ sản phẩm
- **(A)** Mỗi Chapter chỉ có 1 `PRESIDENT`. Khi bổ nhiệm người khác làm `PRESIDENT` thì `PRESIDENT` hiện tại bị kết thúc chức vụ và trở thành thành viên Chapter **không ban** (không có chức vụ ban, không có nhóm học theo ban, không bị gán khóa bắt buộc theo ban). Đây là trạng thái hợp lệ của quy tắc "một chức vụ".
- **(B)** KHÔNG có tính năng lên lịch bổ nhiệm/đổi ban cho tương lai. Chỉ chuyển giao nhiệm kỳ mới đổi ban và nó áp dụng theo danh sách chuyển giao. Chuyển giao phải đơn giản **THAY THẾ toàn bộ**: lúc áp dụng đóng MỌI hàng position/membership còn hiệu lực HOẶC có ngày bắt đầu/kết thúc trong tương lai của người đó trong Chapter (không chỉ `ends_at IS NULL`), rồi tạo bố trí mới. Bổ nhiệm/đổi ban qua API luôn có hiệu lực ngay (`starts_at = now`), bỏ qua hoặc từ chối ngày tương lai.

## Danh sách lỗi
1. **NGHIÊM TRỌNG** `src/lib/chapter-reorganizations.ts:118-130`: chuyển giao chỉ đóng hàng `ends_at=null`; hàng có ngày kết thúc tương lai còn hiệu lực → chồng lấn → `SinglePositionRequired`, không áp dụng được. Sửa theo (B).
2. `prisma/migrations/20261110_standardize_roles_positions/migration.sql` ~dòng 153: khi mã cũ và mới cùng có rule hiệu lực cho cùng khóa/phạm vi, bước đổi mã gây unique violation `learning_rules_active_scope_key` (đã tái hiện). Trước khi đổi: đóng (`effective_until = now`) các rule trùng, giữ một, không mất dữ liệu. Thêm kịch bản thử với dữ liệu mẫu trên Postgres thử.
3. `src/app/api/v1/admin/learning-rules/[ruleId]/materialize/route.ts:30-49`: đường cũ vẫn tạo assignment bắt buộc và hạn cho ADMIN/LEAD; bỏ qua ADMIN/LEAD (và người không đủ điều kiện học).
4. `src/middleware.ts:24,139-160`: JWT LEAD còn hạn nhưng `auth_version` đã tăng bị API từ chối trong khi `/login` vẫn chuyển về dashboard → không đăng nhập lại được tới khi xóa cookie. Khi phiên bị từ chối phải xóa cookie và cho vào trang đăng nhập.
5. `src/lib/position-replacement.ts:28-47`: bổ nhiệm B thay A làm PRESIDENT chỉ kết thúc vị trí của B, A còn PRESIDENT → `ChapterPresidentConflict`. Sửa theo (A).
6. `src/lib/position-replacement.ts:39-45`: membership tương lai vào ban rồi bổ nhiệm ngay vào chính ban đó → giữ membership tương lai và tạo thêm membership hiện tại → `MembershipExists`. Theo (B) loại bỏ hàng tương lai/chồng lấn khi thay thế.
8. `src/app/chapter-manager/invitations/page.tsx:138` và `src/app/chapter-manager/members/page.tsx:169`: mời hàng loạt và nút mời từ Members vẫn gửi `chapterId`, thiếu ban → 400 `MemberPositionRequired`. Giao diện phải cho chọn ban (hoặc gửi unit của ban) và hiển thị lỗi rõ.
9. `src/lib/invitations.ts:552` và danh sách lời mời của Chapter: lời mời mới lưu theo `organization_unit_id` nhưng danh sách lọc `chapter_id` nên lời mời biến mất sau khi gửi; sửa lọc cho khớp.
10. `src/app/api/v1/invitations/route.ts:36`: DNA LEAD được cấp `MANAGE_DNA_MEMBERS` nhưng list/resend/cancel vẫn đòi `MANAGE_CHAPTER_MEMBERS` → 403; sửa cho khớp quyền DNA LEAD (và vẫn chặn LEAD Chapter xem lời mời DNA).
11. `src/app/api/v1/organization/dna-leaderboard/route.ts:23-34`: người có `DNA_MEMBER` tại TT nhưng còn membership DNA cha vẫn lọt bảng xếp hạng qua hàng cha; danh sách loại trừ vị trí `TT/TRAINEE` không còn phù hợp. Xác định thành viên DNA theo nhóm `DNA_GROUP` và cập nhật danh sách loại trừ theo tên chuẩn.
13. `src/test/standardize-migration.test.ts` chỉ kiểm tra chuỗi SQL nên không bắt được lỗi unique ở mục 2; thêm test hành vi cho helper (position-replacement, chuyển giao thay thế, scope `DNA_GROUP`) bằng test thuần không cần DB.

## DB thử (chỉ dùng để thử migration mục 2)
Container Docker `bbe-test-pg` tại `127.0.0.1:54329`, user `postgres`, mật khẩu `bbe_local_test_only`. Chỉ tạo database `bbe_test_*` từ `TEMPLATE bbe_test_head` (schema ngay trước prompt 03; KHÔNG sửa template), thử migration với dữ liệu có mã cũ và mới cùng tồn tại (kể cả rule trùng), rồi xóa database thử. Nếu sandbox của bạn không kết nối được, ghi rõ chưa kiểm chứng.

## Kết thúc
`npx tsc --noEmit`, `npm run test:unit` toàn bộ, cập nhật `HANDOFF.md`, cập nhật `docs/KHBB.md` mục 2.3 ghi trạng thái "thành viên Chapter không ban" nếu đổi hành vi, rồi báo cáo đúng mẫu. Không đụng baseline DB trống/seed (prompt 06).
