export default function NewContentChip({
  show,
  variant = 'lesson',
  label,
}: {
  show?: boolean
  variant?: 'lesson' | 'quiz'
  label?: string
}) {
  if (!show) return null
  const text = label ?? (variant === 'quiz' ? 'Quiz mới' : 'Bài mới')
  const classes =
    variant === 'quiz'
      ? 'inline-flex shrink-0 items-center gap-1 rounded-full border border-orange-300 bg-orange-500 px-2 py-0.5 text-[11px] font-extrabold text-white shadow-sm'
      : 'inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-300 bg-blue-600 px-2 py-0.5 text-[11px] font-extrabold text-white shadow-sm'
  return (
    <span className={classes}>
      <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
      {text}
    </span>
  )
}
