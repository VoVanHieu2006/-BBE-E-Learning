import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { validateQuizPoolAssignments } from '@/lib/quiz-pool-selection'

/** Admin management for the five module-question pools. */
export async function GET(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const pools = await prisma.questionPool.findMany({
    where: { assessment_id: params.assessmentId },
    include: { _count: { select: { questions: true } } }, orderBy: { sort_order: 'asc' },
  })
  return NextResponse.json({ items: pools.map((pool) => ({ poolId: pool.id, name: pool.name, sortOrder: pool.sort_order, questionCount: pool._count.questions })) })
}

export async function PUT(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const pools = Array.isArray(body.pools) ? body.pools : []
  if (pools.length !== 5 || pools.some((pool: unknown) => !pool || typeof (pool as any).name !== 'string' || !(pool as any).name.trim())) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Exactly five named pools are required.' } }, { status: 400 })
  }
  const assessment = await prisma.assessment.findUnique({ where: { id: params.assessmentId }, select: { id: true, type: true } })
  if (!assessment) return NextResponse.json({ error: { code: 'AssessmentNotFound' } }, { status: 404 })
  if (assessment.type === 'COURSE_FINAL') return NextResponse.json({ error: { code: 'UseFinalExamEditor', message: 'Bài thi cuối khóa phải được cập nhật bằng phiên bản mới.' } }, { status: 409 })

  const questions = await prisma.question.findMany({
    where: { assessment_id: assessment.id },
    select: { id: true },
  })
  const rawAssignments = body.questionAssignments
  if (!Array.isArray(rawAssignments) || rawAssignments.some((assignment: unknown) =>
    !assignment || typeof (assignment as any).questionId !== 'string' || typeof (assignment as any).poolIndex !== 'number'
  )) {
    return NextResponse.json({ error: { code: 'QuestionPoolAssignmentRequired', message: 'Provide one pool assignment for every quiz question.' } }, { status: 400 })
  }
  const assignmentValidation = validateQuizPoolAssignments(
    pools.length,
    questions.map((question) => question.id),
    rawAssignments,
  )
  if (assignmentValidation.ok === false) {
    return NextResponse.json({ error: { code: assignmentValidation.code, message: 'Pool mapping must assign every question exactly once, with at least three questions per pool.' } }, { status: 400 })
  }

  const attempts = await prisma.attempt.count({ where: { assessment_id: params.assessmentId } })
  if (attempts) return NextResponse.json({ error: { code: 'AssessmentVersionRequired' } }, { status: 409 })
  const result = await prisma.$transaction(async (tx) => {
    await tx.question.updateMany({ where: { assessment_id: params.assessmentId }, data: { pool_id: null } })
    await tx.questionPool.deleteMany({ where: { assessment_id: params.assessmentId } })
    await tx.questionPool.createMany({ data: pools.map((pool: any, index: number) => ({ assessment_id: params.assessmentId, name: pool.name.trim(), sort_order: index })) })
    const createdPools = await tx.questionPool.findMany({ where: { assessment_id: params.assessmentId }, orderBy: { sort_order: 'asc' } })
    for (let poolIndex = 0; poolIndex < createdPools.length; poolIndex++) {
      const questionIds = Object.entries(assignmentValidation.poolIndexByQuestionId)
        .filter(([, assignedPoolIndex]) => assignedPoolIndex === poolIndex)
        .map(([questionId]) => questionId)
      await tx.question.updateMany({
        where: { assessment_id: params.assessmentId, id: { in: questionIds } },
        data: { pool_id: createdPools[poolIndex].id },
      })
    }
    return createdPools
  })
  return NextResponse.json({ items: result.map((pool) => ({ poolId: pool.id, name: pool.name, sortOrder: pool.sort_order })) })
}
