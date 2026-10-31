import type { AuthContext } from '@/lib/auth'
import { canAccessChapterPermission, canAccessOrganizationUnitPermission, memberManagementPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'
import { isOrganizationId } from '@/lib/organization-admin-rules'

export type MemberInviteScope =
  | { ok: true; chapterId?: string; organizationUnitId?: string }
  | { ok: false; status: number; error: { code: string; message?: string } }

/**
 * Resolve where a member invitation lands and whether the actor may send it.
 * Chapter leads are always bound to their own chapter; the requested chapterId is ignored.
 * Shared by the single and bulk member invitation routes so both keep the same rules.
 */
export async function resolveMemberInviteScope(context: AuthContext, body: Record<string, unknown>): Promise<MemberInviteScope> {
  const role = context.role
  const requestedChapterId = typeof body.chapterId === 'string' ? body.chapterId : undefined
  let chapterId = role === 'CHAPTER_LEADER' ? undefined : requestedChapterId
  let organizationUnitId: string | undefined
  if (body.organizationUnitId !== undefined) {
    if (role === 'ADMIN' || chapterId || (typeof body.chapterId === 'string' && body.chapterId.trim()) || !isOrganizationId(body.organizationUnitId)) {
      return { ok: false, status: 400, error: { code: 'ValidationError', message: 'Choose one valid organization unit scope.' } }
    }
    const unit = await prisma.organizationUnit.findUnique({ where: { id: body.organizationUnitId as string }, select: { id: true, type: true, status: true } })
    if (!unit || unit.status !== 'ACTIVE' || !['DNA', 'DNA_GROUP', 'CHAPTER', 'DEPARTMENT'].includes(unit.type)) {
      return { ok: false, status: 404, error: { code: 'OrganizationUnitNotFound' } }
    }
    if (!await canAccessOrganizationUnitPermission(context, unit.id, memberManagementPermission(unit.type))) {
      return { ok: false, status: 403, error: { code: 'AccessDenied' } }
    }
    organizationUnitId = unit.id
    chapterId = undefined
  }
  if (!organizationUnitId && role === 'CHAPTER_LEADER') chapterId = context.chapterId
  if (!chapterId && !organizationUnitId) {
    return { ok: false, status: 403, error: { code: 'AccessDenied', message: 'Tài khoản Lead Chapter chưa được phân công Chapter' } }
  }
  if (organizationUnitId && role === 'ADMIN') {
    return { ok: false, status: 403, error: { code: 'AccessDenied' } }
  }
  if (!organizationUnitId && role !== 'CHAPTER_LEADER' && (role === 'ADMIN' || !await canAccessChapterPermission(context, chapterId!, 'MANAGE_CHAPTER_MEMBERS'))) {
    return { ok: false, status: 403, error: { code: 'AccessDenied', message: 'Bạn không có quyền mời thành viên vào Chapter này.' } }
  }
  return { ok: true, chapterId, organizationUnitId }
}
