import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

export const CHAPTER_LEAD_CODES = ['CHAPTER_LEAD', 'CHAPTER_MANAGER']
type Db = Prisma.TransactionClient | typeof prisma

/** PositionAssignment is the authority. ChapterMember is affiliation, never a grant. */
export async function chapterLeadScope(userId: string, db: Db = prisma, now = new Date()) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      chapter_lead_binding: { select: { chapter_id: true } },
      chapter_members: { select: { chapter_id: true } },
      position_assignments: {
        where: { position: { code: { in: CHAPTER_LEAD_CODES } }, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
        select: { id: true, unit: { select: { status: true, chapter: { select: { id: true, name: true } } } } },
      },
    },
  })
  if (!user || user.role === 'ADMIN') return { isLead: false, chapterId: null, conflict: false }
  const assignments = user.position_assignments
  const chapters = Array.from(new Set(assignments.map(row => row.unit.chapter?.id).filter((id): id is string => Boolean(id))))
  const legacyMismatch = user.role === 'CHAPTER_LEADER' && chapters.length === 1 && user.chapter_members.some(row => row.chapter_id !== chapters[0])
  const bindingMismatch = chapters.length === 1 && user.chapter_lead_binding?.chapter_id !== chapters[0]
  const conflict = assignments.length > 1 || legacyMismatch || bindingMismatch
  return {
    isLead: user.role === 'CHAPTER_LEADER' || assignments.length > 0,
    chapterId: !conflict && assignments.length === 1 && assignments[0].unit.status === 'ACTIVE' ? chapters[0] || null : null,
    conflict,
  }
}

export class OrganizationConflict extends Error {
  constructor(public readonly code: string, message: string, public readonly chapterName?: string) {
    super(message)
    Object.setPrototypeOf(this, OrganizationConflict.prototype)
  }
}

/** Called after the user lock, inside the same transaction as the insert. */
export async function assertLeadAppointment(db: Db, userId: string, positionCode: string, unitId: string, startsAt: Date, endsAt: Date | null) {
  if (!CHAPTER_LEAD_CODES.includes(positionCode)) return
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } })
  if (user.role === 'ADMIN') return
  const [binding, target] = await Promise.all([
    db.chapterLeadBinding.findUnique({ where: { user_id: userId }, include: { chapter: { select: { name: true } } } }),
    db.chapter.findUnique({ where: { organization_unit_id: unitId }, select: { id: true } }),
  ])
  if (binding && binding.chapter_id !== target?.id) throw new OrganizationConflict('ChapterLeadPermanentBinding', `Tài khoản đã gắn cố định với ${binding.chapter.name}; không được đổi Lead sang Chapter khác.`, binding.chapter.name)
  const candidates = await db.positionAssignment.findMany({
    where: {
      user_id: userId, position: { code: { in: CHAPTER_LEAD_CODES } },
      ...(endsAt ? { starts_at: { lt: endsAt } } : {}),
      AND: [
        { OR: [{ ends_at: null }, { ends_at: { gt: startsAt } }] },
        { OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] },
      ],
    },
    select: { starts_at: true, ends_at: true, unit: { select: { name: true } } },
  })
  const existing = candidates.find(row => !row.ends_at || row.ends_at > row.starts_at)
  if (existing) throw new OrganizationConflict('ChapterLeadConflict', `Tài khoản đang có nhiệm kỳ Lead Chapter tại ${existing.unit.name}. Hãy thu hồi hoặc chuyển quyền trước khi bổ nhiệm Chapter khác.`, existing.unit.name)
}
