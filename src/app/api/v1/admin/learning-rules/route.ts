import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseLearningRuleInput } from '@/lib/learning-rule-rules'
import { Prisma } from '@prisma/client'
import { normalizeOrganizationPagination, normalizeOrganizationSearch } from '@/lib/organization-admin-rules'

/** Admin configuration of target-based learning rules; assignment is materialized separately. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const params = new URL(request.url).searchParams
  const search = normalizeOrganizationSearch(params.get('search'))
  const where: Prisma.LearningRuleWhereInput = search ? { OR: [
    { course: { title: { contains: search, mode: 'insensitive' } } },
    { organization_unit: { name: { contains: search, mode: 'insensitive' } } },
    { position: { code: { contains: search, mode: 'insensitive' } } },
    { position: { name: { contains: search, mode: 'insensitive' } } },
  ] } : {}
  const total = await prisma.learningRule.count({ where })
  const pagination = normalizeOrganizationPagination(params.get('page'), params.get('limit'), total)
  const items = await prisma.learningRule.findMany({
    where,
    include: { course: { select: { title: true } }, organization_unit: { select: { name: true, type: true } }, position: { select: { name: true, code: true } } },
    orderBy: { created_at: 'desc' },
    skip: pagination.skip,
    take: pagination.limit,
  })
  return NextResponse.json({
    items,
    pagination: { page: pagination.page, limit: pagination.limit, total: pagination.total, totalPages: pagination.totalPages },
  })
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const body = await request.json().catch(() => null)
  const parsed = parseLearningRuleInput(body)
  if (parsed.ok === false) {
    return NextResponse.json({ error: { code: parsed.code, message: parsed.message } }, { status: 400 })
  }
  const input = parsed.value
  const [course, organizationUnit, position] = await Promise.all([
    prisma.course.findUnique({ where: { id: input.courseId }, select: { id: true } }),
    input.organizationUnitId
      ? prisma.organizationUnit.findUnique({ where: { id: input.organizationUnitId }, select: { id: true } })
      : Promise.resolve(null),
    input.positionId
      ? prisma.position.findUnique({ where: { id: input.positionId }, select: { id: true } })
      : Promise.resolve(null),
  ])
  if (!course) return NextResponse.json({ error: { code: 'CourseNotFound' } }, { status: 404 })
  if (input.organizationUnitId && !organizationUnit) return NextResponse.json({ error: { code: 'OrganizationUnitNotFound' } }, { status: 404 })
  if (input.positionId && !position) return NextResponse.json({ error: { code: 'PositionNotFound' } }, { status: 404 })

  const rule = await prisma.learningRule.create({
    data: {
      course_id: course.id,
      organization_unit_id: input.organizationUnitId,
      position_id: input.positionId,
      mandatory: input.mandatory,
      can_view: input.canView,
      can_assess: input.canAssess,
      can_earn_stars: input.canEarnStars,
      due_days: input.dueDays,
      effective_from: input.effectiveFrom,
      effective_until: input.effectiveUntil,
    },
  })
  return NextResponse.json({ rule }, { status: 201 })
}
