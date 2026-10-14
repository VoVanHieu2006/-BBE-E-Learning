export default function PageLoading() {
  return <div className="page-loading space-y-5" role="status" aria-label="Đang tải trang">
    <div className="h-8 w-56 rounded-xl bg-slate-200" />
    <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-28 rounded-2xl bg-white shadow-sm" />)}</div>
    <div className="h-72 rounded-2xl bg-white shadow-sm" />
  </div>
}
