import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessChapterPermission, listManagedOrganizationUnits } from '@/lib/authorization'

/** Returns the effective UI scope, including tenure-based manager assignments. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const [user, chapters] = await Promise.all([
    prisma.user.findUnique({
      where: { id: auth.context!.userId },
      select: { id: true, email: true, role: true, status: true, chapter_members: { take: 1, include: { chapter: { select: { id: true, name: true } } } } },
    }),
    prisma.chapter.findMany({ select: { id: true, name: true } }),
  ])
  if (!user) return NextResponse.json({ error: { code: 'NotFound' } }, { status: 404 })

  const managerChapters = (await Promise.all(chapters.map(async (chapter) => {
    const canView = await canAccessChapterPermission(auth.context!, chapter.id, 'VIEW_MEMBER_PROGRESS')
    if (!canView) return null
    const canManageMembers = await canAccessChapterPermission(auth.context!, chapter.id, 'MANAGE_CHAPTER_MEMBERS')
    return { ...chapter, canManageMembers }
  }))).filter(Boolean) as Array<{ id: string; name: string; canManageMembers: boolean }>
  const managedOrganizationUnits = await listManagedOrganizationUnits(auth.context!)
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
