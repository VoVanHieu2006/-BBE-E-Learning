import { prisma } from './prisma'
import { presidentReplacementWarning, type PresidentSituation } from './member-invite-position'

/**
 * Tình trạng vị trí Chủ tịch của một Chapter (theo đơn vị CHAPTER): Chủ tịch đang tại nhiệm
 * và các lời mời Chủ tịch khác còn hiệu lực. `excludeEmail` bỏ qua lời mời của chính email đang được mời lại.
 */
export async function getChapterPresidentSituation(chapterUnitId: string, excludeEmail?: string): Promise<PresidentSituation> {
  const now = new Date()
  const [assignment, pending] = await Promise.all([
    prisma.positionAssignment.findFirst({
      where: {
        unit_id: chapterUnitId,
        position: { code: 'PRESIDENT' },
        starts_at: { lte: now },
        OR: [{ ends_at: null }, { ends_at: { gt: now } }],
        user: { role: 'MEMBER', status: 'ACTIVE' },
      },
      orderBy: { starts_at: 'desc' },
      select: { user: { select: { id: true, email: true, display_name: true } } },
    }),
    prisma.invitation.findMany({
      where: {
        organization_unit_id: chapterUnitId,
        position_code: 'PRESIDENT',
        status: 'PENDING',
        expires_at: { gt: now },
        ...(excludeEmail ? { email: { not: excludeEmail } } : {}),
      },
      orderBy: { created_at: 'asc' },
      select: { id: true, email: true, expires_at: true },
    }),
  ])
  return {
    currentPresident: assignment?.user ? { userId: assignment.user.id, name: assignment.user.display_name || '', email: assignment.user.email } : null,
    pendingInvitations: pending.map((row) => ({ id: row.id, email: row.email, expiresAt: row.expires_at.toISOString() })),
  }
}

export type PresidentInviteCheck =
  | { ok: true; situation: PresidentSituation }
  | { ok: false; status: 409; error: { code: 'PresidentReplaceConfirmRequired'; message: string; situation: PresidentSituation } }

/**
 * Chapter đã có Chủ tịch hoặc đã có lời mời Chủ tịch khác: chỉ cho gửi khi người mời đã xác nhận
 * (`confirmReplacePresident: true`) sau khi thấy cảnh báo. Cảnh báo do server quyết định nên
 * không client nào bỏ qua được.
 */
export async function checkPresidentInvite(chapterUnitId: string, email: string, confirmed: unknown): Promise<PresidentInviteCheck> {
  const situation = await getChapterPresidentSituation(chapterUnitId, email)
  const warning = presidentReplacementWarning(situation)
  if (warning && confirmed !== true) {
    return { ok: false, status: 409, error: { code: 'PresidentReplaceConfirmRequired', message: warning, situation } }
  }
  return { ok: true, situation }
}
