/**
 * Recomputes the MEMBER/LT snapshots of closed competition months.
 *
 * Before the fix, `individualPeriodRows` counted stars from the start of each
 * Chapter's competition term even for a MONTH board, so a month snapshot saved
 * for the global view carried over stars from earlier months of the term.
 *
 * Default is a dry run that only prints the rows that would change. Writing
 * replaces `items` of the existing snapshot payload and nothing else:
 *   npx ts-node -P scripts/tsconfig.json --transpile-only scripts/db/repair-monthly-individual-snapshots.ts
 *   npx ts-node -P scripts/tsconfig.json --transpile-only scripts/db/repair-monthly-individual-snapshots.ts --apply
 * Optional: --month=2026-10 limits the run to one month key;
 * --backup=<file.json> saves the replaced payloads before writing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { individualPeriodRows } from '../../src/lib/competition-snapshots'
import 'dotenv/config'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const onlyMonth = process.argv.find((arg) => arg.startsWith('--month='))?.slice('--month='.length)
const BACKUP_PATH = process.argv.find((arg) => arg.startsWith('--backup='))?.slice('--backup='.length)

async function main() {
  const months = await prisma.competitionMonth.findMany({
    where: { state: 'CLOSED', ...(onlyMonth ? { key: onlyMonth } : {}) },
    orderBy: { starts_at: 'asc' },
  })
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${months.length} closed month(s)`)
  let changedSnapshots = 0

  for (const month of months) {
    for (const group of ['MEMBER', 'LT'] as const) {
      const key = `ranking:${group}:${month.id}`
      const snapshot = await prisma.learningSnapshot.findUnique({ where: { key } })
      if (!snapshot) { console.log(`${month.key} ${group}: no snapshot, skipped`); continue }

      const payload = snapshot.payload as any
      const oldStars = new Map<string, number>((payload.items || []).map((row: any) => [row.userId, row.stars ?? 0]))
      const items = await individualPeriodRows(prisma, month.starts_at, month.ends_at, group)
      const diffs = items.filter((row) => (oldStars.get(row.userId) ?? 0) !== row.stars)
      console.log(`${month.key} ${group}: ${diffs.length}/${items.length} row(s) differ`)
      for (const row of diffs.slice(0, 20)) console.log(`  ${row.userId}: ${oldStars.get(row.userId) ?? 0} -> ${row.stars}`)
      if (!diffs.length) continue

      changedSnapshots++
      if (!APPLY) continue
      // Keep the old payload so the repair can be rolled back by hand.
      if (BACKUP_PATH) {
        mkdirSync(dirname(BACKUP_PATH), { recursive: true })
        const saved = existsSync(BACKUP_PATH) ? JSON.parse(readFileSync(BACKUP_PATH, 'utf8')) : {}
        saved[key] = { id: snapshot.id, payload }
        writeFileSync(BACKUP_PATH, JSON.stringify(saved))
      }
      await prisma.learningSnapshot.update({
        where: { id: snapshot.id },
        data: { payload: JSON.parse(JSON.stringify({ ...payload, items, repair: { at: new Date().toISOString(), reason: 'MONTH_BOARD_USED_TERM_START' } })) },
      })
    }
  }
  console.log(`${APPLY ? 'Updated' : 'Would update'} ${changedSnapshots} snapshot(s).`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
