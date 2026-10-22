import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { parseCsv, extractGoogleDocRef, buildGoogleExportUrl } from '@/lib/quiz/import'
import { listChapterMembers } from '@/lib/chapter-members'
import { prisma } from '@/lib/prisma'
import { ORDERED_CHAPTER_ROSTER, CHAPTER_ROSTER_COLUMNS } from '@/lib/departments'

const MEMBER_PATTERN = /^\s*(.*?)\s*\(([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\)\s*$/i
const EMAIL_ONLY_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

function matchStandardDepartmentName(header: string, depts: Array<{ id: string; name: string }>) {
  const norm = normalized(header)
  // Direct match
  if (norm.includes('chu tich')) return depts.find((d) => d.name === 'Chủ Tịch')
  const direct = depts.find((d) => normalized(d.name) === norm)
  if (direct) return direct

  // Synonym / flexible matching
  if (norm.includes('chu tich')) return depts.find((d) => normalized(d.name).includes('chu tich'))
  if (norm.includes('chat luong')) return depts.find((d) => normalized(d.name).includes('chat luong'))
  if (norm.includes('noi dung')) return depts.find((d) => normalized(d.name).includes('noi dung'))
  if (norm.includes('khach moi')) return depts.find((d) => normalized(d.name).includes('khach moi'))
  if (norm.includes('tt&sk') || norm.includes('tt & sk') || norm.includes('truyen thong')) return depts.find((d) => normalized(d.name).includes('tt') || normalized(d.name).includes('truyen thong'))
  if (norm.includes('thanh vien')) return depts.find((d) => normalized(d.name).includes('thanh vien'))
  if (norm.includes('dinh huong')) return depts.find((d) => normalized(d.name).includes('dinh huong'))
  if (norm.includes('thu ky')) return depts.find((d) => normalized(d.name).includes('thu ky'))
  return null
}

export async function POST(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (
    auth.context!.role !== 'ADMIN' &&
    !(await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS'))
  ) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const ref = extractGoogleDocRef(String(body?.url || ''))
  if (!ref || ref.kind !== 'sheet') {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Cần link Google Sheet hợp lệ.' } }, { status: 400 })
  }

  const response = await fetch(buildGoogleExportUrl(ref), { cache: 'no-store', redirect: 'follow' })
  const text = await response.text().catch(() => '')
  if (!response.ok || response.url.includes('accounts.google.com') || /^<!DOCTYPE html/i.test(text)) {
    return NextResponse.json(
      { error: { code: 'DocumentNotPublic', message: 'Hãy bật “Bất kỳ ai có liên kết – Người xem”.' } },
      { status: 400 }
    )
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: params.chapterId },
    select: { organization_unit_id: true, name: true },
  })
  if (!chapter?.organization_unit_id) {
    return NextResponse.json({ error: { code: 'ChapterOrganizationMissing' } }, { status: 409 })
  }

  const [storedDepartments, leadPosition, currentMembers] = await Promise.all([
    prisma.organizationUnit.findMany({
      where: { parent_id: chapter.organization_unit_id, type: 'DEPARTMENT', status: 'ACTIVE' },
      select: { id: true, name: true },
    }),
    prisma.position.findFirst({ where: { code: 'DEPARTMENT_LEAD' }, select: { id: true } }),
    listChapterMembers(params.chapterId, { roles: ['MEMBER'], status: 'ACTIVE' }),
  ])

  const departments = [{ id: chapter.organization_unit_id, name: 'Chủ Tịch' }, ...storedDepartments.filter((department) => normalized(department.name) !== 'chu tich')]
  const rows = parseCsv(text)
  if (rows.length < 2) {
    return NextResponse.json({ error: { code: 'SheetEmpty', message: 'Sheet chưa có dữ liệu thành viên.' } }, { status: 400 })
  }

  const headers = rows[0]
  const candidates: Array<{
    displayName: string
    email: string
    departmentUnitId: string
    departmentName: string
    positionId: string | null
    isLead: boolean
    row: number
  }> = []
  const errors: Array<{ row: number; column: string; value: string; message: string }> = []

  for (let column = 0; column < headers.length; column++) {
    const header = (headers[column] || '').trim()
    if (!header) continue
    const department = matchStandardDepartmentName(header, departments)
    if (!department) {
      errors.push({ row: 1, column: header, value: header, message: 'Tên cột chưa khớp với 7 Ban trong hệ thống.' })
      continue
    }

    let departmentIndex = 0
    for (let row = 1; row < rows.length; row++) {
      const value = (rows[row]?.[column] || '').trim()
      if (!value) continue

      let displayName = ''
      let email = ''
      const match = value.match(MEMBER_PATTERN)
      if (match) {
        displayName = match[1].trim()
        email = match[2].toLowerCase().trim()
      } else if (EMAIL_ONLY_PATTERN.test(value)) {
        email = value.toLowerCase().trim()
        displayName = email.split('@')[0]
      } else {
        errors.push({ row: row + 1, column: header, value, message: 'Định dạng ô phải là: Họ tên (email@domain.com).' })
        continue
      }

      // Ban Chủ Tịch chỉ có tối đa 1 người (0 hoặc 1)
      if (department.name.toLowerCase() === 'chủ tịch' && departmentIndex > 0) {
        errors.push({
          row: row + 1,
          column: header,
          value,
          message: 'Ban Chủ Tịch chỉ được phép có tối đa 1 người (Chủ tịch Chapter). Vui lòng điều chỉnh lại sheet.',
        })
        continue
      }

      const isLead = departmentIndex === 0
      candidates.push({
        displayName,
        email,
        departmentUnitId: department.id,
        departmentName: department.name,
        positionId: isLead ? leadPosition?.id || null : null,
        isLead,
        row: row + 1,
      })
      departmentIndex++
    }
  }

  // Đối chiếu với thành viên hiện tại trong Chapter
  const currentMemberByEmail = new Map(currentMembers.map((m) => [m.email.toLowerCase(), m]))
  const candidateEmails = new Set(candidates.map((c) => c.email))

  // Kiểm tra thành viên thuộc khối DNA: không được phép gán vào ban Chapter
  const dnaUsers = await prisma.user.findMany({
    where: {
      email: { in: Array.from(candidateEmails) },
      organization_memberships: {
        some: {
          status: 'ACTIVE',
          unit: { type: { in: ['DNA', 'DNA_GROUP'] } },
        },
      },
    },
    select: { email: true, display_name: true },
  })
  const dnaEmailSet = new Set(dnaUsers.map((u) => u.email.toLowerCase()))

  // 1. Phân bổ người trong sheet khớp với thành viên Chapter
  const matchedCandidateItems: any[] = []
  // 2. Edge Case 1: Người trong sheet nhưng chưa có trong Chapter
  const unmatchedSheetMembers: Array<{
    displayName: string
    email: string
    departmentName: string
    isLead: boolean
    row: number
    statusNote: string
  }> = []

  for (const c of candidates) {
    if (dnaEmailSet.has(c.email.toLowerCase())) {
      errors.push({
        row: c.row,
        column: c.departmentName,
        value: `${c.displayName} (${c.email})`,
        message: `Tài khoản ${c.email} là thành viên Khối DNA, không được xếp vào Ban của Chapter.`,
      })
      continue
    }

    const matched = currentMemberByEmail.get(c.email)
    if (matched) {
      matchedCandidateItems.push({
        ...c,
        userId: matched.userId,
        currentDisplayName: matched.displayName,
      })
    } else {
      unmatchedSheetMembers.push({
        displayName: c.displayName,
        email: c.email,
        departmentName: c.departmentName,
        isLead: c.isLead,
        row: c.row,
        statusNote: 'Chưa có trong Chapter này',
      })
    }
  }

  // 3. Edge Case 2: Thành viên Chapter hiện tại nhưng KHÔNG có tên trong sheet
  const unmatchedCurrentMembers: Array<{
    userId: string
    displayName: string
    email: string
    currentDepartmentName: string
  }> = []

  for (const m of currentMembers) {
    if (m.role === 'CHAPTER_LEADER' || m.role === 'ADMIN' || m.email === 'chapter.lead.demo@bbe.vn') continue
    if (!candidateEmails.has(m.email.toLowerCase())) {
      unmatchedCurrentMembers.push({
        userId: m.userId,
        displayName: m.displayName || m.email.split('@')[0],
        email: m.email,
        currentDepartmentName: m.department?.name || 'Chưa phân ban',
      })
    }
  }

  // Tổ chức 8 cột Nhiệm kỳ mới cho các thành viên khớp
  const matchedNewTerm = ORDERED_CHAPTER_ROSTER.map((banName) => {
    const dept = departments.find((d) => normalized(d.name) === normalized(banName))
    const deptItems = matchedCandidateItems.filter((item) => normalized(item.departmentName) === normalized(banName))
    const lead = deptItems.find((item) => item.isLead) || deptItems[0] || null
    return {
      departmentId: dept?.id || null,
      departmentName: banName,
      lead,
      members: deptItems,
      total: deptItems.length,
    }
  })

  return NextResponse.json({
    sourceUrl: body.url,
    items: matchedCandidateItems,
    matchedNewTerm,
    unmatchedSheetMembers,
    unmatchedCurrentMembers,
    errors,
    valid: errors.length === 0,
    summary: {
      totalInSheet: candidates.length,
      matchedInChapter: matchedCandidateItems.length,
      unmatchedSheetCount: unmatchedSheetMembers.length,
      unmatchedCurrentCount: unmatchedCurrentMembers.length,
      departments: departments.length,
    },
  })
}
