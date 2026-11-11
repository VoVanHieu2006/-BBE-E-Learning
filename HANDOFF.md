# HANDOFF — Prompt 07 (BXH bỏ email, tên mặc định vui)

Nhánh: `feat/p07-bxh-an-email`

## Trạng thái
- [x] 1. `src/lib/fun-display-name.ts` (40 con vật × 30 tính từ = 1200; FNV-1a theo userId; kèm `publicDisplayName`, `publicRankingRow`)
- [x] 2. Bỏ `email` khỏi payload bảng xếp hạng (`period-leaderboard.ts` hydrateRanking, `leaderboard/route.ts`, `leaderboard/chapters/[chapterId]/route.ts`, `organization/dna-leaderboard/route.ts`; `leaderboard/chapters/route.ts` không có trường người dùng)
- [x] 3. Server luôn trả `displayName` hoàn chỉnh qua `publicDisplayName`/`publicRankingRow`
- [x] 4. `UnifiedLeaderboard.tsx` nhận diện bằng `userId` (bỏ email; bỏ nhánh `email.split('@')`, bỏ 2 khối hiển thị email, bỏ `email` khỏi interface). Giữ `email` ở modal hồ sơ (chỉ ADMIN/LEAD).
- [ ] 5. Thống nhất tên mặc định ở màn hình khác
- [ ] 6. Test
- [ ] 7. `docs/api.md`

## Đang làm
Khảo sát code.

## Lệnh test đã chạy

## Quyết định
- `hydrateRanking` bỏ tham số `isGuest`: mọi người (khách hay thành viên) nhận cùng hàng không email. `publicRankingRow` xóa cả `email` cũ trong snapshot đã lưu.
- Không còn dùng `row.displayName` trong snapshot làm tên: tên luôn tính lại từ bảng users theo quy tắc prompt.
- Giữ email ở màn hình quản lý: `chapters/[id]/dashboard/members`, `current-roster`, `courses/[id]/students`, `kpi`, hồ sơ học viên (modal ADMIN/LEAD), `users/me`.

## Nghi ngờ / xung đột có thể
