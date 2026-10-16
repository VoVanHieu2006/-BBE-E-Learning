import { prisma } from '@/lib/prisma'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { ChapterMemberRecord, mergeChapterMemberRecords } from '@/lib/chapter-membership-rules'

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
  const userWhere: Record<string, unknown> = {}
  if (options.roles?.length) userWhere.role = { in: options.roles }
  if (options.status) userWhere.status = options.status
  const search = options.search?.trim().slice(0, 255)
  if (search) userWhere.OR = [{ email: { contains: search, mode: 'insensitive' } }, { display_name: { contains: search, mode: 'insensitive' } }]
  const relationFilter = Object.keys(userWhere).length ? { user: userWhere } : {}
  const now = new Date()

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
