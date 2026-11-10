import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { invalidateCourseContentCaches } from '@/lib/course-edit-guard'
import { prisma } from '@/lib/prisma'
import { PoolUpdateError, updateLessonPools } from '@/lib/assessment-pools'

export async function PUT(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const body = await request.json().catch(() => null)
  const pools = body?.pools
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.assessmentId) || !Array.isArray(pools) || pools.length < 1 || pools.length > 20 || pools.some(pool => !pool || typeof pool.name !== 'string' || !pool.name.trim() || pool.name.trim().length > 255)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'C\u1ea7n 1-20 nh\u00f3m c\u00f3 t\u00ean h\u1ee3p l\u1ec7.' } }, { status: 400 })
  }
  const assignments = body?.questionAssignments
  if (!Array.isArray(assignments) || assignments.some(row => !row || typeof row.questionId !== 'string' || !Number.isInteger(row.poolIndex))) {
    return NextResponse.json({ error: { code: 'QuestionPoolAssignmentRequired', message: 'C\u1ea7n g\u00e1n nh\u00f3m cho t\u1eebng c\u00e2u h\u1ecfi.' } }, { status: 400 })
  }
  try {
    const result = await prisma.$transaction(tx => updateLessonPools(tx, params.assessmentId, pools, assignments), { isolationLevel: 'Serializable' })
    invalidateCourseContentCaches()
    return NextResponse.json({ items: result.map(pool => ({ poolId: pool.id, name: pool.name, sortOrder: pool.sort_order })) })
  } catch (error) {
    if (error instanceof PoolUpdateError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    if ((error as { code?: string }).code === 'P2034') return NextResponse.json({ error: { code: 'ContentChanged', message: 'D\u1eef li\u1ec7u v\u1eeba thay \u0111\u1ed5i. Vui l\u00f2ng t\u1ea3i l\u1ea1i v\u00e0 th\u1eed l\u1ea1i.' } }, { status: 409 })
    throw error
  }
}
