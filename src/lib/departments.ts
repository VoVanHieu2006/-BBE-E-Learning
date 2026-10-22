export const EXACT_7_BANS = [
  'Ban Chất Lượng',
  'Ban Nội Dung',
  'Ban Khách Mời',
  'Ban TT&SK',
  'Ban Thành Viên',
  'Ban Thư Ký',
  'Ban Định Hướng',
] as const

export const ORDERED_7_BANS = [
  'Ban Định Hướng',
  'Ban Thành Viên',
  'Ban Thư Ký',
  'Ban Khách Mời',
  'Ban TT&SK',
  'Ban Nội Dung',
  'Ban Chất Lượng',
] as const

export type StandardDepartmentName = (typeof EXACT_7_BANS)[number]
export const ORDERED_CHAPTER_ROSTER = ['Chủ Tịch', ...ORDERED_7_BANS] as const

export interface ChapterRosterColumn {
  key: string
  label: string
  shortLabel: string
}

export const CHAPTER_ROSTER_COLUMNS: readonly ChapterRosterColumn[] = [
  { key: 'Chủ Tịch', label: 'Chủ Tịch', shortLabel: 'Chủ Tịch' },
  { key: 'Ban Định Hướng', label: 'Ban Định Hướng', shortLabel: 'Định Hướng' },
  { key: 'Ban Thành Viên', label: 'Ban Thành Viên', shortLabel: 'Thành Viên' },
  { key: 'Ban Thư Ký', label: 'Ban Thư Ký', shortLabel: 'Thư Ký' },
  { key: 'Ban Khách Mời', label: 'Ban Khách Mời', shortLabel: 'Khách Mời' },
  { key: 'Ban TT&SK', label: 'Ban TT&SK', shortLabel: 'TT&SK' },
  { key: 'Ban Nội Dung', label: 'Ban Nội Dung', shortLabel: 'Nội Dung' },
  { key: 'Ban Chất Lượng', label: 'Ban Chất Lượng', shortLabel: 'Chất Lượng' },
] as const
