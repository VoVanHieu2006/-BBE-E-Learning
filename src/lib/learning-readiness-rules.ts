export const learningReasonMessages: Record<string, string> = {
  READY: 'Cấu hình sẵn sàng.',
  MONTH_NOT_CONFIGURED: 'Chưa khởi tạo tháng thi đua phù hợp.',
  TERM_NOT_CONFIGURED: 'Chưa khởi tạo nhiệm kỳ Chapter phù hợp.', SEASON_NOT_CONFIGURED: 'Chưa khởi tạo mùa chuyển giao phù hợp.',
  SNAPSHOT_MISSING: 'Kỳ đã kết thúc nhưng chưa có snapshot.', CYCLE_NOT_STARTED: 'Chưa có chu kỳ học; tiến độ lịch sử được giữ riêng.',
  REPLAY_INCOMPLETE: 'Chưa xem đủ video trong lượt xem tháng này.', REPLAY_NOT_STARTED: 'Chưa bắt đầu lượt xem tháng này.',
  AWARDED: 'Đã cộng sao video.', ALREADY_AWARDED: 'Lượt xem này đã nhận sao.', SUPPRESSED: 'Lượt xem đã bị chặn thưởng; không cộng bù.',
  TRANSFER_SEASON_NOT_CONFIGURED: 'Chưa cấu hình mùa chuyển giao cho giai đoạn này.',
  CHAPTER_TRANSFER_OVERDUE: 'Chapter chưa hoàn tất chuyển giao nên thưởng đang tạm dừng.',
  REWARD_NOT_ELIGIBLE: 'Tài khoản hoặc khóa học chưa đủ điều kiện nhận sao.',
}

export function readinessForReason(reasonCode: string) {
  return { ready: reasonCode === 'READY', reasonCode, message: learningReasonMessages[reasonCode] || reasonCode }
}
