import { Prisma } from '@prisma/client'
import { lockLearningUser, enqueueAssignmentSync } from './learning-periods'
import { OrganizationConflict } from './chapter-lead'

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
  if (target.type === 'DNA') {
    const binding = await tx.chapterLeadBinding.findUnique({ where: { user_id: userId }, include: { chapter: { select: { name: true } }, user: { select: { role: true } } } })
    if (binding && binding.user.role !== 'ADMIN') throw new OrganizationConflict('LeadChapterCannotJoinDna', `Tài khoản Lead đã gắn cố định với ${binding.chapter.name}; không được chuyển sang DNA.`, binding.chapter.name)
  }
  const opposite = target.type === 'DNA' ? ['CHAPTER', 'DEPARTMENT'] : ['DNA', 'DNA_GROUP']
  const ended = await tx.organizationMembership.findMany({ where: {
    user_id: userId, status: 'ACTIVE', OR: [{ ends_at: null }, { ends_at: { gt: now } }], unit: { type: { in: opposite as any } },
  }, select: { id: true, unit_id: true, starts_at: true } })
  const legacyChapter = target.type === 'DNA' ? await tx.chapterMember.findUnique({ where: { user_id: userId } }) : null
  const positions = await tx.positionAssignment.findMany({ where: { user_id: userId, unit: { type: { in: opposite as any } }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, select: { id: true, starts_at: true } })
  if (!ended.length && !legacyChapter && !positions.length) return now
  for (const membership of ended) await tx.organizationMembership.update({ where: { id: membership.id }, data: { status: 'ENDED', ends_at: membership.starts_at > now ? membership.starts_at : now } })
  for (const position of positions) await tx.positionAssignment.update({ where: { id: position.id }, data: { ends_at: position.starts_at > now ? position.starts_at : now } })
  if (target.type === 'DNA') {
    // Use the exact transfer timestamp. The legacy delete trigger will find no
    // remaining open interval; historical rows, progress and stars stay intact.
    await tx.chapterAffiliationInterval.updateMany({ where: { user_id: userId, ends_at: null }, data: { ends_at: now } })
    await tx.chapterMember.deleteMany({ where: { user_id: userId } })
  }
  await tx.auditLog.create({ data: {
    actor_user_id: actorId, action: 'REPLACE_ORGANIZATION_AFFILIATION', entity_type: 'USER', entity_id: userId,
    metadata: { targetUnitId, endedMembershipIds: ended.map((row) => row.id), endedPositionIds: positions.map(row => row.id), endedChapterId: legacyChapter?.chapter_id, effectiveAt: now.toISOString() },
  } })
  await enqueueAssignmentSync(tx, userId, `organization:${userId}:${now.toISOString()}`)
  return now
}
