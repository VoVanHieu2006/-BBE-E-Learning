import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { captureChapterActualTerm } from './chapter-actual-terms'
import { learningContext, lockLearningUser, enqueueAssignmentSync, activeLearningPolicy } from './learning-periods'
import { windowOf } from './transfer-windows'
import { resolveSeasonForWindow } from './transfer-season-lookup'

/** Applies scheduled Chapter department/LT changes atomically, then rebuilds learning paths. */
export async function applyDueChapterReorganizations(now = new Date(), batchId?: string, applyNow = false): Promise<number> {
  const due = await prisma.chapterReorganization.findMany({
    where: { status: 'SCHEDULED', ...(batchId ? { id: batchId } : {}), ...(applyNow && batchId ? {} : { effective_at: { lte: now } }) },
    include: { items: true },
    orderBy: { effective_at: 'asc' },
  })
  let applied = 0
  for (const batch of due) {
    try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM chapters WHERE id = ${batch.chapter_id}::uuid FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM chapter_reorganizations WHERE id = ${batch.id}::uuid FOR UPDATE`
      const fresh = await tx.chapterReorganization.findUnique({ where: { id: batch.id }, include: { items: true } })
      if (fresh?.status !== 'SCHEDULED') return false
      const roster = await tx.chapterMember.findMany({ where: { chapter_id: batch.chapter_id }, orderBy: { user_id: 'asc' } })
      const rosterIds = roster.map((row) => row.user_id)
      let appliedAt = now
      for (const userId of rosterIds) appliedAt = await lockLearningUser(tx, userId)
      for (const userId of rosterIds) await learningContext(tx, userId, appliedAt)
      const [effectiveClock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      appliedAt = effectiveClock.now
      if (!rosterIds.length) {
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
        appliedAt = clock.now
      }
      if (fresh.items.some((item) => !rosterIds.includes(item.user_id))) throw new Error('TransferMemberNoLongerInChapter')
      const policy = await activeLearningPolicy(tx, appliedAt)
      let seasonId = fresh.transfer_season_id
      // Duplicate protection belongs to the transfer window of the scheduled
      // effective time, not to a season row that an Admin may have edited.
      const transferWindow = windowOf(fresh.effective_at)
      if (await tx.chapterReorganization.count({
        where: {
          chapter_id: batch.chapter_id,
          status: 'APPLIED',
          id: { not: batch.id },
          effective_at: { gte: transferWindow.startsAt, lt: transferWindow.endsAt },
        },
      })) throw new Error('Giai đoạn này đã có một lần chuyển giao được áp dụng. Mỗi giai đoạn chỉ được chuyển giao một lần.')
      if (policy) {
        // A batch that was explicitly linked to a season keeps that link so
        // legacy six-month seasons stay readable. New batches are validated by
        // the POST route against the standard window.
        const linked = seasonId ? await tx.transferSeason.findUnique({ where: { id: seasonId } }) : null
        if (!linked) {
          const resolution = await resolveSeasonForWindow(tx, fresh.effective_at)
          if (!resolution.ok || !resolution.season) throw new Error(resolution.message || 'Chưa có mùa chuyển giao phù hợp cho giai đoạn đã chọn.')
          seasonId = resolution.season.id
        }
      }
      const snapshot = {
        scheduledAt: fresh.effective_at.toISOString(), appliedAt: appliedAt.toISOString(),
        roster: await tx.user.findMany({ where: { id: { in: rosterIds } }, select: { id: true, role: true, status: true } }),
        positions: await tx.positionAssignment.findMany({ where: { user_id: { in: rosterIds }, ends_at: null }, select: { user_id: true, unit_id: true, position_id: true } }),
        progress: await tx.lessonProgress.findMany({ where: { user_id: { in: rosterIds } }, select: { user_id: true, lesson_id: true, completed: true, completed_at: true, furthest_watched_position_seconds: true } }),
      }
      await tx.learningSnapshot.create({ data: { key: `transfer:${batch.id}`, kind: 'BEFORE_TRANSFER', captured_at: appliedAt, payload: JSON.parse(JSON.stringify(snapshot)) } })
      await tx.chapterReorganization.update({ where: { id: batch.id }, data: { status: 'APPLIED', applied_at: appliedAt, transfer_season_id: seasonId, last_error: null, apply_attempts: { increment: 1 } } })
      if (policy) {
        await captureChapterActualTerm(tx, batch.chapter_id, appliedAt)
        await tx.chapterCompetitionTerm.updateMany({ where: { chapter_id: batch.chapter_id, ends_at: null }, data: { ends_at: appliedAt } })
        await tx.chapterCompetitionTerm.create({ data: { chapter_id: batch.chapter_id, season_id: seasonId, starts_at: appliedAt } })
        for (const userId of rosterIds) {
          await learningContext(tx, userId, appliedAt)
          await tx.learningCycle.updateMany({ where: { user_id: userId, ends_at: null }, data: { ends_at: appliedAt } })
          await tx.learningCycle.create({ data: { user_id: userId, chapter_id: batch.chapter_id, starts_at: appliedAt, trigger_key: `transfer:${batch.id}:${userId}` } })
          await tx.attempt.updateMany({ where: { user_id: userId, status: 'IN_PROGRESS' }, data: { status: 'CANCELLED', submitted_at: appliedAt, cancellation_reason: 'LEARNING_CYCLE_RESET' } })
          // lesson_progress is the compatibility projection; the previous cycle survives above.
          await tx.lessonProgress.updateMany({ where: { user_id: userId }, data: { completed: false, completed_at: null, furthest_watched_position_seconds: 0, last_position_seconds: 0, last_watched_at: null } })
          await tx.userLearningAssignment.updateMany({ where: { user_id: userId, ended_at: null }, data: { ended_at: appliedAt } })
          await tx.supplementalLearningRequirement.updateMany({ where: { user_id: userId, ended_at: null }, data: { ended_at: appliedAt } })
        }
      }
      for (const userId of rosterIds) await enqueueAssignmentSync(tx, userId, `transfer-sync:${batch.id}:${userId}`)
      // Do not backdate a delayed reset to its scheduled timestamp.
      now = appliedAt
      if (batch.term_number) {
        await tx.chapter.update({
          where: { id: batch.chapter_id },
          data: { current_term_number: batch.term_number },
        })
      }
      const chapter = await tx.chapter.findUnique({ where: { id: batch.chapter_id }, select: { organization_unit_id: true } })
      if (!chapter?.organization_unit_id) throw new Error('ChapterOrganizationUnitNotFound')
      // Department units under this chapter
      const deptUnits = await tx.organizationUnit.findMany({
        where: { parent_id: chapter.organization_unit_id, type: 'DEPARTMENT' },
        select: { id: true },
      })
      const deptUnitIds = deptUnits.map((u) => u.id)
      if (fresh.items.some((item) => item.department_unit_id && !deptUnitIds.includes(item.department_unit_id))) throw new Error('TransferDepartmentScopeChanged')
      const presidentItems = fresh.items.filter((item) => !item.department_unit_id)
      const scopedPositions = await tx.position.findMany({ where: { id: { in: fresh.items.flatMap((item) => item.position_id ? [item.position_id] : []) } }, select: { id: true, scope: true, code: true } })
      if (fresh.items.some((item) => item.position_id && !scopedPositions.some((position) => position.id === item.position_id && (item.department_unit_id ? position.scope === 'DEPARTMENT' : position.code === 'CHAPTER_PRESIDENT')))) throw new Error('TransferPositionScopeChanged')
      if (presidentItems.length > 1) throw new Error('MultipleChapterPresidents')
      if (presidentItems.length) {
        const president = await tx.position.findUnique({ where: { id: presidentItems[0].position_id || '' } })
        if (president?.code !== 'CHAPTER_PRESIDENT') throw new Error('InvalidChapterPresidentPosition')
      }

      const renamedItems = fresh.items.filter((item) => item.display_name)
      if (renamedItems.length) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE users AS target SET display_name = source.display_name
          FROM (VALUES ${Prisma.join(renamedItems.map((item) => Prisma.sql`(${item.user_id}::uuid, ${item.display_name}::text)`))})
            AS source(user_id, display_name)
          WHERE target.id = source.user_id
        `)
      }

      // Kết thúc toàn bộ ban và chức vụ cũ trong các Ban của Chapter
      // Thành viên không có tên trong sheet chuyển giao sẽ mất ban và chuyển về chưa phân ban
      if (deptUnitIds.length) {
        await tx.organizationMembership.updateMany({
          where: { unit_id: { in: deptUnitIds }, status: 'ACTIVE', ends_at: null },
          data: { status: 'ENDED', ends_at: now },
        })
        await tx.positionAssignment.updateMany({
          where: { unit_id: { in: deptUnitIds }, ends_at: null },
          data: { ends_at: now },
        })
      }
      await tx.positionAssignment.updateMany({ where: { unit_id: chapter.organization_unit_id, position: { code: 'CHAPTER_PRESIDENT' }, ends_at: null }, data: { ends_at: now } })
      const departmentItems = fresh.items.filter((item) => item.department_unit_id)
      if (departmentItems.length) await tx.organizationMembership.createMany({ data: departmentItems.map((item) => ({ user_id: item.user_id, unit_id: item.department_unit_id!, starts_at: now })) })
      await tx.positionAssignment.createMany({ data: fresh.items.filter((item) => item.position_id).map((item) => ({ user_id: item.user_id, unit_id: item.department_unit_id || chapter.organization_unit_id!, position_id: item.position_id!, is_primary: item.is_primary, starts_at: now, appointed_by: batch.created_by_user_id })) })
      return true
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
    if (result) applied++
    } catch (error) {
      await prisma.chapterReorganization.updateMany({ where: { id: batch.id, status: 'SCHEDULED' }, data: { last_error: error instanceof Error ? error.message.slice(0, 2000) : 'UnknownTransferError', apply_attempts: { increment: 1 } } })
    }
  }
  return applied
}
