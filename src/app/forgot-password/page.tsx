'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/v1/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Không thể gửi yêu cầu. Vui lòng thử lại.');
        return;
      }
      if (data.sent === false) {
        setError(`Không tìm thấy email ${email} trong hệ thống. Vui lòng kiểm tra lại.`);
        return;
      }
      setSubmitted(true);
      setEmailSent(true);
    } catch {
      setError('Lỗi kết nối. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#2563EB] rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4 shadow-lg">B</div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: "'Be Vietnam Pro', 'Inter', sans-serif" }}>Quên mật khẩu</h1>
          <p className="text-[#737686] mt-1">Nhập email để nhận liên kết đặt lại</p>
        </div>
        <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-lg">
          {submitted ? (
            <div className="text-center py-6">
              <div className="text-5xl mb-4">✉️</div>
              <h2 className="text-xl font-bold text-[#172554] mb-2">Đã gửi email</h2>
              <p className="text-[#434655]">Nếu email tồn tại trong hệ thống, link đặt lại mật khẩu đã được gửi đến {email}. Vui lòng kiểm tra hộp thư (bao gồm thư mục Spam).</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-[#172554] mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-[#cbdbf5] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent transition"
                  placeholder="email@bbelearning.com"
                />
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading} className="w-full py-3.5 bg-[#F97316] hover:bg-[#ea580c] text-white font-semibold rounded-xl shadow-md transition-colors disabled:opacity-50">
                {loading ? 'Đang gửi...' : 'Gửi link đặt lại'}
              </button>
            </form>
          )}
          <div className="mt-6 text-center">
            <Link href="/login" className="text-sm text-[#2563EB] hover:underline font-medium">← Quay lại đăng nhập</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
