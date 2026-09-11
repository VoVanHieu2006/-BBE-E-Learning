import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// DELETE: Xóa bình luận
export async function DELETE(
  request: NextRequest,
  { params }: { params: { lessonId: string; commentId: string } }
) {
  try {
    const auth = await authenticate(request);
    if (!auth.ok || !auth.context) {
      return NextResponse.json(
        { error: auth.error || { code: 'Unauthorized', message: 'Vui lòng đăng nhập' } },
        { status: 401 }
      );
    }

    const { lessonId, commentId } = params;

    const comment = await prisma.lessonComment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.lesson_id !== lessonId) {
      return NextResponse.json(
        { error: { code: 'NotFound', message: 'Bình luận không tồn tại' } },
        { status: 404 }
      );
    }

    const isAuthor = comment.user_id === auth.context.userId;
    const isElevated = auth.context.role === 'ADMIN' || auth.context.role === 'CHAPTER_LEADER';

    if (!isAuthor && !isElevated) {
      return NextResponse.json(
        { error: { code: 'Forbidden', message: 'Bạn không có quyền xóa bình luận này' } },
        { status: 403 }
      );
    }

    await prisma.lessonComment.delete({
      where: { id: commentId },
    });

    return NextResponse.json({ success: true, message: 'Đã xóa bình luận' });
  } catch (error: any) {
    console.error('[LESSON_COMMENT_DELETE_ERROR]:', error);
    return NextResponse.json(
      { error: { code: 'ServerError', message: 'Không thể xóa bình luận' } },
      { status: 500 }
    );
  }
}
