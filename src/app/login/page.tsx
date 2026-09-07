'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If already logged in, redirect away
    const raw = localStorage.getItem('user');
    const token = localStorage.getItem('accessToken');
    if (raw && token) {
      try {
        const u = JSON.parse(raw);
        if (u.role === 'ADMIN') router.replace('/admin/dashboard');
        else if (u.role === 'CHAPTER_LEADER') router.replace('/chapter-manager/dashboard');
        else router.replace('/student/dashboard');
      } catch {
        localStorage.removeItem('user');
        localStorage.removeItem('accessToken');
      }
    }
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.trim(), password: form.password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          res.status === 423
            ? 'Tài khoản bị tạm khóa do đăng nhập sai quá nhiều lần. Vui lòng dùng tính năng quên mật khẩu.'
            : data.error?.message || 'Tài khoản hoặc mật khẩu không đúng.'
        );
        setLoading(false);
        return;
      }

      if (data.accessToken && data.user) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken || '');
        localStorage.setItem('user', JSON.stringify(data.user));

        const role = data.user.role;
        if (role === 'ADMIN') router.replace('/admin/dashboard');
        else if (role === 'CHAPTER_LEADER') router.replace('/chapter-manager/dashboard');
        else router.replace('/student/dashboard');
      } else {
        setError('Phản hồi từ máy chủ không hợp lệ.');
      }
    } catch (err: any) {
      setError('Lỗi kết nối: ' + (err.message || 'Không thể kết nối tới máy chủ'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f9ff] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Official Logo */}
        <div className="text-center">
          <img
            src="/images/logo-white.png"
            alt="BBE Logo"
            className="h-20 w-auto object-contain mx-auto mb-3 rounded-2xl shadow-md border border-[#eff4ff]"
          />
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Đăng nhập
          </h1>
          <p className="text-[#737686] mt-1 text-sm">Hệ thống đào tạo trực tuyến BBE E-Learning</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-xl space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
              <span className="shrink-0 mt-0.5">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1.5">Địa chỉ Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-3 bg-white border border-[#cbdbf5] rounded-xl text-[#0b1c30] placeholder-[#737686] focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent transition text-sm"
                placeholder="email@bbelearning.com"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-sm font-semibold text-[#172554]">Mật khẩu</label>
                <Link href="/forgot-password" className="text-xs text-[#2563EB] hover:underline font-semibold">
                  Quên mật khẩu?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full px-4 py-3 bg-white border border-[#cbdbf5] rounded-xl text-[#0b1c30] placeholder-[#737686] focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent transition pr-12 text-sm"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737686] hover:text-[#2563EB] p-1.5 rounded-lg transition text-lg"
                >
                  {showPassword ? '👁️' : '🔒'}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={loading} className="w-full py-3.5 shadow-md">
                {loading ? 'Đang xác thực...' : 'Đăng nhập vào hệ thống →'}
              </Button>
            </div>
          </form>
        </div>

        <div className="text-center space-y-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-[#737686] hover:text-[#2563EB] transition font-semibold"
          >
            ← Quay lại trang chủ
          </Link>
          <p className="text-xs text-[#94a3b8]">
            Chưa có tài khoản? Liên hệ BĐHU Chapter của bạn để nhận lời mời.
          </p>
        </div>
      </div>
    </main>
  );
}
