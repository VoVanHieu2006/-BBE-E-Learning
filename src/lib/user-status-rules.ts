export interface UserStatusActor {
  userId: string
  role: string
  chapterId?: string | null
}

export interface UserStatusTarget {
  id: string
  role: string
  status: string
  restrictions?: any[]
  deactivated_by_role?: string | null
  deactivated_by_user_id?: string | null
  anonymized_at?: Date | null
}

export type UserStatusAction = 'ACTIVE' | 'INACTIVE'

export interface CanChangeUserStatusResult {
  allowed: boolean
  code?: 'ValidationError' | 'AccessDenied' | 'AdminUnlockRequired' | 'AccountRetired' | 'InvalidTransition'
  message?: string
}

/**
 * BR-USER-STATUS: Centralized status change guard.
 * - Admin: Allowed to change status (except deactivating another Admin).
 * - Non-Admin (Chapter Leader, Unit Lead):
 *   - Cannot change status of Admin, Chapter Leader, or themselves.
 *   - Cannot activate accounts (INACTIVE -> ACTIVE or LOCKED -> ACTIVE). ONLY Admin can reactivate.
 *   - Can deactivate (ACTIVE -> INACTIVE) members under their scope.
 */
export function assertCanChangeUserStatus(
  actor: UserStatusActor,
  target: UserStatusTarget,
  newStatus: UserStatusAction
): CanChangeUserStatusResult {
  if (target.anonymized_at) {
    return { allowed: false, code: 'AccountRetired', message: 'Tài khoản đã ẩn danh, không thể thay đổi trạng thái.' }
  }

  const isAdmin = actor.role === 'ADMIN'

  // Admin cannot deactivate another Admin
  if (isAdmin && target.role === 'ADMIN' && newStatus === 'INACTIVE') {
    return { allowed: false, code: 'InvalidTransition', message: 'Không thể vô hiệu hóa Admin khác qua API.' }
  }

  if (isAdmin) {
    return { allowed: true }
  }

  // Non-Admin checks:
  if (target.role === 'ADMIN' || target.role === 'CHAPTER_LEADER' || target.id === actor.userId) {
    return {
      allowed: false,
      code: 'AccessDenied',
      message: 'Không có quyền thay đổi trạng thái tài khoản Admin hoặc Lead Chapter.',
    }
  }

  // Non-Admin attempting to ACTIVATE (status: ACTIVE)
  if (newStatus === 'ACTIVE') {
    if (target.status === 'LOCKED') {
      return {
        allowed: false,
        code: 'AdminUnlockRequired',
        message: 'Tài khoản đang bị khóa bởi hệ thống; chỉ Quản trị viên (Admin) mới có quyền mở khóa.',
      }
    }
    return {
      allowed: false,
      code: 'AccessDenied',
      message: 'Chỉ Admin mới có quyền kích hoạt lại tài khoản đã bị vô hiệu hóa.',
    }
  }

  // Deactivation is allowed for members
  if (newStatus === 'INACTIVE') {
    return { allowed: true }
  }

  return { allowed: false, code: 'ValidationError', message: 'Trạng thái không hợp lệ.' }
}
