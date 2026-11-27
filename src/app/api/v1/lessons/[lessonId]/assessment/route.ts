import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { guardCourseEditableByLesson, invalidateCourseContentCaches } from '@/lib/course-edit-guard';
import { assertFinalExamBankCapacity, finalExamBankError, lockCourseExamBank } from '@/lib/final-exam-bank';
import { applyDueAssessmentSchedules, applyDueCourseAssessmentSchedules, existingScheduleOf, hasCurrentMonthLockingAttempts, scheduleColumns, scheduledConfigOf } from '@/lib/assessment-schedule';
import { MAX_LESSON_QUIZ_QUESTIONS, resolveAssessmentConfigUpdate, validateLessonBankForCounts } from '@/lib/quiz-schedule-rules';
import { CourseDraftError } from '@/lib/course-draft';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/lessons/{lessonId}/assessment
 * Lấy bài kiểm tra của bài học
 * Chỉ Admin được xem ngân hàng câu hỏi/đáp án để biên tập.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { lessonId: string } }
) {
  const { lessonId } = params;
  if (!UUID_REGEX.test(lessonId)) {
    return NextResponse.json(
      { error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } },
      { status: 404 }
    );
  }

  const auth = await authenticate(request).catch(() => ({
    ok: false,
    error: { code: 'UNAUTHORIZED' },
  }));

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json(
      { error: { code: 'AccessDenied', message: 'Chỉ Admin được xem ngân hàng câu hỏi.' } },
      { status: 403 },
    );
  }

  const now = new Date();
  const target = await prisma.assessment.findUnique({ where: { lesson_id: lessonId }, select: { id: true } });
  if (target) await applyDueAssessmentSchedules(prisma, { assessmentId: target.id, now });
  const assessment = await prisma.assessment.findUnique({
    where: { lesson_id: lessonId },
    include: {
      question_pools: { orderBy: { sort_order: 'asc' } },
      questions: {
        where: { archived_at: null },
        include: {
          options: { orderBy: { sort_order: 'asc' } },
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  });

  if (!assessment) {
    return NextResponse.json(
      { error: { code: 'AssessmentNotFound', message: 'Bài học chưa có bài kiểm tra' } },
      { status: 404 }
    );
  }
  const hasCurrentMonthAttempts = await hasCurrentMonthLockingAttempts(prisma, assessment.id, now);

  return NextResponse.json(
    {
      assessmentId: assessment.id,
      id: assessment.id,
      lessonId: assessment.lesson_id,
      title: assessment.title,
      description: assessment.description,
      questionCount: assessment.question_count,
      durationMinutes: assessment.duration_minutes,
      hasCurrentMonthAttempts,
      scheduledConfig: scheduledConfigOf(assessment),
      totalQuestionCount: assessment.questions.length,
      pools: assessment.question_pools.map((pool) => ({
        poolId: pool.id,
        name: pool.name,
        sortOrder: pool.sort_order,
      })),
      questions: assessment.questions.map((q) => ({
        questionId: q.id,
        id: q.id,
        questionText: q.question_text,
        type: q.question_type,
        points: Number(q.points),
        sortOrder: q.sort_order,
        poolId: q.pool_id,
        explanation: q.explanation || '',
        options: q.options.map((o) => ({
          optionId: o.id,
          id: o.id,
          optionText: o.option_text,
          isCorrect: o.is_correct,
        })),
      })),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

/**
 * POST /api/v1/lessons/{lessonId}/assessment
 * Tạo hoặc cập nhật bài kiểm tra của bài học — Admin only
 * OPTIMIZED: Uses batch createMany for questions and options
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { lessonId: string } }
) {
  try {
    const { lessonId } = params;
    if (!UUID_REGEX.test(lessonId)) {
      return NextResponse.json(
        { error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } },
        { status: 404 }
      );
    }

    const auth = await authenticate(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
    if ((auth as any).context!.role !== 'ADMIN') {
      return NextResponse.json(
        { error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền tạo bài kiểm tra' } },
        { status: 403 }
      );
    }

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, session: { select: { course_id: true } } },
    });
    if (!lesson) {
      return NextResponse.json(
        { error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } },
        { status: 404 }
      );
    }

    const blocked = await guardCourseEditableByLesson(lessonId);
    if (blocked) return blocked;

    const body = await request.json().catch(() => ({}));
    const { title, description, questions, pools } = body || {};
    const questionCount = Number(body?.questionCount ?? questions?.length);
    const durationMinutes = Number(body?.durationMinutes);

    if (
      !title ||
      typeof title !== 'string' ||
      title.trim().length < 2 ||
      title.trim().length > 255
    ) {
      return NextResponse.json(
        { error: { code: 'ValidationError', message: 'Tiêu đề bắt buộc (2-255 ký tự)' } },
        { status: 400 }
      );
    }
    if (!Array.isArray(questions) || questions.length === 0 || questions.length > MAX_LESSON_QUIZ_QUESTIONS) {
      return NextResponse.json(
        { error: { code: 'ValidationError', message: `Cần ít nhất 1 câu hỏi, tối đa ${MAX_LESSON_QUIZ_QUESTIONS} câu` } },
        { status: 400 }
      );
    }
    const optionalInteger = (value: unknown, max: number) => value === undefined || value === null ? null : Number.isInteger(value) && Number(value) >= 1 && Number(value) <= max ? Number(value) : NaN;
    const scheduledQuestionCount = optionalInteger(body?.scheduledQuestionCount, MAX_LESSON_QUIZ_QUESTIONS);
    const scheduledDurationMinutes = optionalInteger(body?.scheduledDurationMinutes, 240);
    if (Number.isNaN(scheduledQuestionCount) || Number.isNaN(scheduledDurationMinutes) || (body?.cancelSchedule !== undefined && typeof body.cancelSchedule !== 'boolean')) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'Lịch tháng sau không hợp lệ: số câu hoặc thời gian (1–240 phút).' } }, { status: 400 });
    }
    if (questions.some((question: any) => !question || typeof question.questionText !== 'string' || !question.questionText.trim() ||
      !Array.isArray(question.options) || question.options.length < 2 ||
      !question.options.some((option: any) => option?.isCorrect === true || option?.is_correct === true) ||
      question.options.some((option: any) => typeof (option?.optionText ?? option?.option_text) !== 'string' || !(option.optionText ?? option.option_text).trim()))) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'Mỗi câu hỏi cần nội dung, ít nhất hai đáp án và một đáp án đúng.' } }, { status: 400 });
    }
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > questions.length ||
        !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 240) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'Số câu mỗi lượt phải nằm trong ngân hàng đề; thời gian phải từ 1 đến 240 phút.' } }, { status: 400 });
    }
    const usesPools = pools !== undefined;
    if (usesPools) {
      if (!Array.isArray(pools) || pools.length < 1 || pools.length > 20 || pools.some((pool: unknown) => typeof pool !== 'string' || !pool.trim())) {
        return NextResponse.json({ error: { code: 'ValidationError', message: 'Quiz pool phải gồm từ 1 đến 20 tên nhóm.' } }, { status: 400 });
      }
      if (questionCount < pools.length) {
        return NextResponse.json({ error: { code: 'ValidationError', message: 'Số câu mỗi lượt không thể ít hơn số nhóm.' } }, { status: 400 });
      }
      const poolCounts = Array.from({ length: pools.length }, () => 0);
      for (const question of questions) {
        const poolIndex = Number((question as any).poolIndex);
        if (!Number.isInteger(poolIndex) || poolIndex < 0 || poolIndex >= pools.length) {
          return NextResponse.json({ error: { code: 'ValidationError', message: 'Mỗi câu hỏi phải thuộc một trong các nhóm đã tạo.' } }, { status: 400 });
        }
        poolCounts[poolIndex]++;
      }
      if (poolCounts.some((count) => count < 1)) {
        return NextResponse.json({ error: { code: 'QuestionPoolIncomplete', message: 'Mỗi nhóm phải có ít nhất 1 câu hỏi để đủ điều kiện lưu cấu hình.' } }, { status: 400 });
      }
      const minCount = Math.min(...poolCounts);
      const maxAllowed = pools.length * minCount;
      if (questionCount > maxAllowed) {
        return NextResponse.json({
          error: {
            code: 'QuestionPoolQuotaExceeded',
            message: `Với ${pools.length} nhóm và nhóm ít câu nhất có ${minCount} câu, bài kiểm tra chỉ được chọn tối đa ${maxAllowed} câu để bảo đảm phân phối cân bằng.`,
          },
        }, { status: 400 });
      }
    }

    // Loại câu hỏi Đúng/Sai đã ngừng sử dụng
    if (questions.some((q: any) => (q.questionType || q.type) === 'TRUE_FALSE')) {
      return NextResponse.json(
        {
          error: {
            code: 'ValidationError',
            message: 'Loại câu hỏi "Đúng / Sai" đã ngừng sử dụng. Vui lòng dùng trắc nghiệm 1 hoặc nhiều đáp án.',
          },
        },
        { status: 400 }
      );
    }

    const normalizeQuestion = (q: any, i: number) => {
      const rawOptions =
        Array.isArray(q.options) && q.options.length > 0
          ? q.options
          : [
              { optionText: 'Đáp án A', isCorrect: true },
              { optionText: 'Đáp án B', isCorrect: false },
            ];
      return {
        text: (q.questionText || q.question_text || `Câu hỏi ${i + 1}`).trim() as string,
        type: (q.questionType || q.type || 'SINGLE_CHOICE') as string,
        points: Math.max(1, parseInt(String(q.points), 10) || 10),
        explanation: (typeof q.explanation === 'string' && q.explanation.trim() ? q.explanation.trim() : null) as string | null,
        options: rawOptions.map((opt: any, j: number) => ({
          text: (opt.optionText || opt.option_text || `Đáp án ${j + 1}`).trim() as string,
          isCorrect: Boolean(opt.isCorrect ?? opt.is_correct ?? false),
        })),
      };
    };
    type ExistingQuestion = { id: string; question_text: string; question_type: string; points: number; explanation: string | null; options: { id: string; option_text: string; is_correct: boolean }[] };
    const sameContent = (n: ReturnType<typeof normalizeQuestion>, e: ExistingQuestion) =>
      n.text === e.question_text && n.type === e.question_type && n.points === Number(e.points) && n.explanation === (e.explanation ?? null) &&
      n.options.length === e.options.length && n.options.every((o, j) => o.text === e.options[j].option_text && o.isCorrect === e.options[j].is_correct);
    // Incoming questions that keep an existing active row untouched (same id, same grading content).
    const findKeptQuestions = (existingQuestions: ExistingQuestion[]) => {
      const byId = new Map(existingQuestions.map((e) => [e.id, e]));
      const kept = new Map<string, ExistingQuestion>();
      questions.forEach((q: any, i: number) => {
        const match = typeof q?.id === 'string' ? byId.get(q.id) : undefined;
        if (match && !kept.has(match.id) && sameContent(normalizeQuestion(q, i), match)) kept.set(match.id, match);
      });
      return kept;
    };

    // The target ID is decided under the exam-bank lock: an attempted quiz keeps its row, others are recreated.
    // `kept` rows stay in place; `reusableIds` belong to rows deleted in this transaction, so clients may keep their ids.
    const prepare = (assessmentId: string, kept: Map<string, ExistingQuestion>, reusableIds: Set<string>) => {
    const preparedPools = usesPools ? pools.map((name: string, sortOrder: number) => ({ id: crypto.randomUUID(), assessment_id: assessmentId, name: name.trim(), sort_order: sortOrder })) : [];
    const usedIds = new Set<string>();

    const preparedQuestions = questions.map((q: any, i: number) => {
      const n = normalizeQuestion(q, i);
      const candidate = typeof q?.id === 'string' && !usedIds.has(q.id) ? kept.get(q.id) : undefined;
      const keptRow = candidate && sameContent(n, candidate) ? candidate : undefined;
      const reuse = !keptRow && typeof q?.id === 'string' && reusableIds.has(q.id) && !usedIds.has(q.id);
      const qId = keptRow ? keptRow.id : reuse ? q.id : crypto.randomUUID();
      usedIds.add(qId);

      const options = keptRow
        ? keptRow.options.map((o, j) => ({ id: o.id, question_id: qId, option_text: o.option_text, is_correct: o.is_correct, sort_order: j }))
        : n.options.map((opt: { text: string; isCorrect: boolean }, j: number) => ({
            id: crypto.randomUUID(),
            question_id: qId,
            option_text: opt.text,
            is_correct: opt.isCorrect,
            sort_order: j,
          }));

      return {
        keep: Boolean(keptRow),
        question: {
          id: qId,
          assessment_id: assessmentId,
          question_text: n.text,
          question_type: n.type as any,
          points: n.points,
          explanation: n.explanation,
          sort_order: i,
          pool_id: usesPools ? preparedPools[Number(q.poolIndex)].id : null,
        },
        options,
      };
    });

    return { preparedPools, preparedQuestions };
    };

    const actor = (auth as any).context!.userId as string;
    const { assessmentId, preparedPools, preparedQuestions, config } = await prisma.$transaction(
      async (tx) => {
        await lockCourseExamBank(tx, lesson.session.course_id);
        const now = new Date();
        const activated = await applyDueCourseAssessmentSchedules(tx, lesson.session.course_id, now);
        const existing = await tx.assessment.findUnique({
          where: { lesson_id: lessonId },
          select: { id: true, question_count: true, duration_minutes: true, scheduled_question_count: true, scheduled_duration_minutes: true, scheduled_effective_at: true, scheduled_effective_month_key: true, _count: { select: { attempts: true } } },
        });
        const locked = existing?._count.attempts ? await hasCurrentMonthLockingAttempts(tx, existing.id, now) : false;
        const rollover = existing ? activated.includes(existing.id) : false;
        const cancelSchedule = body?.cancelSchedule === true;
        const requestedCount = !locked && !cancelSchedule && (scheduledQuestionCount !== null || rollover)
          ? (scheduledQuestionCount ?? existing?.question_count ?? questionCount)
          : questionCount;
        const requestedDuration = !locked && !cancelSchedule && (scheduledDurationMinutes !== null || rollover)
          ? (scheduledDurationMinutes ?? existing?.duration_minutes ?? durationMinutes)
          : durationMinutes;
        const config = resolveAssessmentConfigUpdate({
          current: existing?._count.attempts ? { questionCount: existing.question_count, durationMinutes: existing.duration_minutes } : { questionCount: requestedCount, durationMinutes: requestedDuration },
          existingSchedule: existing?._count.attempts ? existingScheduleOf(existing) : null,
          requested: { questionCount: requestedCount, durationMinutes: requestedDuration, scheduledQuestionCount: locked ? scheduledQuestionCount : null, scheduledDurationMinutes: locked ? scheduledDurationMinutes : null, cancelSchedule },
          hasCurrentMonthLockingAttempts: locked, now,
        });
        const poolCounts = usesPools ? pools.map((_: unknown, index: number) => questions.filter((q: any) => Number(q.poolIndex) === index).length) : [];
        const bank = validateLessonBankForCounts({ questionCount: config.questionCount, scheduledQuestionCount: config.schedule?.questionCount ?? null, poolCounts, totalQuestions: questions.length });
        if (bank.ok === false) throw new CourseDraftError(bank.code, bank.message, 400);
        const settings = { title: title.trim(), description: description?.trim() || null, question_count: config.questionCount, duration_minutes: config.durationMinutes };

        let assessmentId: string;
        let kept = new Map<string, ExistingQuestion>();
        const reusableIds = new Set<string>();
        if (existing?._count.attempts) {
          // Attempt history references these rows: unchanged questions stay in place, changed referenced ones are archived, the rest dropped.
          assessmentId = existing.id;
          const active = await tx.question.findMany({
            where: { assessment_id: existing.id, archived_at: null },
            select: {
              id: true, question_text: true, question_type: true, points: true, explanation: true,
              options: { select: { id: true, option_text: true, is_correct: true }, orderBy: { sort_order: 'asc' } },
              _count: { select: { attempt_questions: true, attempt_answers: true } },
            },
          });
          kept = findKeptQuestions(active as ExistingQuestion[]);
          const stale = active.filter((q) => !kept.has(q.id));
          const referenced = stale.filter((q) => q._count.attempt_questions + q._count.attempt_answers > 0).map((q) => q.id);
          const unused = stale.filter((q) => !referenced.includes(q.id)).map((q) => q.id);
          unused.forEach((id) => reusableIds.add(id));
          if (referenced.length) await tx.question.updateMany({ where: { id: { in: referenced } }, data: { archived_at: now, pool_id: null } });
          if (unused.length) {
            await tx.questionOption.deleteMany({ where: { question_id: { in: unused } } });
            await tx.question.deleteMany({ where: { id: { in: unused } } });
          }
          if (kept.size) await tx.question.updateMany({ where: { id: { in: Array.from(kept.keys()) } }, data: { pool_id: null } });
          await tx.questionPool.deleteMany({ where: { assessment_id: existing.id } });
          await tx.assessment.update({ where: { id: existing.id }, data: { ...settings, ...scheduleColumns(config, actor, now) } });
        } else {
          assessmentId = crypto.randomUUID();
          if (existing) {
            (await tx.question.findMany({ where: { assessment_id: existing.id }, select: { id: true } })).forEach((q) => reusableIds.add(q.id));
            await tx.questionOption.deleteMany({ where: { question: { assessment_id: existing.id } } });
            await tx.question.deleteMany({ where: { assessment_id: existing.id } });
            await tx.questionPool.deleteMany({ where: { assessment_id: existing.id } });
            await tx.assessment.delete({ where: { id: existing.id } });
          }
          await tx.assessment.create({ data: { ...settings, id: assessmentId, lesson_id: lessonId, created_by: actor } });
        }

        const { preparedPools, preparedQuestions } = prepare(assessmentId, kept, reusableIds);
        if (preparedPools.length) await tx.questionPool.createMany({ data: preparedPools });
        const fresh = preparedQuestions.filter((p) => !p.keep);
        for (const { question } of preparedQuestions.filter((p) => p.keep)) {
          await tx.question.update({ where: { id: question.id }, data: { sort_order: question.sort_order, pool_id: question.pool_id } });
        }
        // Batch insert questions & options
        await tx.question.createMany({ data: fresh.map((p: any) => p.question) });
        const allOptionRows = fresh.flatMap((p: any) => p.options);
        if (allOptionRows.length > 0) {
          await tx.questionOption.createMany({ data: allOptionRows });
        }
        await assertFinalExamBankCapacity(tx, lesson.session.course_id);
        return { assessmentId, preparedPools, preparedQuestions, config };
      },
      {
        timeout: 15000,
        maxWait: 5000,
      }
    );

    invalidateCourseContentCaches(lesson.session.course_id, lessonId);
    return NextResponse.json(
      {
        assessmentId,
        id: assessmentId,
        lessonId,
        title: title.trim(),
        description: description?.trim() || null,
        questionCount: preparedQuestions.length,
        activeQuestionCount: config.questionCount,
        durationMinutes: config.durationMinutes,
        scheduled: config.wasScheduled,
        scheduledConfig: config.schedule ? { questionCount: config.schedule.questionCount, durationMinutes: config.schedule.durationMinutes, effectiveAt: config.schedule.effectiveAt.toISOString(), effectiveMonthKey: config.schedule.effectiveMonthKey } : null,
        pools: preparedPools.map((pool) => ({ poolId: pool.id, name: pool.name, sortOrder: pool.sort_order })),
        questions: preparedQuestions.map(({ question: q, options: opts }) => ({
          questionId: q.id,
          id: q.id,
          questionText: q.question_text,
          type: q.question_type,
          points: Number(q.points),
          sortOrder: q.sort_order,
          explanation: q.explanation || '',
          poolId: q.pool_id,
          options: opts.map((o) => ({
            optionId: o.id,
            id: o.id,
            optionText: o.option_text,
            isCorrect: o.is_correct,
          })),
        })),
      },
      { status: 201 }
    );
  } catch (err: any) {
    const bankError = finalExamBankError(err);
    if (bankError) return NextResponse.json(bankError, { status: 409 });
    if (err instanceof CourseDraftError) return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    console.error('[LESSON_ASSESSMENT_POST_ERROR]:', err);
    return NextResponse.json(
      { error: { code: 'ServerError', message: err.message || 'Lỗi lưu bài kiểm tra' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/v1/lessons/{lessonId}/assessment
 * Delete assessment associated with this lesson (Admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { lessonId: string } }
) {
  const { lessonId } = params;
  if (!UUID_REGEX.test(lessonId)) {
    return NextResponse.json(
      { error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } },
      { status: 404 }
    );
  }

  const auth = await authenticate(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json(
      { error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền xóa bài kiểm tra' } },
      { status: 403 }
    );
  }

  const blocked = await guardCourseEditableByLesson(lessonId);
  if (blocked) return blocked;

  const existing = await prisma.assessment.findUnique({
    where: { lesson_id: lessonId },
    select: { id: true, _count: { select: { attempts: true } } },
  });

  if (!existing) {
    return NextResponse.json(
      { error: { code: 'AssessmentNotFound', message: 'Bài học chưa có bài kiểm tra' } },
      { status: 404 }
    );
  }
  if (existing._count.attempts) {
    return NextResponse.json({ error: { code: 'AssessmentVersionRequired', message: 'Quiz đã có lượt làm; không thể xóa để tránh mất lịch sử.' } }, { status: 409 })
  }

  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { session: { select: { course_id: true } } } });
  if (!lesson) return NextResponse.json({ error: { code: 'LessonNotFound' } }, { status: 404 });

  try {
    await prisma.$transaction(
      async (tx) => {
        await lockCourseExamBank(tx, lesson.session.course_id);
        if (await tx.attempt.count({ where: { assessment_id: existing.id } })) throw new Error('AssessmentVersionRequired');
        await tx.questionOption.deleteMany({ where: { question: { assessment_id: existing.id } } });
        await tx.question.deleteMany({ where: { assessment_id: existing.id } });
        await tx.questionPool.deleteMany({ where: { assessment_id: existing.id } });
        await tx.assessment.delete({ where: { id: existing.id } });
        await assertFinalExamBankCapacity(tx, lesson.session.course_id);
      },
      { timeout: 15000, maxWait: 5000 },
    );
  } catch (error) {
    const bankError = finalExamBankError(error);
    if (bankError) return NextResponse.json(bankError, { status: 409 });
    if (error instanceof Error && error.message === 'AssessmentVersionRequired') return NextResponse.json({ error: { code: 'AssessmentVersionRequired', message: 'Quiz đã có lượt làm; không thể xóa lịch sử.' } }, { status: 409 });
    throw error;
  }

  invalidateCourseContentCaches(lesson.session.course_id, lessonId);
  return NextResponse.json({
    success: true,
    message: 'Đã xóa bài kiểm tra thành công',
    lessonId,
    assessmentId: existing.id,
  });
}
