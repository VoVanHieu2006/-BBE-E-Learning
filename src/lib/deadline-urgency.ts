export type UrgencyLevel = {
  key: 'URGENT_1D' | 'URGENT_3D' | 'URGENT_5D' | 'URGENT_10D' | 'URGENT_15D' | 'URGENT_20D' | 'URGENT_30D' | 'RELAXED_OVER_30D' | 'OVERDUE'
  label: string
  badgeText: string
  textColor: string
  bgColor: string
  borderColor: string
  isPulse: boolean
}

export function getUrgencyLevel(remainingDays: number | null): UrgencyLevel {
  if (remainingDays === null) {
    return {
      key: 'RELAXED_OVER_30D',
      label: 'Khóa học bắt buộc',
      badgeText: '📌 Khóa học bắt buộc',
      textColor: 'text-blue-700',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      isPulse: false,
    }
  }

  if (remainingDays < 0) {
    return {
      key: 'OVERDUE',
      label: `Quá hạn ${Math.abs(remainingDays)} ngày`,
      badgeText: `🚨 Quá hạn ${Math.abs(remainingDays)} ngày`,
      textColor: 'text-red-700',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-300',
      isPulse: true,
    }
  }

  if (remainingDays <= 1) {
    return {
      key: 'URGENT_1D',
      label: 'Khẩn cấp cực độ! Còn dưới 24h',
      badgeText: '🚨 Khẩn cấp cực độ! Còn dưới 24h',
      textColor: 'text-red-700',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-300',
      isPulse: true,
    }
  }

  if (remainingDays <= 3) {
    return {
      key: 'URGENT_3D',
      label: 'Rất gấp! Còn dưới 3 ngày',
      badgeText: '⚡ Rất gấp! Còn dưới 3 ngày',
      textColor: 'text-orange-700',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-300',
      isPulse: false,
    }
  }

  if (remainingDays <= 5) {
    return {
      key: 'URGENT_5D',
      label: 'Khẩn trương! Còn dưới 5 ngày',
      badgeText: '🔥 Khẩn trương! Còn dưới 5 ngày',
      textColor: 'text-amber-700',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-300',
      isPulse: false,
    }
  }

  if (remainingDays <= 10) {
    return {
      key: 'URGENT_10D',
      label: 'Sắp đến hạn! Còn dưới 10 ngày',
      badgeText: '⏳ Sắp đến hạn! Còn dưới 10 ngày',
      textColor: 'text-yellow-800',
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-300',
      isPulse: false,
    }
  }

  if (remainingDays <= 15) {
    return {
      key: 'URGENT_15D',
      label: 'Cần tăng tốc! Còn dưới 15 ngày',
      badgeText: '⚠️ Cần tăng tốc! Còn dưới 15 ngày',
      textColor: 'text-amber-800',
      bgColor: 'bg-amber-50/70',
      borderColor: 'border-amber-200',
      isPulse: false,
    }
  }

  if (remainingDays <= 20) {
    return {
      key: 'URGENT_20D',
      label: 'Cần chú ý! Còn dưới 20 ngày',
      badgeText: '📘 Cần chú ý! Còn dưới 20 ngày',
      textColor: 'text-lime-800',
      bgColor: 'bg-lime-50',
      borderColor: 'border-lime-200',
      isPulse: false,
    }
  }

  if (remainingDays <= 30) {
    return {
      key: 'URGENT_30D',
      label: 'Tiến độ ổn định! Còn dưới 30 ngày',
      badgeText: '🗓️ Tiến độ ổn định! Còn dưới 30 ngày',
      textColor: 'text-blue-700',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      isPulse: false,
    }
  }

  return {
    key: 'RELAXED_OVER_30D',
    label: 'Thư thả! Còn trên 30 ngày',
    badgeText: '🌿 Thư thả! Còn trên 30 ngày',
    textColor: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    isPulse: false,
  }
}
