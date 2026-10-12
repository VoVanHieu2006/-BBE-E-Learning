import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function ensurePosition(code: string, name: string, scope: 'PLATFORM' | 'DNA' | 'CHAPTER' | 'DEPARTMENT', isManager: boolean) {
  return prisma.position.upsert({ where: { code }, update: { name, scope, is_manager: isManager }, create: { code, name, scope, is_manager: isManager } })
}

async function main() {
  const viewProgressPermission = await prisma.permission.upsert({
    where: { code: 'VIEW_MEMBER_PROGRESS' }, update: { description: 'View detailed learning progress within a scoped Chapter.' },
    create: { code: 'VIEW_MEMBER_PROGRESS', description: 'View detailed learning progress within a scoped Chapter.' },
  })
  const manageMembersPermission = await prisma.permission.upsert({
    where: { code: 'MANAGE_CHAPTER_MEMBERS' }, update: { description: 'Manage members within a scoped Chapter.' },
    create: { code: 'MANAGE_CHAPTER_MEMBERS', description: 'Manage members within a scoped Chapter.' },
  })
  const chapterManager = await ensurePosition('CHAPTER_MANAGER', 'BĐHU / Chapter Manager', 'CHAPTER', true)
  await prisma.positionPermission.upsert({
    where: { position_id_permission_id: { position_id: chapterManager.id, permission_id: viewProgressPermission.id } },
    update: {}, create: { position_id: chapterManager.id, permission_id: viewProgressPermission.id },
  })
  await prisma.positionPermission.upsert({
    where: { position_id_permission_id: { position_id: chapterManager.id, permission_id: manageMembersPermission.id } },
    update: {}, create: { position_id: chapterManager.id, permission_id: manageMembersPermission.id },
  })
  const dnaManager = await ensurePosition('DNA_MANAGER', 'DNA Manager', 'DNA', true)
  for (const permissionId of [viewProgressPermission.id, manageMembersPermission.id]) {
    await prisma.positionPermission.upsert({ where: { position_id_permission_id: { position_id: dnaManager.id, permission_id: permissionId } }, update: {}, create: { position_id: dnaManager.id, permission_id: permissionId } })
  }
  const departmentLeader = await ensurePosition('DEPARTMENT_LEADER', 'LT / Department Leader', 'DEPARTMENT', true)
  for (const permissionId of [viewProgressPermission.id, manageMembersPermission.id]) {
    await prisma.positionPermission.upsert({ where: { position_id_permission_id: { position_id: departmentLeader.id, permission_id: permissionId } }, update: {}, create: { position_id: departmentLeader.id, permission_id: permissionId } })
  }
  await ensurePosition('MEMBER', 'Member', 'DEPARTMENT', false)

  const chapters = await prisma.chapter.findMany({ include: { chapter_members: { include: { user: { select: { id: true, role: true } } }, orderBy: { joined_at: 'asc' } } } })
  let createdUnits = 0
  let createdMemberships = 0
  let createdAssignments = 0
  for (const chapter of chapters) {
    let unitId = chapter.organization_unit_id
    if (!unitId) {
      const unit = await prisma.organizationUnit.create({ data: { name: chapter.name, type: 'CHAPTER' } })
      unitId = unit.id
      await prisma.chapter.update({ where: { id: chapter.id }, data: { organization_unit_id: unitId } })
      createdUnits++
    }
    let primaryAssigned = false
    for (const member of chapter.chapter_members) {
      const membership = await prisma.organizationMembership.findFirst({ where: { user_id: member.user_id, unit_id: unitId, status: 'ACTIVE', ends_at: null }, select: { id: true } })
      if (!membership) {
        await prisma.organizationMembership.create({ data: { user_id: member.user_id, unit_id: unitId, starts_at: member.joined_at } })
        createdMemberships++
      }
      if (member.user.role === 'CHAPTER_LEADER') {
        const assignment = await prisma.positionAssignment.findFirst({ where: { user_id: member.user_id, position_id: chapterManager.id, unit_id: unitId, ends_at: null }, select: { id: true } })
        if (!assignment) {
          await prisma.positionAssignment.create({ data: { user_id: member.user_id, position_id: chapterManager.id, unit_id: unitId, is_primary: !primaryAssigned, starts_at: member.joined_at } })
          createdAssignments++
        }
        primaryAssigned = true
      }
    }
  }
  console.log(JSON.stringify({ chapters: chapters.length, createdUnits, createdMemberships, createdAssignments }))
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
