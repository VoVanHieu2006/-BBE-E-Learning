'use client'

import type { CSSProperties } from 'react'

interface StarRewardCelebrationProps {
  amount: number
  message: string
}

const particles = [
  { x: '-64px', y: '-54px', delay: '0ms' },
  { x: '-28px', y: '-76px', delay: '70ms' },
  { x: '20px', y: '-74px', delay: '130ms' },
  { x: '60px', y: '-48px', delay: '35ms' },
  { x: '-70px', y: '2px', delay: '110ms' },
  { x: '70px', y: '8px', delay: '90ms' },
  { x: '-38px', y: '42px', delay: '150ms' },
  { x: '42px', y: '44px', delay: '55ms' },
]

export default function StarRewardCelebration({ amount, message }: StarRewardCelebrationProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[100] flex justify-center px-4" role="status" aria-live="polite" aria-atomic="true">
      <div className="star-reward-card relative rounded-3xl border border-amber-200 bg-white/95 px-8 py-5 text-center shadow-2xl shadow-amber-950/15 backdrop-blur">
        <div className="relative mx-auto grid h-14 w-20 place-items-center" aria-hidden="true">
          <span className="star-reward-main text-5xl">⭐</span>
          {particles.map((particle, index) => (
            <span
              key={index}
              className="star-reward-particle absolute left-1/2 top-1/2 text-sm"
              style={{
                '--star-x': particle.x,
                '--star-y': particle.y,
                '--star-delay': particle.delay,
              } as CSSProperties}
            >
              {index % 3 === 0 ? '✦' : '★'}
            </span>
          ))}
        </div>
        <p className="mt-1 text-xl font-extrabold text-amber-600">+{amount} Star{amount === 1 ? '' : 's'}</p>
        <p className="mt-1 text-xs font-medium text-slate-600">{message}</p>
      </div>
    </div>
  )
}
