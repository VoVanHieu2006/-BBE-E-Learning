'use client'

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import confetti from 'canvas-confetti'
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

/** Centered full-viewport reward overlay. Shown once per awarded reward key. */
export default function StarRewardCelebration({ amount, message, balance, onClose, disableAutoDismiss = false }: StarRewardCelebrationProps) {
  const [visible, setVisible] = useState(true)
  const [count, setCount] = useState(amount)
  const [reducedMotion, setReducedMotion] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const gradientId = useId()

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(media.matches)
    // Never show "+0" for a real reward: the count-up starts at 1.
    const floor = Math.min(1, amount)
    setCount(media.matches ? amount : floor)
    soundEffects.playStarChime()
    const fire = canvasRef.current ? confetti.create(canvasRef.current, { resize: true, disableForReducedMotion: true }) : null
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      if (media.matches) { setCount(amount); return }
      const fraction = Math.min(1, Math.max(0, (now - start - 1200) / 1100))
      setCount(Math.max(floor, Math.round(amount * (1 - Math.pow(1 - fraction, 3)))))
      if (fraction < 1) frame = requestAnimationFrame(tick)
    }
    if (!media.matches) frame = requestAnimationFrame(tick)
    const burst = () => {
      if (media.matches) return
      const options = { particleCount: 32, spread: 62, startVelocity: 24, gravity: 0.9, ticks: 110, colors: ['#fbbf24', '#f97316', '#2563eb'], scalar: 0.9 }
      fire?.({ ...options, angle: 60, origin: { x: 0.2, y: 0.62 } })
      fire?.({ ...options, angle: 120, origin: { x: 0.8, y: 0.62 } })
    }
    const bursts = [setTimeout(burst, 650), setTimeout(burst, 1100)]
    const dismiss = disableAutoDismiss ? null : setTimeout(() => { setVisible(false); onCloseRef.current?.() }, 3500)
    const motionChanged = () => {
      setReducedMotion(media.matches)
      if (media.matches) { cancelAnimationFrame(frame); fire?.reset(); setCount(amount) }
    }
    media.addEventListener('change', motionChanged)
    return () => {
      cancelAnimationFrame(frame)
      bursts.forEach(clearTimeout)
      if (dismiss !== null) clearTimeout(dismiss)
      media.removeEventListener('change', motionChanged)
      fire?.reset()
    }
  }, [amount, disableAutoDismiss])

  if (!visible) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[9998] grid place-items-center px-4" role="status" aria-live="polite" aria-atomic="true">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <div className="star-reward-card relative w-full max-w-sm rounded-2xl border border-amber-200 bg-white px-8 py-6 text-center shadow-xl">
        {!reducedMotion && Array.from({ length: 12 }, (_, index) => {
          const angle = Math.PI * 2 * index / 12
          return <svg key={index} aria-hidden="true" viewBox="0 0 24 24" className="star-reward-particle absolute h-5 w-5 text-amber-400" style={{ left: `${50 + Math.cos(angle) * 48}%`, top: `${50 + Math.sin(angle) * 48}%`, '--star-delay': `${700 + index * 55}ms` } as CSSProperties}><path fill="currentColor" d="m12 1 3.2 6.9 7.5 1-5.5 5.3 1.4 7.5-6.6-3.6-6.6 3.6 1.4-7.5L1.3 8.9l7.5-1Z" /></svg>
        })}
        <svg viewBox="0 0 160 160" className="star-reward-main relative mx-auto h-36 w-36" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0.7" y2="1">
              <stop offset="0" stopColor="#fff3a3" /><stop offset="0.5" stopColor="#facc15" /><stop offset="1" stopColor="#fb923c" />
            </linearGradient>
          </defs>
          <path d="M72 20 Q80 4 88 20 L104 51 Q106 55 112 56 L145 61 Q161 64 149 76 L125 100 Q121 104 122 110 L127 143 Q129 159 115 151 L85 135 Q80 132 75 135 L45 151 Q31 159 33 143 L38 110 Q39 104 35 100 L11 76 Q-1 64 15 61 L48 56 Q54 55 56 51Z" fill={`url(#${gradientId})`} stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="m69 35 8-15q3-5 6 0l9 18" fill="none" stroke="#fffbe5" strokeWidth="6" strokeLinecap="round" opacity="0.8" />
          <ellipse cx="51" cy="102" rx="10" ry="5" fill="#fb7185" opacity="0.55" /><ellipse cx="109" cy="102" rx="10" ry="5" fill="#fb7185" opacity="0.55" />
          <g className="star-reward-eyes" fill="#78350f"><ellipse cx="62" cy="88" rx="4.5" ry="7" /><ellipse cx="98" cy="88" rx="4.5" ry="7" /><circle cx="63" cy="86" r="1.5" fill="white" /><circle cx="99" cy="86" r="1.5" fill="white" /></g>
          <path d="M69 103 Q80 117 91 103" fill="none" stroke="#78350f" strokeWidth="3.5" strokeLinecap="round" />
        </svg>
        <p className="relative mt-1 text-4xl font-black tabular-nums text-amber-700" aria-label={`+${amount} sao`}><span aria-hidden="true">+{count} ⭐</span></p>
        <p className="relative mt-2 text-sm font-semibold leading-relaxed text-slate-700">{message}</p>
        {typeof balance === 'number' && <p className={`relative mt-3 text-sm text-slate-600 ${reducedMotion ? '' : 'star-reward-total'}`}>Tổng: <span className="font-bold text-amber-700">{balance.toLocaleString('vi-VN')} ⭐</span></p>}
        <p className="relative mt-3 text-xs font-medium text-amber-800">BBE Learning · Thành tích mới</p>
      </div>
    </div>
  )
}
