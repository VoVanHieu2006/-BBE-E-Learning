'use client'
import { useState } from 'react'
import YouTubePlayer from '@/components/YouTubePlayer'
import Card from '@/components/ui/Card'

export default function PlayerPage({ params }: { params: { lessonId: string } }) {
  const [completionMsg, setCompletionMsg] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [youtubeVideoId, setYoutubeVideoId] = useState('dQw4w9WgXcQ')
  // Simulates saved progress that arrives after the player was created.
  const [savedPosition, setSavedPosition] = useState(0)

  return (
    <main className="min-h-screen bg-[#f8f9ff] p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-[#172554] mb-2" style={{ fontFamily: "'Be Vietnam Pro', 'Inter', sans-serif" }}>
          BBE E-Learning — Video Player
        </h1>
        <p className="text-[#6c6f7f] mb-6">Source of truth cho completed vẫn là server (BR-03).</p>

        <div className="bg-white rounded-2xl p-4 border border-[#eff4ff] shadow-md mb-6">
          <label htmlFor="lesson-access-token" className="block text-sm font-semibold text-[#172554] mb-1">Access Token (from /api/v1/auth/login)</label>
          <input id="lesson-access-token"
            type="text"
            placeholder="Bearer token..."
            className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            onChange={(e) => setAccessToken(e.target.value)}
          />
          <label htmlFor="lesson-youtube-video-id" className="block text-sm font-semibold text-[#172554] mb-1 mt-3">YouTube Video ID</label>
          <input id="lesson-youtube-video-id"
            type="text"
            value={youtubeVideoId}
            className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            onChange={(e) => setYoutubeVideoId(e.target.value)}
          />
          <label htmlFor="lesson-saved-position" className="block text-sm font-semibold text-[#172554] mb-1 mt-3">Saved position (seconds)</label>
          <input id="lesson-saved-position"
            type="number"
            min={0}
            data-resume-position
            className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            onChange={(e) => setSavedPosition(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>

        <Card className="p-0 overflow-hidden mb-6">
          <YouTubePlayer
            youtubeVideoId={youtubeVideoId}
            lessonId={params.lessonId}
            accessToken={accessToken || undefined}
            initialPosition={savedPosition}
            initialFurthest={savedPosition}
            durationSeconds={596}
            onComplete={() => setCompletionMsg('🎉 Hoàn thành bài học (100%)')}
          />
        </Card>

        {completionMsg && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl mb-4 font-medium">
            {completionMsg}
          </div>
        )}

        <Card className="bg-gradient-to-r from-[#eff4ff] to-[#cbdbf5] border-[#dce9ff]">
          <h2 className="font-bold text-[#172554] mb-3">Tính năng đã implement</h2>
          <ul className="list-disc ml-5 text-sm space-y-1 text-[#434655]">
            <li>Heartbeat mỗi 12s gửi positionSeconds + furthestWatchedPositionSeconds</li>
            <li>Server-side seek-ahead check (BR-03) — client bị reject nếu tua tới</li>
            <li>Client seek-lock: nếu currentTime vượt furthest + 5s buffer → tự seekTo() về furthest</li>
            <li>Auto-complete khi xem hết 100% (BR-03)</li>
            <li>Playback rate 1.5x / 2x</li>
            <li>UI controls ẩn thanh tua mặc định, custom control bar</li>
          </ul>
          <p className="text-xs mt-3 italic text-[#6c6f7f]">
            Note: YouTube controls mặc định đã ẩn (controls=0).
          </p>
        </Card>
      </div>
    </main>
  )
}
