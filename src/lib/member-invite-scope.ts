import { isLeadRole } from '@/lib/roles'
import type { AuthContext } from '@/lib/auth'
import { canAccessChapterPermission, canAccessOrganizationUnitPermission, memberManagementPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { isOrganizationId } from '@/lib/organization-admin-rules'
import { INVALID_INVITE_POSITION_MESSAGE, invitePositionCode, parseInvitePosition, type InvitePositionCode } from '@/lib/member-invite-position'

export type MemberInviteScope =
  | { ok: true; chapterId?: string; organizationUnitId?: string; positionCode?: InvitePositionCode | null }
  | { ok: false; status: number; error: { code: string; message?: string } }

const CHAPTER_LEVEL_DENIED = 'Chỉ người quản lý thành viên cấp Chapter (Lead Chapter) mới được mời Chủ tịch hoặc Trưởng ban.'

/**
 * Resolve where a member invitation lands and whether the actor may send it.
 * Chapter leads are always bound to their own chapter; the requested chapterId is ignored.
 * Shared by the single and bulk member invitation routes so both keep the same rules.
 *
 * `body.position` (MEMBER mặc định | DEPARTMENT_LEAD | PRESIDENT):
 * - PRESIDENT: đích là đơn vị CHAPTER của Chapter người mời, bỏ qua ban; cần quyền quản lý thành viên ở cấp Chapter.
 * - DEPARTMENT_LEAD: bắt buộc một ban (DEPARTMENT) thuộc Chapter; cần quyền ở cấp Chapter, quản lý một ban là chưa đủ.
 */
export async function resolveMemberInviteScope(context: AuthContext, body: Record<string, unknown>): Promise<MemberInviteScope> {
  const role = context.role
  const position = parseInvitePosition(body.position)
  if (!position) return { ok: false, status: 400, error: { code: 'InvalidInvitePosition', message: INVALID_INVITE_POSITION_MESSAGE } }
  if (position === 'PRESIDENT') return resolvePresidentScope(context)

  const requestedChapterId = typeof body.chapterId === 'string' ? body.chapterId : undefined
  let chapterId = isLeadRole(role) ? undefined : requestedChapterId
  let organizationUnitId: string | undefined
  if (body.organizationUnitId !== undefined) {
    if (role === 'ADMIN' || chapterId || (typeof body.chapterId === 'string' && body.chapterId.trim()) || !isOrganizationId(body.organizationUnitId)) {
      return { ok: false, status: 400, error: { code: 'ValidationError', message: 'Vui lòng chọn một ban hoặc nhóm DNA hợp lệ.' } }
    }
    const unit = await prisma.organizationUnit.findUnique({ where: { id: body.organizationUnitId as string }, select: { id: true, type: true, status: true, parent_id: true } })
    if (!unit || unit.status !== 'ACTIVE' || !['DNA_GROUP', 'DEPARTMENT'].includes(unit.type)) {
      return { ok: false, status: 404, error: { code: 'OrganizationUnitNotFound' } }
    }
    if (position === 'DEPARTMENT_LEAD' && unit.type !== 'DEPARTMENT') {
      return { ok: false, status: 400, error: { code: 'InvalidInvitePosition', message: 'Trưởng ban chỉ mời được vào một ban của Chapter, không áp dụng cho nhóm DNA.' } }
    }
    if (!await canAccessOrganizationUnitPermission(context, unit.id, memberManagementPermission(unit.type))) {
      return { ok: false, status: 403, error: { code: 'AccessDenied' } }
    }
    if (position === 'DEPARTMENT_LEAD' && !(unit.parent_id && await canAccessOrganizationUnitPermission(context, unit.parent_id, 'MANAGE_CHAPTER_MEMBERS'))) {
      return { ok: false, status: 403, error: { code: 'AccessDenied', message: CHAPTER_LEVEL_DENIED } }
    }
    organizationUnitId = unit.id
    chapterId = undefined
  }
  if (!organizationUnitId && isLeadRole(role)) chapterId = context.chapterId
  if (!chapterId && !organizationUnitId) {
    return { ok: false, status: 403, error: { code: 'AccessDenied', message: 'Tài khoản Lead Chapter chưa được phân công Chapter' } }
  }
  if (organizationUnitId && role === 'ADMIN') {
    return { ok: false, status: 403, error: { code: 'AccessDenied' } }
  }
  if (!organizationUnitId && !isLeadRole(role) && (role === 'ADMIN' || !await canAccessChapterPermission(context, chapterId!, 'MANAGE_CHAPTER_MEMBERS'))) {
    return { ok: false, status: 403, error: { code: 'AccessDenied', message: 'Bạn không có quyền mời thành viên vào Chapter này.' } }
  }
  if (!organizationUnitId) return { ok: false, status: 400, error: { code: 'MemberPositionRequired', message: 'Vui lòng chọn một ban hoặc nhóm DNA cho thành viên.' } }
  return { ok: true, organizationUnitId, positionCode: invitePositionCode(position) }
}

/** Chủ tịch luôn thuộc Chapter của chính người mời (Admin mời qua luồng riêng, không qua đây). */
async function resolvePresidentScope(context: AuthContext): Promise<MemberInviteScope> {
  if (context.role === 'ADMIN') return { ok: false, status: 403, error: { code: 'AccessDenied' } }
  if (!context.chapterId) return { ok: false, status: 403, error: { code: 'AccessDenied', message: 'Tài khoản chưa thuộc Chapter nào nên không mời được Chủ tịch.' } }
  const chapter = await prisma.chapter.findUnique({ where: { id: context.chapterId }, select: { organization_unit_id: true } })
  if (!chapter?.organization_unit_id) return { ok: false, status: 404, error: { code: 'ChapterNotFound', message: 'Chapter chưa có đơn vị tổ chức; không mời được Chủ tịch.' } }
  const unit = await prisma.organizationUnit.findUnique({ where: { id: chapter.organization_unit_id }, select: { id: true, type: true, status: true } })
  if (!unit || unit.type !== 'CHAPTER' || unit.status !== 'ACTIVE') return { ok: false, status: 404, error: { code: 'OrganizationUnitNotFound' } }
  if (!await canAccessOrganizationUnitPermission(context, unit.id, 'MANAGE_CHAPTER_MEMBERS')) {
    return { ok: false, status: 403, error: { code: 'AccessDenied', message: CHAPTER_LEVEL_DENIED } }
  }
  return { ok: true, organizationUnitId: unit.id, positionCode: 'PRESIDENT' }
}
