export const LEARNING_PROGRAMS = [
  { code: 'CORE_MEMBER', name: 'Chương trình học cho Thành viên', is_core: true, sort_order: 0 },
  { code: 'CORE_LEADER', name: 'Chương trình học cho LT', is_core: true, sort_order: 1 },
  { code: 'CORE_DNA', name: 'Chương trình học cho DNA', is_core: true, sort_order: 2 },
  { code: 'EXTENDED', name: 'Chương trình học mở rộng/khuyến khích', is_core: false, sort_order: 3 },
] as const

export const STANDARD_DEPARTMENTS = [
  ['BTV', 'Ban Thành Viên'], ['BTK', 'Ban Thư Ký'], ['BND', 'Ban Nội Dung'],
  ['BCL', 'Ban Chất Lượng'], ['BDH', 'Ban Định Hướng'], ['BKM', 'Ban Khách Mời'], ['BTTSK', 'Ban TT&SK'],
] as const

export const LEARNING_TARGETS = [
  ...STANDARD_DEPARTMENTS.map(([code, name], index) => ({ code: `MEMBER_${code}`, label: `Thành viên ${name}`, department_code: code, position_code: 'MEMBER', dna_unit_code: null, sort_order: index })),
  ...STANDARD_DEPARTMENTS.map(([code, name], index) => ({ code: `LEADER_${code}`, label: `LT ${name}`, department_code: code, position_code: 'DEPARTMENT_LEAD', dna_unit_code: null, sort_order: index + 7 })),
  { code: 'CHAPTER_PRESIDENT', label: 'Chủ tịch Chapter', department_code: null, position_code: 'CHAPTER_PRESIDENT', dna_unit_code: null, sort_order: 14 },
  ...['TT', 'SGDC', 'LDC'].map((code, index) => ({ code: `DNA_${code}`, label: `DNA ${code}`, department_code: null, position_code: null, dna_unit_code: code, sort_order: 15 + index })),
]

export function suggestLearningProgram(title: string) {
  const text = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase()
  if (/\bdna\b|\bsgdc\b|\bldc\b/.test(text)) return { code: 'CORE_DNA', reason: 'Tên khóa hướng đến DNA; cần xem nội dung.' }
  if (/\blt\b|leader team|truong ban|lanh dao/.test(text)) return { code: 'CORE_LEADER', reason: 'Tên khóa hướng đến LT/lãnh đạo; cần xem nội dung.' }
  if (/ky nang|an toan thong tin|lam viec nhom|tieng anh|tin hoc|tai chinh|tu duy phan bien/.test(text)) return { code: 'EXTENDED', reason: 'Kỹ năng bổ sung; cần xác nhận có thuộc khóa cốt lõi hay không.' }
  if (/thanh vien|tong quan|van hoa to chuc|hanh trinh bbe/.test(text)) return { code: 'CORE_MEMBER', reason: 'Có thể là khóa chung/riêng Thành viên; cần xem nội dung.' }
  return { code: null, reason: 'Chưa đủ bằng chứng; cần Admin xem nội dung.' }
}
