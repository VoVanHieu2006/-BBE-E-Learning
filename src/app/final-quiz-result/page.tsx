'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch } from '@/lib/api/client';

function QuizResultContent() {
  const searchParams = useSearchParams();
  const attemptId = searchParams.get('attemptId');
  const [mounted, setMounted] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setMounted(true);
    if (attemptId) {
      loadResult(attemptId);
    } else {
      setLoading(false);
      setError('Thiếu mã lượt làm bài (attemptId).');
    }
  }, [attemptId]);

  async function loadResult(id: string) {
    setLoading(true);
    const res = await apiFetch(`/api/v1/attempts/${id}`);
    if (res.ok && res.data) {
      setResult(res.data);
    } else {
      setError(res.error?.message || 'Không thể tải kết quả bài kiểm tra.');
    }
    setLoading(false);
  }

  if (!mounted || loading) {
    return <div className="text-center py-20 text-[#737686]">Đang tải kết quả bài kiểm tra...</div>;
  }

  if (error || !result) {
    return (
      <Card className="text-center py-12 space-y-4">
        <p className="text-lg font-semibold text-red-600">{error || 'Không tìm thấy kết quả.'}</p>
        <Link href="/student/courses">
          <Button variant="outline">Quay lại khóa học</Button>
        </Link>
      </Card>
    );
  }

  const scorePercent = Math.round(Number(result.score || 0));
  const passed = result.passed;

  return (
    <div className="space-y-6">
      <Card shadow="lg" className="p-8 text-center space-y-6">
        <div className="w-20 h-20 mx-auto rounded-full flex items-center justify-center text-4xl shadow-inner bg-gradient-to-br from-[#eff4ff] to-[#dce9ff]">
          {passed ? '🎉' : '📖'}
        </div>

        <div>
          <h2 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            {passed ? 'Chúc mừng bạn đã vượt qua!' : 'Chưa đạt yêu cầu hoàn thành'}
          </h2>
          <p className="text-sm text-[#737686] mt-1">
            {passed
              ? 'Bạn đã hoàn thành bài kiểm tra cuối khóa xuất sắc.'
              : 'Bạn cần đạt tối thiểu 85% điểm số để hoàn thành khóa học.'}
          </p>
        </div>

        <div className="py-4">
          <div className={`text-6xl font-extrabold ${passed ? 'text-green-600' : 'text-red-500'}`}>
            {scorePercent}%
          </div>
          <span
            className={`inline-block mt-3 px-4 py-1.5 rounded-full text-sm font-bold ${
              passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {passed ? '✓ ĐÃ ĐẠT (PASSED)' : '✗ CHƯA ĐẠT (FAILED)'}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap justify-center gap-4 pt-4 border-t border-[#eff4ff]">
          <Link href="/student/progress">
            <Button variant="secondary">Xem tiến độ học tập</Button>
          </Link>
          <Link href="/student/courses">
            <Button>Danh mục khóa học</Button>
          </Link>
        </div>
      </Card>

      {/* Answers Breakdown */}
      {result.answers && result.answers.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-bold text-[#172554] mb-4" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Chi tiết kết quả các câu hỏi
          </h3>
          <div className="space-y-3">
            {result.answers.map((a: any, idx: number) => (
              <div
                key={a.questionId || idx}
                className={`p-4 rounded-xl border ${
                  a.isCorrect
                    ? 'bg-green-50/50 border-green-200'
                    : 'bg-red-50/50 border-red-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-sm text-[#172554]">
                    <span>{a.isCorrect ? '✅' : '❌'}</span>
                    <span>Câu hỏi {idx + 1}</span>
                  </div>
                  <span className={`text-xs font-bold ${a.isCorrect ? 'text-green-700' : 'text-red-700'}`}>
                    {a.isCorrect ? 'Trả lời đúng' : 'Trả lời sai'}
                  </span>
                </div>
                {passed && a.explanation && (
                  <p className="text-xs text-[#737686] mt-2 pt-2 border-t border-green-100">
                    💡 {a.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function FinalQuizResultPage() {
  return (
    <main className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-6">
      <div className="max-w-2xl w-full">
        <Suspense fallback={<div className="text-center text-[#737686]">Đang tải...</div>}>
          <QuizResultContent />
        </Suspense>
      </div>
    </main>
  );
}
