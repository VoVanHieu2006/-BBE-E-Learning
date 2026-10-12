import { prisma } from './prisma'
import { hashToken, generateToken } from './tokens'
import { sendInvitationEmail } from './email'
import { reconcileLearningAssignmentsForUser } from './learning-assignments'
type UserRole = 'ADMIN' | 'CHAPTER_LEADER' | 'MEMBER';
type InvitationRole = 'CHAPTER_LEADER' | 'MEMBER';
type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';
import bcrypt from 'bcryptjs'

export interface SendInvitationOptions {
  email: string
  role: InvitationRole
  chapterId?: string
  organizationUnitId?: string
  invitedBy: string
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
  if (Boolean(opts.chapterId) === Boolean(opts.organizationUnitId)) {
    return { ok: false, code: 'ValidationError', message: 'Choose exactly one Chapter or Organization Unit scope.' }
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
    organizationUnitId: opts.organizationUnitId,
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

  // Use transaction to create chapter + invitation in DB first
  const created = await prisma.$transaction(async (tx) => {
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

    return {
      invitationId: invitation.id,
      chapterId: chapter.id,
      expiresAt,
      token,
    }
  })

  // Send chapter leader invitation email via Resend OUTSIDE transaction
  const emailResult = await sendInvitationEmail({
    to: email,
    role: 'CHAPTER_LEADER',
    chapterName,
    token: created.token,
    expiresAt: created.expiresAt,
  })

  return {
    ok: true as const,
    invitationId: created.invitationId,
    chapterId: created.chapterId,
    status: 'PENDING' as InvitationStatus,
    expiresAt: created.expiresAt,
    token: created.token,
    emailSent: emailResult.success,
    emailError: emailResult.success ? undefined : emailResult.error,
  }
}

/** Resend invitation — invalidates old token if PENDING, creates new token */
export async function resendInvitation(
  invitationId: string,
  actorId: string,
  actorRole: UserRole,
  hasScopedManagePermission = false,
): Promise<{ ok: true; invitationId: string; status: InvitationStatus; expiresAt: Date; token: string; emailSent: boolean; emailError?: string } | SendInvitationError> {
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

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: 'CANCELLED', cancelled_at: new Date() },
  })

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
    chapterName: invitation.chapter?.name || invitation.organization_unit?.name || 'BBE',
    organizationUnitId: invitation.organization_unit_id || undefined,
    expiresAt: invitation.expires_at,
  }
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
  const accepted = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: invitation.email,
        password_hash: passwordHash,
        role: invitation.role as UserRole,
        status: 'ACTIVE',
        failed_login_count: 0,
      },
    })

    let chapterId = invitation.chapter_id
    let organizationUnitId = invitation.organization_unit_id
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

    if (invitation.role === 'CHAPTER_LEADER') {
      const position = await tx.position.upsert({
        where: { code: 'CHAPTER_MANAGER' },
        update: {},
        create: { code: 'CHAPTER_MANAGER', name: 'Chapter Manager', scope: 'CHAPTER', is_manager: true },
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
      const managePermission = await tx.permission.upsert({
        where: { code: 'MANAGE_CHAPTER_MEMBERS' }, update: {},
        create: { code: 'MANAGE_CHAPTER_MEMBERS', description: 'Manage members within a scoped Chapter.' },
      })
      await tx.positionPermission.upsert({
        where: { position_id_permission_id: { position_id: position.id, permission_id: managePermission.id } },
        update: {}, create: { position_id: position.id, permission_id: managePermission.id },
      })
    }

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
  if (accepted.ok) {
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

  // Filter by status
  if (status) where.status = status

  // BĐHU chỉ được xem lời mời trong chapter của mình (chapterId do auth context cung cấp)
  if (actorRole !== 'ADMIN' && !chapterId && !organizationUnitId) {
    return { items: [], totalItems: 0, totalPages: 0 }
  }

  // If chapterId is specified (Admin querying specific chapter, or BĐHU with their chapter)
  if (chapterId) {
    where.chapter_id = chapterId
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
      chapterName: inv.chapter?.name || inv.organization_unit?.name || 'N/A',
      invitedBy: inv.invited_by,
      invitedByEmail: inv.invited_by_user?.email || 'N/A',
      status: inv.status,
      createdAt: inv.created_at,
      expiresAt: inv.expires_at,
      accountStatus: inv.status === 'ACCEPTED' ? 'ACTIVE' : 'NONE',
    })),
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
  }
}
