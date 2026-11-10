# Quy tắc bổ sung cho worker chạy ngoài (Codex, Qoder, ...)

Đọc `docs/prompts/00-quy-tac-chung.md` trước, rồi file này. File này **thay thế** các điểm sau của file chung.

## Bạn đang ở trong một git worktree riêng
- Thư mục làm việc và nhánh của bạn đã được tạo sẵn. **Chỉ làm việc trong thư mục hiện tại**; không mở, sửa hay chạy lệnh ở thư mục khác (đặc biệt không đụng `C:\Users\Acer\Desktop\E-learning` gốc và các worktree anh em).
- Có worker khác chạy song song trên các nhánh khác. Không sửa file ngoài phạm vi prompt của bạn; nếu bắt buộc phải sửa một file thuộc việc khác, ghi vào `HANDOFF.md` mục "xung đột có thể" thay vì tự sửa rộng.
- `node_modules` được nối bằng junction với thư mục gốc. **Tuyệt đối không chạy** `npm install`, `npm ci`, `prisma generate`, `prisma migrate`, `prisma db push`. Không đổi `package.json`/lockfile. Chỉ chạy `npx tsc --noEmit`, `npm run test:unit`, hoặc test riêng lẻ.
- Không có `.env`; không tìm cách lấy. Không kết nối database thật. Test tích hợp cần DB thì bỏ qua và ghi rõ.

## Commit
- Được commit **lên nhánh của bạn** (checkpoint thường xuyên, mỗi khi xong một mục và `npx tsc --noEmit` sạch). Không push, không merge, không rebase, không đổi nhánh, không `git reset --hard`, không `git clean`, không xóa file không do bạn tạo.
- Thông điệp commit ngắn, tiếng Anh, dạng `feat(...)/fix(...)/chore(...)`.

## Chống mất việc khi hết hạn mức (BẮT BUỘC)
Hạn mức của bạn có thể hết bất cứ lúc nào. Vì vậy:
1. Tạo file `HANDOFF.md` ở thư mục gốc worktree ngay từ đầu và cập nhật sau **mỗi mục lớn**: đã xong gì, đang làm gì (file nào), còn lại gì (đánh số theo prompt), lệnh test đã chạy và kết quả, quyết định đã đưa ra, chỗ nghi ngờ.
2. Không để thay đổi dở dang chưa commit quá một mục. Nếu đang dở, commit với tiền tố `wip:`.
3. Nếu bạn nhận ra mình sắp hết hạn mức, dừng sớm, cập nhật `HANDOFF.md`, commit, rồi báo cáo ngắn.

## Báo cáo cuối
Theo mẫu ở `00-quy-tac-chung.md`, đồng thời đảm bảo `HANDOFF.md` phản ánh trạng thái cuối. Không khẳng định "xong" nếu `npx tsc --noEmit` hoặc `npm run test:unit` thất bại hoặc chưa chạy.
