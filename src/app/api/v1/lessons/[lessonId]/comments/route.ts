import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET: Lấy danh sách bình luận của bài học (gốc + replies)
export async function GET(
  request: NextRequest,
  { params }: { params: { lessonId: string } }
) {
  try {
    const { lessonId } = params;

    const comments = await prisma.lessonComment.findMany({
      where: {
        lesson_id: lessonId,
        parent_id: null,
      },
      orderBy: {
        created_at: 'desc',
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
        replies: {
          orderBy: {
            created_at: 'asc',
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      comments: comments.map((c) => ({
        id: c.id,
        lessonId: c.lesson_id,
        userId: c.user_id,
        userEmail: c.user.email,
        userRole: c.user.role,
        content: c.content,
        parentId: c.parent_id,
        createdAt: c.created_at.toISOString(),
        updatedAt: c.updated_at.toISOString(),
        replies: (c.replies || []).map((r) => ({
          id: r.id,
          lessonId: r.lesson_id,
          userId: r.user_id,
          userEmail: r.user.email,
          userRole: r.user.role,
          content: r.content,
          parentId: r.parent_id,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
        })),
      })),
    });
  } catch (error: any) {
    console.error('[LESSON_COMMENTS_GET_ERROR]:', error);
    return NextResponse.json(
      { error: { code: 'ServerError', message: 'Không thể tải bình luận' } },
      { status: 500 }
    );
  }
}

// POST: Thêm bình luận mới hoặc phản hồi
export async function POST(
  request: NextRequest,
  { params }: { params: { lessonId: string } }
) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok || !auth.context) {
      return NextResponse.json(
        { error: auth.error || { code: 'Unauthorized', message: 'Vui lòng đăng nhập để bình luận' } },
        { status: 401 }
      );
    }

    const { lessonId } = params;
    const body = await request.json().catch(() => ({}));
    const { content, parentId } = body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json(
        { error: { code: 'ValidationError', message: 'Nội dung bình luận không được để trống' } },
        { status: 400 }
      );
    }

    if (content.trim().length > 3000) {
      return NextResponse.json(
        { error: { code: 'ValidationError', message: 'Bình luận tối đa 3000 ký tự' } },
        { status: 400 }
      );
    }

    // Verify lesson exists
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true },
    });

    if (!lesson) {
      return NextResponse.json(
        { error: { code: 'NotFound', message: 'Bài học không tồn tại' } },
        { status: 404 }
      );
    }

    let resolvedParentId: string | null = null;

    if (parentId) {
      const parentComment = await prisma.lessonComment.findUnique({
        where: { id: parentId },
      });

      if (!parentComment || parentComment.lesson_id !== lessonId) {
        return NextResponse.json(
          { error: { code: 'ValidationError', message: 'Bình luận gốc không hợp lệ' } },
          { status: 400 }
        );
      }

      // Giới hạn 2 cấp: nếu reply cho 1 reply, gắn vào comment gốc
      resolvedParentId = parentComment.parent_id ? parentComment.parent_id : parentComment.id;
    }

    const newComment = await prisma.lessonComment.create({
      data: {
        lesson_id: lessonId,
        user_id: auth.context.userId,
        parent_id: resolvedParentId,
        content: content.trim(),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        comment: {
          id: newComment.id,
          lessonId: newComment.lesson_id,
          userId: newComment.user_id,
          userEmail: newComment.user.email,
          userRole: newComment.user.role,
          content: newComment.content,
          parentId: newComment.parent_id,
          createdAt: newComment.created_at.toISOString(),
          updatedAt: newComment.updated_at.toISOString(),
          replies: [],
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[LESSON_COMMENTS_POST_ERROR]:', error);
    return NextResponse.json(
      { error: { code: 'ServerError', message: 'Không thể gửi bình luận' } },
      { status: 500 }
    );
  }
}
