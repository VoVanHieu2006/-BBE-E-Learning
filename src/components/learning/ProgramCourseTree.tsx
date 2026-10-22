'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { apiFetch, clearApiCache } from '@/lib/api/client'

export default function ProgramCourseTree() {
  const [programs, setPrograms] = useState<any[]>([])
  const [completedLessonIds, setCompletedLessonIds] = useState<Set<string>>(new Set())
  const [inProgressLessonIds, setInProgressLessonIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [openPrograms, setOpenPrograms] = useState<Record<string, boolean>>({})
  const [expandedLocked, setExpandedLocked] = useState<Record<string, boolean>>({})

  const loadData = async (force = false) => {
    if (force) {
      setRefreshing(true)
      clearApiCache('/api/v1/learning/me')
    }
    try {
      const res = await apiFetch<any>('/api/v1/learning/me', { noCache: force })
      if (res.ok && res.data) {
        const progList = res.data.programs || []
        setPrograms(progList)
        setCompletedLessonIds(new Set(res.data.completedLessonIds || []))
        setInProgressLessonIds(new Set(res.data.inProgressLessonIds || []))

        // Mặc định mở các chương trình có khóa học
        setOpenPrograms((prev) => {
          if (Object.keys(prev).length > 0) return prev
          const init: Record<string, boolean> = {}
          progList.forEach((p: any) => {
            if (p.courses?.length > 0) init[p.id] = true
          })
          return init
        })
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }
  useEffect(() => {
    loadData()
  }, [])

  const toggleProgram = (id: string) => {
    setOpenPrograms((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const hasAnyCourse = useMemo(() => programs.some((p) => p.courses?.length > 0), [programs])

  if (!loading && !hasAnyCourse) return null

  return (
    <section className="space-y-4 pt-2" aria-label="Lộ trình chương trình đào tạo BBE">
      {/* Header Lộ trình */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-slate-100">
        <div>
          <h2 className="text-xl font-bold text-[#172554] flex items-center gap-2" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            <span>🗺️ Lộ trình đào tạo theo Chương trình</span>
          </h2>
          <p className="text-xs text-[#737686] mt-0.5">
            Xem cấu trúc bài học và trạng thái hoàn thành trực tiếp trên từng chương trình chuẩn BBE
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadData(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-xl border border-blue-200 transition shadow-2xs self-start sm:self-auto disabled:opacity-50"
          title="Tải lại tiến độ lộ trình bài học"
        >
          <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
          <span>{refreshing ? 'Đang cập nhật...' : 'Làm mới lộ trình'}</span>
        </button>
      </div>

      {loading && programs.length === 0 ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2].map((n) => (
            <div key={n} className="h-28 bg-slate-50 rounded-2xl border border-slate-200 p-4" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {programs.map((program) => {
            const courses = program.courses || []
            if (courses.length === 0) return null

            const isOpen = openPrograms[program.id] ?? true

            // Tính tổng số bài và số bài hoàn thành trong toàn bộ chương trình
            let totalLessonsInProgram = 0
            let completedLessonsInProgram = 0

            courses.forEach((c: any) => {
              c.sessions?.forEach((s: any) => {
                s.lessons?.forEach((l: any) => {
                  totalLessonsInProgram++
                  if (completedLessonIds.has(l.id)) completedLessonsInProgram++
                })
              })
            })

            const percent = totalLessonsInProgram > 0 ? Math.round((completedLessonsInProgram / totalLessonsInProgram) * 100) : 0

            return (
              <div
                key={program.id}
                className="rounded-3xl border border-blue-100/80 bg-white overflow-hidden shadow-xs transition"
              >
                {/* Accordion Program Header */}
                <button
                  type="button"
                  onClick={() => toggleProgram(program.id)}
                  className="w-full px-5 py-4 bg-gradient-to-r from-blue-50/70 via-slate-50/50 to-white flex items-center justify-between text-left transition hover:bg-blue-50"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl p-2 bg-white rounded-xl shadow-2xs border border-blue-100">
                      {program.code === 'CORE_MEMBER' ? '🎓' : program.code === 'CORE_LEADER' ? '👑' : program.code === 'CORE_DNA' ? '🧬' : '🚀'}
                    </span>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-sm text-[#172554]">{program.name}</h3>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-[#2563EB] border border-blue-200">
                          {courses.length} khóa
                        </span>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                          {completedLessonsInProgram}/{totalLessonsInProgram} bài ({percent}%)
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-blue-700">
                    {isOpen ? '▲ Thu gọn' : '▼ Mở rộng'}
                  </span>
                </button>

                {/* Accordion Program Content */}
                {isOpen && (
                  <div className="p-4 space-y-4 bg-white border-t border-slate-100">
                    {courses.map((course: any) => {
                      // Xếp thứ tự phẳng tất cả bài học trong khóa để kiểm tra khóa tuần tự
                      const flatLessons: any[] = []
                      course.sessions?.forEach((s: any) => {
                        s.lessons?.forEach((l: any) => {
                          flatLessons.push(l)
                        })
                      })

                      return (
                        <div
                          key={course.id}
                          className="rounded-2xl border border-slate-200/80 bg-slate-50/30 p-4 space-y-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200/60">
                            <h4 className="font-bold text-sm text-[#172554]">
                              {course.title}
                            </h4>
                            <Link
                              href={`/student/courses/${course.id}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 transition"
                            >
                              <span>Mở khóa học</span>
                              <span>→</span>
                            </Link>
                          </div>

                          {/* Sessions & Lessons */}
                          <div className="space-y-3">
                            {course.sessions?.map((session: any) => {
                              const isPublicCourse = course.visibility === 'PUBLIC'
                              const nextUnlockedLessonIndex = isPublicCourse
                                ? flatLessons.length
                                : flatLessons.findIndex((fl) => !completedLessonIds.has(fl.id))

                              const visibleLessons: any[] = []
                              const lockedLessons: any[] = []

                              session.lessons?.forEach((lesson: any) => {
                                const lessonIndex = flatLessons.findIndex((fl) => fl.id === lesson.id)
                                const isDone = completedLessonIds.has(lesson.id)
                                if (isPublicCourse || isDone || lessonIndex === nextUnlockedLessonIndex || nextUnlockedLessonIndex === -1) {
                                  visibleLessons.push(lesson)
                                } else {
                                  lockedLessons.push(lesson)
                                }
                              })

                              const isExpanded = expandedLocked[session.id] ?? false

                              return (
                                <div key={session.id} className="space-y-1.5 pl-2 border-l-2 border-blue-200">
                                  <div className="text-xs font-bold text-slate-700">
                                    {session.title}
                                  </div>
                                  <div className="space-y-1">
                                    {/* Visible Lessons: Completed + 1 Next Unlocked Lesson */}
                                    {visibleLessons.map((lesson: any) => {
                                      const isDone = completedLessonIds.has(lesson.id)
                                      const isInProgress = inProgressLessonIds.has(lesson.id)

                                      return (
                                        <div
                                          key={lesson.id}
                                          className="flex items-center justify-between gap-3 p-2 rounded-xl bg-white border border-slate-100 hover:border-blue-200 transition text-xs"
                                        >
                                          <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-sm">
                                              {isDone ? '✅' : isInProgress ? '⏳' : '📖'}
                                            </span>
                                            <Link
                                              href={`/student/learning/${lesson.id}`}
                                              className="text-[#172554] hover:text-blue-600 font-semibold truncate transition"
                                            >
                                              {lesson.title}
                                            </Link>
                                          </div>

                                          <div className="shrink-0">
                                            {isDone ? (
                                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                ✓ Hoàn thành
                                              </span>
                                            ) : isInProgress ? (
                                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-200 animate-pulse">
                                                ⏳ Đang học
                                              </span>
                                            ) : (
                                              <Link
                                                href={`/student/learning/${lesson.id}`}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition"
                                              >
                                                ▶ Bắt đầu
                                              </Link>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })}

                                    {/* Collapsed Locked Lessons Summary Line */}
                                    {lockedLessons.length > 0 && !isExpanded && (
                                      <button
                                        type="button"
                                        onClick={() => setExpandedLocked((prev) => ({ ...prev, [session.id]: true }))}
                                        className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 text-xs text-slate-600 font-medium transition cursor-pointer text-left"
                                        title="Nhấn để xem danh sách bài học chưa mở"
                                      >
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span>🔒</span>
                                          <span className="font-semibold text-slate-700 truncate">
                                            + {lockedLessons.length} bài học tiếp theo (Mở tuần tự sau khi hoàn thành bài trên)
                                          </span>
                                        </div>
                                        <span className="text-[11px] text-blue-600 font-bold shrink-0 ml-2">
                                          Xem danh sách ▼
                                        </span>
                                      </button>
                                    )}

                                    {/* Expanded Locked Lessons List */}
                                    {lockedLessons.length > 0 && isExpanded && (
                                      <div className="space-y-1 pt-1">
                                        {lockedLessons.map((lesson: any) => (
                                          <div
                                            key={lesson.id}
                                            className="flex items-center justify-between gap-3 p-2 rounded-xl bg-slate-50/70 border border-dashed border-slate-200 text-xs"
                                          >
                                            <div className="flex items-center gap-2 min-w-0">
                                              <span className="text-sm">🔒</span>
                                              <span className="text-slate-400 font-medium truncate" title="Bài học đang bị khóa (cần hoàn thành bài trước)">
                                                {lesson.title}
                                              </span>
                                            </div>
                                            <div className="shrink-0">
                                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400 border border-slate-200">
                                                🔒 Khóa
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                        <div className="text-right pt-0.5">
                                          <button
                                            type="button"
                                            onClick={() => setExpandedLocked((prev) => ({ ...prev, [session.id]: false }))}
                                            className="text-[11px] text-blue-600 font-bold hover:underline"
                                          >
                                            ▲ Thu gọn {lockedLessons.length} bài học chưa mở
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
