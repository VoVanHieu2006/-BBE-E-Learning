import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { invalidateCoursesServerCache } from '@/lib/server-cache';
import { invalidateSystemDataCache } from '@/lib/progress/calculator';
import { assertFinalExamBankCapacity, finalExamBankError, lockCourseExamBank } from '@/lib/final-exam-bank';

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

  const assessment = await prisma.assessment.findUnique({
    where: { lesson_id: lessonId },
    include: {
      question_pools: { orderBy: { sort_order: 'asc' } },
      questions: {
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

  return NextResponse.json(
    {
      assessmentId: assessment.id,
      id: assessment.id,
      lessonId: assessment.lesson_id,
      title: assessment.title,
      description: assessment.description,
      questionCount: assessment.question_count,
      durationMinutes: assessment.duration_minutes,
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
    if (!Array.isArray(questions) || questions.length === 0 || questions.length > 100) {
      return NextResponse.json(
        { error: { code: 'ValidationError', message: 'Cần ít nhất 1 câu hỏi, tối đa 100 câu' } },
        { status: 400 }
      );
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

    const existingAssessment = await prisma.assessment.findUnique({ where: { lesson_id: lessonId }, select: { id: true, _count: { select: { attempts: true } } } });
    if (existingAssessment?._count.attempts) {
      return NextResponse.json({ error: { code: 'AssessmentVersionRequired', message: 'Quiz đã có lượt làm; không thể thay đổi để tránh mất lịch sử.' } }, { status: 409 });
    }

    const assessmentId = crypto.randomUUID();
    const preparedPools = usesPools ? pools.map((name: string, sortOrder: number) => ({ id: crypto.randomUUID(), assessment_id: assessmentId, name: name.trim(), sort_order: sortOrder })) : [];

    // Prepare questions and options with pre-generated UUIDs for batch createMany
    const preparedQuestions = questions.map((q: any, i: number) => {
      const qId = crypto.randomUUID();
      const qText = (q.questionText || q.question_text || `Câu hỏi ${i + 1}`).trim();
      const qType = q.questionType || q.type || 'SINGLE_CHOICE';
      const qPoints = Math.max(1, parseInt(String(q.points), 10) || 10);
      const qExplanation =
        typeof q.explanation === 'string' && q.explanation.trim()
          ? q.explanation.trim()
          : null;

      const rawOptions =
        Array.isArray(q.options) && q.options.length > 0
          ? q.options
          : [
              { optionText: 'Đáp án A', isCorrect: true },
              { optionText: 'Đáp án B', isCorrect: false },
            ];

      const options = rawOptions.map((opt: any, j: number) => ({
        id: crypto.randomUUID(),
        question_id: qId,
        option_text: (opt.optionText || opt.option_text || `Đáp án ${j + 1}`).trim(),
        is_correct: Boolean(opt.isCorrect ?? opt.is_correct ?? false),
        sort_order: j,
      }));

      return {
        question: {
          id: qId,
          assessment_id: assessmentId,
          question_text: qText,
          question_type: qType as any,
          points: qPoints,
          explanation: qExplanation,
          sort_order: i,
          pool_id: usesPools ? preparedPools[Number(q.poolIndex)].id : null,
        },
        options,
      };
    });

    const allQuestionRows = preparedQuestions.map((p) => p.question);
    const allOptionRows = preparedQuestions.flatMap((p) => p.options);

    await prisma.$transaction(
      async (tx) => {
        await lockCourseExamBank(tx, lesson.session.course_id);
        // Delete existing assessment if present
        const existing = await tx.assessment.findUnique({
          where: { lesson_id: lessonId },
          select: { id: true, _count: { select: { attempts: true } } },
        });
        if (existing?._count.attempts) throw new Error('AssessmentVersionRequired');

        if (existing) {
          await tx.questionOption.deleteMany({ where: { question: { assessment_id: existing.id } } });
          await tx.question.deleteMany({ where: { assessment_id: existing.id } });
          await tx.questionPool.deleteMany({ where: { assessment_id: existing.id } });
          await tx.assessment.delete({ where: { id: existing.id } });
        }

        // Create new assessment
        await tx.assessment.create({
          data: {
            id: assessmentId,
            lesson_id: lessonId,
            title: title.trim(),
            description: description?.trim() || null,
            question_count: questionCount,
            duration_minutes: durationMinutes,
            created_by: (auth as any).context!.userId,
          },
        });

        if (preparedPools.length) await tx.questionPool.createMany({ data: preparedPools });
        // Batch insert questions & options
        await tx.question.createMany({ data: allQuestionRows });
        if (allOptionRows.length > 0) {
          await tx.questionOption.createMany({ data: allOptionRows });
        }
        await assertFinalExamBankCapacity(tx, lesson.session.course_id);
      },
      {
        timeout: 15000,
        maxWait: 5000,
      }
    );

    invalidateCoursesServerCache(lesson.session.course_id);
    invalidateSystemDataCache();
    return NextResponse.json(
      {
        assessmentId,
        id: assessmentId,
        lessonId,
        title: title.trim(),
        description: description?.trim() || null,
        questionCount: preparedQuestions.length,
        durationMinutes,
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
    if (err instanceof Error && err.message === 'AssessmentVersionRequired') return NextResponse.json({ error: { code: 'AssessmentVersionRequired', message: 'Quiz đã có lượt làm; không thể thay đổi lịch sử.' } }, { status: 409 });
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

  return NextResponse.json({
    success: true,
    message: 'Đã xóa bài kiểm tra thành công',
    lessonId,
    assessmentId: existing.id,
  });
}
