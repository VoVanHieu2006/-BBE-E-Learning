import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { resolveMemberInviteScope } from '@/lib/member-invite-scope'
import { getChapterPresidentSituation } from '@/lib/president-invite'
import { presidentReplacementWarning } from '@/lib/member-invite-position'

/**
 * GET /api/v1/invitations/member/president-status?email=
 * Cho modal mời biết người dùng có được mời Chủ tịch/Trưởng ban không (quyền cấp Chapter),
 * và Chapter đang có Chủ tịch hoặc lời mời Chủ tịch nào để cảnh báo trước khi gửi.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const scope = await resolveMemberInviteScope(auth.context!, { position: 'PRESIDENT' })
  if (scope.ok === false) return NextResponse.json({ canInviteLeadership: false, situation: null, warning: null })
  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase() || undefined
  const situation = await getChapterPresidentSituation(scope.organizationUnitId!, email)
  return NextResponse.json({ canInviteLeadership: true, situation, warning: presidentReplacementWarning(situation) })
}
