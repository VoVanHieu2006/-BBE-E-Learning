# BBE E-Learning Hub

Nền tảng đào tạo nội bộ BBE: khóa học, video/tài liệu, bài kiểm tra, lộ trình bắt buộc, quản lý Chapter/DNA và bảng xếp hạng. Stack: Next.js 14 App Router, TypeScript, Prisma ORM 6 và PostgreSQL.

## Bắt đầu

Yêu cầu Node.js tương thích Next.js 14, npm và PostgreSQL. Cài dependencies theo lockfile:

```powershell
npm ci
Copy-Item .env.example .env
```

Điền database, JWT và dịch vụ cần dùng theo [operations](docs/operations.md). Secrets thật không thuộc Git hay tài liệu.

- **Database đã có dữ liệu:** giữ migration history, kiểm tra và triển khai forward migrations theo runbook. Không dùng `db:push`, reset hoặc seed để nâng cấp.
- **Database mới, trống hoàn toàn:** làm theo [bootstrap](prisma/bootstrap/README.md). Migration history cũ không replay được nguyên trạng từ DB rỗng. Script nhận `BASELINE_DATABASE_URL` và xác nhận tên đích riêng.
- `db:seed` xóa dữ liệu trước khi tạo lại. Seed demo cũng ghi dữ liệu; chỉ chạy chủ động trên DB development/test đã xác định, không thuộc quickstart thông thường.

```powershell
npm run db:generate
npm run dev
```

Development mặc định tại http://localhost:3000. Production local dùng `npm run build`, rồi `npm start`. Xóa `.next/` thì phải build lại trước khi start.

## Lệnh thường dùng

| Lệnh | Mục đích |
|---|---|
| `npm run dev` | Development server |
| `npm run typecheck` | TypeScript không emit |
| `npm run build` | Production build |
| `npm start` | Chạy production build đã có |
| `npm test` | Danh sách unit test rõ ràng |
| `npm run test:integration -- <tên-suite>` | Chọn đúng một suite DB riêng có guard; đọc [testing](docs/testing.md) |
| `npm run test:browser` | Suite trình duyệt |
| `npm run db:generate` | Sinh Prisma client |
| `npm run db:baseline-empty` | Bootstrap DB mới, trống; cần guard xác nhận |
| `npm run learning:scheduler` | Worker định kỳ, base URL và secret riêng |

Các lệnh chuyên biệt vẫn nằm trong [package.json](package.json). Không chạy test ghi với DB ứng dụng đang dùng.

## Tài liệu hiện hành

| Tài liệu | Nội dung |
|---|---|
| [Nghiệp vụ](docs/business-rules.md) | Quy tắc, quyết định thay thế, dữ liệu legacy |
| [Kiến trúc](docs/architecture.md) | Module, dữ liệu, quyền, cache và scheduler |
| [API](docs/api.md) | 96 route, method, guard, request/response và lỗi |
| [Vận hành](docs/operations.md) | Cấu hình, bootstrap, triển khai, mapping, mùa chuyển giao, phục hồi |
| [Kiểm thử](docs/testing.md) | Suite duy trì, DB riêng và nghiệm thu thủ công |
| [Vấn đề còn mở](docs/known-issues.md) | Bằng chứng, cách tái hiện và giới hạn kiểm chứng |
| [Hiệu năng](docs/performance.md) | Số đo thực, mô hình tải và giới hạn kết luận |

Schema chính thức: [prisma/schema.prisma](prisma/schema.prisma). Bản gốc cẩm nang và sổ tay công thức nằm trong [docs/reference](docs/reference/); quyết định thay thế được ghi trong tài liệu nghiệp vụ. Kết quả tự sinh thuộc `artifacts/` (Git bỏ qua), không ghi lại vào `docs/`.
