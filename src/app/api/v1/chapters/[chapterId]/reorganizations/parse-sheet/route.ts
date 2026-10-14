import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { parseCsv, extractGoogleDocRef, buildGoogleExportUrl } from '@/lib/quiz/import'
import { prisma } from '@/lib/prisma'

const MEMBER_PATTERN = /^\s*(.*?)\s*\(([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\)\s*$/i
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export async function POST(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context!.role !== 'ADMIN' && !await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS')) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }
  const body = await request.json().catch(() => ({}))
  const ref = extractGoogleDocRef(String(body?.url || ''))
  if (!ref || ref.kind !== 'sheet') return NextResponse.json({ error: { code: 'ValidationError', message: 'Cần link Google Sheet hợp lệ.' } }, { status: 400 })
  const response = await fetch(buildGoogleExportUrl(ref), { cache: 'no-store', redirect: 'follow' })
  const text = await response.text().catch(() => '')
  if (!response.ok || response.url.includes('accounts.google.com') || /^<!DOCTYPE html/i.test(text)) {
    return NextResponse.json({ error: { code: 'DocumentNotPublic', message: 'Hãy bật “Bất kỳ ai có liên kết – Người xem”.' } }, { status: 400 })
  }
  const chapter = await prisma.chapter.findUnique({ where: { id: params.chapterId }, select: { organization_unit_id: true } })
  if (!chapter?.organization_unit_id) return NextResponse.json({ error: { code: 'ChapterOrganizationMissing' } }, { status: 409 })
  const [departments, leadPosition] = await Promise.all([
    prisma.organizationUnit.findMany({ where: { parent_id: chapter.organization_unit_id, type: 'DEPARTMENT', status: 'ACTIVE' }, select: { id: true, name: true } }),
    prisma.position.findFirst({ where: { code: 'DEPARTMENT_LEAD' }, select: { id: true } }),
  ])
  const rows = parseCsv(text)
  if (rows.length < 2) return NextResponse.json({ error: { code: 'SheetEmpty', message: 'Sheet chưa có dữ liệu thành viên.' } }, { status: 400 })
  const headers = rows[0]
  const candidates: Array<{ displayName: string; email: string; departmentUnitId: string; departmentName: string; positionId: string | null; isLead: boolean; row: number }> = []
  const errors: Array<{ row: number; column: string; value: string; message: string }> = []

  for (let column = 0; column < headers.length; column++) {
    const header = (headers[column] || '').trim()
    if (!header) continue
    const department = departments.find((item) => normalized(item.name) === normalized(header))
    if (!department) {
      errors.push({ row: 1, column: header, value: header, message: 'Tên cột chưa khớp với Ban trong hệ thống.' })
      continue
    }
    let departmentIndex = 0
    for (let row = 1; row < rows.length; row++) {
      const value = (rows[row]?.[column] || '').trim()
      if (!value) continue
      const match = value.match(MEMBER_PATTERN)
      if (!match) { errors.push({ row: row + 1, column: header, value, message: 'Dùng định dạng Họ tên (email@domain.com).' }); continue }
      candidates.push({ displayName: match[1].trim(), email: match[2].toLowerCase(), departmentUnitId: department.id, departmentName: department.name, positionId: departmentIndex === 0 ? leadPosition?.id || null : null, isLead: departmentIndex === 0, row: row + 1 })
      departmentIndex++
    }
  }
  const duplicateEmails = new Set<string>()
  const seen = new Set<string>()
  candidates.forEach((item) => { if (seen.has(item.email)) duplicateEmails.add(item.email); seen.add(item.email) })
  const users = await prisma.user.findMany({ where: { email: { in: Array.from(seen) } }, select: { id: true, email: true, display_name: true } })
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]))
  const items = candidates.map((candidate) => {
    const user = byEmail.get(candidate.email)
    let validationError: string | null = null
    if (!user) validationError = 'Email chưa có tài khoản trong hệ thống.'
    else if (duplicateEmails.has(candidate.email)) validationError = 'Email xuất hiện ở nhiều Ban.'
    if (validationError) errors.push({ row: candidate.row, column: candidate.departmentName, value: candidate.email, message: validationError })
    return { ...candidate, userId: user?.id || null, currentDisplayName: user?.display_name || null, validationError }
  })
  return NextResponse.json({ sourceUrl: body.url, items, errors, valid: errors.length === 0, summary: { departments: departments.length, members: items.length, leads: items.filter((item) => item.isLead).length } })
}
