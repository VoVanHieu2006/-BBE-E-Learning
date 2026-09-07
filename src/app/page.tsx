'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Button from '@/components/ui/Button';

export default function LandingPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const rawUser = localStorage.getItem('user');
      const token = localStorage.getItem('accessToken');
      if (rawUser && token) {
        try {
          const u = JSON.parse(rawUser);
          setUser(u);
          const target =
            u.role === 'ADMIN'
              ? '/admin/dashboard'
              : u.role === 'CHAPTER_LEADER'
              ? '/chapter-manager/dashboard'
              : '/student/dashboard';
          router.replace(target);
          return;
        } catch {}
      }
    }
    setMounted(true);
  }, [router]);

  const getDashboardHref = () => {
    if (!user) return '/login';
    if (user.role === 'ADMIN') return '/admin/dashboard';
    if (user.role === 'CHAPTER_LEADER') return '/chapter-manager/dashboard';
    return '/student/dashboard';
  };

  const getDashboardLabel = () => {
    if (!user) return 'Đăng nhập ngay →';
    if (user.role === 'ADMIN') return 'Quay lại Dashboard Quản Trị →';
    if (user.role === 'CHAPTER_LEADER') return 'Quay lại Dashboard Chapter →';
    return 'Quay lại Bàn Học Của Bạn →';
  };

  const isLoggedIn = mounted && Boolean(user);

  // If checking authentication or logged in, show clean transitional screen to prevent guest flash (Request 3)
  if (!mounted || user) {
    return (
      <main className="min-h-screen bg-[#172554] flex flex-col items-center justify-center p-6 text-white text-center">
        <div className="w-12 h-12 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-300 font-medium">Đang chuyển tiếp tới Bàn làm việc...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8f9ff] flex flex-col">
      {/* Top Navbar */}
      <header className="bg-white/95 backdrop-blur-md border-b border-[#e5eeff] sticky top-0 z-50 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <img
              src="/images/logo-transparent.png"
              alt="BBE Learning Hub"
              className="h-10 w-auto object-contain"
            />
          </Link>

          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <Link href={getDashboardHref()}>
                <Button size="sm" variant="secondary" className="shadow-sm">
                  ⚡ Quay lại Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/student/courses" className="text-sm font-semibold text-[#172554] hover:text-[#2563EB] transition px-3 py-2">
                  Khám phá khóa học
                </Link>
                <Link href="/leaderboard" className="text-sm font-semibold text-[#172554] hover:text-[#2563EB] transition px-3 py-2">
                  Bảng xếp hạng
                </Link>
                <Link href="/login">
                  <Button size="sm">Đăng nhập</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section with Official Colors: Navy #172554, Blue #2563EB, Orange #F97316 */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#172554] via-[#0b1c30] to-[#2563EB] text-white py-24 md:py-32 px-6">
        <div className="absolute inset-0 opacity-15 pointer-events-none">
          <svg viewBox="0 0 1440 600" preserveAspectRatio="none" className="w-full h-full">
            <circle cx="1200" cy="100" r="350" fill="#F97316" />
            <circle cx="150" cy="500" r="250" fill="#2563EB" />
          </svg>
        </div>
        <div className="relative max-w-5xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-xs font-semibold text-[#cbdbf5] mb-2">
            ✨ Nền tảng đào tạo nội bộ câu lạc bộ BBE
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Học tập chuyên sâu <br />
            <span className="text-[#F97316]">Nâng tầm kỹ năng cùng BBE</span>
          </h1>
          <p className="text-lg md:text-xl text-[#cbdbf5] max-w-2xl mx-auto leading-relaxed">
            Hệ thống quản lý học tập tích hợp video bài giảng chống tua gian lận, tài liệu chuyên sâu, bài kiểm tra chuẩn đầu ra và thống kê tiến độ đa thiết bị.
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-4">
            {isLoggedIn ? (
              <Link href={getDashboardHref()}>
                <Button size="lg" className="shadow-xl py-4 px-8 text-base">
                  {getDashboardLabel()}
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button size="lg" className="shadow-lg">
                    Đăng nhập để học ngay →
                  </Button>
                </Link>
                <Link href="/student/courses">
                  <Button variant="outline" size="lg" className="bg-white/10 text-white border-white/30 hover:bg-white/20">
                    Khám phá khóa học công khai
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Feature Highlights */}
      <section className="max-w-6xl mx-auto py-20 px-6 flex-1">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold text-[#172554] mb-3" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Trải nghiệm học tập hiện đại
          </h2>
          <p className="text-[#737686] max-w-xl mx-auto text-sm">
            Được xây dựng dựa trên tiêu chuẩn Stitch Design System mang lại trải nghiệm mượt mà, tiện lợi.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: '📚',
              title: 'Khóa học chuyên sâu',
              desc: 'Hệ thống video chất lượng cao từ YouTube, tài liệu lưu trữ đám mây Cloudflare R2 và lộ trình bài giảng bài bản.',
            },
            {
              icon: '⏱️',
              title: 'Đồng bộ tiến độ chuẩn xác',
              desc: 'Tự động lưu vị trí video đang xem theo thời gian thực, chống tua gian lận và đánh dấu hoàn thành khi đạt ≥ 85%.',
            },
            {
              icon: '👥',
              title: 'Bảng điều khiển BĐHU & Admin',
              desc: 'Quản lý toàn diện theo từng Chapter: theo dõi tiến độ từng học viên, gửi lời mời tự động qua email và bài kiểm tra cuối khóa.',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
            >
              <div className="w-14 h-14 rounded-2xl bg-[#eff4ff] flex items-center justify-center text-3xl mb-6">
                {f.icon}
              </div>
              <h3 className="text-xl font-bold text-[#172554] mb-3" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                {f.title}
              </h3>
              <p className="text-sm text-[#434655] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#172554] text-white py-10 px-6 text-center text-sm text-[#cbdbf5] border-t border-[#1e3a8a]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/images/logo-transparent.png" alt="BBE" className="h-6 w-auto brightness-200" />
            <span className="font-semibold text-xs">© BBE E-Learning Platform</span>
          </div>
          <div className="text-xs text-[#94a3b8]">Thiết kế dựa trên Stitch Design System • Next.js 14 App Router</div>
        </div>
      </footer>
    </main>
  );
}
