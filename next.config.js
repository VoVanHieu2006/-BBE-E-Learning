/** @type {import('next').NextConfig} */

const securityHeaders = [
  // Chống Clickjacking: ngăn nhúng trang vào iframe từ domain khác
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Chống MIME Sniffing: trình duyệt không được đoán sai Content-Type
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Bảo vệ XSS cũ (hỗ trợ IE/Edge cũ)
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // Kiểm soát thông tin Referrer khi navigate sang domain khác
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Bắt buộc HTTPS (HSTS) — 2 năm, bao gồm subdomains
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Hạn chế quyền truy cập các API trình duyệt nhạy cảm
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
]

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Áp dụng cho toàn bộ routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
