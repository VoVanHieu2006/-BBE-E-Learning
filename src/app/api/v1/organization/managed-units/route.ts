import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { listManagedOrganizationUnits } from '@/lib/authorization'

/** Effective DNA/Chapter/Department scopes; permissions come from active tenures. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const items = await listManagedOrganizationUnits(auth.context!)
  return NextResponse.json({ items })
}
