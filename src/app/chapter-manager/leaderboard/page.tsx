'use client'

import UnifiedLeaderboard from '@/components/learning/UnifiedLeaderboard'

export default function ChapterManagerLeaderboardPage() {
  return (
    <div className="w-full max-w-6xl mx-auto pb-12">
      <UnifiedLeaderboard initialGroup="MEMBER" initialPeriodType="MONTH" showChapterSelector={true} />
    </div>
  )
}
