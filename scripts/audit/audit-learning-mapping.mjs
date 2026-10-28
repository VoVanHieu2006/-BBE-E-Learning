import nextEnv from '@next/env'
import { Client } from 'pg'
import { writeFile, mkdir } from 'node:fs/promises'

nextEnv.loadEnvConfig(process.cwd())
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for a read-only audit.')
const db = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, connectionTimeoutMillis: 15_000 })
await db.connect()
try {
  await db.query('BEGIN READ ONLY')
  await db.query("SET LOCAL statement_timeout = '30s'")
  const { rows: courses } = await db.query('SELECT id, title, description, status, mandatory_default_due_days FROM courses ORDER BY title, id')
  const { rows: units } = await db.query('SELECT id, name, type, parent_id FROM organization_units ORDER BY type, name, id')
  const { rows: positions } = await db.query('SELECT code, name, scope FROM positions ORDER BY code')
  const { rows: clock } = await db.query("SELECT current_setting('TimeZone') AS database_timezone, clock_timestamp() AS audited_at")
  await db.query('COMMIT')
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase()
  const proposals = courses.map((course) => {
    const title = normalize(course.title)
    let proposedProgram = null, reason = 'Chưa đủ bằng chứng trong tên khóa; cần Admin xem nội dung.', confidence = 'REVIEW_REQUIRED'
    if (/\bdna\b|\bsgdc\b|\bldc\b/.test(title)) { proposedProgram = 'CORE_DNA'; reason = 'Tên khóa nhắc DNA/SGDC/LDC; cần xác nhận có thuộc chương trình cốt lõi.' }
    else if (/\blt\b|leader team|truong ban|lanh dao/.test(title)) { proposedProgram = 'CORE_LEADER'; reason = 'Tên khóa hướng đến LT/lãnh đạo; cần xác nhận nội dung và khóa chung/riêng.' }
    else if (/thanh vien/.test(title)) { proposedProgram = 'CORE_MEMBER'; reason = 'Tên khóa nhắc Thành viên; có thể là tên Ban, cần Admin xác nhận.' }
    else if (/ky nang|an toan thong tin|lam viec nhom|tieng anh|tin hoc|tai chinh|tu duy phan bien/.test(title)) { proposedProgram = 'EXTENDED'; reason = 'Tên khóa mô tả kỹ năng bổ sung; cần Admin xác nhận không thuộc khóa cốt lõi.' }
    else if (/tong quan|van hoa to chuc|hanh trinh bbe/.test(title)) { proposedProgram = 'CORE_MEMBER'; reason = 'Nội dung giới thiệu/hành trình BBE có thể là khóa chung Thành viên; cần xem nội dung trước khi duyệt.' }
    return { courseId: course.id, title: course.title, status: course.status, proposedProgram, reason, confidence }
  })
  await mkdir('artifacts/learning', { recursive: true })
  await writeFile('artifacts/learning/mapping-audit.json', JSON.stringify({ ...clock[0], proposals, units, positions }, null, 2) + '\n')
  const escape = (value) => String(value ?? 'Chưa đề xuất').replaceAll('|', '\\|').replaceAll('\n', ' ')
  await writeFile('artifacts/learning/mapping-proposals.md', '# Đề xuất mapping — chưa được duyệt\n\nKhông có mapping nào được ghi vào database bởi audit này.\n\n| courseId | Tên khóa | Trạng thái | Chương trình đề xuất | Lý do |\n|---|---|---|---|---|\n' + proposals.map((row) => `| ${[row.courseId, row.title, row.status, row.proposedProgram, row.reason].map(escape).join(' | ')} |`).join('\n') + '\n')
  console.log(`Read-only audit complete: ${courses.length} courses, ${units.length} organization units, ${positions.length} positions. No database writes.`)
} finally { await db.end() }
