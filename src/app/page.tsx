'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'

interface FeaturedCourse {
  id?: string
  courseId?: string
  title: string
  description?: string | null
  coverUrl?: string | null
  sessionCount?: number
}

export default function LandingPage() {
  const [user, setUser] = useState<any>(null)
  const [featuredCourses, setFeaturedCourses] = useState<FeaturedCourse[]>([])
  const carouselRef = useRef<HTMLDivElement>(null)
  const [carouselPaused, setCarouselPaused] = useState(false)

  useEffect(() => {
    const rawUser = localStorage.getItem('user')
    const token = localStorage.getItem('accessToken')
    if (rawUser && token) {
      try {
        setUser(JSON.parse(rawUser))
      } catch {
        localStorage.removeItem('user')
        localStorage.removeItem('accessToken')
      }
    }

    fetch('/api/v1/courses?limit=8', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setFeaturedCourses(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setFeaturedCourses([]))
  }, [])

  const getDashboardHref = () => {
    if (!user) return '/login'
    if (user.role === 'ADMIN') return '/admin/dashboard'
    if (user.role === 'CHAPTER_LEADER') return '/chapter-manager/dashboard'
    return '/student/dashboard'
  }

  const getDashboardLabel = () => {
    if (!user) return 'Đăng nhập để học ngay'
    if (user.role === 'ADMIN') return 'Mở trang quản trị'
    if (user.role === 'CHAPTER_LEADER') return 'Mở không gian Chapter'
    return 'Tiếp tục học tập'
  }

  const scrollCarousel = useCallback((direction: -1 | 1) => {
    const carousel = carouselRef.current
    if (!carousel) return
    const card = carousel.querySelector<HTMLElement>('[data-course-card]')
    const amount = (card?.getBoundingClientRect().width || 280) + 20
    const nearEnd = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 24
    const nearStart = carousel.scrollLeft <= 24

    if (direction === 1 && nearEnd) {
      carousel.scrollTo({ left: 0, behavior: 'smooth' })
    } else if (direction === -1 && nearStart) {
      carousel.scrollTo({ left: carousel.scrollWidth, behavior: 'smooth' })
    } else {
      carousel.scrollBy({ left: direction * amount, behavior: 'smooth' })
    }
  }, [])

  useEffect(() => {
    if (carouselPaused || featuredCourses.length < 2) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return
    const timer = window.setInterval(() => scrollCarousel(1), 5200)
    return () => window.clearInterval(timer)
  }, [carouselPaused, featuredCourses.length, scrollCarousel])

  const isLoggedIn = Boolean(user)

  return (
    <main className="min-h-screen overflow-hidden bg-[#f8f9ff] text-[#172554]">
      <header className="sticky top-0 z-50 border-b border-blue-100/80 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Link href="/" aria-label="BBE Learning Hub - Trang chủ" className="shrink-0">
            <img src="/images/logo-transparent.png" alt="BBE Learning Hub" className="h-9 w-auto object-contain sm:h-11" />
          </Link>
          <nav aria-label="Điều hướng chính" className="flex items-center gap-1 sm:gap-3">
            <Link href="/student/courses" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 sm:inline-flex">
              Khóa học
            </Link>
            <Link href="/leaderboard" className="hidden rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 md:inline-flex">
              Bảng xếp hạng
            </Link>
            <Link href={getDashboardHref()}>
              <Button size="sm" variant={isLoggedIn ? 'secondary' : 'primary'} className="whitespace-nowrap shadow-sm">
                {isLoggedIn ? 'Vào lớp học' : 'Đăng nhập'}
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative isolate overflow-hidden bg-[#101f49] px-5 py-16 text-white sm:px-8 sm:py-24 lg:py-28">
        <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -right-24 -top-40 h-[30rem] w-[30rem] rounded-full bg-blue-500/30 blur-3xl" />
          <div className="absolute -bottom-56 -left-24 h-[30rem] w-[30rem] rounded-full bg-orange-400/20 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:24px_24px]" />
        </div>

        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold text-blue-100 shadow-sm backdrop-blur">
              <span aria-hidden="true">✦</span> Nền tảng học tập nội bộ BBE
            </div>
            <h1 className="mt-7 max-w-xl overflow-visible text-4xl font-extrabold leading-[1.45] tracking-tight sm:text-5xl sm:leading-[1.4] lg:text-6xl">
              Học có lộ trình.
              <span className="mt-5 block overflow-visible py-3 bg-gradient-to-r from-orange-300 to-amber-200 bg-clip-text text-transparent">Tiến bộ mỗi ngày.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-blue-100/90 sm:text-lg sm:leading-8">
              Khám phá kiến thức, rèn kỹ năng và theo dõi hành trình phát triển của bạn trong một không gian học tập dành riêng cho cộng đồng BBE.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={isLoggedIn ? getDashboardHref() : '/student/courses'}>
                <Button size="lg" className="w-full justify-center bg-orange-500 px-7 font-bold text-white shadow-lg shadow-orange-950/20 hover:bg-orange-400 sm:w-auto">
                  {isLoggedIn ? '← Quay lại' : 'Xem khóa học cho thành viên →'}
                </Button>
              </Link>
              {!isLoggedIn && <Link href="/login">
                <Button variant="outline" size="lg" className="w-full justify-center border-white/40 bg-white px-7 font-bold text-[#172554] hover:bg-blue-50 sm:w-auto">
                  Đăng nhập để xem nhiều khóa học hơn và lưu tiến độ
                </Button>
              </Link>}
            </div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-xs font-medium text-blue-100/80 sm:text-sm">
              <span className="inline-flex items-center gap-2"><span className="text-emerald-300">✓</span> Học theo từng bước</span>
              <span className="inline-flex items-center gap-2"><span className="text-emerald-300">✓</span> Theo dõi tiến độ rõ ràng</span>
              <span className="inline-flex items-center gap-2"><span className="text-emerald-300">✓</span> Ghi nhận bằng Star ⭐</span>
            </div>
          </div>

          <div aria-hidden="true" className="relative mx-auto hidden w-full max-w-lg lg:block">
            <div className="absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-blue-400/20 to-orange-300/20 blur-2xl" />
            <div className="relative rounded-[2rem] border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-xl">
              <div className="rounded-[1.5rem] bg-white p-5 text-slate-900 shadow-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Hành trình của bạn</p>
                    <p className="mt-1 text-lg font-extrabold">Học tập chủ động</p>
                  </div>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-2xl">⭐</div>
                </div>
                <div className="mt-6 space-y-3">
                  {[['01', 'Xem bài học', 'Đúng thứ tự, đủ nội dung'], ['02', 'Hoàn thành quiz', 'Kiểm tra kiến thức vừa học'], ['03', 'Mở khóa chặng mới', 'Theo dõi tiến độ và phần thưởng']].map(([number, title, detail], index) => (
                    <div key={number} className="flex items-center gap-4 rounded-2xl border border-slate-100 p-3.5">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-extrabold ${index === 0 ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'}`}>{number}</span>
                      <div>
                        <p className="font-bold">{title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{detail}</p>
                      </div>
                      {index === 0 && <span className="ml-auto text-emerald-600">✓</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="absolute -bottom-5 -left-7 rounded-2xl border border-white/20 bg-[#172554] px-4 py-3 text-sm font-semibold text-white shadow-xl">
                ✨ Mỗi bước tiến đều được ghi nhận
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="featured-courses-title" className="border-b border-blue-50 bg-white py-14 sm:py-16">
        <div className="mx-auto mb-7 flex max-w-7xl flex-col gap-4 px-5 sm:flex-row sm:items-end sm:justify-between sm:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Bắt đầu khám phá</p>
            <h2 id="featured-courses-title" className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Khóa học nổi bật</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Những nội dung giúp bạn vững kiến thức và tự tin hơn trong hành trình cùng BBE.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/student/courses" className="text-sm font-bold text-blue-700 hover:text-blue-900">Tất cả khóa học <span aria-hidden="true">→</span></Link>
            {featuredCourses.length > 1 && (
              <div className="hidden gap-2 sm:flex">
                <button type="button" onClick={() => scrollCarousel(-1)} aria-label="Khóa học trước" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-lg text-slate-700 transition hover:border-blue-300 hover:bg-blue-50">←</button>
                <button type="button" onClick={() => scrollCarousel(1)} aria-label="Khóa học tiếp theo" className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-lg text-slate-700 transition hover:border-blue-300 hover:bg-blue-50">→</button>
              </div>
            )}
          </div>
        </div>

        {featuredCourses.length ? (
          <div
            ref={carouselRef}
            role="region"
            aria-label="Các khóa học nổi bật"
            onMouseEnter={() => setCarouselPaused(true)}
            onMouseLeave={() => setCarouselPaused(false)}
            onFocusCapture={() => setCarouselPaused(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCarouselPaused(false)
            }}
            className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-5 pb-5 [scrollbar-width:thin] sm:px-8"
          >
            {featuredCourses.map((course) => {
              const id = course.id || course.courseId
              if (!id) return null
              return (
                <Link
                  key={id}
                  href={`/student/courses/${id}`}
                  data-course-card
                  className="group w-[82vw] max-w-[340px] shrink-0 snap-start overflow-hidden rounded-3xl border border-slate-100 bg-[#f9faff] shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:w-[320px]"
                >
                  {course.coverUrl ? (
                    <img src={course.coverUrl} alt={`Ảnh bìa khóa học ${course.title}`} loading="lazy" className="h-44 w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                  ) : (
                    <div aria-hidden="true" className="grid h-44 place-items-center bg-gradient-to-br from-[#172554] via-blue-700 to-indigo-500 text-5xl text-white">📚</div>
                  )}
                  <div className="p-5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">{course.sessionCount || 0} buổi học</p>
                    <h3 className="mt-2 line-clamp-2 min-h-12 font-extrabold leading-6 text-[#172554]">{course.title}</h3>
                    <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-slate-500">{course.description || 'Khám phá nội dung đào tạo được thiết kế cho hành trình phát triển của bạn.'}</p>
                    <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700">Khám phá ngay <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span></span>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="mx-auto max-w-7xl px-5 text-sm text-slate-500 sm:px-8">Các khóa học nổi bật sẽ được cập nhật sớm. <Link href="/student/courses" className="font-semibold text-blue-700">Khám phá danh mục →</Link></div>
        )}
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Học hiệu quả hơn</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">Một lộ trình rõ ràng, dễ theo dõi</h2>
          <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">Tập trung vào điều cần học, biết mình đang ở đâu và có động lực để đi tiếp.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { icon: '📖', title: 'Nội dung tập trung', detail: 'Video và tài liệu được sắp xếp theo từng khóa học, module và bài học.' },
            { icon: '🎯', title: 'Tiến độ minh bạch', detail: 'Hoàn thành bài học, vượt qua quiz và mở khóa nội dung theo đúng lộ trình.' },
            { icon: '⭐', title: 'Nỗ lực được ghi nhận', detail: 'Nhận Star khi học tập và xem lại hành trình tiến bộ của chính mình.' },
          ].map((feature) => (
            <article key={feature.title} className="rounded-3xl border border-blue-50 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-lg sm:p-8">
              <div aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-3xl">{feature.icon}</div>
              <h3 className="mt-6 text-lg font-extrabold">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{feature.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="px-5 pb-16 sm:px-8 sm:pb-20">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-7 rounded-[2rem] bg-gradient-to-r from-[#172554] to-blue-700 p-7 text-white shadow-xl shadow-blue-950/10 sm:p-10 md:flex-row md:items-center">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-200">Sẵn sàng bắt đầu?</p>
            <h2 className="mt-3 text-2xl font-extrabold sm:text-3xl">Chọn khóa học phù hợp với bạn.</h2>
            <p className="mt-3 text-sm leading-6 text-blue-100">Bắt đầu từ một bài học nhỏ và tiến từng bước trên hành trình của mình.</p>
          </div>
          <Link href="/login" className="shrink-0">
            <Button size="lg" className="w-full justify-center !bg-white px-6 font-bold !text-blue-800 hover:!bg-blue-50 sm:w-auto">
              Khám phá ngay <span aria-hidden="true" className="ml-2">→</span>
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#101f49] px-5 py-8 text-blue-100 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
          <div className="flex items-center gap-3">
            <img src="/images/logo-transparent.png" alt="BBE" className="h-7 w-auto" />
            <span className="text-xs font-semibold">© BBE E-Learning Platform</span>
          </div>
          <p className="text-xs text-blue-200/80">Học tập, phát triển và cùng nhau tiến xa hơn.</p>
        </div>
      </footer>
    </main>
  )
}
