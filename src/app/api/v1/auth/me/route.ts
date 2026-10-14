import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listManagedOrganizationUnits } from '@/lib/authorization'

/** Returns the effective UI scope, including tenure-based manager assignments. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const [user, managedOrganizationUnits] = await Promise.all([
    prisma.user.findUnique({
      where: { id: auth.context!.userId },
      select: { id: true, email: true, role: true, status: true, chapter_members: { take: 1, include: { chapter: { select: { id: true, name: true } } } } },
    }),
    listManagedOrganizationUnits(auth.context!),
  ])
  if (!user) return NextResponse.json({ error: { code: 'NotFound' } }, { status: 404 })

  const managerChapters = managedOrganizationUnits
    .filter((unit) => unit.type === 'CHAPTER' && unit.chapterId)
    .map((unit) => ({ id: unit.chapterId!, name: unit.name, canManageMembers: unit.canManageMembers }))
  const legacyChapter = user.chapter_members[0]?.chapter
  const primaryChapter = legacyChapter || managerChapters[0] || null

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      chapterId: primaryChapter?.id || null,
      chapterName: primaryChapter?.name || null,
      isChapterManager: managerChapters.length > 0,
      managedChapters: managerChapters,
      isOrganizationManager: managedOrganizationUnits.length > 0,
      managedOrganizationUnits,
    },
  })
}
