import { assignMembershipPosition } from './position-replacement'
import { isLeadRole } from '@/lib/roles'
import { invalidateOrganizationViews } from './organization-view-cache'
import { prepareOrganizationTransition } from './organization-transition'
import { prisma } from './prisma'
import { hashToken, generateToken } from './tokens'
import { sendInvitationEmail, type SendInvitationEmailParams } from './email'
import { EMAIL_QUOTA_EXHAUSTED_MESSAGE, LINK_RATE_WINDOW_MS, isLinkRequestRateLimited } from './email-quota-core'
import { reconcileLearningAssignmentsForUser } from './learning-assignments'
import { invalidateChapterLeaderboardCache } from './chapter-leaderboard-cache'
import { invalidateMemberLeaderboardCache } from './member-leaderboard-cache'
type UserRole = 'ADMIN' | 'LEAD' | 'MEMBER';
type InvitationRole = 'LEAD' | 'DNA_LEAD' | 'MEMBER';
type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';
import bcrypt from 'bcryptjs'
import { ensureChapterStandardDepartments } from './chapter-departments'

/**
 * Cách xử lý mail của một lời mời:
 * - auto: tự đặt chỗ 1 slot hạn mức rồi gửi (mời đơn, gửi lại);
 * - reserved: người gọi đã đặt chỗ sẵn (mời hàng loạt), `day` là ngày UTC của slot;
 * - link: người gọi biết đã hết slot, bỏ qua mail và giao bằng link.
 */
export type InvitationMailPlan = { kind: 'auto' } | { kind: 'reserved'; day: string } | { kind: 'link' }
export type InvitationDeliveryMethod = 'EMAIL' | 'LINK'

export interface SendInvitationOptions {
  email: string
  role: InvitationRole
  chapterId?: string
  organizationUnitId?: string
  invitedBy: string
  mail?: InvitationMailPlan
}

export interface SendInvitationResult {
  ok: true
  invitationId: string
  chapterId?: string
  organizationUnitId?: string
  status: InvitationStatus
  expiresAt: Date
  // Token is only returned here for email sending - it's sent in plain
  token: string
  emailSent: boolean
  emailError?: string
  /** EMAIL = đã gửi mail; LINK = chưa gửi được mail, cần lấy link mời để giao. */
  delivery: InvitationDeliveryMethod
}

export interface SendInvitationError {
  ok: false
  code: string
  message: string
}

/** Common validation: check if email already has an ACTIVE or INACTIVE account */
export async function isEmailActive(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } })
  return user !== null && user.status === 'ACTIVE'
}

/** BR-02: email must not belong to ANY existing account (Active or Inactive) */
export async function emailHasAnyAccount(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } })
  return user !== null
}

interface MailDelivery {
  emailSent: boolean
  emailError?: string
  delivery: InvitationDeliveryMethod
}

/**
 * Giao mail cho lời mời đã lưu rồi ghi lại cách giao. Hết hạn mức, thiếu cấu hình hoặc lỗi gửi
 * không bao giờ làm hỏng việc mời: lời mời vẫn đang chờ, chỉ chuyển sang giao bằng link.
 */
async function deliverInvitationMail(
  invitationId: string,
  params: Omit<SendInvitationEmailParams, 'slotDay'>,
  plan: InvitationMailPlan,
  currentDelivery: InvitationDeliveryMethod,
): Promise<MailDelivery> {
  let delivery: InvitationDeliveryMethod = 'LINK'
  let emailError: string | undefined = EMAIL_QUOTA_EXHAUSTED_MESSAGE
  if (plan.kind !== 'link') {
    try {
      const result = await sendInvitationEmail({ ...params, slotDay: plan.kind === 'reserved' ? plan.day : undefined })
      if (result.success) delivery = 'EMAIL'
      emailError = result.success ? undefined : result.error || 'không rõ lý do'
    } catch (error) {
      console.error('[INVITATION] email dispatch threw:', (error as Error)?.message)
      emailError = 'Lỗi hệ thống khi gửi email.'
    }
  }
  if (delivery !== currentDelivery) {
    await prisma.invitation.update({ where: { id: invitationId }, data: { delivery_method: delivery } })
  }
  return { emailSent: delivery === 'EMAIL', emailError, delivery }
}

/** Send an invitation to a member (BĐHU or Admin) */
export async function sendMemberInvitation(
  opts: SendInvitationOptions
): Promise<SendInvitationResult | SendInvitationError> {
  if (Boolean(opts.chapterId) === Boolean(opts.organizationUnitId)) {
    return { ok: false, code: 'ValidationError', message: 'Choose exactly one Chapter or Organization Unit scope.' }
  }
  if (opts.role === 'MEMBER') {
    const unit = opts.organizationUnitId ? await prisma.organizationUnit.findUnique({ where: { id: opts.organizationUnitId }, select: { type: true, status: true } }) : null
    if (!unit || unit.status !== 'ACTIVE' || !['DEPARTMENT', 'DNA_GROUP'].includes(unit.type)) return { ok: false, code: 'MemberPositionRequired', message: 'Vui lòng chọn một ban hoặc nhóm DNA cho thành viên.' }
  }
  // BR-02 (issue #10): no invitation if email already belongs to ANY account (Active or Inactive)
  if (await emailHasAnyAccount(opts.email)) {
    const user = await prisma.user.findUnique({ where: { email: opts.email } })
    if (user?.status === 'ACTIVE') {
      return { ok: false, code: 'EmailAlreadyActive', message: 'Email đã có tài khoản đang hoạt động (Active). Không thể gửi lời mời.' }
    } else {
      return { ok: false, code: 'EmailAlreadyExists', message: 'Email đã gắn với một tài khoản Inactive. Vui lòng kích hoạt lại tài khoản đó hoặc liên hệ Admin.' }
    }
  }

  // Check if there's already a pending invitation for this email (prevent duplicates)
  const existingPending = await prisma.invitation.findFirst({
    where: { email: opts.email, status: 'PENDING' },
  })
  if (existingPending) {
    // Invalidate existing pending invitation
    await prisma.invitation.update({
      where: { id: existingPending.id },
      data: { status: 'CANCELLED', cancelled_at: new Date() },
    })
  }

  const token = generateToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

  const invitation = await prisma.invitation.create({
    data: {
      email: opts.email,
      role: opts.role,
      chapter_id: opts.chapterId || null,
      organization_unit_id: opts.organizationUnitId || null,
      invited_by: opts.invitedBy,
      token_hash: tokenHash,
      status: 'PENDING',
      expires_at: expiresAt,
    },
  })

  // Send invitation email via Resend (hạn mức ngày được tính trong email.ts); lỗi → giao bằng link
  const mail = await deliverInvitationMail(invitation.id, { to: opts.email, role: opts.role, token, expiresAt }, opts.mail ?? { kind: 'auto' }, 'EMAIL')

  return {
    ok: true,
    invitationId: invitation.id,
    chapterId: opts.chapterId,
    organizationUnitId: opts.organizationUnitId,
    status: 'PENDING',
    expiresAt,
    token, // return plain token for email
    ...mail,
  }
}

/** Send invitation for chapter leader — also creates the chapter */
export async function sendChapterLeaderInvitation(
  email: string,
  chapterName: string,
  chapterDescription: string | undefined,
  invitedBy: string
): Promise<{ ok: true; invitationId: string; chapterId: string | null; status: InvitationStatus; expiresAt: Date; token: string; emailSent: boolean; emailError?: string; delivery: InvitationDeliveryMethod } | SendInvitationError> {
  email = email.trim().toLowerCase()
  // BR-02 (issue #10): no invitation if email already belongs to ANY account
  if (await emailHasAnyAccount(email)) {
    const u = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: { chapter_lead_binding: { include: { chapter: true } } } })
    if (u?.chapter_lead_binding) return { ok: false, code: 'ChapterLeadPermanentBinding', message: `Tài khoản đã gắn cố định với ${u.chapter_lead_binding.chapter.name}; không thể gán Chapter khác.` }
    if (u?.status === 'ACTIVE') {
      return { ok: false, code: 'EmailAlreadyActive', message: 'Email đã có tài khoản đang hoạt động.' }
    } else {
      return { ok: false, code: 'EmailAlreadyExists', message: 'Email này đã gắn với tài khoản Inactive.' }
    }
  }

  // Check chapter name uniqueness
  const existingChapter = await prisma.chapter.findUnique({ where: { name: chapterName } })
  if (existingChapter) {
    return { ok: false, code: 'ChapterNameConflict', message: 'Tên chapter đã tồn tại' }
  }

  const pendingName = await prisma.invitation.findFirst({ where: { role: 'LEAD', status: 'PENDING', chapter_name: chapterName, expires_at: { gt: new Date() } }, select: { id: true } })
  if (pendingName) return { ok: false, code: 'ChapterNameConflict', message: 'Chapter name is reserved by a pending invitation' }

  // Persist the invitation only; the Chapter is created on acceptance.
  const created = await prisma.$transaction(async (tx) => {
    // Check for existing pending invitation
    const existingPending = await tx.invitation.findFirst({
      where: { email, status: 'PENDING' },
    })
    if (existingPending) {
      await tx.invitation.update({
        where: { id: existingPending.id },
        data: { status: 'CANCELLED', cancelled_at: new Date() },
      })
    }

    const token = generateToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    const invitation = await tx.invitation.create({
      data: {
        email,
        role: 'LEAD',
        chapter_name: chapterName,
        chapter_description: chapterDescription,
        invited_by: invitedBy,
        token_hash: tokenHash,
        status: 'PENDING',
        expires_at: expiresAt,
      },
    })

    return {
      invitationId: invitation.id,
      chapterId: null,
      expiresAt,
      token,
    }
  })

  // Send chapter leader invitation email via Resend OUTSIDE transaction
  const mail = await deliverInvitationMail(created.invitationId, { to: email, role: 'LEAD', chapterName, token: created.token, expiresAt: created.expiresAt }, { kind: 'auto' }, 'EMAIL')

  return {
    ok: true as const,
    invitationId: created.invitationId,
    chapterId: created.chapterId,
    status: 'PENDING' as InvitationStatus,
    expiresAt: created.expiresAt,
    token: created.token,
    ...mail,
  }
}

export async function sendDnaLeaderInvitation(email: string, invitedBy: string) {
  email = email.trim().toLowerCase()
  const binding = await prisma.chapterLeadBinding.findFirst({ where: { user: { email, role: { not: 'ADMIN' } } }, include: { chapter: { select: { name: true } } } })
  if (binding) return { ok: false as const, code: 'LeadChapterCannotJoinDna', message: `Lead đã gắn cố định với ${binding.chapter.name}; không được chuyển sang DNA.` }
  const dnaUnit = await prisma.organizationUnit.findFirst({ where: { type: 'DNA' }, orderBy: { created_at: 'asc' } })
  if (!dnaUnit) return { ok: false as const, code: 'DnaNotConfigured', message: 'Chưa có đơn vị DNA trong hệ thống.' }
  const activeLead = await prisma.positionAssignment.findFirst({
    where: { unit_id: dnaUnit.id, position: { code: 'DNA_LEAD' }, starts_at: { lte: new Date() }, OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] },
  })
  if (activeLead) return { ok: false as const, code: 'DnaLeadExists', message: 'Hệ thống đã có một Lead DNA đang hoạt động.' }
  const existingUser = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } })
  if (existingUser) return { ok: false as const, code: 'LeadInvitationRequiresNewAccount', message: 'LEAD phải là tài khoản mới được mời làm LEAD; không đổi vai trò tài khoản hiện có.' }
  return sendMemberInvitation({ email, role: 'DNA_LEAD', organizationUnitId: dnaUnit.id, invitedBy })
}

/** Resend invitation — invalidates old token if PENDING, creates new token */
export async function resendInvitation(
  invitationId: string,
  actorId: string,
  actorRole: UserRole,
  hasScopedManagePermission = false,
): Promise<{ ok: true; invitationId: string; status: InvitationStatus; expiresAt: Date; token: string; emailSent: boolean; emailError?: string; delivery: InvitationDeliveryMethod } | SendInvitationError> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } })

  if (!invitation) {
    return { ok: false, code: 'InvitationNotFound', message: 'Invitation không tồn tại' }
  }

  // Authorization: Admin can resend any invitation; BĐHU only their own
  if (actorRole !== 'ADMIN' && !hasScopedManagePermission && invitation.invited_by !== actorId) {
    return { ok: false, code: 'AccessDenied', message: 'Không có quyền resend invitation này' }
  }

  // Cannot resend accepted invitation
  if (invitation.status === 'ACCEPTED') {
    return { ok: false, code: 'InvalidState', message: 'Invitation đã được chấp nhận' }
  }

  const token = generateToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  // Điều kiện nằm trong câu UPDATE: nếu lời mời vừa được kích hoạt (ACCEPTED) thì không làm sống lại.
  const renewed = await prisma.invitation.updateMany({
    where: { id: invitationId, status: { not: 'ACCEPTED' } },
    data: {
      token_hash: tokenHash,
      status: 'PENDING',
      expires_at: expiresAt,
      accepted_at: null,
      cancelled_at: null,
    },
  })
  if (renewed.count !== 1) {
    return { ok: false, code: 'InvalidState', message: 'Invitation đã được chấp nhận' }
  }

  // Gửi lại bằng email (tính hạn mức). Hết hạn mức hoặc lỗi thì chuyển sang giao bằng link.
  const mail = await deliverInvitationMail(invitationId, { to: invitation.email, role: invitation.role, token, expiresAt }, { kind: 'auto' }, invitation.delivery_method)

  return { ok: true, invitationId, status: 'PENDING', expiresAt, token, ...mail }
}

/**
 * Lấy link mời mới cho lời mời đang chờ giao bằng link (không gửi mail). Mỗi lần gọi đổi token nên
 * link cũ hết hiệu lực; hạn 24 giờ của lời mời giữ nguyên. Token chỉ lưu dạng băm nên không thể hiện lại link cũ.
 * Quyền kiểm tra giống resend/cancel (route kiểm tra thêm quyền theo đơn vị). Ghi audit log, không chứa token.
 */
export async function issueInvitationLink(
  invitationId: string,
  actorId: string,
  actorRole: UserRole,
  hasScopedManagePermission = false,
): Promise<{ ok: true; invitationId: string; token: string; expiresAt: Date } | SendInvitationError> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } })
  if (!invitation) return { ok: false, code: 'InvitationNotFound', message: 'Lời mời không tồn tại' }
  if (actorRole !== 'ADMIN' && !hasScopedManagePermission && invitation.invited_by !== actorId) {
    return { ok: false, code: 'AccessDenied', message: 'Không có quyền lấy link của lời mời này' }
  }
  const now = new Date()
  if (invitation.status !== 'PENDING' || invitation.expires_at <= now) {
    return { ok: false, code: 'InvalidState', message: 'Chỉ lấy được link của lời mời còn đang chờ và chưa hết hạn.' }
  }
  if (invitation.delivery_method !== 'LINK') {
    return { ok: false, code: 'NotLinkDelivery', message: 'Lời mời này đã gửi qua email. Dùng "Gửi lại" để gửi email mới.' }
  }

  const since = new Date(now.getTime() - LINK_RATE_WINDOW_MS)
  const [byActor, byInvitation] = await Promise.all([
    prisma.auditLog.count({ where: { actor_user_id: actorId, action: 'INVITATION_LINK_ISSUED', created_at: { gte: since } } }),
    prisma.auditLog.count({ where: { entity_type: 'INVITATION', entity_id: invitationId, action: 'INVITATION_LINK_ISSUED', created_at: { gte: since } } }),
  ])
  if (isLinkRequestRateLimited({ byActor, byInvitation })) {
    return { ok: false, code: 'RateLimited', message: 'Bạn đã lấy link quá nhiều lần trong ít phút. Vui lòng thử lại sau.' }
  }

  const token = generateToken()
  const issued = await prisma.$transaction(async (tx) => {
    // Điều kiện nằm trong câu UPDATE: nếu lời mời vừa được kích hoạt/hủy/hết hạn thì không đổi gì.
    const updated = await tx.invitation.updateMany({
      where: { id: invitationId, status: 'PENDING', delivery_method: 'LINK', expires_at: { gt: now } },
      data: { token_hash: hashToken(token) },
    })
    if (updated.count !== 1) return false
    await tx.auditLog.create({
      data: { actor_user_id: actorId, action: 'INVITATION_LINK_ISSUED', entity_type: 'INVITATION', entity_id: invitationId, metadata: { email: invitation.email, role: invitation.role } },
    })
    return true
  })
  if (!issued) return { ok: false, code: 'InvalidState', message: 'Lời mời vừa thay đổi trạng thái, hãy tải lại danh sách.' }
  return { ok: true, invitationId, token, expiresAt: invitation.expires_at }
}

/** Cancel invitation */
export async function cancelInvitation(
  invitationId: string,
  actorId: string,
  actorRole: UserRole,
  hasScopedManagePermission = false,
): Promise<{ ok: true; invitationId: string; status: InvitationStatus } | SendInvitationError> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } })

  if (!invitation) {
    return { ok: false, code: 'InvitationNotFound', message: 'Invitation không tồn tại' }
  }

  if (actorRole !== 'ADMIN' && !hasScopedManagePermission && invitation.invited_by !== actorId) {
    return { ok: false, code: 'AccessDenied', message: 'Không có quyền hủy invitation này' }
  }

  if (invitation.status !== 'PENDING') {
    return { ok: false, code: 'InvalidState', message: 'Chỉ hủy được invitation đang PENDING' }
  }

  // Điều kiện PENDING nằm trong câu UPDATE: lời mời vừa được kích hoạt thì không bị đổi thành CANCELLED.
  const cancelled = await prisma.invitation.updateMany({
    where: { id: invitationId, status: 'PENDING' },
    data: { status: 'CANCELLED', cancelled_at: new Date() },
  })
  if (cancelled.count !== 1) {
    return { ok: false, code: 'InvalidState', message: 'Lời mời vừa thay đổi trạng thái, hãy tải lại danh sách.' }
  }

  return { ok: true, invitationId, status: 'CANCELLED' }
}

/** Validate an invitation token (public — used by the accept-invitation page) */
export async function validateInvitationToken(
  token: string
): Promise<
  | { ok: true; email: string; role: InvitationRole; chapterName: string; organizationUnitId?: string; expiresAt: Date }
  | SendInvitationError
> {
  const tokenHash = hashToken(token)
  const invitation = await prisma.invitation.findUnique({
    where: { token_hash: tokenHash },
    include: { chapter: { select: { name: true } }, organization_unit: { select: { id: true, name: true } } },
  })

  if (!invitation) {
    return { ok: false, code: 'InvitationNotFound', message: 'Link không hợp lệ hoặc đã bị thay thế bằng lời mời mới' }
  }
  if (invitation.status === 'ACCEPTED') {
    return { ok: false, code: 'TokenAlreadyUsed', message: 'Lời mời này đã được sử dụng' }
  }
  if (invitation.status === 'CANCELLED') {
    return { ok: false, code: 'InvalidState', message: 'Lời mời này đã bị hủy' }
  }
  if (invitation.status === 'EXPIRED' || new Date() > invitation.expires_at) {
    return { ok: false, code: 'TokenExpired', message: 'Lời mời đã hết hạn' }
  }

  return {
    ok: true,
    email: invitation.email,
    role: invitation.role as InvitationRole,
    chapterName: invitation.chapter_name || invitation.chapter?.name || invitation.organization_unit?.name || 'BBE',
    organizationUnitId: invitation.organization_unit_id || undefined,
    expiresAt: invitation.expires_at,
  }
}

const INVITATION_NO_LONGER_VALID_MESSAGE = 'Link không còn hiệu lực, vui lòng xin link mới'

/** Ném trong transaction của acceptInvitation để rollback khi lời mời không còn khớp token/PENDING/chưa hết hạn. */
// Không dùng `class extends Error` + instanceof: target biên dịch ES5 làm instanceof sai với lớp con của Error.
const INVITATION_NO_LONGER_VALID_FLAG = 'invitationNoLongerValid'
function createInvitationNoLongerValidError(): Error {
  return Object.assign(new Error(INVITATION_NO_LONGER_VALID_MESSAGE), { [INVITATION_NO_LONGER_VALID_FLAG]: true })
}
function isInvitationNoLongerValidError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<string, unknown>)[INVITATION_NO_LONGER_VALID_FLAG] === true
}

/** Accept invitation — create user account and activate */
export async function acceptInvitation(
  token: string,
  password: string
): Promise<{ ok: true; userId: string; email: string; role: UserRole; status: 'ACTIVE' } | SendInvitationError> {
  const tokenHash = hashToken(token)

  const invitation = await prisma.invitation.findUnique({ where: { token_hash: tokenHash } })

  if (!invitation) {
    return { ok: false, code: 'InvitationNotFound', message: 'Token không hợp lệ' }
  }

  if (invitation.status !== 'PENDING') {
    return { ok: false, code: 'TokenAlreadyUsed', message: 'Token đã được sử dụng hoặc đã bị hủy' }
  }

  if (new Date() > invitation.expires_at) {
    return { ok: false, code: 'TokenExpired', message: 'Token đã hết hạn' }
  }

  if (invitation.role === 'MEMBER') {
    const unit = invitation.organization_unit_id ? await prisma.organizationUnit.findUnique({ where: { id: invitation.organization_unit_id }, select: { type: true, status: true } }) : null
    if (!unit || unit.status !== 'ACTIVE' || !['DEPARTMENT', 'DNA_GROUP'].includes(unit.type)) return { ok: false, code: 'MemberPositionRequired', message: 'Lời mời cần được gửi lại với một ban hoặc nhóm DNA cụ thể.' }
  }

  // Hash password with bcrypt
  const passwordHash = await bcrypt.hash(password, 12)

  // Use transaction: claim invitation + create user + link to chapter
  let accepted
  try {
    accepted = await prisma.$transaction(async (tx) => {
    // Chiếm lời mời trước tiên và đúng theo token đã dùng: nếu trong lúc băm mật khẩu người quản lý đã đổi link
    // (token_hash mới), hủy hoặc lời mời hết hạn thì không khớp dòng nào → hủy cả transaction, chưa tạo gì.
    // Hai lượt kích hoạt cùng lúc cũng chỉ một lượt chiếm được (lượt sau chờ khóa dòng rồi thấy status đã ACCEPTED).
    const claimedAt = new Date()
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, token_hash: tokenHash, status: 'PENDING', expires_at: { gt: claimedAt } },
      data: { status: 'ACCEPTED', accepted_at: claimedAt },
    })
    if (claimed.count !== 1) throw createInvitationNoLongerValidError()

    const user = await tx.user.create({
      data: {
        email: invitation.email.trim().toLowerCase(),
        password_hash: passwordHash,
        role: (invitation.role === 'DNA_LEAD' ? 'LEAD' : invitation.role) as UserRole,
        status: 'ACTIVE',
        failed_login_count: 0,
      },
    })

    let chapterId = invitation.chapter_id
    let organizationUnitId = invitation.organization_unit_id
    if (!chapterId && isLeadRole(invitation.role) && invitation.chapter_name) {
      const unit = await tx.organizationUnit.create({ data: { name: invitation.chapter_name, type: 'CHAPTER' } })
      const chapter = await tx.chapter.create({
        data: {
          name: invitation.chapter_name,
          description: invitation.chapter_description,
          organization_unit_id: unit.id,
          current_term_number: 1,
        },
      })
      chapterId = chapter.id
      organizationUnitId = unit.id
      await tx.chapterCompetitionTerm.create({
        data: {
          chapter_id: chapter.id,
          starts_at: chapter.created_at,
          ends_at: null,
          season_id: null,
        },
      })
      await ensureChapterStandardDepartments(unit.id, tx)
      await tx.invitation.update({ where: { id: invitation.id }, data: { chapter_id: chapter.id, organization_unit_id: unit.id } })
    }
    if (chapterId) {
      const chapter = await tx.chapter.findUnique({ where: { id: chapterId }, select: { id: true, name: true, organization_unit_id: true } })
      if (!chapter) throw new Error('Invitation Chapter no longer exists')
      if (!organizationUnitId) organizationUnitId = chapter.organization_unit_id
      if (!organizationUnitId) {
        const unit = await tx.organizationUnit.create({ data: { name: chapter.name, type: 'CHAPTER' } })
        organizationUnitId = unit.id
        await tx.chapter.update({ where: { id: chapter.id }, data: { organization_unit_id: organizationUnitId } })
      }
    } else if (organizationUnitId) {
      let currentId: string | null = organizationUnitId
      const visited = new Set<string>()
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId)
        const unit = await tx.organizationUnit.findUnique({ where: { id: currentId }, select: { id: true, type: true, parent_id: true, chapter: { select: { id: true } } } })
        if (!unit) throw new Error('Invitation organization unit no longer exists')
        if (unit.type === 'CHAPTER' && unit.chapter) {
          chapterId = unit.chapter.id
          break
        }
        currentId = unit.parent_id
      }
    }
    if (!organizationUnitId) throw new Error('Invitation has no valid organization scope')

    // Retain the legacy Chapter index where one exists; OrganizationMembership
    // is the source of truth for Chapter, Department, and DNA scopes.
    if (chapterId) {
      await tx.chapterMember.upsert({
        where: { chapter_id_user_id: { chapter_id: chapterId, user_id: user.id } },
        create: { chapter_id: chapterId, user_id: user.id },
        update: {},
      })
    }
    await tx.organizationMembership.create({ data: { user_id: user.id, unit_id: organizationUnitId } })

    if (isLeadRole(invitation.role)) {
      const position = await tx.position.upsert({
        where: { code: 'CHAPTER_LEAD' },
        update: {},
        create: { code: 'CHAPTER_LEAD', name: 'Lead Chapter', scope: 'CHAPTER', is_manager: true },
      })
      const existingPrimary = await tx.positionAssignment.findFirst({ where: { unit_id: organizationUnitId, is_primary: true, starts_at: { lte: new Date() }, OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] }, select: { id: true } })
      await tx.positionAssignment.create({
        data: { user_id: user.id, position_id: position.id, unit_id: organizationUnitId, is_primary: !existingPrimary, starts_at: new Date(), appointed_by: invitation.invited_by },
      })
      const progressPermission = await tx.permission.upsert({
        where: { code: 'VIEW_MEMBER_PROGRESS' }, update: {},
        create: { code: 'VIEW_MEMBER_PROGRESS', description: 'View detailed learning progress within a scoped Chapter.' },
      })
      await tx.positionPermission.upsert({
        where: { position_id_permission_id: { position_id: position.id, permission_id: progressPermission.id } },
        update: {}, create: { position_id: position.id, permission_id: progressPermission.id },
      })
    } else if (invitation.role === 'DNA_LEAD') {
      const position = await tx.position.upsert({
        where: { code: 'DNA_LEAD' },
        update: { name: 'Lead DNA', scope: 'DNA', is_manager: true },
        create: { code: 'DNA_LEAD', name: 'Lead DNA', scope: 'DNA', is_manager: true },
      })
      await tx.positionAssignment.create({
        data: { user_id: user.id, position_id: position.id, unit_id: organizationUnitId, is_primary: true, starts_at: new Date(), appointed_by: invitation.invited_by },
      })

    }

    if (invitation.role !== 'MEMBER') {
      const code = invitation.role === 'DNA_LEAD' ? 'DNA_LEAD' : 'CHAPTER_LEAD'
      const position = await tx.position.findUniqueOrThrow({ where: { code } })
      for (const permissionCode of ['VIEW_MEMBER_PROGRESS', code === 'DNA_LEAD' ? 'MANAGE_DNA_MEMBERS' : 'MANAGE_CHAPTER_MEMBERS']) {
        const permission = await tx.permission.upsert({ where: { code: permissionCode }, update: {}, create: { code: permissionCode } })
        await tx.positionPermission.upsert({ where: { position_id_permission_id: { position_id: position.id, permission_id: permission.id } }, update: {}, create: { position_id: position.id, permission_id: permission.id } })
      }
    }
    if (invitation.role === 'MEMBER') await assignMembershipPosition(tx, user.id, organizationUnitId, invitation.invited_by)

    console.log(`[ACCOUNT] User created (${user.role})`)

    return {
      ok: true as const,
      userId: user.id,
      email: user.email,
      role: user.role,
      status: 'ACTIVE' as const,
    }
    })
  } catch (error) {
    if (isInvitationNoLongerValidError(error)) {
      return { ok: false, code: 'TokenAlreadyUsed', message: INVITATION_NO_LONGER_VALID_MESSAGE }
    }
    throw error
  }
  if (accepted.ok) {
    invalidateChapterLeaderboardCache()
    invalidateMemberLeaderboardCache()
    try {
      await reconcileLearningAssignmentsForUser(accepted.userId)
    } catch (error) {
      // Account creation is already committed; progression retries reconciliation
      // on first lesson access, so do not make an accepted invitation appear failed.
      console.error('[INVITATION] Learning assignment reconciliation failed:', error)
    }
  }
  return accepted
}

/** Get invitations list with pagination */
export async function getInvitations(params: {
  actorId: string
  actorRole: UserRole
  kind?: 'LEAD'
  status?: InvitationStatus
  chapterId?: string
  organizationUnitId?: string
  page: number
  limit: number
}) {
  const { actorId, actorRole, status, chapterId, organizationUnitId, page, limit } = params
  const skip = (page - 1) * limit

  // Đánh dấu các lời mời PENDING đã quá hạn thành EXPIRED để bộ lọc/trạng thái hiển thị đúng
  await prisma.invitation.updateMany({
    where: { status: 'PENDING', expires_at: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })

  // Build where clause
  const where: Record<string, unknown> = {}
  if (isLeadRole(params.kind)) {
    if (actorRole !== 'ADMIN') throw new Error('AccessDenied')
    where.role = { in: ['LEAD', 'DNA_LEAD'] }
  }

  // Filter by status
  if (status) where.status = status

  // BĐHU chỉ được xem lời mời trong chapter của mình (chapterId do auth context cung cấp)
  if (actorRole !== 'ADMIN' && !chapterId && !organizationUnitId) {
    return { items: [], totalItems: 0, totalPages: 0 }
  }

  // If chapterId is specified (Admin querying specific chapter, or BĐHU with their chapter)
  if (chapterId) {
    where.OR = [
      { chapter_id: chapterId, organization_unit_id: null },
      { organization_unit: { OR: [
        { chapter: { id: chapterId } },
        { type: 'DEPARTMENT', parent: { chapter: { id: chapterId } } },
      ] } },
    ]
  }
  if (organizationUnitId) {
    where.organization_unit_id = organizationUnitId
  }

  const [invitations, totalItems] = await Promise.all([
    prisma.invitation.findMany({
      where,
      include: {
        chapter: { select: { id: true, name: true } },
        organization_unit: { select: { id: true, name: true, type: true } },
        invited_by_user: { select: { id: true, email: true } },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.invitation.count({ where }),
  ])

  return {
    items: invitations.map((inv) => ({
      id: inv.id,
      invitationId: inv.id,
      email: inv.email,
      role: inv.role,
      chapterId: inv.chapter_id,
      organizationUnitId: inv.organization_unit_id,
      organizationUnitType: inv.organization_unit?.type || null,
      chapterName: inv.chapter_name || inv.chapter?.name || inv.organization_unit?.name || 'N/A',
      invitedBy: inv.invited_by,
      invitedByEmail: inv.invited_by_user?.email || 'N/A',
      status: inv.status,
      deliveryMethod: inv.delivery_method,
      createdAt: inv.created_at,
      expiresAt: inv.expires_at,
      accountStatus: inv.status === 'ACCEPTED' ? 'ACTIVE' : 'NONE',
    })),
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
  }
}
