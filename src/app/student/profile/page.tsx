'use client'
import { FormEvent, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Toast, { ToastMessage } from '@/components/ui/Toast'
import { apiFetch, clearApiCache } from '@/lib/api/client'

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null)
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  useEffect(() => {
    apiFetch('/api/v1/users/me').then((res) => {
      if (res.ok) {
        setProfile(res.data)
        setDisplayName(res.data?.displayName || '')
      }
    })
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const res = await apiFetch('/api/v1/users/me', {
      method: 'PATCH',
      noCache: true,
      body: JSON.stringify({ displayName }),
    })
    setSaving(false)
    if (!res.ok) return setToast({ type: 'error', message: res.error?.message || 'Không thể lưu hồ sơ.' })
    setProfile({ ...profile, displayName: res.data.displayName })

    // Cập nhật localStorage ngay lập tức
    try {
      const u = localStorage.getItem('user')
      if (u) {
        const parsed = JSON.parse(u)
        parsed.displayName = res.data.displayName
        localStorage.setItem('user', JSON.stringify(parsed))
      }
    } catch {}

    // Xóa cache API phía client để bảng xếp hạng và các trang khác nạp tên mới ngay
    clearApiCache('/api/v1/leaderboard')
    clearApiCache('/api/v1/users/me')
    clearApiCache('/api/v1/users')

    setToast({ type: 'success', message: 'Đã cập nhật tên hiển thị thành công.' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
          Hồ sơ cá nhân
        </h1>
        <p className="mt-1 text-sm text-[#737686]">
          Tên giúp Lead Chapter và Admin đối chiếu bạn với danh sách cuối nhiệm kỳ. Email vẫn là mã nhận diện duy nhất.
        </p>
      </div>

      <Card className="space-y-5 border border-[#eff4ff]">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[#737686]">Email đăng nhập</div>
          <div className="mt-1 font-medium text-[#172554]">{profile?.email || 'Đang tải…'}</div>
        </div>
        <form onSubmit={save} className="space-y-3">
          <label className="block text-sm font-semibold text-[#172554]">Họ và tên</label>
          <input
            required
            minLength={2}
            maxLength={120}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ví dụ: Nguyễn Minh Anh"
            className="w-full rounded-xl border border-[#cbdbf5] px-4 py-3 outline-none focus:border-[#3156d8]"
          />
          <Button type="submit" loading={saving}>Lưu hồ sơ</Button>
        </form>
      </Card>

      <Card className="space-y-4 border border-[#eff4ff]">
        <div>
          <h2 className="font-bold text-[#172554]">Tư cách hiện tại</h2>
          <p className="mt-1 text-xs text-[#737686]">
            {profile?.managerKind === 'LEAD_DNA'
              ? 'Tài khoản quản lý hệ thống DNA, không tham gia lộ trình học tập.'
              : 'Quyền Chapter và DNA được quản lý độc lập.'}
          </p>
        </div>

        <div className={`grid gap-3 ${profile?.managerKind === 'LEAD_DNA' ? '' : 'sm:grid-cols-2'}`}>
          {profile?.managerKind !== 'LEAD_DNA' && (
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="text-xs font-semibold uppercase text-blue-700">Chapter</p>
              <p className="mt-1 font-bold text-[#172554]">{profile?.chapterName || 'Không hoạt động'}</p>
              <p className="mt-1 text-sm text-[#596174]">
                {profile?.currentDepartment
                  ? `${profile.currentDepartment.name}${profile?.currentTermLabel ? ` · ${profile.currentTermLabel}` : ''}`
                  : profile?.department
                  ? `${profile.department.name}`
                  : 'Chưa có Ban'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {profile?.positions
                  ?.filter((position: any) => position.scope === 'CHAPTER' || position.scope === 'DEPARTMENT')
                  .map((position: any) => (
                    <span key={`${position.code}-${position.unitId}`} className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-blue-700">
                      {position.name}
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div className="rounded-xl bg-emerald-50 p-4">
            <p className="text-xs font-semibold uppercase text-emerald-700">DNA</p>
            <p className="mt-1 font-bold text-[#172554]">{profile?.dna?.active ? profile.dna.unitName : 'Không hoạt động'}</p>
            {profile?.managerKind === 'LEAD_DNA' ? (
              <p className="mt-2 inline-flex rounded-full bg-white px-3 py-1 text-sm font-bold text-emerald-700">Lead DNA</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-[#596174]">{profile?.dna?.groupName ? `Nhóm ${profile.dna.groupName}` : 'Không thuộc nhóm DNA'}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {profile?.positions
                    ?.filter((position: any) => position.scope === 'DNA')
                    .map((position: any) => (
                      <span key={`${position.code}-${position.unitId}`} className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-emerald-700">
                        {position.name}
                      </span>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>

        {profile?.capabilities?.formerOrCurrentLt && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            Bạn đã từng là LT nên tiếp tục được học, làm bài kiểm tra và nhận sao ở nội dung dành cho LT.
          </p>
        )}
      </Card>

      {/* Lịch sử phân ban qua các nhiệm kỳ */}
      {profile?.departmentHistory && profile.departmentHistory.length > 0 && (
        <Card className="space-y-4 border border-[#eff4ff]">
          <div>
            <h2 className="font-bold text-[#172554] flex items-center gap-2">
              <span>📜</span> Lịch sử phân ban qua các nhiệm kỳ
            </h2>
            <p className="mt-1 text-xs text-[#737686]">Quá trình tham gia công tác và cống hiến tại các ban thuộc Chapter.</p>
          </div>

          <div className="space-y-2">
            {profile.departmentHistory.map((item: any) => (
              <div key={item.id} className="p-3 bg-[#f8f9ff] rounded-xl flex items-center justify-between border border-[#eff4ff]">
                <div>
                  <p className="font-bold text-sm text-[#172554]">
                    {item.termLabel || 'Nhiệm kỳ'} — {item.departmentName}
                  </p>
                  <p className="text-[11px] text-[#737686] mt-0.5">
                    Bắt đầu: {new Date(item.startsAt).toLocaleDateString('vi-VN')}
                    {item.endsAt && ` • Kết thúc: ${new Date(item.endsAt).toLocaleDateString('vi-VN')}`}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                  item.status === 'ACTIVE'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {item.status === 'ACTIVE' ? 'Đang công tác' : 'Hoàn thành'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
