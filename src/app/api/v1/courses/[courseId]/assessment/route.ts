import { NextResponse } from 'next/server'

/**
 * GET /api/v1/courses/{courseId}/assessment
 * Deprecated endpoint: do not expose the complete quiz question bank.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: {
        code: 'DeprecatedEndpoint',
        message: 'Ngân hàng câu hỏi chỉ được tải từ endpoint quản trị theo từng bài học.',
      },
    },
    { status: 410 },
  )
}

/**
 * POST /api/v1/courses/{courseId}/assessment
 * Deprecated: assessments are configured per lesson by Admin.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: 'DeprecatedEndpoint',
        message: 'Endpoint này đã ngừng hoạt động. Bài kiểm tra được quản lý theo từng bài học.',
      },
    },
    { status: 410 }
  )
}
