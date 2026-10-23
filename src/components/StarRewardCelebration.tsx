'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { soundEffects } from '@/lib/audio-effects'

interface StarRewardCelebrationProps {
  amount: number
  message: string
  onClose?: () => void
}

const particles = [
  { x: '-80px', y: '-60px', delay: '0ms', symbol: '⭐' },
  { x: '-40px', y: '-90px', delay: '50ms', symbol: '✨' },
  { x: '10px', y: '-95px', delay: '120ms', symbol: '✦' },
  { x: '60px', y: '-70px', delay: '30ms', symbol: '★' },
  { x: '90px', y: '-30px', delay: '90ms', symbol: '⭐' },
  { x: '-90px', y: '-10px', delay: '110ms', symbol: '✦' },
  { x: '95px', y: '20px', delay: '70ms', symbol: '✨' },
  { x: '-80px', y: '40px', delay: '140ms', symbol: '★' },
  { x: '-45px', y: '75px', delay: '60ms', symbol: '⭐' },
  { x: '25px', y: '80px', delay: '100ms', symbol: '✦' },
  { x: '75px', y: '55px', delay: '40ms', symbol: '✨' },
  { x: '-20px', y: '-50px', delay: '20ms', symbol: '★' },
]

export default function StarRewardCelebration({ amount, message, onClose }: StarRewardCelebrationProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    // Play celebratory chime sound via Web Audio API
    soundEffects.playStarChime()

    // Auto fadeout after 3.5 seconds
    const timer = setTimeout(() => {
      setVisible(false)
      onClose?.()
    }, 3500)

    return () => clearTimeout(timer)
  }, [onClose])

  if (!visible) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-14 z-[100] flex justify-center px-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="star-reward-card relative overflow-hidden rounded-[2rem] border-2 border-amber-300 bg-white/95 px-8 py-6 text-center shadow-2xl shadow-amber-500/30 backdrop-blur-md sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(251,191,36,0.24),transparent_62%)]" aria-hidden="true" />
        <div className="star-reward-ring pointer-events-none absolute left-1/2 top-10 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300/70" aria-hidden="true" />
        <div className="relative mx-auto grid h-20 w-28 place-items-center" aria-hidden="true">
          <span className="star-reward-main text-7xl drop-shadow-[0_6px_14px_rgba(245,158,11,0.45)]">⭐</span>
          {particles.map((particle, index) => (
            <span
              key={index}
              className="star-reward-particle absolute left-1/2 top-1/2 text-base font-bold text-amber-500"
              style={{
                '--star-x': particle.x,
                '--star-y': particle.y,
                '--star-delay': particle.delay,
              } as CSSProperties}
            >
              {particle.symbol}
            </span>
          ))}
        </div>
        <p className="relative mt-1 text-3xl font-black tracking-tight text-amber-600 sm:text-4xl" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
          +{amount} <span aria-hidden="true">⭐</span>
        </p>
        <p className="relative mt-1.5 max-w-xs text-xs font-semibold leading-relaxed text-slate-700">{message}</p>
        <p className="relative mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700/80">BBE Learning · Thành tích mới</p>
      </div>
    </div>
  )
}
