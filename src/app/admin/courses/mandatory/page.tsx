'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Toast, { ToastMessage } from '@/components/ui/Toast'
import { apiFetch } from '@/lib/api/client'

interface TargetGroupDef {
  name: string
  color: string
  badgeBg: string
  targetKeys: string[]
}
const TARGET_GROUPS: TargetGroupDef[] = [
  {
    name: 'Thành viên',
    color: 'bg-blue-900 text-blue-100',
    badgeBg: 'bg-blue-800/80',
    targetKeys: [
      'MEMBER_BTK',
      'MEMBER_BTV',
      'MEMBER_BKM',
      'MEMBER_BTTSK',
      'MEMBER_BDH',
      'MEMBER_BND',
      'MEMBER_BCL',
    ],
  },
  {
    name: 'Chủ tịch',
    color: 'bg-amber-900 text-amber-100',
    badgeBg: 'bg-amber-800/80',
    targetKeys: ['CHAPTER_PRESIDENT'],
  },
  {
    name: 'LT',
    color: 'bg-indigo-900 text-indigo-100',
    badgeBg: 'bg-indigo-800/80',
    targetKeys: [
      'LEADER_BTK',
      'LEADER_BTV',
      'LEADER_BKM',
      'LEADER_BTTSK',
      'LEADER_BDH',
      'LEADER_BND',
      'LEADER_BCL',
    ],
  },
  {
    name: 'DNA',
    color: 'bg-emerald-950 text-emerald-100',
    badgeBg: 'bg-emerald-900/80',
    targetKeys: ['DNA_SGDC', 'DNA_LDC', 'DNA_TT'],
  },
]

function getTargetColumnLabel(target: any): string {
  let label = target.label || target.key
  label = label.replace(/^Thành viên\s+/i, '')
  label = label.replace(/^LT\s+/i, '')
  label = label.replace(/^Chủ tịch Chapter$/i, 'Chủ tịch')
  label = label.replace(/^DNA\s+/i, '')
  return label
}

export default function MandatoryCourseMatrixPage() {
  const [data, setData] = useState<any>(null)
  const [draft, setDraft] = useState<any>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [saving, setSaving] = useState(false)
  const [rowDays, setRowDays] = useState<Record<string, number>>({})

  const load = async () => {
    const res = await apiFetch('/api/v1/admin/mandatory-matrix', { noCache: true })
    if (res.ok && res.data) {
      setData(res.data)
      setDraft(structuredClone(res.data.cells))
      setRowDays(
        Object.fromEntries(
          res.data.courses.map((course: any) => [course.id, course.defaultDueDays || 30])
        )
      )
    } else {
      setToast({ type: 'error', message: res.error?.message || 'Không tải được ma trận khóa học bắt buộc.' })
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // Nhóm các target theo 4 nhóm đối tượng chính
  const targetGroupMap = useMemo(() => {
    if (!data?.targets) return []
    const targetsByKey = new Map<string, any>(data.targets.map((t: any) => [t.key, t]))

    const groups: Array<{
      name: string
      color: string
      badgeBg: string
      targets: any[]
    }> = []

    for (const g of TARGET_GROUPS) {
      const matched = g.targetKeys.map((k) => targetsByKey.get(k)).filter(Boolean)
      if (matched.length > 0) {
        groups.push({
          name: g.name,
          color: g.color,
          badgeBg: g.badgeBg,
          targets: matched,
        })
      }
    }

    // Các target phụ nếu có
    const usedKeys = new Set(TARGET_GROUPS.flatMap((g) => g.targetKeys))
    const others = data.targets.filter((t: any) => !usedKeys.has(t.key))
    if (others.length > 0) {
      groups.push({
        name: '📌 Đối tượng khác',
        color: 'bg-slate-900 text-slate-100',
        badgeBg: 'bg-slate-800',
        targets: others,
      })
    }

    return groups
  }, [data?.targets])

  const orderedTargets = useMemo(() => {
    if (!data?.targets) return []
    const byKey = new Map<string, any>(data.targets.map((target: any) => [target.key, target]))
    const ordered = TARGET_GROUPS.flatMap((group) =>
      group.targetKeys.map((key) => byKey.get(key)).filter(Boolean),
    ) as any[]
    const used = new Set(ordered.map((target: any) => target.key))
    const extras = data.targets.filter((target: any) => !used.has(target.key))
    return [...ordered, ...extras]
  }, [data?.targets])

  const eligibleTargets = useMemo(
    () => orderedTargets.filter((target: any) => (target.scopeCount ?? 1) > 0),
    [orderedTargets],
  )

  const catalogBroken = Boolean(
    data && (data.targets.length !== 18 || data.catalogComplete === false),
  )

  const changes = useMemo(() => {
    if (!data || !draft) return []
    return data.courses.flatMap((course: any) =>
      data.targets.flatMap((target: any) => {
        const before = data.cells[course.id]?.[target.key]
        const after = draft[course.id]?.[target.key]
        if (!before || !after) return []
        const effectiveDueDays = Number(rowDays[course.id] || after.dueDays || course.defaultDueDays || 30)
        const enabledChanged = before.enabled !== after.enabled
        const enabledDueDaysChanged =
          after.enabled &&
          (Number(before.dueDays || 30) !== effectiveDueDays ||
            Number(after.dueDays || 30) !== effectiveDueDays)
        return enabledChanged || enabledDueDaysChanged
          ? [
              {
                courseId: course.id,
                targetKey: target.key,
                enabled: after.enabled,
                dueDays: effectiveDueDays,
              },
            ]
          : []
      })
    )
  }, [data, draft, rowDays])

  const rowDefaults = useMemo(
    () =>
      data
        ? data.courses
            .filter((course: any) => Number(rowDays[course.id] || 30) !== Number(course.defaultDueDays || 30))
            .map((course: any) => ({
              courseId: course.id,
              dueDays: Number(rowDays[course.id] || 30),
            }))
        : [],
    [data, rowDays]
  )

  const setCell = (courseId: string, targetKey: string, patch: any) => {
    if (catalogBroken) return
    const target = orderedTargets.find((item: any) => item.key === targetKey)
    if (target && (target.scopeCount ?? 1) === 0) return
    setDraft((current: any) => ({
      ...current,
      [courseId]: {
        ...current[courseId],
        [targetKey]: {
          ...current[courseId][targetKey],
          ...patch,
        },
      },
    }))
  }

  const setRowEnabled = (course: any, enabled: boolean) => {
    if (catalogBroken) return
    setDraft((current: any) => ({
      ...current,
      [course.id]: Object.fromEntries(
        orderedTargets.map((target: any) => {
          const cell = current[course.id][target.key]
          if ((target.scopeCount ?? 1) === 0) return [target.key, cell]
          return [
            target.key,
            {
              ...cell,
              enabled,
              dueDays: rowDays[course.id] || course.defaultDueDays || 30,
            },
          ]
        })
      ),
    }))
  }

  const setColumnEnabled = (targetKey: string, enabled: boolean) => {
    if (catalogBroken) return
    const target = orderedTargets.find((item: any) => item.key === targetKey)
    if (!target || (target.scopeCount ?? 1) === 0) return
    setDraft((current: any) => ({
      ...current,
      ...Object.fromEntries(
        data.courses.map((course: any) => {
          const cell = current[course.id][targetKey]
          return [
            course.id,
            {
              ...current[course.id],
              [targetKey]: {
                ...cell,
                enabled,
                dueDays: rowDays[course.id] || course.defaultDueDays || 30,
              },
            },
          ]
        })
      ),
    }))
  }

  const save = async () => {
    if (catalogBroken) return
    if (!changes.length && !rowDefaults.length) return
    setSaving(true)
    try {
      const nextDraft = structuredClone(draft)
      for (const course of data.courses) {
        const days = Number(rowDays[course.id] || 30)
        for (const target of data.targets) {
          if (nextDraft[course.id]?.[target.key]?.enabled) {
            nextDraft[course.id][target.key].dueDays = days
          }
        }
      }

      const res = await apiFetch('/api/v1/admin/mandatory-matrix', {
        method: 'PUT',
        body: JSON.stringify({ changes, rowDefaults }),
      })
      if (res.ok) {
        setData((current: any) => ({
          ...current,
          cells: structuredClone(nextDraft),
          courses: current.courses.map((course: any) => ({
            ...course,
            defaultDueDays: rowDays[course.id] || course.defaultDueDays,
          })),
        }))
        setDraft(nextDraft)
        setToast({ type: 'success', message: 'Đã lưu ma trận khóa học bắt buộc thành công!' })
      } else {
        setToast({ type: 'error', message: res.error?.message || 'Không lưu được cấu hình ma trận.' })
      }
    } finally {
      setSaving(false)
    }
  }

  const totalChanges = changes.length + rowDefaults.length

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Header & Hành động */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Ma trận khóa học bắt buộc
          </h1>
          <p className="mt-1 text-sm text-[#737686]">
            Cấu hình đối tượng bắt buộc và thời hạn hoàn thành (ngày) cho 18 đối tượng thuộc 4 nhóm: Thành viên, Chủ tịch, LT và DNA. Số ngày ở đầu hàng áp dụng cho tất cả đối tượng được tick trong hàng; bấm <strong>Lưu thay đổi</strong> để cập nhật.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Link href="/admin/courses">
            <Button variant="outline" className="shadow-2xs">
              ← Quản lý Khóa học
            </Button>
          </Link>
          <Button
            loading={saving}
            disabled={totalChanges === 0 || catalogBroken}
            onClick={save}
            className="shadow-sm font-bold"
          >
            Lưu thay đổi {totalChanges > 0 ? `(${totalChanges})` : ''}
          </Button>
        </div>
      </div>

      {catalogBroken && (
        <div className="mb-4 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900 shadow-2xs">
          Danh mục đối tượng chưa đủ 18 (đang có {data?.targets?.length || 0}). Không thể lưu cấu hình cho đến khi danh mục được sửa.
        </div>
      )}

      {totalChanges > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 flex items-center justify-between shadow-2xs">
          <span>⚠️ Bạn đang có <strong>{totalChanges}</strong> thay đổi chưa lưu (bao gồm đối tượng bắt buộc hoặc số ngày hoàn thành).</span>
          <Button size="sm" loading={saving} onClick={save}>
            Lưu ngay
          </Button>
        </div>
      )}

      {/* GIAO DIỆN MOBILE (< md) */}
      <div className="space-y-4 md:hidden">
        {data?.courses?.map((course: any) => (
          <details key={course.id} className="rounded-2xl border bg-white p-4.5 shadow-xs">
            <summary className="cursor-pointer font-bold text-slate-900 text-sm">
              {course.title}
            </summary>
            <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Thời hạn hoàn thành:</span>
              <input
                type="number"
                min={1}
                max={3650}
                value={rowDays[course.id] || 30}
                onChange={(event) =>
                  setRowDays((current) => ({
                    ...current,
                    [course.id]: Number(event.target.value),
                  }))
                }
                className="w-20 rounded-xl border border-slate-200 p-1.5 text-center text-xs font-bold"
              />
              <span className="text-xs text-slate-500">ngày</span>
            </div>
            <div className="mt-3 space-y-1.5 max-h-60 overflow-y-auto">
              {orderedTargets.map((target: any) => {
                const unavailable = (target.scopeCount ?? 1) === 0
                return (
                  <label
                    key={target.key}
                    className={`flex items-center gap-3 rounded-xl p-2.5 text-xs ${unavailable ? 'bg-slate-100 cursor-not-allowed opacity-60' : 'bg-slate-50 hover:bg-slate-100/70 cursor-pointer'}`}
                    title={unavailable ? 'Chưa cấu hình đơn vị hoặc chức vụ cho đối tượng này' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(draft?.[course.id]?.[target.key]?.enabled)}
                      disabled={unavailable || catalogBroken}
                      onChange={(event) =>
                        setCell(course.id, target.key, {
                          enabled: event.target.checked,
                          dueDays: rowDays[course.id] || 30,
                        })
                      }
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                    />
                    <span className="font-medium text-slate-800">{target.label}</span>
                  </label>
                )
              })}
            </div>
          </details>
        ))}
      </div>

      {/* GIAO DIỆN DESKTOP (TABLE VỚI HEADER 2 DÒNG THẲNG TẮP) */}
      <div className="mb-3 hidden flex-wrap items-center gap-2 text-xs text-slate-600 md:flex">
        <span className="font-semibold text-slate-800">Bảng có 18 đối tượng trong 4 nhóm:</span>
        {targetGroupMap.map((group) => (
          <span key={`summary-${group.name}`} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-semibold">
            {group.name}: {group.targets.length}
          </span>
        ))}
        <span className="text-slate-400">Kéo ngang để xem hết các cột.</span>
      </div>
      <div className="hidden overflow-x-auto md:block rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-xs text-left border-separate border-spacing-0">
          {/* HEADER 2 DÒNG THẲNG TẮP */}
          <thead className="sticky top-0 z-20 bg-[#172554] text-white select-none">
            {/* DÒNG 1: KHỐI CHỨC VỤ / ĐƠN VỊ */}
            <tr className="border-b border-blue-900/60">
              <th
                rowSpan={2}
                className="sticky left-0 z-30 min-w-[340px] max-w-[360px] w-[350px] bg-[#172554] px-4 py-3.5 text-left border-r-2 border-b border-blue-900 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.2)]"
              >
                <div className="font-extrabold text-sm text-white">Khóa học & Thời hạn</div>
                <div className="text-[11px] font-normal text-blue-200/80 mt-0.5">
                  Nhập số ngày, hệ thống tự động lưu cho các ban được tick
                </div>
              </th>

              {targetGroupMap.map((group) => (
                <th
                  key={group.name}
                  colSpan={group.targets.length}
                  className={`px-3 py-2 text-center text-xs font-extrabold tracking-wide uppercase border-r border-blue-800/60 ${group.color}`}
                >
                  <div className="inline-flex items-center gap-1.5">
                    <span>{group.name}</span>
                    <span className="text-[10px] opacity-80 font-normal">
                      ({group.targets.length} đối tượng)
                    </span>
                  </div>
                </th>
              ))}
            </tr>

            {/* DÒNG 2: TÊN CỤ THỂ 18 TARGET & NÚT TICK CẢ CỘT ĐỒNG ĐỀU */}
            <tr className="bg-[#1e293b] text-slate-200 border-b border-slate-700">
              {orderedTargets.map((target: any) => {
                const unavailable = (target.scopeCount ?? 1) === 0
                const allEnabled =
                  data.courses.length > 0 &&
                  data.courses.every((course: any) => draft?.[course.id]?.[target.key]?.enabled)
                const columnLabel = getTargetColumnLabel(target)

                return (
                  <th
                    key={target.key}
                    className="min-w-[105px] px-2 py-2.5 text-center border-r border-b border-slate-700/80 align-top bg-[#1e293b]"
                  >
                    <div className="font-bold text-xs text-white truncate" title={target.label}>
                      {columnLabel}
                    </div>
                    <button
                      type="button"
                      disabled={unavailable || catalogBroken}
                      onClick={() => setColumnEnabled(target.key, !allEnabled)}
                      className={`mt-1.5 w-full whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[10px] font-bold transition shadow-2xs border ${
                        unavailable || catalogBroken
                          ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
                          : allEnabled
                            ? 'bg-amber-400 text-slate-900 border-amber-300 hover:bg-amber-300'
                            : 'bg-slate-700 text-slate-200 border-slate-600 hover:bg-slate-600'
                      }`}
                      title={unavailable ? 'Chưa cấu hình đơn vị hoặc chức vụ cho đối tượng này' : allEnabled ? 'Bỏ tick toàn bộ cột này' : 'Tick toàn bộ cột này'}
                    >
                      {unavailable ? 'Chưa cấu hình' : allEnabled ? '✓ Đã tick' : 'Tick cột'}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>

          {/* DỮ LIỆU CÁC KHÓA HỌC */}
          <tbody className="bg-white">
            {data?.courses?.map((course: any, idx: number) => {
              const allEnabled =
                eligibleTargets.length > 0 &&
                eligibleTargets.every((target: any) => draft?.[course.id]?.[target.key]?.enabled)

              return (
                <tr
                  key={course.id}
                  className={`hover:bg-blue-50/30 transition ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}`}
                >
                  {/* CỘT CỐ ĐỊNH: TÊN KHÓA HỌC & SỐ NGÀY (KHÔNG CẦN NÚT "ĐỒNG BỘ CẢ DÒNG") */}
                  <td className={`sticky left-0 z-10 min-w-[340px] max-w-[360px] w-[350px] px-4 py-3 border-r-2 border-b border-slate-200 shadow-[4px_0_8px_-2px_rgba(0,0,0,0.06)] ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}`}>
                    <p className="font-bold text-xs text-[#172554] line-clamp-2 leading-snug" title={course.title}>
                      {course.title}
                    </p>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <div className="inline-flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-xl border border-slate-200">
                        <input
                          type="number"
                          min={1}
                          max={3650}
                          value={rowDays[course.id] || 30}
                          onChange={(e) =>
                            setRowDays((v) => ({ ...v, [course.id]: Number(e.target.value) }))
                          }
                          className="w-14 rounded-lg bg-white border border-slate-300 px-1.5 py-0.5 text-center text-xs font-extrabold text-[#172554] focus:outline-none focus:ring-2 focus:ring-blue-500"
                          title="Hạn hoàn thành (ngày) áp dụng khi bấm Lưu thay đổi"
                        />
                        <span className="text-[11px] font-semibold text-slate-500">ngày</span>
                      </div>

                      <button
                        type="button"
                        disabled={catalogBroken}
                        onClick={() => setRowEnabled(course, !allEnabled)}
                        className={`rounded-xl px-2 py-1 text-[11px] font-bold transition border ${
                          catalogBroken
                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                            : allEnabled
                              ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {allEnabled ? 'Bỏ cả dòng' : 'Tick cả dòng'}
                      </button>
                    </div>
                  </td>

                  {/* 18 CỘT CHECKBOX CĂN GIỮA ĐỒNG ĐỀU */}
                  {orderedTargets.map((target: any) => {
                    const isChecked = Boolean(draft?.[course.id]?.[target.key]?.enabled)
                    const unavailable = (target.scopeCount ?? 1) === 0
                    return (
                      <td
                        key={target.key}
                        className={`px-2 py-3 text-center border-r border-slate-100 ${
                          isChecked ? 'bg-blue-50/40' : ''
                        } ${unavailable ? 'bg-slate-50' : ''}`}
                      >
                        <label
                          className={`inline-flex items-center justify-center p-1 rounded-lg transition ${unavailable ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-blue-100/60'}`}
                          title={unavailable ? 'Chưa cấu hình đơn vị hoặc chức vụ cho đối tượng này' : `${course.title} - ${target.label}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={unavailable || catalogBroken}
                            onChange={(e) =>
                              setCell(course.id, target.key, {
                                enabled: e.target.checked,
                                dueDays: rowDays[course.id] || course.defaultDueDays || 30,
                              })
                            }
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 transition cursor-pointer disabled:cursor-not-allowed"
                            title={`${course.title} - ${target.label}`}
                          />
                        </label>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>

        {!data && (
          <div className="p-12 text-center text-xs font-medium text-slate-400">
            Đang tải dữ liệu ma trận 18 đối tượng...
          </div>
        )}
      </div>
    </>
  )
}
