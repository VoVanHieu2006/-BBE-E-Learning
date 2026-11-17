import type { ReactNode } from 'react'

/** "VIDEO" / "QUIZ" label: bold caps in its own color so the two parts of a month are easy to tell apart. */
export function MonthPartLabel({ kind }: { kind: 'video' | 'quiz' }) {
  return (
    <span className={`font-extrabold uppercase tracking-wide ${kind === 'video' ? 'text-[#2563EB]' : 'text-violet-700'}`}>
      {kind === 'video' ? 'Video' : 'Quiz'}
    </span>
  )
}

/** One month: "VIDEO +1 ⭐ · QUIZ đạt +1 ⭐". `quiz` null hides the quiz part (lesson without a quiz). */
export default function MonthStarParts({ video, quiz }: { video: ReactNode; quiz?: ReactNode | null }) {
  return (
    // Each label stays on the same line as its value; a narrow box wraps between the two parts.
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className="whitespace-nowrap"><MonthPartLabel kind="video" /> {video}</span>
      {quiz !== null && quiz !== undefined && quiz !== '' && (
        <>
          <span aria-hidden="true" className="text-slate-400">·</span>
          <span className="whitespace-nowrap"><MonthPartLabel kind="quiz" /> {quiz}</span>
        </>
      )}
    </span>
  )
}
