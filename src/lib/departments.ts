export const EXACT_7_BANS = [
  'Ban chất lượng',
  'Ban nội dung',
  'Ban khách mời',
  'Ban TT&SK',
  'Ban Thành viên',
  'Ban Thư ký',
  'Chủ tịch',
] as const

export type StandardDepartmentName = (typeof EXACT_7_BANS)[number]
