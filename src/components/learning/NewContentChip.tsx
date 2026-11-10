export default function NewContentChip({ show }: { show?: boolean }) {
  if (!show) return null
  return <span className="inline-flex shrink-0 items-center rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">Mới</span>
}
