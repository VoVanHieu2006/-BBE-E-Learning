'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { apiFetch } from '@/lib/api/client';

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const [mounted, setMounted] = useState(false);

  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-lg text-center py-10">
        <div className="w-8 h-8 border-3 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-[#737686]">Đang xác thực thông tin lời mời...</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('Mã mời không hợp lệ hoặc thiếu token.');
      return;
    }

    if (form.password.length < 8) {
      setError('Mật khẩu phải từ 8 ký tự trở lên.');
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setLoading(true);
    setError('');

    const res = await apiFetch('/api/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({
        token,
        password: form.password,
        confirmPassword: form.confirmPassword,
      }),
    });

    if (res.ok) {
      setSuccess('Kích hoạt tài khoản thành công! Đang chuyển đến trang đăng nhập...');
      setTimeout(() => {
        router.push('/login');
      }, 1500);
    } else {
      setError(res.error?.message || 'Không thể kích hoạt tài khoản. Lời mời có thể đã hết hạn.');
    }
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-lg">
      {!token ? (
        <div className="text-center py-6 space-y-4">
          <p className="text-red-600 font-semibold">Liên kết lời mời không hợp lệ (thiếu token).</p>
          <Link href="/login">
            <Button variant="outline">Về trang đăng nhập</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm">
              {success}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-[#172554] mb-1.5">
              Tạo mật khẩu mới (tối thiểu 8 ký tự) *
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full px-4 py-3 border border-[#cbdbf5] rounded-xl text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#172554] mb-1.5">
              Xác nhận lại mật khẩu *
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              className="w-full px-4 py-3 border border-[#cbdbf5] rounded-xl text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              placeholder="••••••••"
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full py-3.5">
            {loading ? 'Đang kích hoạt...' : 'Kích hoạt tài khoản & Đăng nhập'}
          </Button>

          <div className="text-center pt-2">
            <Link href="/login" className="text-sm text-[#2563EB] hover:underline">
              ← Đã có tài khoản? Đăng nhập ngay
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <main className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#2563EB] rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4 shadow-lg">
            B
          </div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Kích hoạt tài khoản
          </h1>
          <p className="text-[#737686] mt-1">Chào mừng bạn đến với BBE E-Learning</p>
        </div>
        <Suspense fallback={<div className="text-center text-[#737686]">Đang tải...</div>}>
          <AcceptInvitationContent />
        </Suspense>
      </div>
    </main>
  );
}
