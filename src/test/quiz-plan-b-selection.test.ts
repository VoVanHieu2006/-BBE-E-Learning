import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { selectQuizQuestions, QuizQuestionPool } from '../lib/quiz-pool-selection'

describe('Quiz Pool Selection — Plan B Standardized Algorithm', () => {
  const identityShuffle = <T>(items: readonly T[]): T[] => [...items]
  const reverseShuffle = <T>(items: readonly T[]): T[] => [...items].reverse()

  const createPools = (names: string[]): QuizQuestionPool[] =>
    names.map((name) => ({ id: name }))

  const createQuestions = (counts: Record<string, number>) => {
    const list: { id: string; poolId: string }[] = []
    for (const [poolId, count] of Object.entries(counts)) {
      for (let i = 1; i <= count; i++) {
        list.push({ id: `${poolId}_q${i}`, poolId })
      }
    }
    return list
  }

  it('Ví dụ 1: 5-5-5, cấu hình 9 câu -> 3-3-3 chia đều tuyệt đối', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 5, B: 5, C: 5 })
    const result = selectQuizQuestions(pools, questions, identityShuffle, 9)

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.questions.length, 9)
    assert.deepEqual(result.quotas, [3, 3, 3])
    // Verify each pool has exactly 3 questions
    assert.equal(result.questions.filter((q) => q.poolId === 'A').length, 3)
    assert.equal(result.questions.filter((q) => q.poolId === 'B').length, 3)
    assert.equal(result.questions.filter((q) => q.poolId === 'C').length, 3)
    // Verify all IDs are unique
    assert.equal(new Set(result.questions.map((q) => q.id)).size, 9)
  })

  it('Ví dụ 2: 5-5-5, cấu hình 8 câu -> phân phối 3-3-2 (chênh lệch <= 1)', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 5, B: 5, C: 5 })
    const result = selectQuizQuestions(pools, questions, identityShuffle, 8)

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.questions.length, 8)
    // Quotas must be a permutation of [3, 3, 2]
    const sortedQuotas = [...result.quotas].sort((a, b) => b - a)
    assert.deepEqual(sortedQuotas, [3, 3, 2])
    assert.ok(Math.max(...result.quotas) - Math.min(...result.quotas) <= 1)
  })

  it('5-5-5, cấu hình 7 câu -> phân phối 3-2-2', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 5, B: 5, C: 5 })
    const result = selectQuizQuestions(pools, questions, identityShuffle, 7)

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.questions.length, 7)
    const sortedQuotas = [...result.quotas].sort((a, b) => b - a)
    assert.deepEqual(sortedQuotas, [3, 2, 2])
  })

  it('Ví dụ 3: 3-5-6, cấu hình 9 câu -> 3-3-3 (Q_max = 3 x 3 = 9)', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 3, B: 5, C: 6 })
    const result = selectQuizQuestions(pools, questions, identityShuffle, 9)

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.questions.length, 9)
    assert.deepEqual(result.quotas, [3, 3, 3])
  })

  it('Ví dụ 3 (tiếp): 3-5-6, cấu hình 8 câu -> 3-3-2', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 3, B: 5, C: 6 })
    const result = selectQuizQuestions(pools, questions, identityShuffle, 8)

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.questions.length, 8)
    const sortedQuotas = [...result.quotas].sort((a, b) => b - a)
    assert.deepEqual(sortedQuotas, [3, 3, 2])
  })

  it('Ví dụ 3 (tiếp): 3-5-6, cấu hình 6 câu -> 2-2-2', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 3, B: 5, C: 6 })
    const result = selectQuizQuestions(pools, questions, identityShuffle, 6)

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.questions.length, 6)
    assert.deepEqual(result.quotas, [2, 2, 2])
  })

  it('Ví dụ 4: 3-5-6, cấu hình 10 câu -> TỪ CHỐI (Q_max = 9, không dùng cơ chế deficit lấy bù)', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 3, B: 5, C: 6 })
    const result = selectQuizQuestions(pools, questions, identityShuffle, 10)

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'QuestionPoolQuotaExceeded')
    assert.equal(result.maxAllowed, 9)
    assert.equal(result.minCount, 3)
  })

  it('0-5-6, cấu hình 9 câu -> TỪ CHỐI QuestionPoolIncomplete (nhóm 0 câu)', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 0, B: 5, C: 6 })
    const result = selectQuizQuestions(pools, questions, identityShuffle, 9)

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'QuestionPoolIncomplete')
  })

  it('3-5-6, cấu hình 2 câu -> TỪ CHỐI (Q < K = 3)', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 3, B: 5, C: 6 })
    const result = selectQuizQuestions(pools, questions, identityShuffle, 2)

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'QuestionPoolCountInvalid')
  })

  it('Random câu dư không cố định nhóm đầu tiên qua các lần chọn', () => {
    const pools = createPools(['A', 'B', 'C'])
    const questions = createQuestions({ A: 5, B: 5, C: 5 })

    // Simulate different shuffle behaviors (or PRNG seeds)
    const extraCounts = { A: 0, B: 0, C: 0 }
    const iterations = 300

    for (let i = 0; i < iterations; i++) {
      // Pseudo-random Fisher-Yates
      const seedShuffle = <T>(items: readonly T[]): T[] => {
        const arr = [...items]
        for (let j = arr.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1))
          ;[arr[j], arr[k]] = [arr[k], arr[j]]
        }
        return arr
      }

      const result = selectQuizQuestions(pools, questions, seedShuffle, 8) // Q=8, K=3 -> base=2, remainder=2 (two groups receive 3, one receives 2)
      assert.equal(result.ok, true)
      if (result.ok) {
        if (result.quotas[0] === 3) extraCounts.A++
        if (result.quotas[1] === 3) extraCounts.B++
        if (result.quotas[2] === 3) extraCounts.C++
      }
    }

    // Each pool should receive extra question roughly 2/3 of the time (~200 times)
    // Ensure all 3 pools received extra questions and none was 0 or 100%
    assert.ok(extraCounts.A > 50, `A got extra ${extraCounts.A} times`)
    assert.ok(extraCounts.B > 50, `B got extra ${extraCounts.B} times`)
    assert.ok(extraCounts.C > 50, `C got extra ${extraCounts.C} times`)
  })

  it('Không có ID câu hỏi nào bị trùng trong cùng một attempt', () => {
    const pools = createPools(['P1', 'P2', 'P3', 'P4'])
    const questions = createQuestions({ P1: 8, P2: 8, P3: 8, P4: 8 })

    for (let iter = 0; iter < 50; iter++) {
      const result = selectQuizQuestions(pools, questions, (items) => [...items].sort(() => Math.random() - 0.5), 15)
      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(result.questions.length, 15)
      const ids = result.questions.map((q) => q.id)
      const uniqueIds = new Set(ids)
      assert.equal(uniqueIds.size, ids.length, 'Duplicate question ID detected')
    }
  })
})
