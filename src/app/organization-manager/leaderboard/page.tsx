'use client'

import UnifiedLeaderboard from '@/components/learning/UnifiedLeaderboard'

export default function DnaLeaderboardPage() {
  return (
    <div className="w-full max-w-6xl mx-auto pb-12">
      <UnifiedLeaderboard initialGroup="DNA" initialPeriodType="MONTH" showChapterSelector={false} />
    </div>
  )
}
