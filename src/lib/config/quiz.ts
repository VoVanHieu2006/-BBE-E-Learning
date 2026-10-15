/**
 * CẤU HÌNH BÀI KIỂM TRA (QUIZ CONFIG)
 * 
 * Bạn có thể dễ dàng thay đổi thời gian chờ giữa các lần làm bài kiểm tra (Cooldown) tại biến dưới đây.
 * Giá trị tính bằng GIỜ (hours).
 * Ví dụ:
 *   - 24 : Chờ 24 giờ (mặc định theo quy định)
 *   - 12 : Chờ 12 giờ
 *   - 1  : Chờ 1 giờ
 *   - 0.1: Chờ 6 phút (dùng khi cần test nhanh)
 *   - 0  : Tắt hoàn toàn thời gian chờ
 */
export const QUIZ_COOLDOWN_MINUTES = Number(process.env.NEXT_PUBLIC_QUIZ_COOLDOWN_MINUTES || 2);
export const QUIZ_COOLDOWN_HOURS = QUIZ_COOLDOWN_MINUTES / 60;

// Thời gian chờ tính bằng Mili-giây (milliseconds)
export const QUIZ_COOLDOWN_MS = QUIZ_COOLDOWN_MINUTES * 60 * 1000;

// Điểm tối thiểu để vượt qua bài kiểm tra (85%)
export const QUIZ_PASS_PERCENT = 85;

// Phải xem hết video để được mở khóa bài kiểm tra. Server là nguồn kiểm soát cuối.
export const VIDEO_WATCH_REQUIRED_PERCENT = 100;
