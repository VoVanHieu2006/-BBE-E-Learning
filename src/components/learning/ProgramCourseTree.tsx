'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { apiFetch, clearApiCache } from '@/lib/api/client'

const PROGRAM_THEME: Record<string, {
  icon: string
  header: string
  border: string
  badge: string
  courseHeader: string
  courseBorder: string
}> = {
  CORE_MEMBER: {
    icon: '🎓',
    header: 'from-blue-50/80 via-white to-white',
    border: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
    courseHeader: 'bg-blue-50/60',
    courseBorder: 'border-blue-200/80',
  },
  CORE_LEADER: {
    icon: '👑',
    header: 'from-purple-50/80 via-white to-white',
    border: 'border-purple-200',
    badge: 'bg-purple-100 text-purple-800 border-purple-200',
    courseHeader: 'bg-purple-50/60',
    courseBorder: 'border-purple-200/80',
  },
  CORE_DNA: {
    icon: '🧬',
    header: 'from-emerald-50/80 via-white to-white',
    border: 'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    courseHeader: 'bg-emerald-50/60',
    courseBorder: 'border-emerald-200/80',
  },
  EXTENDED: {
    icon: '🚀',
    header: 'from-slate-50/80 via-white to-white',
    border: 'border-slate-200',
    badge: 'bg-slate-100 text-slate-800 border-slate-200',
    courseHeader: 'bg-slate-50/80',
    courseBorder: 'border-slate-200',
  },
}

const DEFAULT_THEME = PROGRAM_THEME.EXTENDED

export default function ProgramCourseTree() {
  const [programs, setPrograms] = useState<any[]>([])
  const [completedLessonIds, setCompletedLessonIds] = useState<Set<string>>(new Set())
  const [inProgressLessonIds, setInProgressLessonIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [openPrograms, setOpenPrograms] = useState<Record<string, boolean>>({})
  const [openCourses, setOpenCourses] = useState<Record<string, boolean>>({})

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
        // Programs open by default, but every course starts collapsed. This
        // keeps long curricula scannable and avoids resetting any playing video.
        setOpenPrograms((prev) => {
          if (Object.keys(prev).length > 0) return prev
          const init: Record<string, boolean> = {}
          progList.forEach((p: any) => { init[p.id] = true })
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

  const hasAnyCourse = useMemo(
    () => programs.some((p) => (p.courses || []).some((c: any) => (c.sessions || []).some((s: any) => (s.lessons || []).length > 0))),
    [programs],
  )

  const allCourseIds = useMemo(
    () => programs.flatMap((p) => (p.courses || []).map((c: any) => c.id)),
    [programs],
  )

  const allExpanded = allCourseIds.length > 0 && allCourseIds.every((id) => openCourses[id])

  const toggleProgram = (id: string) => {
    setOpenPrograms((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleCourse = (id: string) => {
    setOpenCourses((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleAll = () => {
    const next = !allExpanded
    const programState: Record<string, boolean> = {}
    const courseState: Record<string, boolean> = {}
    programs.forEach((p) => {
      programState[p.id] = next
      ;(p.courses || []).forEach((c: any) => { courseState[c.id] = next })
    })
    setOpenPrograms(programState)
    setOpenCourses(courseState)
  }

  if (!loading && !hasAnyCourse) return null

  return (
    <section className="space-y-4 pt-2" aria-label="Lộ trình chương trình đào tạo BBE">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            <span aria-hidden="true">🗺️</span> Lộ trình đào tạo theo Chương trình
          </h2>
          <p className="mt-0.5 text-xs text-[#737686]">
            Tất cả bài học đã xuất bản đều hiển thị. Bài chưa đủ điều kiện được đánh dấu khóa và mở tuần tự.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={toggleAll}
            className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
            disabled={allCourseIds.length === 0}
          >
            <span aria-hidden="true">{allExpanded ? '▴' : '▾'}</span>
            {allExpanded ? 'Thu gọn tất cả' : 'Mở tất cả'}
          </button>
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            title="Tải lại tiến độ lộ trình bài học"
          >
            <span className={refreshing ? 'animate-spin' : ''} aria-hidden="true">🔄</span>
            {refreshing ? 'Đang cập nhật…' : 'Làm mới'}
          </button>
        </div>
      </div>

      {loading && programs.length === 0 ? (
        <div className="space-y-3 animate-pulse" aria-busy="true">
          {[1, 2, 3].map((n) => <div key={n} className="h-24 rounded-2xl border border-slate-200 bg-slate-50 p-4" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {programs.map((program) => {
            const courses = (program.courses || []).filter((course: any) =>
              (course.sessions || []).some((session: any) => (session.lessons || []).length > 0))
            if (courses.length === 0) return null

            const theme = PROGRAM_THEME[program.code] || DEFAULT_THEME
            const isOpen = openPrograms[program.id] ?? true
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
              <div key={program.id} className={`overflow-hidden rounded-3xl border ${theme.border} bg-white shadow-xs`}>
                <button
                  type="button"
                  onClick={() => toggleProgram(program.id)}
                  aria-expanded={isOpen}
                  className={`flex w-full items-center justify-between bg-gradient-to-r ${theme.header} px-5 py-4 text-left transition hover:brightness-[0.98]`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`rounded-xl border p-2 text-xl ${theme.badge}`} aria-hidden="true">{theme.icon}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-bold text-[#172554]">{program.name}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${theme.badge}`}>
                          {courses.length} khóa
                        </span>
                        <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                          {completedLessonsInProgram}/{totalLessonsInProgram} bài ({percent}%)
                        </span>
                      </div>
                      {program.is_core !== false && <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Chương trình lõi</p>}
                    </div>
                  </div>
                  <span className="ml-3 shrink-0 text-xs font-bold text-blue-700" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                  <div className="space-y-4 border-t border-slate-100 bg-white p-4">
                    {courses.map((course: any) => {
                      const flatLessons: any[] = []
                      course.sessions?.forEach((session: any) => {
                        session.lessons?.forEach((lesson: any) => flatLessons.push(lesson))
                      })
                      const isPublicCourse = course.visibility === 'PUBLIC'
                      const firstIncompleteIndex = flatLessons.findIndex((lesson) => !completedLessonIds.has(lesson.id))
                      const unlockedThroughIndex = isPublicCourse || firstIncompleteIndex < 0 ? flatLessons.length - 1 : firstIncompleteIndex
                      const isCourseOpen = openCourses[course.id] ?? false
                      const doneInCourse = flatLessons.filter((lesson) => completedLessonIds.has(lesson.id)).length
                      const coursePercent = flatLessons.length ? Math.round((doneInCourse / flatLessons.length) * 100) : 0

                      return (
                        <div key={course.id} className={`overflow-hidden rounded-2xl border ${theme.courseBorder} bg-slate-50/30`}>
                          <button
                            type="button"
                            onClick={() => toggleCourse(course.id)}
                            aria-expanded={isCourseOpen}
                            className={`flex w-full flex-col gap-2 px-4 py-3 text-left transition hover:brightness-[0.99] sm:flex-row sm:items-center sm:justify-between ${theme.courseHeader}`}
                          >
                            <div className="min-w-0">
                              <h4 className="truncate text-sm font-bold text-[#172554]">{course.title}</h4>
                              <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                                {flatLessons.length} bài · Đã hoàn thành {doneInCourse}/{flatLessons.length} ({coursePercent}%)
                                {isPublicCourse && <span className="ml-2 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">Công khai</span>}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Link
                                href={`/student/courses/${course.id}`}
                                onClick={(event) => event.stopPropagation()}
                                className="rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-bold text-blue-700 transition hover:bg-blue-50"
                              >
                                Mở khóa học →
                              </Link>
                              <span className="text-xs font-bold text-blue-700" aria-hidden="true">{isCourseOpen ? '▲' : '▼'}</span>
                            </div>
                          </button>

                          {isCourseOpen && (
                            <div className="space-y-3 border-t border-slate-200/60 bg-white p-3">
                              {course.sessions?.map((session: any, sessionIndex: number) => (
                                <div key={session.id} className="space-y-1.5 border-l-2 border-blue-200 pl-2">
                                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">Buổi {sessionIndex + 1}</span>
                                    <span className="truncate">{session.title}</span>
                                  </div>
                                  <div className="space-y-1">
                                    {session.lessons?.map((lesson: any) => {
                                      const lessonIndex = flatLessons.findIndex((item) => item.id === lesson.id)
                                      const isDone = completedLessonIds.has(lesson.id)
                                      const isInProgress = inProgressLessonIds.has(lesson.id) && !isDone
                                      const isOpen = isPublicCourse || lessonIndex <= unlockedThroughIndex
                                      const status = isDone ? 'done' : !isOpen ? 'locked' : isInProgress ? 'progress' : 'open'

                                      return (
                                        <div
                                          key={lesson.id}
                                          className={`flex items-center justify-between gap-3 rounded-xl border px-2.5 py-2 text-xs transition ${
                                            status === 'locked'
                                              ? 'border-dashed border-slate-200 bg-slate-50/60'
                                              : 'border-slate-100 bg-white hover:border-blue-200'
                                          }`}
                                        >
                                          <div className="flex min-w-0 items-center gap-2">
                                            <span className="text-sm" aria-hidden="true">
                                              {status === 'done' ? '✅' : status === 'locked' ? '🔒' : status === 'progress' ? '⏳' : '📖'}
                                            </span>
                                            {status === 'locked' ? (
                                              <span className="truncate font-medium text-slate-400" title="Cần hoàn thành bài trước để mở khóa">
                                                {lesson.title}
                                              </span>
                                            ) : (
                                              <Link href={`/student/learning/${lesson.id}`} className="truncate font-semibold text-[#172554] transition hover:text-blue-600">
                                                {lesson.title}
                                              </Link>
                                            )}
                                          </div>
                                          <div className="shrink-0">
                                            {status === 'done' ? (
                                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">✓ Hoàn thành</span>
                                            ) : status === 'locked' ? (
                                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">🔒 Khóa</span>
                                            ) : status === 'progress' ? (
                                              <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[10px] font-extrabold text-blue-800 animate-pulse">⏳ Đang học</span>
                                            ) : (
                                              <Link href={`/student/learning/${lesson.id}`} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100">
                                                ▶ Bắt đầu
                                              </Link>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
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
