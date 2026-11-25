import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveMemberInviteScope } from '@/lib/member-invite-scope'
import { getChapterPresidentSituation, getSingleHolderSituation } from '@/lib/president-invite'
import { presidentReplacementWarning, singleHolderWarning } from '@/lib/member-invite-position'
import { isOrganizationId } from '@/lib/organization-admin-rules'

/**
 * GET /api/v1/invitations/member/president-status?email=&departmentUnitId=
 * Cho modal mời biết người dùng có được mời Chủ tịch/Trưởng ban không (quyền cấp Chapter),
 * và Chapter đang có Chủ tịch hoặc lời mời Chủ tịch nào để cảnh báo trước khi gửi.
 * Có `departmentUnitId` (một ban thuộc Chapter của người mời): trả thêm `departmentLead` = tình trạng Trưởng ban
 * của ban đó + câu cảnh báo (null nếu ban chưa có Trưởng ban và không có lời mời Trưởng ban khác).
 * Ban không thuộc Chapter của người mời / không phải ban đang hoạt động → `departmentLead: null`.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const scope = await resolveMemberInviteScope(auth.context!, { position: 'PRESIDENT' })
  if (scope.ok === false) return NextResponse.json({ canInviteLeadership: false, situation: null, warning: null, departmentLead: null })
  const chapterUnitId = scope.organizationUnitId!
  const params = request.nextUrl.searchParams
  const email = (params.get('email') || '').trim().toLowerCase() || undefined
  const departmentUnitId = params.get('departmentUnitId') || ''
  const situation = await getChapterPresidentSituation(chapterUnitId, email)

  let departmentLead = null
  if (departmentUnitId && isOrganizationId(departmentUnitId)) {
    const unit = await prisma.organizationUnit.findUnique({ where: { id: departmentUnitId }, select: { id: true, type: true, status: true, parent_id: true } })
    if (unit && unit.type === 'DEPARTMENT' && unit.status === 'ACTIVE' && unit.parent_id === chapterUnitId) {
      const leadSituation = await getSingleHolderSituation(unit.id, 'DEPARTMENT_LEAD', email)
      departmentLead = { situation: leadSituation, warning: singleHolderWarning(leadSituation) }
    }
  }
  return NextResponse.json({ canInviteLeadership: true, situation, warning: presidentReplacementWarning(situation), departmentLead })
}
