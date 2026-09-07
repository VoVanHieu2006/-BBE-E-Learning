'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { apiFetch } from '@/lib/api/client';

interface InviteInfo {
  email: string;
  role: string;
  chapterName: string;
  expiresAt: string;
}

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const [mounted, setMounted] = useState(false);
  const [validating, setValidating] = useState(true);
  const [invalidReason, setInvalidReason] = useState('');
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);

  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!token) {
      setValidating(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await apiFetch(`/api/v1/invitations/validate?token=${encodeURIComponent(token)}`, { noCache: true });
      if (cancelled) return;
      if (res.ok && res.data?.valid) {
        setInviteInfo(res.data as InviteInfo);
      } else {
        setInvalidReason(res.error?.message || 'Liên kết lời mời không hợp lệ.');
      }
      setValidating(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, token]);

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
      setInvalidReason(res.error?.message || 'Liên kết lời mời không hợp lệ.');
      setInviteInfo(null);
    }
    setLoading(false);
  };

  if (!mounted || validating) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-lg text-center py-10">
        <div className="w-8 h-8 border-[3px] border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-[#737686]">Đang xác thực thông tin lời mời...</p>
      </div>
    );
  }

  if (!token || invalidReason) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-lg text-center py-10 space-y-4">
        <div className="w-14 h-14 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-center mx-auto text-2xl">
          ✕
        </div>
        <div>
          <h2 className="text-lg font-bold text-[#172554]">Lời mời không khả dụng</h2>
          <p className="text-sm text-[#737686] mt-2">{invalidReason || 'Liên kết lời mời không hợp lệ (thiếu token).'}</p>
          <p className="text-xs text-[#737686] mt-1">
            Vui lòng liên hệ người gửi để nhận liên kết mời mới.
          </p>
        </div>
        <Link href="/login">
          <Button variant="outline">Về trang đăng nhập</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-lg">
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm mb-5">
          {success}
        </div>
      )}

      {inviteInfo && (
        <div className="bg-[#eff4ff] border border-[#cbdbf5] text-[#172554] px-4 py-3 rounded-xl text-sm mb-5">
          Lời mời cho <strong>{inviteInfo.email}</strong>
          {inviteInfo.role === 'CHAPTER_LEADER' ? ' với vai trò Ban Định Hướng' : ' với vai trò Thành viên học tập'}
          {' — Chapter '}
          <strong>{inviteInfo.chapterName}</strong>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {error}
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
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <main className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src="/images/logo-white.png"
            alt="BBE E-Learning"
            className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#2563EB] object-contain p-2 shadow-lg"
          />
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
