'use client';
import Sidebar from '@/components/layout/Sidebar';
import ContentTransition from '@/components/layout/ContentTransition';
import { consumePilotNavigation, deactivatePilotScope, getApiSessionKey, getTabSnapshot, getVerifiedPilotUser, revokeApiSession, saveTabSnapshot, verifyPilotSession } from '@/lib/api/client';
import { useEffect, useLayoutEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import pilot from './pilot.module.css';
import { PilotVisibility } from '@/components/layout/PilotVisibility';

export default function ChapterManagerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [authorized, setAuthorized] = useState(false);
  const [scopeKey, setScopeKey] = useState('');
  const [authorizedPath,setAuthorizedPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => () => deactivatePilotScope(), []);
  useLayoutEffect(() => {
    let live = true;
    let checking = false;
    let checkAgain = false;
    const verify = async () => {
      if (checking) { checkAgain = true; return; }
      checking = true;
      setAuthorized(false);
      setError(null);
      const result = await verifyPilotSession();
      checking = false;
      if (!live) return;
      if(checkAgain){checkAgain=false;void verify();return;}
      if (result.ok) {
        setUser(result.data.user);
        setScopeKey(getApiSessionKey());
        setAuthorizedPath(pathname);
        setAuthorized(true);
      } else if (result.status === 401 || result.status === 403) {
        setUser(null);
        router.replace('/login?callbackUrl=' + encodeURIComponent(pathname));
      } else {
        setError('Chưa xác minh được phiên. Vui lòng kiểm tra kết nối và thử lại.');
      }
    };
    const foreground = () => { if (document.visibilityState === 'visible') void verify(); };
    const revoked = () => { setAuthorized(false); setUser(null); setError('Phiên hoặc quyền truy cập đã thay đổi. Vui lòng xác minh lại.'); };
    const scopeChanged = () => { setAuthorized(false);setUser(null);void verify(); };
    const storage = (event: StorageEvent) => {
      if (!event.key || ['accessToken','user','refreshToken'].includes(event.key)) { revokeApiSession(); void verify(); }
    };
    if(consumePilotNavigation(pathname)){
      setUser(getVerifiedPilotUser());setScopeKey(getApiSessionKey());setAuthorizedPath(pathname);setAuthorized(true);setError(null);
    }else void verify();
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('pageshow', foreground);
    window.addEventListener('storage', storage);
    window.addEventListener('bbe:session-revoked', revoked);
    window.addEventListener('bbe:scope-changed',scopeChanged);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('pageshow', foreground);
      window.removeEventListener('storage', storage);
      window.removeEventListener('bbe:session-revoked', revoked);
      window.removeEventListener('bbe:scope-changed',scopeChanged);
    };
  }, [pathname, router, retry]);
  useEffect(() => {
    if (!authorized) return;
    const scope = getApiSessionKey();
    const snapshot = getTabSnapshot<{scroll:number}>(`scroll:${pathname}`);
    const frame = requestAnimationFrame(() => { if (snapshot) window.scrollTo(0,snapshot.scroll); });
    const save = () => { if (scope === getApiSessionKey()) saveTabSnapshot(`scroll:${pathname}`,{scroll:window.scrollY}); };
    window.addEventListener('scroll',save,{passive:true});
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll',save); save(); };
  },[authorized,pathname]);
  return (
    <div className="min-h-screen bg-[#f8f9ff] flex">
      <Sidebar role="CHAPTER_LEADER" user={{ email:user?.email, chapterName:user?.chapterName, canManageMembers:user?.canManageMembers }} />
      <main className="relative md:ml-64 flex-1 px-4 pb-8 pt-20 md:px-8 md:py-10 w-full min-w-0">
        {authorized && user?.managedChapters?.length > 1 && (
          <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
            <label htmlFor="managed-chapter" className="text-xs font-semibold text-[#596174]">Đang quản lý Chapter</label>
            <select id="managed-chapter" value={user.chapterId || ''} onChange={(event) => {
              const chapter = user.managedChapters.find((item: any) => item.id === event.target.value);
              if (!chapter) return;
              localStorage.setItem('user',JSON.stringify({...user,chapterId:chapter.id,chapterName:chapter.name,canManageMembers:chapter.canManageMembers}));
              window.location.reload();
            }} className="rounded-lg border border-[#cbdbf5] bg-white px-3 py-2 text-sm font-semibold text-[#172554]">
              {user.managedChapters.map((chapter: any) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}
            </select>
          </div>
        )}
        {user && authorizedPath===pathname && <PilotVisibility.Provider value={authorized}><div ref={node=>{if(node)node.inert=!authorized;}} style={{visibility:authorized?'visible':'hidden'}} aria-hidden={!authorized}><ContentTransition key={scopeKey} className={pilot.route}>{children}</ContentTransition></div></PilotVisibility.Provider>}
        {(!authorized || authorizedPath!==pathname) && <div role="status" className="absolute inset-x-4 top-20 z-10 min-h-48 rounded-xl border border-[#cbdbf5] bg-white p-6 text-[#172554] md:inset-x-8 md:top-10">{error || 'Đang xác minh phiên…'}{error && <button type="button" onClick={()=>setRetry(value=>value+1)} className="ml-3 rounded-lg border px-3 py-2">Thử lại</button>}</div>}
      </main>
    </div>
  );
}
