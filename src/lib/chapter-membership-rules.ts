export interface ChapterMemberRecord {
  userId: string
  email: string
  status: string
  role: string
  createdAt: Date
  joinedAt: Date
  displayName?: string | null
  department?: { id: string; name: string } | null
  deactivatedByUserId?: string | null
  deactivatedByRole?: string | null
  cascadeLeadId?: string | null
}

/** Merge legacy and organization memberships without double-counting a learner. */
export function mergeChapterMemberRecords(...groups: ReadonlyArray<ReadonlyArray<ChapterMemberRecord>>): ChapterMemberRecord[] {
  const byUserId = new Map<string, ChapterMemberRecord>()
  for (const group of groups) {
    for (const record of group) {
      const existing = byUserId.get(record.userId)
      if (!existing) {
        byUserId.set(record.userId, record)
        continue
      }
      if (record.joinedAt.getTime() < existing.joinedAt.getTime()) {
        byUserId.set(record.userId, {
          ...existing,
          ...record,
          joinedAt: record.joinedAt,
          department: record.department || existing.department,
          deactivatedByUserId: record.deactivatedByUserId || existing.deactivatedByUserId,
          deactivatedByRole: record.deactivatedByRole || existing.deactivatedByRole,
          cascadeLeadId: record.cascadeLeadId || existing.cascadeLeadId,
        })
      } else {
        byUserId.set(record.userId, {
          ...existing,
          displayName: record.displayName || existing.displayName,
          department: record.department || existing.department,
          deactivatedByUserId: record.deactivatedByUserId || existing.deactivatedByUserId,
          deactivatedByRole: record.deactivatedByRole || existing.deactivatedByRole,
          cascadeLeadId: record.cascadeLeadId || existing.cascadeLeadId,
        })
      }
    }
  }
  return Array.from(byUserId.values()).sort((a, b) =>
    b.joinedAt.getTime() - a.joinedAt.getTime() || a.email.localeCompare(b.email),
  )
}
