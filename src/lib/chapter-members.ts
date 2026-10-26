import { prisma } from '@/lib/prisma'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { ChapterMemberRecord, mergeChapterMemberRecords } from '@/lib/chapter-membership-rules'

const LT_CODES = ['PRESIDENT', 'CHAPTER_PRESIDENT', 'DEPARTMENT_LEAD', 'DEPARTMENT_LEADER']
const MANAGER_CODES = ['CHAPTER_LEAD', 'CHAPTER_MANAGER', 'DNA_LEAD', 'DNA_MANAGER']

/** Current learners only. Account administration and history retain listChapterMembers. */
export async function listChapterLearners(chapterId: string, options: { asOf?: Date } = {}): Promise<Array<ChapterMemberRecord & { isLead: boolean }>> {
  const asOf = options.asOf || new Date()
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { organization_unit_id: true } })
  if (!chapter) return []
  const unitIds = chapter.organization_unit_id ? await getOrganizationUnitTreeIds(chapter.organization_unit_id) : []
  const active = { starts_at: { lte: asOf }, OR: [{ ends_at: null }, { ends_at: { gt: asOf } }] }
  const users = await prisma.user.findMany({
    where: { role: 'MEMBER', status: 'ACTIVE', OR: [
      { chapter_members: { some: { chapter_id: chapterId } } },
      { organization_memberships: { some: { unit_id: { in: unitIds } } } },
    ] },
    select: {
      id: true, email: true, display_name: true, status: true, role: true, created_at: true,
      chapter_members: { select: { chapter_id: true, joined_at: true } },
      organization_memberships: { include: { unit: { select: { id: true, name: true, type: true, status: true } } } },
      position_assignments: { where: active, include: { position: { include: { permissions: { include: { permission: true } } } }, unit: { select: { id: true, type: true, status: true } } } },
    },
  })
  const intervals = users.length ? await prisma.chapterAffiliationInterval.findMany({ where: { user_id: { in: users.map(user => user.id) } } }) : []
  const effective = (row: { starts_at: Date; ends_at: Date | null }) => row.starts_at <= asOf && (!row.ends_at || row.ends_at > asOf)
  return users.flatMap(user => {
    const positions = user.position_assignments.filter(row => row.unit.status === 'ACTIVE' && row.position.scope === row.unit.type)
    // Department LT and Chapter president are learners even when they manage a Ban.
    if (positions.some(row => MANAGER_CODES.includes(row.position.code) || (!LT_CODES.includes(row.position.code) &&
      (row.position.is_manager || row.position.permissions.some(grant => ['MANAGE_CHAPTER_MEMBERS', 'MANAGE_DNA_MEMBERS'].includes(grant.permission.code)))))) return []
    const memberships = user.organization_memberships.filter(row => ['CHAPTER', 'DEPARTMENT', 'DNA', 'DNA_GROUP'].includes(row.unit.type))
    const current = memberships.filter(row => row.status === 'ACTIVE' && row.unit.status === 'ACTIVE' && effective(row))
    if (current.some(row => !unitIds.includes(row.unit_id))) return []
    const own = current.filter(row => unitIds.includes(row.unit_id))
    const legacy = user.chapter_members.find(row => row.chapter_id === chapterId && row.joined_at <= asOf)
    const history = intervals.filter(row => row.user_id === user.id)
    if (!own.length && (!legacy || memberships.length || user.chapter_members.some(row => row.chapter_id !== chapterId) ||
      (history.length && !history.some(row => row.chapter_id === chapterId && effective(row))))) return []
    const department = own.find(row => row.unit.type === 'DEPARTMENT')?.unit
    const joinedAt = own.length ? new Date(Math.min(...own.map(row => row.starts_at.getTime()))) : legacy!.joined_at
    const isLead = positions.some(row => LT_CODES.includes(row.position.code) &&
      (row.unit_id === chapter.organization_unit_id || row.unit_id === department?.id))
    return [{ userId: user.id, email: user.email, displayName: user.display_name, status: user.status, role: user.role,
      createdAt: user.created_at, joinedAt, department: department ? { id: department.id, name: department.name } : null, isLead }]
  }).sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime() || a.email.localeCompare(b.email))
}

export interface ListChapterMembersOptions {
  roles?: Array<'ADMIN' | 'CHAPTER_LEADER' | 'MEMBER'>
  status?: 'ACTIVE' | 'INACTIVE' | 'LOCKED'
  search?: string
}

/** Resolves current Chapter/Department members from both transitional membership stores. */
export async function listChapterMembers(
  chapterId: string,
  options: ListChapterMembersOptions = {},
): Promise<ChapterMemberRecord[]> {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { organization_unit_id: true } })
  if (!chapter) return []

  const unitIds = chapter.organization_unit_id
    ? await getOrganizationUnitTreeIds(chapter.organization_unit_id)
    : []
  const now = new Date()
  // A legacy Chapter index must never turn a DNA learner into a current Chapter member.
  const userWhere: Record<string, unknown> = { organization_memberships: { none: {
    status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }],
    unit: { type: { in: ['DNA', 'DNA_GROUP'] } },
  } } }
  if (options.roles?.length) userWhere.role = { in: options.roles }
  if (options.status) userWhere.status = options.status
  const search = options.search?.trim().slice(0, 255)
  if (search) userWhere.OR = [{ email: { contains: search, mode: 'insensitive' } }, { display_name: { contains: search, mode: 'insensitive' } }]
  const relationFilter = Object.keys(userWhere).length ? { user: userWhere } : {}
  const [legacyRows, organizationRows] = await Promise.all([
    prisma.chapterMember.findMany({
      where: { chapter_id: chapterId, ...relationFilter } as any,
      select: {
        joined_at: true,
        user: {
          select: {
            id: true,
            email: true,
            display_name: true,
            status: true,
            role: true,
            created_at: true,
            deactivated_by_user_id: true,
            deactivated_by_role: true,
            cascade_lead_id: true,
          },
        },
      },
    }),
    unitIds.length
      ? prisma.organizationMembership.findMany({
          where: {
            unit_id: { in: unitIds },
            status: 'ACTIVE',
            starts_at: { lte: now },
            OR: [{ ends_at: null }, { ends_at: { gt: now } }],
            ...relationFilter,
          } as any,
          select: {
            starts_at: true,
            unit: { select: { id: true, name: true, type: true } },
            user: {
              select: {
                id: true,
                email: true,
                display_name: true,
                status: true,
                role: true,
                created_at: true,
                deactivated_by_user_id: true,
                deactivated_by_role: true,
                cascade_lead_id: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ])

  const mapLegacy = (row: (typeof legacyRows)[number]): ChapterMemberRecord => ({
    userId: row.user.id,
    email: row.user.email,
    status: row.user.status,
    role: row.user.role,
    createdAt: row.user.created_at,
    joinedAt: row.joined_at,
    displayName: row.user.display_name,
    deactivatedByUserId: row.user.deactivated_by_user_id,
    deactivatedByRole: row.user.deactivated_by_role,
    cascadeLeadId: row.user.cascade_lead_id,
  })
  const mapOrganization = (row: (typeof organizationRows)[number]): ChapterMemberRecord => ({
    userId: row.user.id,
    email: row.user.email,
    status: row.user.status,
    role: row.user.role,
    createdAt: row.user.created_at,
    joinedAt: row.starts_at,
    displayName: row.user.display_name,
    department: row.unit.type === 'DEPARTMENT' ? { id: row.unit.id, name: row.unit.name } : null,
    deactivatedByUserId: row.user.deactivated_by_user_id,
    deactivatedByRole: row.user.deactivated_by_role,
    cascadeLeadId: row.user.cascade_lead_id,
  })
  return mergeChapterMemberRecords(legacyRows.map(mapLegacy), organizationRows.map(mapOrganization))
}
