'use client'
import { FormEvent, useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import BulkInvitePanel from '@/components/invitations/BulkInvitePanel'
import { apiFetch } from '@/lib/api/client'
import EmailQuotaNotice, { useEmailQuota } from '@/components/invitations/EmailQuotaNotice'
import InviteLinkButton from '@/components/invitations/InviteLinkButton'

export default function InviteDna() {
  const [groups, setGroups] = useState<any[]>([])
  const [group, setGroup] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  /** Lời mời vừa tạo nhưng chưa gửi được mail: cho lấy link ngay tại đây (trang này không có bảng lời mời). */
  const [linkInvite, setLinkInvite] = useState<{ id: string; email: string } | null>(null)
  const [quotaTick, setQuotaTick] = useState(0)
  const quota = useEmailQuota(quotaTick)

  useEffect(() => {
    apiFetch('/api/v1/organization/managed-units').then((r) => {
      const g = (r.data?.items || []).filter((u: any) => u.type === 'DNA_GROUP' && ['LDC', 'SGDC', 'TT'].includes(u.name))
      setGroups(g)
      setGroup(g[0]?.id || '')
    })
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setLinkInvite(null)
    const sentTo = email.trim()
    const r = await apiFetch('/api/v1/invitations/member', { method: 'POST', body: JSON.stringify({ email: sentTo, organizationUnitId: group }), noCache: true })
    setBusy(false)
    if (!r.ok) { setMessage(r.error?.message || 'Không gửi được lời mời.'); return }
    setQuotaTick((n) => n + 1)
    setEmail('')
    if (r.data?.emailSent === false && r.data?.invitationId) {
      setMessage(`Đã tạo lời mời cho ${sentTo} nhưng chưa gửi được mail (${r.data.emailError || 'không rõ lý do'}). Bấm nút bên dưới để lấy link mời và gửi cho họ.`)
      setLinkInvite({ id: r.data.invitationId, email: sentTo })
    } else {
      setMessage('Đã gửi lời mời thành viên DNA.')
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-[#172554]">Mời thành viên DNA</h1>
        <p className="mt-1 text-sm text-[#737686]">Mỗi thành viên mới phải được gắn vào một nhóm DNA: LDC, SGDC hoặc TT.</p>
      </header>
      <Card className="space-y-4">
        <EmailQuotaNotice quota={quota} />
        <label className="block text-sm font-semibold">
          Nhóm DNA
          <select required value={group} onChange={(e) => setGroup(e.target.value)} disabled={busy} className="mt-1 w-full rounded-xl border bg-white px-4 py-3">
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <div className="flex gap-2" role="tablist" aria-label="Cách mời">
          {([{ key: 'single', label: 'Một email' }, { key: 'bulk', label: 'Nhiều email' }] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={mode === tab.key}
              disabled={busy}
              onClick={() => { setMode(tab.key); setMessage('') }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${mode === tab.key ? 'bg-[#2563EB] text-white' : 'bg-white text-[#434655] border border-[#cbdbf5] hover:bg-[#eff4ff]'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {mode === 'bulk' ? (
          <BulkInvitePanel organizationUnitId={group} missingScopeMessage="Chưa có nhóm DNA nào bạn được phép mời vào." onSent={() => setQuotaTick((n) => n + 1)} disabled={busy} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-semibold">
              Email
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border px-4 py-3" />
            </label>
            <Button type="submit" loading={busy} disabled={!group}>Gửi lời mời DNA</Button>
          </form>
        )}
        {message && mode === 'single' && <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
        {linkInvite && mode === 'single' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <InviteLinkButton invitationId={linkInvite.id} email={linkInvite.email} onMessage={(type, text) => setMessage(text)} className="text-sm font-semibold text-[#2563EB] hover:underline disabled:opacity-50 text-left break-all" />
          </div>
        )}
      </Card>
    </div>
  )
}
