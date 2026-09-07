import { prisma } from './prisma'
import { hashToken, generateToken } from './tokens'
import { sendInvitationEmail } from './email'
type UserRole = 'ADMIN' | 'CHAPTER_LEADER' | 'MEMBER';
type InvitationRole = 'CHAPTER_LEADER' | 'MEMBER';
type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';
import bcrypt from 'bcrypt'

export interface SendInvitationOptions {
  email: string
  role: InvitationRole
  chapterId: string
  invitedBy: string
}

export interface SendInvitationResult {
  ok: true
  invitationId: string
  chapterId: string
  status: InvitationStatus
  expiresAt: Date
  // Token is only returned here for email sending - it's sent in plain
  token: string
  emailSent: boolean
  emailError?: string
}

export interface SendInvitationError {
  ok: false
  code: string
  message: string
}

/** Common validation: check if email already has an ACTIVE or INACTIVE account */
export async function isEmailActive(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email } })
  return user !== null && user.status === 'ACTIVE'
}

/** BR-02: email must not belong to ANY existing account (Active or Inactive) */
export async function emailHasAnyAccount(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email } })
  return user !== null
}

/** Send an invitation to a member (BĐHU or Admin) */
export async function sendMemberInvitation(
  opts: SendInvitationOptions
): Promise<SendInvitationResult | SendInvitationError> {
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
      chapter_id: opts.chapterId,
      invited_by: opts.invitedBy,
      token_hash: tokenHash,
      status: 'PENDING',
      expires_at: expiresAt,
    },
  })

  // Send invitation email via Resend
  const emailResult = await sendInvitationEmail({
    to: opts.email,
    role: opts.role,
    token,
    expiresAt,
  })

  return {
    ok: true,
    invitationId: invitation.id,
    chapterId: opts.chapterId,
    status: 'PENDING',
    expiresAt,
    token, // return plain token for email
    emailSent: emailResult.success,
    emailError: emailResult.success ? undefined : emailResult.error,
  }
}

/** Send invitation for chapter leader — also creates the chapter */
export async function sendChapterLeaderInvitation(
  email: string,
  chapterName: string,
  chapterDescription: string | undefined,
  invitedBy: string
): Promise<{ ok: true; invitationId: string; chapterId: string; status: InvitationStatus; expiresAt: Date; token: string; emailSent: boolean; emailError?: string } | SendInvitationError> {
  // BR-02 (issue #10): no invitation if email already belongs to ANY account
  if (await emailHasAnyAccount(email)) {
    const u = await prisma.user.findUnique({ where: { email } })
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

  // Use transaction to create chapter + invitation
  return await prisma.$transaction(async (tx) => {
    // Create chapter
    const chapter = await tx.chapter.create({
      data: {
        name: chapterName,
        description: chapterDescription,
        status: 'ACTIVE',
      },
    })

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
        role: 'CHAPTER_LEADER',
        chapter_id: chapter.id,
        invited_by: invitedBy,
        token_hash: tokenHash,
        status: 'PENDING',
        expires_at: expiresAt,
      },
    })

    // Send chapter leader invitation email via Resend
    const emailResult = await sendInvitationEmail({
      to: email,
      role: 'CHAPTER_LEADER',
      chapterName,
      token,
      expiresAt,
    })

    return {
      ok: true as const,
      invitationId: invitation.id,
      chapterId: chapter.id,
      status: 'PENDING' as InvitationStatus,
      expiresAt,
      token,
      emailSent: emailResult.success,
      emailError: emailResult.success ? undefined : emailResult.error,
    }
  })
}

/** Resend invitation — invalidates old token if PENDING, creates new token */
export async function resendInvitation(
  invitationId: string,
  actorId: string,
  actorRole: UserRole
): Promise<{ ok: true; invitationId: string; status: InvitationStatus; expiresAt: Date; token: string; emailSent: boolean; emailError?: string } | SendInvitationError> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } })

  if (!invitation) {
    return { ok: false, code: 'InvitationNotFound', message: 'Invitation không tồn tại' }
  }

  // Authorization: Admin can resend any invitation; BĐHU only their own
  if (actorRole !== 'ADMIN' && invitation.invited_by !== actorId) {
    return { ok: false, code: 'AccessDenied', message: 'Không có quyền resend invitation này' }
  }

  // Cannot resend accepted invitation
  if (invitation.status === 'ACCEPTED') {
    return { ok: false, code: 'InvalidState', message: 'Invitation đã được chấp nhận' }
  }

  const token = generateToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

  await prisma.invitation.update({
    where: { id: invitationId },
    data: {
      token_hash: tokenHash,
      status: 'PENDING',
      expires_at: expiresAt,
      accepted_at: null,
      cancelled_at: null,
    },
  })

  // Send resend invitation email via Resend
  const emailResult = await sendInvitationEmail({
    to: invitation.email,
    role: invitation.role,
    token,
    expiresAt,
  })

  return { ok: true, invitationId, status: 'PENDING', expiresAt, token, emailSent: emailResult.success, emailError: emailResult.success ? undefined : emailResult.error }
}

/** Cancel invitation */
export async function cancelInvitation(
  invitationId: string,
  actorId: string,
  actorRole: UserRole
): Promise<{ ok: true; invitationId: string; status: InvitationStatus } | SendInvitationError> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } })

  if (!invitation) {
    return { ok: false, code: 'InvitationNotFound', message: 'Invitation không tồn tại' }
  }

  if (actorRole !== 'ADMIN' && invitation.invited_by !== actorId) {
    return { ok: false, code: 'AccessDenied', message: 'Không có quyền hủy invitation này' }
  }

  if (invitation.status !== 'PENDING') {
    return { ok: false, code: 'InvalidState', message: 'Chỉ hủy được invitation đang PENDING' }
  }

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: 'CANCELLED', cancelled_at: new Date() },
  })

  return { ok: true, invitationId, status: 'CANCELLED' }
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

  // Hash password with bcrypt
  const passwordHash = await bcrypt.hash(password, 12)

  // Use transaction: create user + link to chapter + update invitation
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: invitation.email,
        password_hash: passwordHash,
        role: invitation.role as UserRole,
        status: 'ACTIVE',
        failed_login_count: 0,
      },
    })

    // Create chapter membership
    await tx.chapterMember.create({
      data: {
        chapter_id: invitation.chapter_id,
        user_id: user.id,
      },
    })

    // Update invitation status
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', accepted_at: new Date() },
    })

    console.log(`[ACCOUNT] User created: ${user.email} (${user.role})`)

    return {
      ok: true as const,
      userId: user.id,
      email: user.email,
      role: user.role,
      status: 'ACTIVE' as const,
    }
  })
}

/** Get invitations list with pagination */
export async function getInvitations(params: {
  actorId: string
  actorRole: UserRole
  status?: InvitationStatus
  chapterId?: string
  page: number
  limit: number
}) {
  const { actorId, actorRole, status, chapterId, page, limit } = params
  const skip = (page - 1) * limit

  // Đánh dấu các lời mời PENDING đã quá hạn thành EXPIRED để bộ lọc/trạng thái hiển thị đúng
  await prisma.invitation.updateMany({
    where: { status: 'PENDING', expires_at: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })

  // Build where clause
  const where: Record<string, unknown> = {}

  // Filter by status
  if (status) where.status = status

  // BĐHU chỉ được xem lời mời trong chapter của mình (chapterId do auth context cung cấp)
  if (actorRole !== 'ADMIN' && !chapterId) {
    return { items: [], totalItems: 0, totalPages: 0 }
  }

  // If chapterId is specified (Admin querying specific chapter, or BĐHU with their chapter)
  if (chapterId) {
    where.chapter_id = chapterId
  }

  const [invitations, totalItems] = await Promise.all([
    prisma.invitation.findMany({
      where,
      include: {
        chapter: { select: { id: true, name: true } },
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
      chapterName: inv.chapter.name,
      invitedBy: inv.invited_by,
      invitedByEmail: inv.invited_by_user.email,
      status: inv.status,
      createdAt: inv.created_at,
      expiresAt: inv.expires_at,
      accountStatus: inv.status === 'ACCEPTED' ? 'ACTIVE' : 'NONE',
    })),
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
  }
}
