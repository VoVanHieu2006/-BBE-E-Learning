'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { soundEffects } from '@/lib/audio-effects'

interface StarRewardCelebrationProps {
  amount: number
  message: string
  /** Latest confirmed layout balance so "+N" is anchored to the real ledger total. */
  balance?: number | null
  onClose?: () => void
  /** Fires once; wraps the auto-dismiss timer so a parent re-render never restarts it. */
  disableAutoDismiss?: boolean
}

interface Particle {
  x: number
  y: number
  delay: number
  size: number
  symbol: string
}

const PARTICLE_SYMBOLS = ['⭐', '✨', '★', '✦', '💫', '🎉']
const PARTICLE_COUNT = 24

function buildParticles(): Particle[] {
  // Golden confetti: denser ring around the star, light and non-blocking.
  return Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const angle = (Math.PI * 2 * (index + 0.35)) / PARTICLE_COUNT
    const radius = 70 + ((index * 37) % 55)
    return {
      x: Math.round(Math.cos(angle) * radius),
      y: Math.round(Math.sin(angle) * radius * 0.72),
      delay: (index * 45) % 320,
      size: 12 + ((index * 13) % 10),
      symbol: PARTICLE_SYMBOLS[index % PARTICLE_SYMBOLS.length],
    }
  })
}

/** Centered full-viewport reward overlay. Shown once per awarded reward key. */
export default function StarRewardCelebration({
  amount,
  message,
  balance,
  onClose,
  disableAutoDismiss = false,
}: StarRewardCelebrationProps) {
  const [visible, setVisible] = useState(true)
  const particles = useMemo(buildParticles, [])

  useEffect(() => {
    // Celebratory chime through Web Audio; browsers may suspend until the user
    // has interacted — playStarChime already fails closed in that case.
    soundEffects.playStarChime()

    if (disableAutoDismiss) return
    const timer = setTimeout(() => {
      setVisible(false)
      onClose?.()
    }, 3500)

    return () => clearTimeout(timer)
  }, [onClose, disableAutoDismiss])

  if (!visible) return null

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9998] grid place-items-center px-4"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="star-reward-card relative overflow-hidden rounded-[2rem] border-2 border-amber-300 bg-white/95 px-8 py-6 text-center shadow-2xl shadow-amber-500/30 backdrop-blur-md sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(251,191,36,0.24),transparent_62%)]" aria-hidden="true" />
        <div className="star-reward-ring pointer-events-none absolute left-1/2 top-10 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300/70" aria-hidden="true" />
        <div className="relative mx-auto grid h-24 w-32 place-items-center" aria-hidden="true">
          <span className="star-reward-main text-7xl drop-shadow-[0_6px_14px_rgba(245,158,11,0.45)]">⭐</span>
          {particles.map((particle, index) => (
            <span
              key={index}
              className="star-reward-particle absolute left-1/2 top-1/2 font-bold text-amber-500"
              style={{
                fontSize: `${particle.size}px`,
                '--star-x': `${particle.x}px`,
                '--star-y': `${particle.y}px`,
                '--star-delay': `${particle.delay}ms`,
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
        {typeof balance === 'number' && (
          <p className="relative mt-2 text-[11px] font-bold text-slate-500">
            Tổng: <span className="text-amber-600">{balance.toLocaleString('vi-VN')} ⭐</span>
          </p>
        )}
        <p className="relative mt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700/80">BBE Learning · Thành tích mới</p>
      </div>
    </div>
  )
}
