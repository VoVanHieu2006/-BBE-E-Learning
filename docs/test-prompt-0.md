# Prompt 0 — Kiểm tra tự kiểm tra

## Điều kiện trước
- [x] Đọc PROMPT và LƯU Ý (đã đọc)
- [x] Xác nhận 3 file docs (docs/ba-document.md, docs/api-design.md, docs/schema.dbml)
- [x] Xác nhận .env.local có ADMIN_EMAIL / ADMIN_PASSWORD (user thêm)
- [x] Xác nhận không thêm chapter mẫu (user: "không cần thêm chapter mẫu")

## Hạ tầng đã tạo
- [x] `docs/ba-document.md` (extract từ BA.docx)
- [x] `docs/api-design.md` (extract từ API.docx)
- [x] `.env.local` đã có ADMIN_EMAIL, ADMIN_PASSWORD
- [x] Next.js 14+ (App Router, TypeScript, Tailwind) — package.json, src/app, tailwind.config.ts
- [x] `prisma/schema.prisma` (dịch từ docs/schema.dbml, 20 bảng, 11 enum, index, FK, cascade)
- [x] `prisma/migrations/20250831_init/migration.sql` (DDL cho tất cả bảng)
- [x] `prisma/seed.js` (tạo 1 ADMIN từ env, không tạo chapter)
- [x] Migration đã áp dụng thành công (18 bảng tạo, pgcrypto extension OK)
- [x] Seed đã chạy thành công: admin `bbetrainerteam@gmail.com` (ADMIN, ACTIVE)
- [x] Kiểm tra DB: bảng users có dữ liệu admin chính xác (UUID, email, role, status)

## Vấn đề còn lại (cần lưu ý)
- Prisma CLI v8 (`prisma` v8 RC) yêu cầu `prisma.config.ts` mới (`definePrismaConfig`) — đã tạo file nhưng CLI vẫn có thể cần điều chỉnh khi dùng `prisma migrate dev` chính thức. Đã khắc phục bằng cách áp dụng SQL thủ công và chạy seed bằng `node`.
- `prisma/seed.ts` (TypeScript) cần `prisma generate` để hoạt động; đã tạo bản `prisma/seed.js` (JavaScript) hoạt động ngay.

## Kết luận
Prompt 0 đã hoàn thành. Hạ tầng đã sẵn sàng cho Prompt 1.
