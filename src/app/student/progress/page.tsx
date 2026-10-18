'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function StudentProgressRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/student/courses');
  }, [router]);

  return (
    <div className="flex items-center justify-center py-20 text-slate-400">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-3"></div>
      <span className="text-xs font-medium">Đang chuyển tiếp tới Danh mục & Tiến độ khóa học...</span>
    </div>
  );
}
