import { invalidateAdminOverviewCache, invalidateChaptersServerCache, invalidateOrganizationServerCache, invalidateScopesCache, invalidateServerUsersCache } from './server-cache'
import { invalidateChapterLeaderboardCache } from './chapter-leaderboard-cache'
import { invalidateMemberLeaderboardCache } from './member-leaderboard-cache'

/** Run after commit, never from a transaction that may still roll back. */
export function invalidateOrganizationViews() {
  invalidateServerUsersCache()
  invalidateAdminOverviewCache()
  invalidateChaptersServerCache()
  invalidateOrganizationServerCache()
  invalidateScopesCache()
  invalidateChapterLeaderboardCache()
  invalidateMemberLeaderboardCache()
}
