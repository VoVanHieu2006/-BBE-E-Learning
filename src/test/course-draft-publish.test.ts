import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { applyCourseDraft } from '../lib/apply-course-draft'
import { courseDraftSnapshot } from '../lib/course-draft-snapshot'
import { CourseDraftError } from '../lib/course-draft'
import { courseEditBlock } from '../lib/course-edit-guard'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
/** Records the real publisher's writes without loading a DB or replacing business rules. */
function fixture(attempted = true) {
  const writes: { table: string; op: string; args: any }[] = []
  const q = { id: id(5), assessment_id: id(4), question_text: 'Câu gốc', question_type: 'SINGLE_CHOICE', points: 1, explanation: null, sort_order: 0, pool_id: id(6),
    options: [{ id: id(7), option_text: 'Đúng', is_correct: true, sort_order: 0 }, { id: id(8), option_text: 'Sai', is_correct: false, sort_order: 1 }],
    _count: { attempt_questions: attempted ? 1 : 0, attempt_answers: 0 } }
  const row: any = { id: id(1), title: 'Khóa gốc', description: null, visibility: 'PRIVATE', cover_url: null, cover_public_id: null, final_assessment: null,
    sessions: [{ id: id(2), title: 'Buổi gốc', description: null, sort_order: 0,
      lessons: [{ id: id(3), title: 'Bài gốc', description: null, sort_order: 0, video: { youtube_video_id: 'abcdefghijk', duration_seconds: 60 },
        documents: [{ id: id(9), file_name: 'doc', file_size: BigInt(1), mime_type: 'text/plain', storage_key: 'docs/key' }],
        assessment: { id: id(4), title: 'Quiz gốc', description: null, question_count: 1, duration_minutes: 30, _count: { attempts: attempted ? 1 : 0 },
          questions: [q], question_pools: [{ id: id(6), name: 'Nhóm gốc', sort_order: 0 }] },
      }],
    }],
  }
  let generated = 100
  const tables = ['course', 'session', 'lesson', 'video', 'document', 'assessment', 'question', 'questionOption', 'questionPool']
  const tx: any = {}
  for (const table of tables) {
    tx[table] = {}
    for (const op of ['update', 'create', 'delete', 'deleteMany', 'upsert']) tx[table][op] = async (args: any) => {
      writes.push({ table, op, args })
      return { id: args.where?.id || id(generated++), ...args.data }
    }
  }
  tx.course.findUniqueOrThrow = async () => row
  tx.assessment.findUnique = async () => null // no final exam configured
  const content = courseDraftSnapshot(row)
  return { row, content, writes, publish: () => applyCourseDraft(tx as Prisma.TransactionClient, row.id, content, id(10)) }
}

describe('applyCourseDraft with in-memory transaction', () => {
  it('published courses reject direct editing while draft courses remain editable', () => {
    const block = courseEditBlock('PUBLISHED')
    assert.equal(block?.status, 409)
    assert.equal(block?.body.error.code, 'CoursePublished')
    assert.equal(courseEditBlock('DRAFT'), null)
  })
  it('updates an attempted question exactly once in place, retaining its pool and options', async () => {
    const f = fixture()
    f.content.title = 'Tiêu đề mới'
    await f.publish()
    const updates = f.writes.filter(w => w.table === 'question' && w.op === 'update')
    assert.equal(updates.length, 1)
    assert.equal(updates[0].args.where.id, id(5))
    assert.equal(updates[0].args.data.pool_id, id(6))
    assert.equal(f.writes.filter(w => w.table === 'question' && w.op === 'create').length, 0)
    assert.equal(f.writes.filter(w => w.table === 'questionOption' && ['update', 'create', 'delete'].includes(w.op)).length, 0)
  })
  it('rejects deletion of an attempted lesson or session', async () => {
    for (const kind of ['lesson', 'session']) {
      const f = fixture()
      if (kind === 'lesson') f.content.sessions[0].lessons = []
      else f.content.sessions = []
      await assert.rejects(f.publish(), (e: unknown) => e instanceof CourseDraftError && e.status === 409 && e.code === (kind === 'lesson' ? 'LessonHasAttempts' : 'SessionHasAttempts'))
    }
  })
  it('rejects deleting or changing an attempted question instead of cloning it', async () => {
    const f = fixture()
    f.content.sessions[0].lessons[0].assessment!.questions[0].options[0].optionText = 'Đáp án đã đổi'
    await assert.rejects(f.publish(), (e: unknown) => e instanceof CourseDraftError && e.code === 'QuestionHasAttempts')
    assert.equal(f.writes.filter(w => w.table === 'question' && w.op === 'create').length, 0)
  })
  it('deletes omitted questions, options, documents and sessions when unused', async () => {
    const f = fixture(false)
    const lesson = f.content.sessions[0].lessons[0]
    lesson.documents = []
    lesson.assessment!.questions[0].options = [{ ...lesson.assessment!.questions[0].options[0] }, { id: 'temp-option', optionText: 'Mới', isCorrect: false }]
    await f.publish()
    assert.ok(f.writes.some(w => w.table === 'document' && w.op === 'deleteMany' && w.args.where.id.in.includes(id(9))))
    assert.ok(f.writes.some(w => w.table === 'questionOption' && w.op === 'deleteMany' && w.args.where.id.in.includes(id(8))))
    const omitted = fixture(false)
    omitted.content.sessions[0].lessons[0].assessment!.questions = []
    await omitted.publish()
    assert.ok(omitted.writes.some(w => w.table === 'question' && w.op === 'deleteMany' && w.args.where.id.in.includes(id(5))))
    const session = fixture(false); session.content.sessions = []
    await session.publish()
    assert.ok(session.writes.some(w => w.table === 'session' && w.op === 'deleteMany' && w.args.where.id.in.includes(id(2))))
  })
  it('rejects foreign question and option IDs rather than touching another assessment', async () => {
    for (const target of ['question', 'option']) {
      const f = fixture(false)
      const question = f.content.sessions[0].lessons[0].assessment!.questions[0]
      if (target === 'question') question.id = id(90)
      else question.options[0].id = id(90)
      await assert.rejects(f.publish(), /không thuộc/i)
      assert.equal(f.writes.filter(w => w.args.where?.id === id(90)).length, 0)
    }
  })
})
