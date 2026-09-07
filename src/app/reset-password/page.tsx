'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [mounted, setMounted] = useState(false);

  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    setMounted(true);
    if (!token) {
      setError('Link không hợp lệ. Vui lòng yêu cầu đặt lại mật khẩu mới.');
      setStatus('error');
    }
  }, [token]);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9ff]">
        <div className="w-8 h-8 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.newPassword.length < 8) {
      setError('Mật khẩu phải có ít nhất 8 ký tự.');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setStatus('loading');
    setError('');

    try {
      const res = await fetch('/api/v1/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          newPassword: form.newPassword,
          confirmPassword: form.confirmPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error?.message || 'Link đã hết hạn hoặc đã sử dụng. Vui lòng yêu cầu lại.');
        setStatus('error');
        return;
      }

      // Issue #9: logout any existing session so user must log in fresh
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');

      setStatus('success');
    } catch {
      setError('Lỗi kết nối. Vui lòng thử lại.');
      setStatus('idle');
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-[#2563EB] rounded-2xl flex items-center justify-center text-white font-bold text-3xl mx-auto mb-4 shadow-lg">
            B
          </div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Đặt lại mật khẩu
          </h1>
          <p className="text-[#737686] mt-1 text-sm">Nhập mật khẩu mới cho tài khoản của bạn</p>
        </div>

        <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-xl">
          {status === 'success' ? (
            <div className="text-center space-y-4 py-4">
              <div className="text-5xl">✅</div>
              <h2 className="text-xl font-bold text-[#172554]">Đặt lại mật khẩu thành công!</h2>
              <p className="text-sm text-[#434655]">Bạn có thể đăng nhập bằng mật khẩu mới ngay bây giờ.</p>
              <Button onClick={() => router.replace('/login')} className="w-full mt-2">
                Đăng nhập ngay →
              </Button>
            </div>
          ) : status === 'error' && !form.newPassword ? (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
                <span className="shrink-0">⚠️</span>
                <span>{error}</span>
              </div>
              <Link href="/forgot-password">
                <Button variant="secondary" className="w-full">Yêu cầu link mới</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
                  <span className="shrink-0">⚠️</span>
                  <span>{error}</span>
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-[#172554] mb-1.5">Mật khẩu mới</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={form.newPassword}
                    onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                    className="w-full px-4 py-3 border border-[#cbdbf5] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB] transition pr-12 text-sm"
                    placeholder="Tối thiểu 8 ký tự"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#737686] text-lg"
                  >
                    {showPw ? '👁️' : '🙈'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#172554] mb-1.5">Xác nhận mật khẩu</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                  className="w-full px-4 py-3 border border-[#cbdbf5] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB] transition text-sm"
                  placeholder="Nhập lại mật khẩu"
                />
              </div>
              <div className="pt-2">
                <Button type="submit" disabled={status === 'loading'} className="w-full py-3.5">
                  {status === 'loading' ? 'Đang xử lý...' : 'Xác nhận mật khẩu mới'}
                </Button>
              </div>
            </form>
          )}
          <div className="mt-5 text-center">
            <Link href="/login" className="text-sm text-[#2563EB] hover:underline font-medium">← Quay lại đăng nhập</Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9ff]">
        <div className="w-8 h-8 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
