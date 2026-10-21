'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api/client'

export default function ProgramCourseTree() {
  const [programs, setPrograms] = useState<any[]>([])
  useEffect(() => {
    let live = true
    apiFetch<any>('/api/v1/learning/me').then((response) => { if (live && response.ok) setPrograms(response.data.programs || []) }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!programs.some((program) => program.courses.length)) return null
  return <section className="space-y-3" aria-label="Chương trình học">
    <h2 className="text-xl font-bold text-slate-900">Chương trình học</h2>
    {programs.map((program) => <details key={program.id} className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-semibold text-blue-950">{program.name} <span className="text-sm font-normal text-slate-500">({program.courses.length} khóa)</span></summary>
      <div className="mt-3 space-y-2">{program.courses.length ? program.courses.map((course: any) => <details key={course.id} className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer font-medium">{course.title}</summary><Link className="mt-2 inline-block text-sm font-semibold text-blue-700" href={`/student/courses/${course.id}`}>Mở khóa học →</Link>{course.sessions.map((session: any) => <div key={session.id} className="mt-3 border-l-2 border-blue-100 pl-3"><h3 className="text-sm font-semibold">{session.title}</h3><ul className="mt-1 space-y-1">{session.lessons.map((lesson: any) => <li key={lesson.id}><Link href={`/student/learning/${lesson.id}`} className="text-sm text-blue-700 hover:underline">{lesson.title}</Link></li>)}</ul></div>)}</details>) : <p className="text-sm text-slate-500">Chưa có khóa published được phân loại vào chương trình này.</p>}</div>
    </details>)}
  </section>
}
