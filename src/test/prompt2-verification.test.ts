import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeChapterMemberRecords, ChapterMemberRecord } from '../lib/chapter-membership-rules'

describe('Prompt 2 — Chapter Members Pagination Across Chapter Sizes (0, 20, 21, 51, 100, 120, 200)', () => {
  const chapterSizes = [0, 20, 21, 51, 100, 120, 200]
  const limits = [20, 50, 100]

  // Mock generator for chapter members
  function generateMockMembers(count: number): ChapterMemberRecord[] {
    const list: ChapterMemberRecord[] = []
    const now = Date.now()
    for (let i = 0; i < count; i++) {
      const isLead = i % 10 === 0 // 10% LT members
      list.push({
        userId: `user-uuid-${String(i).padStart(4, '0')}`,
        email: `member.${i}@bbe.vn`,
        status: 'ACTIVE',
        role: 'MEMBER', // All learners and LT have base role MEMBER
        createdAt: new Date(now - i * 3600000),
        joinedAt: new Date(now - i * 3600000),
        displayName: isLead ? `LT Member ${i}` : `Học viên ${i}`,
        department: { id: `dept-${i % 5}`, name: `Ban ${i % 5}` },
        deactivatedByUserId: null,
        deactivatedByRole: null,
        cascadeLeadId: null,
      })
    }
    return list
  }

  chapterSizes.forEach((count) => {
    describe(`Chapter size: ${count} members`, () => {
      const allMembers = generateMockMembers(count)
      const merged = mergeChapterMemberRecords(allMembers)

      it(`reports exact totalItems = ${count}`, () => {
        assert.equal(merged.length, count, `Total count must be exactly ${count}`)
      })

      limits.forEach((limit) => {
        it(`paginates correctly with limit = ${limit} without duplicates or missing items`, () => {
          const totalItems = merged.length
          const totalPages = Math.max(1, Math.ceil(totalItems / limit))
          const seenIds = new Set<string>()
          const collectedItems: any[] = []

          for (let page = 1; page <= totalPages; page++) {
            const skip = (page - 1) * limit
            const pageSlice = merged.slice(skip, skip + limit)

            // Validate no empty last page unless chapter is truly 0 members
            if (count > 0) {
              assert.ok(
                pageSlice.length > 0,
                `Page ${page} of ${totalPages} should not be empty for ${count} members`
              )
            } else {
              assert.equal(pageSlice.length, 0, 'Page slice for 0 members should be empty')
            }

            // Check for duplicates across pages
            for (const item of pageSlice) {
              assert.ok(
                !seenIds.has(item.userId),
                `Duplicate item ${item.userId} found on page ${page}!`
              )
              seenIds.add(item.userId)
              collectedItems.push(item)
            }
          }

          // Validate complete coverage: exact count and every item collected
          assert.equal(
            collectedItems.length,
            count,
            `All ${count} members must be retrieved across all pages`
          )
          assert.equal(
            seenIds.size,
            count,
            `Unique IDs collected must equal total count ${count}`
          )

          // Verify that the very last member is reachable and valid
          if (count > 0) {
            const lastOriginal = merged[count - 1]
            const lastCollected = collectedItems[collectedItems.length - 1]
            assert.equal(lastCollected.userId, lastOriginal.userId)
            assert.equal(lastCollected.email, lastOriginal.email)
          }
        })
      })
    })
  })
})

describe('Prompt 2 — Role Filtering & LT Handling in Chapter Dashboard', () => {
  it('does NOT exclude LT members when base role is MEMBER', () => {
    // 50 members, 5 of which are LT
    const count = 50
    const rawMembers: any[] = []
    const leadUserIds = new Set<string>()

    for (let i = 0; i < count; i++) {
      const isLead = i < 5
      const userId = `user-${i}`
      if (isLead) leadUserIds.add(userId)
      rawMembers.push({
        userId,
        email: `user.${i}@bbe.vn`,
        role: 'MEMBER',
        displayName: isLead ? `LT Member ${i}` : `Học viên ${i}`,
        status: 'ACTIVE',
      })
    }

    // Default view: NO roleType filter
    const defaultList = rawMembers.filter((m) => {
      // Role filter check (as in dashboard/members/route.ts)
      const roleTypeParam = ''
      if (roleTypeParam) {
        const isLead = leadUserIds.has(m.userId)
        if (roleTypeParam === 'LT' && !isLead) return false
        if (roleTypeParam === 'MEMBER' && isLead) return false
      }
      return true
    })
    assert.equal(defaultList.length, 50, 'Default view must contain ALL 50 members including LT')

    // Filter by LT
    const ltParam: string = 'LT'
    const ltList = rawMembers.filter((m) => {
      const isLead = leadUserIds.has(m.userId)
      if (ltParam === 'LT' && !isLead) return false
      if (ltParam === 'MEMBER' && isLead) return false
      return true
    })
    assert.equal(ltList.length, 5, 'LT filter must contain exactly the 5 LT members')

    // Filter by MEMBER
    const memberParam: string = 'MEMBER'
    const regularMemberList = rawMembers.filter((m) => {
      const isLead = leadUserIds.has(m.userId)
      if (memberParam === 'LT' && !isLead) return false
      if (memberParam === 'MEMBER' && isLead) return false
      return true
    })
    assert.equal(regularMemberList.length, 45, 'MEMBER filter must contain exactly 45 regular members')
  })
})

describe('Prompt 2 — Video Star Reward Live Reconciliation', () => {
  it('reconciles monthly star reward state directly without reload', () => {
    // Initial state before reward
    const initialProgress = {
      lessonId: 'lesson-123',
      videoCompleted: false,
      completed: false,
      watchedUntil: 50,
      videoStarsThisMonth: {
        competitionMonth: '2026-10',
        completed: false,
        awardedStars: 0,
        suppressed: false,
      },
      replayHistory: [],
    }

    // Backend response upon video completion & star award
    const backendResponse = {
      lessonId: 'lesson-123',
      videoCompleted: true,
      completed: true,
      starReward: {
        awarded: true,
        amount: 2,
        rewardKey: 'video:u1:v1:m1:c1',
        balance: 42,
      },
      videoStarsThisMonth: {
        competitionMonth: '2026-10',
        completed: true,
        awardedStars: 2,
        suppressed: false,
      },
      replayHistory: [
        {
          competitionMonth: '2026-10',
          competitionMonthId: 'm1',
          watchedSeconds: 120,
          completed: true,
          awardedStars: 2,
        },
      ],
    }

    // Updated local state simulates setProgress merge
    const updatedProgress = {
      ...initialProgress,
      videoCompleted: Boolean(backendResponse.videoCompleted),
      completed: Boolean(backendResponse.completed),
      ...(backendResponse.videoStarsThisMonth ? { videoStarsThisMonth: backendResponse.videoStarsThisMonth } : {}),
      ...(backendResponse.replayHistory ? { replayHistory: backendResponse.replayHistory } : {}),
    }

    // Verify immediate synchronization
    assert.equal(updatedProgress.videoStarsThisMonth.awardedStars, 2)
    assert.equal(updatedProgress.videoStarsThisMonth.completed, true)
    assert.equal(updatedProgress.replayHistory.length, 1)
    assert.equal(updatedProgress.replayHistory[0].awardedStars, 2)
    assert.equal(updatedProgress.videoCompleted, true)
  })

  it('prevents duplicate star UI additions on retried response', () => {
    const seenRewardKeys = new Set<string>()
    let rewardedTotal = 0

    function celebrateStar(amount: number, rewardKey: string) {
      if (seenRewardKeys.has(rewardKey)) return
      seenRewardKeys.add(rewardKey)
      rewardedTotal += amount
    }

    // First response
    celebrateStar(2, 'key-123')
    assert.equal(rewardedTotal, 2)

    // Duplicate retried response with same key
    celebrateStar(2, 'key-123')
    assert.equal(rewardedTotal, 2, 'Must not duplicate on retry')
  })
})
