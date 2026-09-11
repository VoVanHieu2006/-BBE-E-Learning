'use client';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

export default function StudentQuizPage({ params }: { params: { courseId: string } }) {
  return (
    <div className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-4">
      <Card className="max-w-lg w-full text-center p-8 space-y-6 shadow-xl border border-blue-100">
        <div className="w-16 h-16 bg-blue-50 text-[#2563EB] rounded-2xl flex items-center justify-center text-3xl mx-auto shadow-inner">
          📝
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Bài kiểm tra theo từng bài học
          </h1>
          <p className="text-sm text-[#434655] leading-relaxed">
            Hệ thống đã nâng cấp sang mô hình làm bài kiểm tra tích hợp trực tiếp trong mỗi video bài học. Sau khi học xong mỗi bài giảng, bạn sẽ làm bài kiểm tra ngay bên cạnh video để hoàn thành bài và mở khóa bài tiếp theo.
          </p>
        </div>

        <div className="pt-2">
          <Link href={`/student/courses/${params.courseId}`}>
            <Button size="lg" className="w-full shadow-md">
              ← Trở về danh sách bài học
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
