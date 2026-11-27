import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { applyCourseDraft } from '../lib/apply-course-draft'
import { courseDraftSnapshot } from '../lib/course-draft-snapshot'
import { GradingQuestion, gradeQuizAttempt } from '../lib/quiz-attempt-rules'
import { QUIZ_PASS_PERCENT } from '../lib/config/quiz'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [COURSE, SESSION, LESSON, ASSESSMENT, Q1, POOL, OPTION_A, OPTION_B, ADMIN] = [1, 2, 3, 4, 5, 6, 7, 8, 10].map(id)
const now = new Date('2026-11-20T03:00:00Z')

interface QuestionRow { id: string; assessment_id: string; question_text: string; question_type: string; points: number; explanation: string | null; sort_order: number; pool_id: string | null; archived_at: Date | null }
interface OptionRow { id: string; question_id: string; option_text: string; is_correct: boolean; sort_order: number }

/** Stateful in-memory bank: Q1 has A (sai) and B (đúng); `attempted` adds one AttemptQuestion reference. */
function bank(attempted: boolean) {
  let generated = 100
  const questions = new Map<string, QuestionRow>([[Q1, { id: Q1, assessment_id: ASSESSMENT, question_text: 'Thủ đô Việt Nam?', question_type: 'SINGLE_CHOICE', points: 1, explanation: null, sort_order: 0, pool_id: POOL, archived_at: null }]])
  const options = new Map<string, OptionRow>([
    [OPTION_A, { id: OPTION_A, question_id: Q1, option_text: 'Hà Nội', is_correct: false, sort_order: 0 }],
    [OPTION_B, { id: OPTION_B, question_id: Q1, option_text: 'Huế', is_correct: true, sort_order: 1 }],
  ])
  const references = new Map([[Q1, attempted ? 1 : 0]])
  const optionsOf = (questionId: string) => Array.from(options.values()).filter(o => o.question_id === questionId).sort((a, b) => a.sort_order - b.sort_order)
  const activeQuestions = () => Array.from(questions.values()).filter(q => q.archived_at === null).sort((a, b) => a.sort_order - b.sort_order)
  const row = () => ({ id: COURSE, title: 'Khóa học', description: null, visibility: 'PRIVATE', cover_url: null, cover_public_id: null, final_assessment: null,
    sessions: [{ id: SESSION, title: 'Buổi 1', description: null, sort_order: 0,
      lessons: [{ id: LESSON, title: 'Bài 1', description: null, sort_order: 0, video: { youtube_video_id: 'abcdefghijk', duration_seconds: 60 }, documents: [],
        assessment: { id: ASSESSMENT, title: 'Quiz bài 1', description: null, question_count: 1, duration_minutes: 30, _count: { attempts: attempted ? 1 : 0 },
          questions: activeQuestions().map(q => ({ ...q, options: optionsOf(q.id), _count: { attempt_questions: references.get(q.id) ?? 0, attempt_answers: 0 } })),
          question_pools: [{ id: POOL, name: 'Nhóm 1', sort_order: 0 }] } }] }] })

  const tx: any = {}
  for (const table of ['course', 'session', 'lesson', 'video', 'document', 'assessment', 'questionPool']) {
    tx[table] = {}
    for (const op of ['update', 'create', 'delete', 'deleteMany', 'upsert']) tx[table][op] = async (args: any) => ({ id: args.where?.id || id(generated++), ...args.data })
  }
  tx.course.findUniqueOrThrow = async () => row()
  tx.assessment.findUnique = async () => null // no final exam
  tx.attempt = { count: async () => 0 } // nothing locks this month's config
  tx.question = {
    update: async ({ where, data }: any) => Object.assign(questions.get(where.id)!, data),
    create: async ({ data }: any) => { const q = { id: id(generated++), archived_at: null, ...data }; questions.set(q.id, q); return q },
    deleteMany: async ({ where }: any) => { for (const qid of where.id.in) questions.delete(qid); return { count: where.id.in.length } },
  }
  tx.questionOption = {
    update: async ({ where, data }: any) => Object.assign(options.get(where.id)!, data),
    create: async ({ data }: any) => { const o = { id: id(generated++), ...data }; options.set(o.id, o); return o },
    deleteMany: async ({ where }: any) => { for (const oid of where.id.in) if (options.get(oid)?.question_id === where.question_id) options.delete(oid); return { count: 0 } },
  }
  /** Admin turns the answer key from B to A, then publishes the draft. */
  const publishAnswerA = () => {
    const content = courseDraftSnapshot(row() as any)
    const [a, b] = content.sessions[0].lessons[0].assessment!.questions[0].options
    a.isCorrect = true
    b.isCorrect = false
    return applyCourseDraft(tx as Prisma.TransactionClient, COURSE, content, ADMIN, now)
  }
  /** The same mapping the submit flow uses when an attempt question has no stored snapshot. */
  const grading = (questionId: string): GradingQuestion => {
    const q = questions.get(questionId)!
    return { id: q.id, points: q.points, explanation: q.explanation, options: optionsOf(q.id).map(o => ({ id: o.id, text: o.option_text, correct: o.is_correct })) }
  }
  return { questions, optionsOf, activeQuestions, publishAnswerA, grading }
}

const grade = (question: GradingQuestion, selectedOptionId: string) =>
  gradeQuizAttempt([question], [{ questionId: question.id, selectedOptionId }], QUIZ_PASS_PERCENT / 100)

describe('đổi đáp án đúng B -> A của câu hỏi Quiz', () => {
  it('câu đã có lượt làm: lưu trữ câu cũ, tạo câu mới đáp án A, lượt mới chấm theo A, lịch sử cũ vẫn đúng theo B', async () => {
    const f = bank(true)
    const oldSnapshot = f.grading(Q1) // question_snapshot stored on the historical attempt
    await f.publishAnswerA()

    const archived = f.questions.get(Q1)!
    assert.deepEqual(archived.archived_at, now)
    assert.equal(archived.pool_id, null)
    assert.deepEqual(f.optionsOf(Q1).map(o => [o.id, o.is_correct]), [[OPTION_A, false], [OPTION_B, true]], 'old answer key untouched')

    const active = f.activeQuestions()
    assert.equal(active.length, 1)
    const q2 = active[0]
    assert.notEqual(q2.id, Q1)
    assert.equal(q2.pool_id, POOL)
    assert.equal(q2.question_text, 'Thủ đô Việt Nam?')
    const [newA, newB] = f.optionsOf(q2.id)
    assert.deepEqual([newA.option_text, newA.is_correct, newB.option_text, newB.is_correct], ['Hà Nội', true, 'Huế', false])
    assert.ok(![OPTION_A, OPTION_B].includes(newA.id) && ![OPTION_A, OPTION_B].includes(newB.id), 'new question owns new options')

    // A new attempt only draws active questions, so it gets Q2 and A is correct.
    const newAttempt = grade(f.grading(q2.id), newA.id)
    assert.equal(newAttempt.results[0].isCorrect, true)
    assert.equal(newAttempt.scoreRatio, 1)
    assert.equal(newAttempt.passed, true)
    assert.equal(grade(f.grading(q2.id), newB.id).results[0].isCorrect, false)

    // Historical attempts keep grading against B, both by snapshot and by the archived row.
    assert.equal(grade(oldSnapshot, OPTION_B).results[0].isCorrect, true)
    assert.equal(grade(oldSnapshot, OPTION_A).results[0].isCorrect, false)
    assert.equal(grade(f.grading(Q1), OPTION_B).results[0].isCorrect, true)
  })

  it('câu chưa có lượt làm: cập nhật đáp án tại chỗ, lượt mới chọn A được chấm đúng', async () => {
    const f = bank(false)
    await f.publishAnswerA()

    const active = f.activeQuestions()
    assert.deepEqual(active.map(q => q.id), [Q1], 'no archive, no copy')
    assert.equal(f.questions.size, 1)
    assert.equal(f.questions.get(Q1)!.archived_at, null)
    assert.deepEqual(f.optionsOf(Q1).map(o => [o.id, o.is_correct]), [[OPTION_A, true], [OPTION_B, false]])

    const attempt = grade(f.grading(Q1), OPTION_A)
    assert.equal(attempt.results[0].isCorrect, true)
    assert.equal(attempt.scoreRatio, 1)
    assert.equal(grade(f.grading(Q1), OPTION_B).results[0].isCorrect, false)
  })
})
