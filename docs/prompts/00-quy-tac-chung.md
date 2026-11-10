# Quy tắc chung cho mọi prompt sửa code

Đọc file này trước, rồi mới đọc prompt cụ thể (01 đến 05). Các prompt chạy **tuần tự**, mỗi prompt một session.

## Tài liệu phải đọc
1. `AGENTS.md` (quy trình làm việc của dự án).
2. `docs/KHBB.md`: **đích đến nghiệp vụ**, luôn đúng khi mâu thuẫn với code. Mục 9 liệt kê điều đã chốt mà code chưa làm.
3. `docs/KHBB-ky-thuat.md`: mô tả code hiện tại kèm `file:line` và bảng đối chiếu tên cũ/mới ở đầu file. Số dòng có thể lệch, hãy tìm lại bằng Grep.
4. `docs/CKNK.md` mục 5.10 (chỉ khi prompt nhắc tới) và phụ lục cuối `docs/reference/handbook-formulas.md`.

## Cách làm việc (theo `AGENTS.md`)
1. Tìm đúng code liên quan bằng Grep/Glob trước, chỉ đọc phần cần thiết, không đọc lại file đã đọc.
2. Nói ngắn gọn nguyên nhân/ý định thay đổi, rồi sửa nhỏ nhất nhưng đầy đủ. Không sửa chức năng không liên quan.
3. Chạy test liên quan và `npx tsc --noEmit`, rồi báo cáo.
4. Công thức nghiệp vụ, quyền và schema chỉ đổi khi prompt yêu cầu rõ ràng.

## An toàn (bắt buộc)
- **Không sửa migration đã có** trong `prisma/migrations/`. Chỉ thêm migration mới khi prompt cho phép.
- **Không chạy gì lên database thật/cloud.** Test tích hợp cần DB riêng: đọc phần guard ở đầu mỗi suite, không đổi host hay tên DB để vượt guard. Nếu không có DB test, chỉ chạy unit test và nói rõ phần nào chưa kiểm chứng.
- Không in hay ghi bí mật (khóa, mật khẩu, token). Dùng `.env.example` làm tham chiếu.
- Hỏi người dùng trước khi làm việc không hoàn tác được (xóa dữ liệu, drop bảng, chạy migration).
- **Không commit, không push.** Để thay đổi trong working tree và liệt kê file đã sửa; người dùng sẽ commit.
- Làm trên một nhánh riêng: `git switch -c <tên nhánh prompt>` ngay từ đầu (thay đổi chưa commit sẽ được mang theo).
- Thông báo hiển thị cho người dùng cuối viết bằng tiếng Việt, giữ giọng hiện có.

## Thuật ngữ chuẩn (dùng cả trong code mới, comment và giao diện)
- Khóa học có hai trạng thái: **xuất bản** (`PUBLISHED`) và **bản nháp** (`DRAFT`). "Công khai / riêng tư" chỉ nói khách chưa đăng nhập có xem được không.
- Mã ban Định Hướng trong tài liệu là `BDHU`; trong code hiện tại vẫn là `BDH` cho tới prompt 03.
- Vai trò chuẩn: `ADMIN`, `LEAD`, `MEMBER`. Trong code hiện tại role vẫn là `CHAPTER_LEADER` cho tới prompt 03: ở prompt 01 và 02, coi `CHAPTER_LEADER` và chức vụ `DNA_LEAD`/`CHAPTER_LEAD`/`CHAPTER_MANAGER` đều là "LEAD".

## Lệnh hay dùng
```bash
npx tsc --noEmit
npm run test:unit
npx ts-node -P tsconfig.test.json src/test/<ten>.test.ts
```
Test unit mới đặt ở `src/test/` và được đăng ký trong `scripts/test/run-tests.cjs` (xem dòng `unit`).

## Báo cáo cuối (bắt buộc, đúng định dạng này)
1. **Đã làm:** từng mục trong prompt, đánh dấu xong / làm một phần / chưa làm.
2. **File đã sửa hoặc thêm.**
3. **Test đã chạy:** lệnh và kết quả thật (pass/fail, số lượng). Nêu rõ test nào không chạy được và vì sao.
4. **Chỗ lệch so với prompt hoặc KHBB, và lý do.**
5. **Rủi ro còn lại và câu hỏi cần người dùng quyết.**
Không khẳng định "đã xong" nếu test thất bại hoặc chưa chạy.
