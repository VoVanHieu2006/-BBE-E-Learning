import { Prisma } from '@prisma/client'
import { lockLearningUser, enqueueAssignmentSync } from './learning-periods'

/** End incompatible affiliations atomically; ordinary appointments never reset a cycle. */
export async function prepareOrganizationTransition(tx: Prisma.TransactionClient, userId: string, targetUnitId: string, actorId?: string) {
  const now = await lockLearningUser(tx, userId)
  let target = await tx.organizationUnit.findUnique({ where: { id: targetUnitId } })
  const seen = new Set<string>()
  while (target && !['DNA', 'CHAPTER'].includes(target.type)) {
    if (seen.has(target.id)) throw new Error('OrganizationCycle')
    seen.add(target.id)
    target = target.parent_id ? await tx.organizationUnit.findUnique({ where: { id: target.parent_id } }) : null
  }
  if (!target) return now
  const opposite = target.type === 'DNA' ? ['CHAPTER', 'DEPARTMENT'] : ['DNA', 'DNA_GROUP']
  const ended = await tx.organizationMembership.findMany({ where: {
    user_id: userId, status: 'ACTIVE', OR: [{ ends_at: null }, { ends_at: { gt: now } }], unit: { type: { in: opposite as any } },
  }, select: { id: true, unit_id: true } })
  const legacyChapter = target.type === 'DNA' ? await tx.chapterMember.findUnique({ where: { user_id: userId } }) : null
  if (!ended.length && !legacyChapter) return now
  await tx.organizationMembership.updateMany({ where: { id: { in: ended.map((row) => row.id) } }, data: { status: 'ENDED', ends_at: now } })
  await tx.positionAssignment.updateMany({ where: { user_id: userId, unit: { type: { in: opposite as any } }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, data: { ends_at: now } })
  if (target.type === 'DNA') await tx.chapterMember.deleteMany({ where: { user_id: userId } })
  await tx.auditLog.create({ data: {
    actor_user_id: actorId, action: 'REPLACE_ORGANIZATION_AFFILIATION', entity_type: 'USER', entity_id: userId,
    metadata: { targetUnitId, endedMembershipIds: ended.map((row) => row.id), endedChapterId: legacyChapter?.chapter_id, effectiveAt: now.toISOString() },
  } })
  await enqueueAssignmentSync(tx, userId, `organization:${userId}:${now.toISOString()}`)
  return now
}
