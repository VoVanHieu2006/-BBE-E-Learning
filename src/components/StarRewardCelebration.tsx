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
      className="pointer-events-none fixed inset-x-0 top-14 z-[100] flex justify-center px-4 animate-in fade-in duration-300"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="star-reward-card relative rounded-3xl border-2 border-amber-300 bg-white/95 px-9 py-6 text-center shadow-2xl shadow-amber-500/25 backdrop-blur-md">
        <div className="relative mx-auto grid h-16 w-24 place-items-center" aria-hidden="true">
          <span className="star-reward-main text-6xl drop-shadow-md">⭐</span>
          {particles.map((particle, index) => (
            <span
              key={index}
              className="star-reward-particle absolute left-1/2 top-1/2 text-base text-amber-500 font-bold"
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
        <p className="mt-2 text-2xl font-extrabold text-amber-600 tracking-tight" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
          +{amount} Star!
        </p>
        <p className="mt-1 text-xs font-semibold text-slate-700 max-w-xs">{message}</p>
      </div>
    </div>
  )
}
