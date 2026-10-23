# 🎓 BBE E-Learning Hub

> Nền tảng Đào tạo Nội bộ Câu lạc bộ Doanh nhân BBE — Xây dựng trên nền tảng Next.js 14 App Router, TypeScript, Prisma ORM, PostgreSQL, YouTube CDN & Cloud Storage.

---

## 📖 Tài liệu Giới thiệu & Sơ đồ Hệ thống

Dự án cung cấp 2 bộ tài liệu phù hợp cho từng đối tượng:

1. 🎯 **[BẢN DÀNH CHO KHÁCH HÀNG & BAN QUẢN TRỊ (Non-Tech, Use Case, Trực quan)](docs/TONG_QUAN_DU_AN_CHO_KHACH_HANG.md)**:
   - Dễ hiểu, không dùng thuật ngữ kỹ thuật phức tạp.
   - Sơ đồ Use Case, các luồng người dùng (Học không tua, Thi 85%, Giám sát Chi hội).
   - Bảng so sánh giá trị và kịch bản 3 phút nói chuyện với khách hàng.

2. ⚙️ **[BẢN DÀNH CHO KỸ THUẬT & LẬP TRÌNH VIÊN (Full Architecture, ERD, Caching)](docs/TONG_QUAN_KIEN_TRUC_VA_VAN_HANH_HE_THONG.md)**:
   - Sơ đồ Kiến trúc 5 tầng, Sơ đồ Thực thể Dữ liệu (ERD 15 bảng).
   - Cơ chế Anti-seek Player Heartbeat, Silent Refresh Edge JWT, Caching đa tầng.

---

## 🚀 Khởi chạy Nhanh

```bash
# 1. Cài đặt thư viện phụ thuộc
npm install

# 2. Cập nhật cơ sở dữ liệu
npm run db:push
npm run db:generate

# 3. Nạp dữ liệu mẫu
npm run db:seed

# 4. Chạy môi trường Development
npm run dev
```

Truy cập: [http://localhost:3000](http://localhost:3000)

---

## 👥 Vai trò & Phân quyền Người dùng

Hệ thống hỗ trợ 3 nhóm vai trò người dùng chính:
- **Admin**: Quản trị toàn hệ thống, cấu hình chương trình đào tạo, KPI và phân quyền.
- **Chapter Leader / Manager (BĐHU)**: Quản lý thành viên Chapter, theo dõi tiến độ và báo cáo nhiệm kỳ.
- **Học viên (Member)**: Tham gia học tập theo lộ trình, tích lũy Star và làm bài kiểm tra.

Chi tiết các tài liệu phân tích nghiệp vụ và kỹ thuật khác:
- [BA Document](docs/ba-document.md)
- [Codebase Context](docs/codebase-context.md)
- [API Design](docs/api-design.md)

---

## 🧪 Dữ liệu demo & kiểm thử (chỉ DB development/test)

Bộ seed giàu dữ liệu nằm trong `scripts/seed-rich-demo.ts` và `scripts/seed-rich-progress.ts`. Chạy theo thứ tự:

```bash
npm run db:seed-rich
npm run db:seed-rich-progress
npm run db:snapshot-demo
```

Seed tạo 8 Chapter mô phỏng (quy mô 16–53 thành viên), 50 bài lõi thuộc ba chương trình Thành viên/LT/DNA, tiến độ 0%/68%/70%/72%, KPI Đỏ/Vàng/Xanh, Chapter đúng 20 và đúng 50%, snapshot tháng 9 và nhiệm kỳ trước, cùng nhiệm kỳ đang mở, DNA TT/SGDC/LDC và chuyển giao giữa tháng. Không chạy trên production.

Công thức Chapter đang dùng: `S_m = A_m / N_m` (tổng sao trong kỳ / quân số active bình quân), điều kiện KPI Vàng/Xanh, quân số **trên 20**, tối thiểu 50% thành viên đạt ≥70% bài lõi. Không dùng trọng số 30/30/20/20 cũ.

---

## ⏰ Deadline Scheduler

Đối với triển khai Vercel, cấu hình biến môi trường `CRON_SECRET`. File `vercel.json` định kỳ gọi endpoint `/api/internal/learning/deadlines/enforce` hằng ngày lúc 00:00 UTC để kiểm tra và quản lý hạn học tập.
