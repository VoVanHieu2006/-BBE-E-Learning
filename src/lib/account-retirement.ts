import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { lockLearningUser } from './learning-periods'
import { invalidateUserAuthCache } from './auth'

/** Keep a pseudonymous historical identity, remove credentials and identifying fields. */
export async function retireInactiveAccounts(limit = 100) {
  const candidates = await prisma.user.findMany({ where: {
    status: 'INACTIVE', anonymized_at: null, deactivated_at: { lte: new Date(Date.now() - 30 * 86_400_000) },
  }, select: { id: true }, take: limit })
  let retired = 0
  for (const candidate of candidates) {
    const done = await prisma.$transaction(async (tx) => {
      const now = await lockLearningUser(tx, candidate.id)
      const user = await tx.user.findUniqueOrThrow({ where: { id: candidate.id } })
      if (user.status !== 'INACTIVE' || user.anonymized_at || !user.deactivated_at || now.getTime() - user.deactivated_at.getTime() < 30 * 86_400_000) return false
      await tx.refreshToken.deleteMany({ where: { user_id: user.id } })
      await tx.passwordResetToken.deleteMany({ where: { user_id: user.id } })
      await tx.invitation.deleteMany({ where: { email: user.email } })
      await tx.chapterMember.deleteMany({ where: { user_id: user.id } })
      await tx.organizationMembership.updateMany({ where: { user_id: user.id, ends_at: null }, data: { status: 'ENDED', ends_at: now } })
      await tx.positionAssignment.updateMany({ where: { user_id: user.id, ends_at: null }, data: { ends_at: now } })
      await tx.chapterReorganizationItem.updateMany({ where: { user_id: user.id }, data: { display_name: null } })
      await tx.lessonComment.updateMany({ where: { user_id: user.id }, data: { content: '[Đã gỡ tài khoản]' } })
      // Old audit metadata may repeat an email/display name. Redact those exact values.
      const rows = await tx.$queryRaw<{ id: string; metadata: Prisma.JsonValue }[]>`
        SELECT id, metadata FROM audit_logs WHERE metadata IS NOT NULL AND
        (strpos(metadata::text, ${user.email}) > 0 OR (${user.display_name || ''} <> '' AND strpos(metadata::text, ${user.display_name || ''}) > 0))`
      for (const row of rows) {
        let serialized = JSON.stringify(row.metadata)
        for (const value of [user.email, user.display_name].filter((value): value is string => Boolean(value))) {
          serialized = serialized.split(JSON.stringify(value).slice(1, -1)).join('[removed]')
        }
        await tx.auditLog.update({ where: { id: row.id }, data: { metadata: JSON.parse(serialized) } })
      }
      await tx.user.update({ where: { id: user.id }, data: {
        email: `retired-${user.id}@anonymous.invalid`, display_name: null, password_hash: '!RETIRED',
        anonymized_at: now, auth_version: { increment: 1 }, deactivated_reason: null,
      } })
      await tx.auditLog.create({ data: { action: 'ANONYMIZE_INACTIVE_ACCOUNT', entity_type: 'USER', entity_id: user.id, metadata: { retainedHistoricalIdentity: true } } })
      return true
    }, { timeout: 30_000 })
    if (done) { retired++; invalidateUserAuthCache(candidate.id) }
  }
  return retired
}
