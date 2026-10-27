'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApiQuery } from '@/lib/api/use-api-query';
import { getVerifiedPilotUser, preparePilotNavigation } from '@/lib/api/client';
import pilot from '../pilot.module.css';

export default function ChapterManagerDashboard() {
  const router=useRouter();
  const [user]=useState<any>(()=>getVerifiedPilotUser());
  const [navigationError,setNavigationError]=useState<string|null>(null);
  const membersQuery=useApiQuery(user?.chapterId ? `/api/v1/chapters/${user.chapterId}/dashboard/members` : null);
  const coursesQuery=useApiQuery(user?.chapterId ? `/api/v1/chapters/${user.chapterId}/dashboard/courses` : null);
  const membersData=membersQuery.data, coursesData=coursesQuery.data;
  const loading=!user || membersQuery.status==='loading' || coursesQuery.status==='loading';
  const refreshing=membersQuery.refreshing || coursesQuery.refreshing;
  const summary=membersData?.summary;
  const totalMembers=summary?.totalMembers ?? membersData?.totalItems ?? (loading ? '…' : 0);
  const totalCourses=coursesData?.totalItems ?? (loading ? '…' : 0);
  const avgProgress=summary?.avgChapterProgress ?? 0;
  const totalStars=summary?.totalStars ?? (loading ? '…' : 0);
  const membersOver70=summary?.membersOver70 ?? 0;
  const syncTime=membersQuery.updatedAt && coursesQuery.updatedAt ? Math.min(membersQuery.updatedAt,coursesQuery.updatedAt) : null;
  const metrics=[
    {label:'Thành viên Chapter',value:totalMembers,note:'Toàn bộ Chapter'},
    {label:'Khóa học Published',value:totalCourses,note:'Chương trình đào tạo'},
    {label:'Tiến độ TB Chapter',value:`${avgProgress}%`,note:'Tất cả các khóa học',tone:pilot.blue},
    {label:'Tổng Star Chapter',value:totalStars,note:'Học tập & Quiz tích lũy',tone:pilot.orange},
    {label:'Đạt tiến độ ≥ 70%',value:<>{membersOver70}<small> / {totalMembers}</small></>,note:`${Number(totalMembers)>0 ? Math.round((Number(membersOver70)/Number(totalMembers))*100) : 0}% thành viên`},
  ];
  return (
    <div className={pilot.pilot}>
      <header className={pilot.header}>
        <div><h1>Dashboard Lead Chapter</h1><p className={pilot.description}>Theo dõi tiến độ học tập và quản lý học viên trong Chapter trực thuộc.</p><p className={pilot.scope}>{user?.chapterName || 'Chapter của bạn'}</p></div>
        <button type="button" className={pilot.refresh} disabled={refreshing} aria-busy={refreshing} onClick={()=>void Promise.all([membersQuery.refresh(),coursesQuery.refresh()])}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></svg>
          {refreshing?'Đang làm mới…':'Làm mới'}
        </button>
      </header>
      <div className={pilot.sync} role="status" aria-live="polite">{syncTime ? <>Đồng bộ thành công cả hai nguồn: {new Intl.DateTimeFormat('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(syncTime)}</> : 'Đang tải dữ liệu Chapter…'}</div>
      {(membersQuery.error || coursesQuery.error) && <p role="alert" className={pilot.error}>Chưa cập nhật được {membersQuery.error?'thành viên':''}{membersQuery.error && coursesQuery.error?' và ':''}{coursesQuery.error?'khóa học':''}. Dữ liệu đã tải được giữ lại. Vui lòng thử Làm mới.</p>}
      {navigationError && <p role="alert" className={pilot.error}>{navigationError}</p>}
      <dl className={pilot.metrics} aria-busy={loading}>
        {metrics.map(metric=><div key={metric.label} className={pilot.metric}><dt>{metric.label}</dt><dd className={metric.tone}>{metric.value}</dd><dd className={pilot.metricNote}>{metric.note}</dd></div>)}
      </dl>
      <div className={pilot.destinations}>
        {[
          {href:'/chapter-manager/members',title:'Quản lý thành viên & Tiến trình',text:'Mời thành viên mới vào Chapter, theo dõi tiến độ từng học viên, khóa hoặc mở khóa tài khoản.',action:'Xem thành viên'},
          {href:'/chapter-manager/courses',title:'Thống kê khóa học',text:'Xem tỷ lệ hoàn thành từng khóa học của các học viên trong Chapter.',action:'Xem khóa học'},
        ].map(item=><Link key={item.href} href={item.href} className={pilot.destination} onClick={async event=>{
          if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
          event.preventDefault();const result=await preparePilotNavigation(item.href);
          if(result.ok)router.push(item.href);else {window.dispatchEvent(new Event('bbe:navigation-cancelled'));setNavigationError('Chưa xác minh được phiên. Vui lòng thử lại.');}
        }}><h2>{item.title}</h2><p>{item.text}</p><span>{item.action}<span aria-hidden="true"> →</span></span></Link>)}
      </div>
    </div>
  );
}
