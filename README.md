# 🎓 BBE E-Learning Hub

> Nền tảng Đào tạo Nội bộ Câu lạc bộ Doanh nhân BBE — Xây dựng trên nền tảng Next.js 14 App Router, TypeScript, Prisma ORM, PostgreSQL, YouTube CDN & Cloud Storage.

---

## 📖 Tài liệu Giới thiệu & Sơ đồ Hệ thống

Dự án cung cấp 2 bộ tài liệu phù hợp cho từng đối tượng:

1. 🎯 **[BẢN DÀNH CHO KHÁCH HÀNG & BAN QUẢN TRỊ (Non-Tech, Use Case, Trực quan)](file:///c:/Users/Acer/Desktop/E-learning/docs/TONG_QUAN_DU_AN_CHO_KHACH_HANG.md)**:
   - Dễ hiểu, không dùng thuật ngữ kỹ thuật phức tạp.
   - Sơ đồ Use Case, các luồng người dùng (Học không tua, Thi 85%, Giám sát Chi hội).
   - Bảng so sánh giá trị và kịch bản 3 phút nói chuyện với khách hàng.

2. ⚙️ **[BẢN DÀNH CHO KỸ THUẬT & LẬP TRÌNH VIÊN (Full Architecture, ERD, Caching)](file:///c:/Users/Acer/Desktop/E-learning/docs/TONG_QUAN_KIEN_TRUC_VA_VAN_HANH_HE_THONG.md)**:
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

## 👥 Tài khoản Mặc định (Seed Data)

| Vai trò | Email | Mật khẩu |
|---|---|---|
| **Admin** | `admin@bbe.com` | `admin123` |
| **Chapter Leader (BĐHU)** | `leader@bbe.com` | `leader123` |
| **Học viên (Member)** | `member@bbe.com` | `member123` |

Chi tiết các tài liệu phân tích nghiệp vụ và kỹ thuật khác:
- [BA Document](file:///c:/Users/Acer/Desktop/E-learning/docs/ba-document.md)
- [Codebase Context](file:///c:/Users/Acer/Desktop/E-learning/docs/codebase-context.md)
- [API Design](file:///c:/Users/Acer/Desktop/E-learning/docs/api-design.md)
