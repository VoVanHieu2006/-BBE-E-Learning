import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import {
  REPLACE_CONFIRM_CODES, singleHolderWarning,
  type PresidentSituation, type ReplaceConfirmCode, type SingleHolderCode, type SingleHolderSituation,
} from './member-invite-position'

/**
 * Tình trạng một chức vụ "chỉ một người giữ" trong đơn vị của nó: Chủ tịch (đơn vị CHAPTER) hoặc
 * Trưởng ban (đơn vị DEPARTMENT). Trả người đang giữ và các lời mời khác vào cùng chức vụ còn hiệu lực.
 * `excludeEmail` bỏ qua lời mời của chính email đang được mời (lại).
 * `db`: truyền transaction để đọc trong cùng giao dịch, sau khi đã khóa Chapter (bổ nhiệm tức thì).
 */
export async function getSingleHolderSituation(unitId: string, positionCode: SingleHolderCode, excludeEmail?: string, db: Prisma.TransactionClient = prisma): Promise<SingleHolderSituation> {
  const now = new Date()
  const [unit, assignment, pending] = await Promise.all([
    db.organizationUnit.findUnique({ where: { id: unitId }, select: { name: true } }),
    db.positionAssignment.findFirst({
      where: {
        unit_id: unitId,
        position: { code: positionCode },
        starts_at: { lte: now },
        OR: [{ ends_at: null }, { ends_at: { gt: now } }],
        user: { role: 'MEMBER', status: 'ACTIVE' },
      },
      orderBy: { starts_at: 'desc' },
      select: { user: { select: { id: true, email: true, display_name: true } } },
    }),
    db.invitation.findMany({
      where: {
        organization_unit_id: unitId,
        position_code: positionCode,
        status: 'PENDING',
        expires_at: { gt: now },
        ...(excludeEmail ? { email: { not: excludeEmail } } : {}),
      },
      orderBy: { created_at: 'asc' },
      select: { id: true, email: true, expires_at: true },
    }),
  ])
  const currentHolder = assignment?.user ? { userId: assignment.user.id, name: assignment.user.display_name || '', email: assignment.user.email } : null
  return {
    positionCode,
    unitName: unit?.name || '',
    currentHolder,
    pendingInvitations: pending.map((row) => ({ id: row.id, email: row.email, expiresAt: row.expires_at.toISOString() })),
    // Giữ dạng cũ của body 409 Chủ tịch (bf8b350) cho client đọc `situation.currentPresident`.
    ...(positionCode === 'PRESIDENT' ? { currentPresident: currentHolder } : {}),
  }
}

/** Tình trạng vị trí Chủ tịch của một Chapter (theo đơn vị CHAPTER), giữ dạng cũ `currentPresident`. */
export async function getChapterPresidentSituation(chapterUnitId: string, excludeEmail?: string): Promise<PresidentSituation> {
  const situation = await getSingleHolderSituation(chapterUnitId, 'PRESIDENT', excludeEmail)
  return { currentPresident: situation.currentHolder, pendingInvitations: situation.pendingInvitations }
}

export type SingleHolderInviteCheck =
  | { ok: true; situation: SingleHolderSituation }
  | { ok: false; status: 409; error: { code: ReplaceConfirmCode; message: string; situation: SingleHolderSituation } }

/**
 * Đơn vị đã có người giữ chức vụ hoặc đã có lời mời khác vào chức vụ đó: chỉ cho gửi khi người mời đã xác nhận
 * (`confirmed === true`) sau khi thấy cảnh báo. Cảnh báo do server quyết định nên không client nào bỏ qua được.
 * Mã lỗi: `PresidentReplaceConfirmRequired` hoặc `DepartmentLeadReplaceConfirmRequired`.
 */
export async function checkSingleHolderInvite(unitId: string, positionCode: SingleHolderCode, email: string, confirmed: unknown): Promise<SingleHolderInviteCheck> {
  const situation = await getSingleHolderSituation(unitId, positionCode, email)
  const warning = singleHolderWarning(situation)
  if (warning && confirmed !== true) {
    return { ok: false, status: 409, error: { code: REPLACE_CONFIRM_CODES[positionCode], message: warning, situation } }
  }
  return { ok: true, situation }
}

/** Giữ tên cũ cho luồng Chủ tịch. */
export function checkPresidentInvite(chapterUnitId: string, email: string, confirmed: unknown) {
  return checkSingleHolderInvite(chapterUnitId, 'PRESIDENT', email, confirmed)
}
