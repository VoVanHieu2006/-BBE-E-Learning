export const EXACT_7_BANS = [
  'Ban Chất Lượng',
  'Ban Nội Dung',
  'Ban Khách Mời',
  'Ban TT&SK',
  'Ban Thành Viên',
  'Ban Thư Ký',
  'Chủ Tịch',
] as const

export const ORDERED_7_BANS = [
  'Chủ Tịch',
  'Ban Thành Viên',
  'Ban Thư Ký',
  'Ban Khách Mời',
  'Ban TT&SK',
  'Ban Nội Dung',
  'Ban Chất Lượng',
] as const

export type StandardDepartmentName = (typeof EXACT_7_BANS)[number]

