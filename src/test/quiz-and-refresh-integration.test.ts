import '../../scripts/test/require-test-database.cjs'
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { selectQuizQuestions } from '../lib/quiz-pool-selection'
const fixture = {
  key: randomUUID(), adminId: randomUUID(), learnerId: randomUUID(), courseId: randomUUID(),
  lessonId: randomUUID(), assessmentId: randomUUID(), attemptId: randomUUID(),
}

before(async () => {
  // Create a complete, owned lesson quiz even when the disposable database is empty.
  await prisma.$transaction(async tx => {
    await tx.user.createMany({ data: [
      { id: fixture.adminId, email: `quiz-admin-${fixture.key}@test.invalid`, password_hash: 'test-only', role: 'ADMIN' },
      { id: fixture.learnerId, email: `quiz-learner-${fixture.key}@test.invalid`, password_hash: 'test-only', role: 'MEMBER' },
    ] })
    await tx.course.create({ data: {
      id: fixture.courseId, title: `Quiz fixture ${fixture.key}`, created_by: fixture.adminId,
      sessions: { create: { title: 'Fixture session', sort_order: 0, lessons: { create: {
        id: fixture.lessonId, title: 'Fixture lesson', sort_order: 0,
      } } } },
    } })
    await tx.assessment.create({ data: {
      id: fixture.assessmentId, lesson_id: fixture.lessonId, type: 'LESSON',
      title: `Grouped quiz fixture ${fixture.key}`, created_by: fixture.adminId, question_count: 8,
    } })
    const pools: Array<{ id: string }> = []
    const questions: Array<{ id: string; poolId: string; questionText: string; options: Array<{ id: string; text: string; correct: boolean }> }> = []
    for (const poolIndex of [0, 1, 2]) {
      const count = [3, 5, 6][poolIndex]
      const pool = await tx.questionPool.create({ data: {
        assessment_id: fixture.assessmentId, name: `Pool ${poolIndex + 1}`, sort_order: poolIndex,
      } })
      pools.push(pool)
      for (let index = 0; index < count; index++) {
        const question = await tx.question.create({ data: {
          assessment_id: fixture.assessmentId, pool_id: pool.id,
          question_text: `Pool ${poolIndex + 1} question ${index + 1}`, sort_order: poolIndex * 10 + index,
          options: { create: [
            { option_text: 'Correct answer', is_correct: true, sort_order: 0 },
            { option_text: 'Other answer', is_correct: false, sort_order: 1 },
          ] },
        }, include: { options: true } })
        questions.push({
          id: question.id, poolId: pool.id, questionText: question.question_text,
          options: question.options.map(option => ({ id: option.id, text: option.option_text, correct: option.is_correct })),
        })
      }
    }
    const selected = selectQuizQuestions(pools, questions, items => [...items], 8)
    assert.ok(selected.ok, 'The owned grouped quiz must be valid')
    if (!selected.ok) throw new Error('Invalid quiz fixture')
    await tx.attempt.create({ data: {
      id: fixture.attemptId, assessment_id: fixture.assessmentId, user_id: fixture.learnerId,
      attempt_number: 1, status: 'IN_PROGRESS', started_at: new Date(), expires_at: new Date(Date.now() + 30 * 60_000),
      attempt_questions: { create: selected.questions.map((question, index) => ({
        question_id: question.id, display_order: index,
        question_snapshot: { id: question.id, questionText: question.questionText, points: 1, options: question.options },
      })) },
    } })
  })
})

after(async () => {
  try {
    await prisma.attempt.deleteMany({ where: { id: fixture.attemptId } })
    await prisma.course.deleteMany({ where: { id: fixture.courseId } })
    await prisma.user.deleteMany({ where: { id: { in: [fixture.adminId, fixture.learnerId] } } })
    await prisma.accountStateInterval.deleteMany({ where: { user_id: { in: [fixture.adminId, fixture.learnerId] } } })
  } finally {
    await prisma.$disconnect()
  }
})

describe('Quiz persistence and business rules', () => {
  it('1. Quiz có nhóm tuân thủ Q <= Q_max trên dữ liệu kiểm thử riêng', async () => {
    const assessments = await prisma.assessment.findMany({
      where: { id: fixture.assessmentId, type: 'LESSON' },
      include: {
        question_pools: {
          include: {
            questions: { select: { id: true } },
          },
        },
      },
    })

    assert.equal(assessments.length, 1, 'The suite must exercise an owned assessment')
    assert.equal(assessments[0].question_pools.length, 3, 'The fixture must have three non-empty pools')
    for (const a of assessments) {
      if (a.question_pools && a.question_pools.length > 0) {
        const counts = a.question_pools.map((p) => p.questions.length)
        const minCount = Math.min(...counts)
        const qMax = a.question_pools.length * minCount
        assert.ok(
          a.question_count <= qMax,
          `Assessment "${a.title}" có question_count=${a.question_count} vượt quá Q_max=${qMax}`
        )
      }
    }
  })

  it('2. AttemptQuestion giữ nguyên snapshot qua các lần đọc và sau khi câu hỏi nguồn thay đổi', async () => {
    const readAttempt = () => prisma.attempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      include: { attempt_questions: { orderBy: { display_order: 'asc' } } },
    })
    const activeAttempt = await readAttempt()
    assert.equal(activeAttempt.status, 'IN_PROGRESS')
    assert.equal(activeAttempt.attempt_questions.length, 8, 'Snapshot coverage must not be skipped on an empty database')
    for (const aq of activeAttempt.attempt_questions) {
      assert.ok(aq.question_snapshot, 'AttemptQuestion must contain question_snapshot')
      const snapshot = aq.question_snapshot as any
      assert.ok(snapshot.questionText || snapshot.text, 'Snapshot must have questionText')
      assert.ok(Array.isArray(snapshot.options), 'Snapshot must have options array')
      assert.equal(snapshot.options.length, 2)
    }
    await prisma.question.update({
      where: { id: activeAttempt.attempt_questions[0].question_id },
      data: { question_text: 'Updated source after attempt started' },
    })
    const reloaded = await readAttempt()
    assert.deepEqual(
      reloaded.attempt_questions.map(row => ({ questionId: row.question_id, order: row.display_order, snapshot: row.question_snapshot })),
      activeAttempt.attempt_questions.map(row => ({ questionId: row.question_id, order: row.display_order, snapshot: row.question_snapshot })),
      'Resuming must retain the saved question order and snapshots',
    )
  })

  it('3. Thuật toán chọn câu hỏi theo nhóm sinh ngẫu nhiên nhưng đúng số lượng và phân phối cân bằng', () => {
    const pools = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
    const questions = [
      { id: 'q1_1', poolId: 'p1' }, { id: 'q1_2', poolId: 'p1' }, { id: 'q1_3', poolId: 'p1' },
      { id: 'q2_1', poolId: 'p2' }, { id: 'q2_2', poolId: 'p2' }, { id: 'q2_3', poolId: 'p2' }, { id: 'q2_4', poolId: 'p2' }, { id: 'q2_5', poolId: 'p2' },
      { id: 'q3_1', poolId: 'p3' }, { id: 'q3_2', poolId: 'p3' }, { id: 'q3_3', poolId: 'p3' }, { id: 'q3_4', poolId: 'p3' }, { id: 'q3_5', poolId: 'p3' }, { id: 'q3_6', poolId: 'p3' },
    ]

    // minCount = 3, Q_max = 3 * 3 = 9
    // Test 8 câu: phân phối 3-3-2
    const randomShuffle = <T>(items: readonly T[]): T[] => {
      const arr = [...items]
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    }

    const res = selectQuizQuestions(pools, questions, randomShuffle, 8)
    assert.equal(res.ok, true)
    if (!res.ok) return
    assert.equal(res.questions.length, 8)
    assert.equal(new Set(res.questions.map((q) => q.id)).size, 8)
    const sorted = [...res.quotas].sort((a, b) => b - a)
    assert.deepEqual(sorted, [3, 3, 2])
  })

  it('4. Kiểm tra hàm chuẩn hóa tiếng Việt cho tìm kiếm bài học (có dấu, không dấu, hoa thường, đ/d)', () => {
    function normalizeVietnamese(str: string): string {
      if (!str) return ''
      return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .trim()
    }

    const title = 'Bài 3: Kỹ năng giao tiếp và Đàm phán hiệu quả'
    const normTitle = normalizeVietnamese(title)

    // Test có dấu
    assert.ok(normTitle.includes(normalizeVietnamese('Kỹ năng')))
    assert.ok(normTitle.includes(normalizeVietnamese('giao tiếp')))
    assert.ok(normTitle.includes(normalizeVietnamese('Đàm phán')))

    // Test không dấu
    assert.ok(normTitle.includes(normalizeVietnamese('ky nang')))
    assert.ok(normTitle.includes(normalizeVietnamese('giao tiep')))
    assert.ok(normTitle.includes(normalizeVietnamese('dam phan')))
    assert.ok(normTitle.includes(normalizeVietnamese('hieu qua')))

    // Test chữ hoa/thường lẫn lộn
    assert.ok(normTitle.includes(normalizeVietnamese('kỸ NĂnG')))
    assert.ok(normTitle.includes(normalizeVietnamese('DAM PHAN')))

    // Test không tìm thấy
    assert.ok(!normTitle.includes(normalizeVietnamese('lập trình python')))
  })
})
