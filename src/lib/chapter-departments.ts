import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { EXACT_7_BANS } from './departments'

export const DEPARTMENT_CODE_MAP: Record<string, string> = {
  'Ban Thành Viên': 'BTV',
  'Ban Thư Ký': 'BTK',
  'Ban Nội Dung': 'BND',
  'Ban Chất Lượng': 'BCL',
  'Ban Định Hướng': 'BDH',
  'Ban Khách Mời': 'BKM',
  'Ban TT&SK': 'BTTSK',
}

/**
 * Ensures that all 7 standard departments exist under the chapter's organization unit.
 * If any are missing, they are created with standard names, status: 'ACTIVE', and standard codes.
 */
export async function ensureChapterStandardDepartments(
  chapterOrgUnitId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  const existing = await db.organizationUnit.findMany({
    where: { parent_id: chapterOrgUnitId, type: 'DEPARTMENT' },
    select: { id: true, name: true, code: true },
  })

  const existingMap = new Map<string, typeof existing[0]>()
  for (const dept of existing) {
    existingMap.set(dept.name.trim().toLowerCase(), dept)
  }

  const result: { id: string; name: string; code: string | null }[] = []

  for (const banName of EXACT_7_BANS) {
    const key = banName.trim().toLowerCase()
    const found = existingMap.get(key)
    const code = DEPARTMENT_CODE_MAP[banName] || null

    if (found) {
      if (!found.code && code) {
        await db.organizationUnit.update({
          where: { id: found.id },
          data: { code },
        })
      }
      result.push({ id: found.id, name: found.name, code: found.code || code })
    } else {
      const created = await db.organizationUnit.create({
        data: {
          name: banName,
          code,
          type: 'DEPARTMENT',
          parent_id: chapterOrgUnitId,
          status: 'ACTIVE',
        },
      })
      result.push({ id: created.id, name: created.name, code: created.code })
    }
  }

  return result
}
