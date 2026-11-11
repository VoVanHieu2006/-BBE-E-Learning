# Prompt 07 — Bảng xếp hạng: bỏ email, tên mặc định vui

Đọc `docs/prompts/00-quy-tac-chung.md` và `docs/prompts/00b-worker-ngoai.md`. Nhánh gợi ý `feat/p07-bxh-an-email`. Worktree này dùng chung `node_modules` đã generate Prisma client mới nhất: không `npm install`, không `prisma generate`, không migrate, không DB thật. Được commit lên nhánh này (không push). Cập nhật `HANDOFF.md`.

## Quyết định của chủ sản phẩm
1. **Bỏ email khỏi bảng xếp hạng.** Hiện `hydrateRanking` trong `src/lib/period-leaderboard.ts` (~dòng 310-314) thêm `email` vào mỗi hàng bảng xếp hạng kỳ cho mọi tài khoản đã đăng nhập và `src/components/learning/UnifiedLeaderboard.tsx` (~dòng 234, 272-275, 783-784, 802-803) hiển thị nó, còn suy ra tên từ phần đầu email. Test bảo mật cũ `scripts/test/test-learning-security.mjs` (~dòng 96) yêu cầu hàng bảng xếp hạng KHÔNG có `email` (lộ thông tin cá nhân giữa các thành viên); trong lần chạy thử trước đã tạm bỏ đúng assertion đó: khôi phục nó nguyên vẹn.
2. **Tên mặc định vui thay cho "Thành viên"** khi người dùng chưa có `display_name` (và chưa bị ẩn danh): dạng **[con vật] + [tính từ]** tiếng Việt, ví dụ "Sóc nhí nhảnh", "Chuột vui vẻ", "Chó tức giận". Phải tổ hợp ra **hơn 1000** tên khác nhau (ví dụ 40 con vật × 30 tính từ). **Không lưu vào DB, không cần chống trùng** (chỉ cho vui). Dùng hàm băm ổn định từ `userId` để cùng một người luôn ra cùng một tên giữa các lần tải (không đổi tên mỗi lần F5).

## Việc cần làm
1. Tạo `src/lib/fun-display-name.ts` (`funDisplayName(userId: string): string`) với hai danh sách từ tiếng Việt (viết hoa chữ đầu của tên), kiểm tra tổ hợp > 1000; hàm thuần, không phụ thuộc DB.
2. Bỏ `email` khỏi MỌI payload bảng xếp hạng dành cho thành viên: `src/lib/period-leaderboard.ts`, `src/app/api/v1/leaderboard/route.ts`, `src/app/api/v1/leaderboard/chapters/[chapterId]/route.ts`, `src/app/api/v1/organization/dna-leaderboard/route.ts` (và bất kỳ route/hàm khác trả hàng xếp hạng cho thành viên; dùng Grep tìm `email` trong các route `leaderboard` và hàm dựng hàng xếp hạng). **Giữ nguyên** email ở các màn hình quản lý có kiểm tra quyền (danh sách thành viên của Chapter/đơn vị cho quản lý): không đụng tới.
3. Server luôn trả `displayName` đã hoàn chỉnh: `display_name` nếu có; nếu tài khoản đã ẩn danh hóa thì "Tài khoản đã gỡ"; ngược lại `funDisplayName(userId)`. Thay mọi chỗ dựng tên từ email hoặc fallback `'Thành viên'` ở bảng xếp hạng (cả UI `UnifiedLeaderboard.tsx`: bỏ nhánh `item.email.split('@')[0]`, bỏ hai khối hiển thị `item.email`).
4. `UnifiedLeaderboard.tsx`: nhận diện hàng của người đang xem **chỉ bằng `userId`** (bỏ so sánh email).
5. Kiểm tra các màn hình khác dùng tên mặc định "Thành viên" cho người chưa đặt tên (hồ sơ, hàng xếp hạng cá nhân, bảng trong `chapter-manager`/`organization-manager`): thống nhất dùng cùng hàm khi cần tên công khai giữa các thành viên; tên hiển thị cho quản lý vẫn có thể dùng email để quản lý nhận diện.
6. Test: unit test cho `funDisplayName` (ổn định theo userId, > 1000 tổ hợp khác nhau, không rỗng, không chứa email/ký tự lạ) đăng ký trong `scripts/test/run-tests.cjs`; test cấu trúc payload bảng xếp hạng không có `email` (viết hàm thuần tách ra nếu route khó test); chạy `npx tsc --noEmit`, `npm run test:unit`. `test-learning-security.mjs` cần DB và app nên chỉ cần khôi phục assertion và ghi rõ chưa chạy nếu không chạy được.
7. Cập nhật `docs/KHBB.md`? Không cần. Ghi một dòng vào `docs/api.md` mục leaderboard: hàng xếp hạng không còn trường `email`, `displayName` luôn có.

## Không được đụng tới
Công thức xếp hạng, điểm, snapshot, migration, màn hình quản lý trả email cho quản lý, các prompt khác.
