import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/v1/lessons/{lessonId}/assessment
 * Lấy bài kiểm tra của bài học
 * Admin và Chapter Leader có thể xem đáp án và giải thích
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { lessonId: string } }
) {
  const auth = await authenticate(request).catch(() => ({
    ok: false,
    error: { code: 'UNAUTHORIZED' },
  }));
  const { lessonId } = params;

  const assessment = await prisma.assessment.findUnique({
    where: { lesson_id: lessonId },
    include: {
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

  const role = (auth as any).context?.role;
  const canSeeCorrect = auth.ok && (role === 'ADMIN' || role === 'CHAPTER_LEADER');

  return NextResponse.json(
    {
      assessmentId: assessment.id,
      id: assessment.id,
      lessonId: assessment.lesson_id,
      title: assessment.title,
      description: assessment.description,
      questionCount: assessment.questions.length,
      questions: assessment.questions.map((q) => ({
        questionId: q.id,
        id: q.id,
        questionText: q.question_text,
        type: q.question_type,
        points: Number(q.points),
        durationSeconds: q.duration_seconds,
        sortOrder: q.sort_order,
        ...(canSeeCorrect && q.explanation ? { explanation: q.explanation } : {}),
        options: q.options.map((o) => ({
          optionId: o.id,
          id: o.id,
          optionText: o.option_text,
          ...(canSeeCorrect ? { isCorrect: o.is_correct } : {}),
        })),
      })),
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=5, stale-while-revalidate=30',
      },
    }
  );
}

/**
 * POST /api/v1/lessons/{lessonId}/assessment
 * Tạo hoặc cập nhật bài kiểm tra của bài học — Admin only
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { lessonId: string } }
) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
    if ((auth as any).context!.role !== 'ADMIN') {
      return NextResponse.json(
        { error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền tạo bài kiểm tra' } },
        { status: 403 }
      );
    }

    const { lessonId } = params;

    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true },
    });
    if (!lesson) {
      return NextResponse.json(
        { error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { title, description, questions } = body || {};

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

    // Format nested questions & options
    const questionsCreateData = questions.map((q: any, i: number) => {
      const qText = (q.questionText || q.question_text || `Câu hỏi ${i + 1}`).trim();
      const qType = q.questionType || q.type || 'SINGLE_CHOICE';
      const qPoints = Math.max(1, parseInt(String(q.points), 10) || 10);
      const qDuration = Math.max(
        10,
        parseInt(String(q.durationSeconds || q.duration_seconds), 10) || 120
      );
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

      return {
        question_text: qText,
        question_type: qType,
        points: qPoints,
        duration_seconds: qDuration,
        explanation: qExplanation,
        sort_order: i,
        options: {
          create: rawOptions.map((opt: any, j: number) => ({
            option_text: (opt.optionText || opt.option_text || `Đáp án ${j + 1}`).trim(),
            is_correct: Boolean(opt.isCorrect ?? opt.is_correct),
            sort_order: j,
          })),
        },
      };
    });

    const result = await prisma.$transaction(
      async (tx) => {
        // Delete existing assessment if present
        const existing = await tx.assessment.findUnique({
          where: { lesson_id: lessonId },
          select: { id: true },
        });

        if (existing) {
          await tx.assessment.delete({
            where: { id: existing.id },
          });
        }

        // Create new assessment
        return tx.assessment.create({
          data: {
            lesson_id: lessonId,
            title: title.trim(),
            description: description?.trim() || null,
            created_by: (auth as any).context!.userId,
            questions: {
              create: questionsCreateData,
            },
          },
          include: {
            questions: {
              include: {
                options: { orderBy: { sort_order: 'asc' } },
              },
              orderBy: { sort_order: 'asc' },
            },
          },
        });
      },
      {
        timeout: 20000,
        maxWait: 5000,
      }
    );

    return NextResponse.json(
      {
        assessmentId: result.id,
        id: result.id,
        lessonId: result.lesson_id,
        title: result.title,
        description: result.description,
        questionCount: result.questions.length,
        questions: result.questions.map((q) => ({
          questionId: q.id,
          id: q.id,
          questionText: q.question_text,
          type: q.question_type,
          points: Number(q.points),
          durationSeconds: q.duration_seconds,
          sortOrder: q.sort_order,
          options: q.options.map((o) => ({
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
    console.error('[LESSON_ASSESSMENT_POST_ERROR]:', err);
    return NextResponse.json(
      { error: { code: 'ServerError', message: err.message || 'Lỗi lưu bài kiểm tra' } },
      { status: 500 }
    );
  }
}
