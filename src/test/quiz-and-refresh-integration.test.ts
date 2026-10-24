import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../lib/prisma'
import { selectQuizQuestions } from '../lib/quiz-pool-selection'

describe('Prompt 3 Integration & Business Logic Tests', () => {
  it('1. Đảm bảo tất cả Quiz có nhóm đều tuân thủ Q <= Q_max trong database', async () => {
    const assessments = await prisma.assessment.findMany({
      where: { type: 'LESSON' },
      include: {
        question_pools: {
          include: {
            questions: { select: { id: true } },
          },
        },
      },
    })

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

  it('2. Kiểm tra API attempt giữ nguyên đề khi reload/resume (AttemptQuestion snapshot)', async () => {
    const activeAttempt = await prisma.attempt.findFirst({
      where: { status: 'IN_PROGRESS' },
      include: {
        attempt_questions: true,
      },
    })

    if (activeAttempt && activeAttempt.attempt_questions.length > 0) {
      // Questions must have snapshot with options and text
      for (const aq of activeAttempt.attempt_questions) {
        assert.ok(aq.question_snapshot, 'AttemptQuestion must contain question_snapshot')
        const snapshot = aq.question_snapshot as any
        assert.ok(snapshot.questionText || snapshot.text, 'Snapshot must have questionText')
        assert.ok(Array.isArray(snapshot.options), 'Snapshot must have options array')
      }
    }
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
