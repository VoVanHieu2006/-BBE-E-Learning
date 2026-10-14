import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { prisma } from '@/lib/prisma'

/** Preview-confirmed, future department/LT changes. Google Sheet clients submit the validated preview rows here. */
export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context!.role !== 'ADMIN' && !await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS')) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const items = await prisma.chapterReorganization.findMany({ where: { chapter_id: params.chapterId }, include: { items: true }, orderBy: { effective_at: 'desc' } })
  return NextResponse.json({ items })
}

export async function POST(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context!.role !== 'ADMIN' && !await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS')) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const body = await request.json().catch(() => null)
  const effectiveAt = body?.effectiveAt ? new Date(body.effectiveAt) : null
  const rows = Array.isArray(body?.items) ? body.items : []
  if (!effectiveAt || !Number.isFinite(effectiveAt.getTime()) || effectiveAt <= new Date() || !rows.length || rows.some((row: any) => !row || typeof row.userId !== 'string' || typeof row.departmentUnitId !== 'string' || (row.positionId != null && typeof row.positionId !== 'string') || (row.displayName != null && (typeof row.displayName !== 'string' || row.displayName.trim().length < 2 || row.displayName.trim().length > 120)))) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Ngày hiệu lực phải ở tương lai và mỗi dòng cần userId, departmentUnitId.' } }, { status: 400 })
  }
  if (new Set(rows.map((row: any) => row.userId)).size !== rows.length) return NextResponse.json({ error: { code: 'DuplicateUser' } }, { status: 400 })
  const chapter = await prisma.chapter.findUnique({ where: { id: params.chapterId }, select: { organization_unit_id: true } })
  if (!chapter?.organization_unit_id) return NextResponse.json({ error: { code: 'ChapterNotFound' } }, { status: 404 })
  const allowedUnits = new Set(await getOrganizationUnitTreeIds(chapter.organization_unit_id))
  const departments = await prisma.organizationUnit.findMany({ where: { id: { in: rows.map((row: any) => row.departmentUnitId) } }, select: { id: true, type: true } })
  if (departments.length !== new Set(rows.map((row: any) => row.departmentUnitId)).size || departments.some((unit) => unit.type !== 'DEPARTMENT' || !allowedUnits.has(unit.id))) return NextResponse.json({ error: { code: 'DepartmentScopeInvalid' } }, { status: 400 })
  const batch = await prisma.chapterReorganization.create({ data: { chapter_id: params.chapterId, effective_at: effectiveAt, status: 'SCHEDULED', source_url: typeof body.sourceUrl === 'string' ? body.sourceUrl.slice(0, 2000) : null, created_by_user_id: auth.context!.userId, confirmed_at: new Date(), items: { create: rows.map((row: any) => ({ user_id: row.userId, display_name: row.displayName?.trim() || null, department_unit_id: row.departmentUnitId, position_id: row.positionId || null, is_primary: row.isPrimary !== false })) } }, include: { items: true } })
  return NextResponse.json({ item: batch }, { status: 201 })
}
