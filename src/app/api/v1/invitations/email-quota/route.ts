import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { isLeadRole } from '@/lib/roles'
import { listManagedOrganizationUnits } from '@/lib/authorization'
import { getEmailQuota } from '@/lib/email-quota'

/**
 * GET /api/v1/invitations/email-quota
 * Hạn mức email còn lại trong ngày UTC (mặc định 90/ngày). Chỉ cho người có quyền mời:
 * ADMIN, LEAD (Chapter/DNA) hoặc người quản lý thành viên của một ban/nhóm.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const context = auth.context!

  let allowed = context.role === 'ADMIN' || isLeadRole(context.role)
  if (!allowed && context.role === 'MEMBER') {
    const units = await listManagedOrganizationUnits(context)
    allowed = units.some((unit) => unit.canManageMembers)
  }
  if (!allowed) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  const quota = await getEmailQuota()
  return NextResponse.json(
    { limit: quota.limit, used: quota.used, remaining: quota.remaining, resetsAt: quota.resetsAt.toISOString() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
