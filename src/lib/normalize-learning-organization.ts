import { Prisma } from '@prisma/client'
import { STANDARD_DEPARTMENTS } from './learning-catalog'
import { lockLearningUser } from './learning-periods'

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim()

/** Exact aliases only. Duplicates abort the transaction for Admin review. */
export async function normalizeLearningOrganization(tx: Prisma.TransactionClient, actorId?: string, convertPresidents = false) {
  const chapters = await tx.organizationUnit.findMany({ where: { type: 'CHAPTER' } })
  const president = await tx.position.upsert({ where: { code: 'CHAPTER_PRESIDENT' }, update: {}, create: { code: 'CHAPTER_PRESIDENT', name: 'Chủ tịch Chapter', scope: 'CHAPTER' } })
  const changes: { unitId: string; action: string; code?: string }[] = []
  for (const chapter of chapters) {
    const departments = await tx.organizationUnit.findMany({ where: { parent_id: chapter.id, type: 'DEPARTMENT' } })
    for (const [code, name] of STANDARD_DEPARTMENTS) {
      const aliases = [normalize(name), normalize(name.replace(/^Ban /, ''))]
      const matches = departments.filter((unit) => unit.code === code || aliases.includes(normalize(unit.name)))
      if (matches.length > 1) throw new Error(`DuplicateDepartment:${chapter.id}:${code}`)
      if (matches[0]) {
        if (matches[0].code !== code) {
          await tx.organizationUnit.update({ where: { id: matches[0].id }, data: { code } })
          changes.push({ unitId: matches[0].id, action: 'ASSIGN_STABLE_CODE', code })
        }
      } else {
        const unit = await tx.organizationUnit.create({ data: { name, code, type: 'DEPARTMENT', parent_id: chapter.id } })
        changes.push({ unitId: unit.id, action: 'CREATE_MISSING_DEPARTMENT', code })
      }
    }
    if (convertPresidents) for (const legacy of departments.filter((unit) => normalize(unit.name) === 'chu tich')) {
      const memberships = await tx.organizationMembership.findMany({ where: { unit_id: legacy.id, status: 'ACTIVE', ends_at: null }, orderBy: { user_id: 'asc' } })
      for (const membership of memberships) {
        const now = await lockLearningUser(tx, membership.user_id)
        const existing = await tx.positionAssignment.count({ where: { user_id: membership.user_id, unit_id: chapter.id, position_id: president.id, ends_at: null } })
        if (!existing) await tx.positionAssignment.create({ data: { user_id: membership.user_id, unit_id: chapter.id, position_id: president.id, starts_at: now, is_primary: true, appointed_by: actorId } })
        await tx.organizationMembership.update({ where: { id: membership.id }, data: { status: 'ENDED', ends_at: now } })
        await tx.positionAssignment.updateMany({ where: { user_id: membership.user_id, unit_id: legacy.id, ends_at: null }, data: { ends_at: now } })
      }
      await tx.organizationUnit.update({ where: { id: legacy.id }, data: { status: 'INACTIVE' } })
      changes.push({ unitId: legacy.id, action: 'PRESERVE_LEGACY_UNIT_AND_MIGRATE_PRESIDENT_POSITION' })
    }
  }
  const dnaGroups = await tx.organizationUnit.findMany({ where: { type: 'DNA_GROUP' } })
  for (const group of dnaGroups) if (['TT', 'SGDC', 'LDC'].includes(group.name.trim().toUpperCase()) && group.code !== group.name.trim().toUpperCase()) {
    await tx.organizationUnit.update({ where: { id: group.id }, data: { code: group.name.trim().toUpperCase() } })
    changes.push({ unitId: group.id, action: 'ASSIGN_STABLE_DNA_CODE', code: group.name.trim().toUpperCase() })
  }
  if (changes.length) await tx.auditLog.create({ data: { actor_user_id: actorId, action: 'NORMALIZE_LEARNING_ORGANIZATION', entity_type: 'POSITION', entity_id: president.id, metadata: { changes } } })
  return changes
}
