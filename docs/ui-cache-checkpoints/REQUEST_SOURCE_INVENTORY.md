# Request / lifecycle source inventory

Generated from HEAD cf88238 plus unchanged runtime working files, 2026-10-27.
This is a textual call-site inventory, not an execution trace. Includes shared components and all role pages. Guest/public pages appear in the route list below; indirect request helpers require separate review before migration.

## Route inventory

- `/accept-invitation`
- `/admin/chapters`
- `/admin/courses/[courseId]/edit`
- `/admin/courses/mandatory`
- `/admin/courses/new`
- `/admin/courses`
- `/admin/dashboard`
- `/admin/invitations`
- `/admin/learning-policy`
- `/admin/organization`
- `/admin/users/[userId]/organization-history`
- `/admin/users`
- `/chapter-manager/courses`
- `/chapter-manager/dashboard`
- `/chapter-manager/invitations`
- `/chapter-manager/leaderboard`
- `/chapter-manager/members/[userId]`
- `/chapter-manager/members`
- `/chapter-manager/term-transition`
- `/final-quiz-result`
- `/forgot-password`
- `/invitations/accept`
- `/leaderboard`
- `/lessons/[lessonId]`
- `/login`
- `/organization-manager/courses`
- `/organization-manager/dashboard`
- `/organization-manager/invitations`
- `/organization-manager/leaderboard`
- `/organization-manager`
- `/organization-manager/units/[unitId]/members/[userId]`
- `/`
- `/reset-password`
- `/student/courses/[courseId]`
- `/student/courses/[courseId]/quiz`
- `/student/courses`
- `/student/dashboard`
- `/student/leaderboard`
- `/student/learning/[lessonId]`
- `/student/learning/[lessonId]/quiz`
- `/student/profile`
- `/student/progress`
- `/student/stars`

## Calls, effects and timers

### src/lib/api/client.ts

- L36: `export function getCachedApiData<T = any>(path: string): T | null {`
- L60: `export function clearApiCache(prefix?: string) {`
- L104: `const res = await fetch('/api/v1/auth/refresh', {`
- L131: `export async function apiFetch<T = any>(`
- L219: `const res = await fetch(fetchUrl, {`
- L229: `return apiFetch<T>(path, { ...options, token: newToken, retryCount: retryCount + 1 })`

### src/app/admin/AdminContext.tsx

- L22: `useEffect(() => {`

### src/app/admin/chapters/page.tsx

- L53: `useEffect(() => {`
- L54: `const cached = getCachedApiData<any>('/api/v1/leaderboard/chapters');`
- L70: `const res = await apiFetch(\`/api/v1/leaderboard/chapters${month ? \`?month=${month}\` : ''}\`, { noCache: true });`
- L99: `const res = await apiFetch(\`/api/v1/chapters/${chapterId}/dashboard/members?${params.toString()}\`, { noCache: true });`
- L138: `apiFetch(\`/api/v1/chapters/${chapterId}/kpi\`, { noCache: true }).then((kpiRes) => {`
- L159: `const res = await apiFetch(\`/api/v1/chapters/${chapterId}/members/${memberId}/course-progress\`, { noCache: true });`
- L207: `const res = await apiFetch(\`/api/v1/chapters/${chapterId}/kpi\`, { method: 'PUT', body: JSON.stringify({ month: kpiForm.month, status: kpiForm.status, note: kpiForm.note.trim() }) });`
- L210: `const history = await apiFetch(\`/api/v1/chapters/${chapterId}/kpi\`, { noCache: true });`

### src/app/admin/courses/[courseId]/edit/page.tsx

- L126: `useEffect(() => {`
- L136: `useEffect(() => {`
- L147: `const courseRes = await apiFetch(\`/api/v1/courses/${params.courseId}\`, { noCache: true });`
- L184: `const res = await apiFetch(\`/api/v1/lessons/${lId}/assessment\`);`
- L265: `const result = await apiFetch(\`/api/v1/courses/${params.courseId}/final-assessment\`);`
- L297: `clearApiCache('/api/v1/courses');`
- L298: `clearApiCache(\`/api/v1/courses/${params.courseId}\`);`
- L300: `const res = await apiFetch(\`/api/v1/courses/${params.courseId}\`, {`
- L309: `clearApiCache('/api/v1/courses');`
- L310: `clearApiCache(\`/api/v1/courses/${params.courseId}\`);`
- L331: `const res = await apiFetch(\`/api/v1/courses/${params.courseId}/cover\`, { method: 'POST', body: payload, noCache: true });`
- L335: `clearApiCache('/api/v1/courses');`
- L348: `clearApiCache('/api/v1/courses');`
- L349: `clearApiCache(\`/api/v1/courses/${params.courseId}\`);`
- L351: `const res = await apiFetch(\`/api/v1/courses/${params.courseId}/publish\`, { method: 'POST' });`
- L352: `clearApiCache('/api/v1/courses');`
- L353: `clearApiCache(\`/api/v1/courses/${params.courseId}\`);`
- L372: `clearApiCache('/api/v1/courses');`
- L373: `clearApiCache(\`/api/v1/courses/${params.courseId}\`);`
- L375: `const res = await apiFetch(\`/api/v1/courses/${params.courseId}/unpublish\`, { method: 'POST' });`
- L376: `clearApiCache('/api/v1/courses');`
- L377: `clearApiCache(\`/api/v1/courses/${params.courseId}\`);`
- L419: `clearApiCache('/api/v1/courses');`
- L439: `const res = await apiFetch(\`/api/v1/courses/${params.courseId}/sessions\`, {`
- L475: `const res = await apiFetch(\`/api/v1/sessions/${targetSessionId}\`, {`
- L494: `clearApiCache('/api/v1/courses');`
- L502: `const res = await apiFetch(\`/api/v1/sessions/${sessionId}\`, { method: 'DELETE' });`
- L525: `clearApiCache('/api/v1/courses');`
- L527: `await apiFetch(\`/api/v1/courses/${params.courseId}/sessions/reorder\`, {`
- L554: `clearApiCache('/api/v1/courses');`
- L556: `await apiFetch(\`/api/v1/sessions/${sessionId}/lessons\`, {`
- L654: `ytIdDebounceRef.current = setTimeout(async () => {`
- L657: `const infoRes = await apiFetch(\`/api/v1/youtube/info?videoId=${vidId}\`, { noCache: true });`
- L730: `clearApiCache('/api/v1/courses');`
- L769: `const res = await apiFetch(\`/api/v1/lessons/${targetLessonId}\`, {`
- L838: `const res = await apiFetch(\`/api/v1/sessions/${targetSessionId}/lessons\`, {`
- L880: `clearApiCache('/api/v1/courses');`
- L892: `const res = await apiFetch(\`/api/v1/lessons/${lessonId}\`, { method: 'DELETE' });`
- L919: `clearApiCache('/api/v1/courses');`
- L931: `const presignRes = await fetch(\`/api/v1/lessons/${lessonId}/documents/presign\`, {`
- L947: `const r2Res = await fetch(presignData.uploadUrl, {`
- L956: `const confirmRes = await fetch(\`/api/v1/lessons/${lessonId}/documents/confirm\`, {`
- L989: `const res = await fetch(\`/api/v1/lessons/${lessonId}/documents/upload\`, {`
- L1065: `clearApiCache('/api/v1/courses');`
- L1086: `const res = await apiFetch(\`/api/v1/documents/${documentId}\`, { method: 'DELETE' });`
- L1214: `const res = await apiFetch('/api/v1/quiz/parse-sheet', {`
- L1319: `clearApiCache('/api/v1/courses');`
- L1324: `const res = await apiFetch(endpoint, {`
- L1350: `clearApiCache(endpoint);`
- L1351: `clearApiCache(\`/api/v1/courses/${params.courseId}\`);`
- L1352: `clearApiCache('/api/v1/assessments');`
- L1399: `clearApiCache('/api/v1/courses');`
- L1403: `const res = await apiFetch(endpoint, { method: 'DELETE' });`

### src/app/admin/courses/mandatory/page.tsx

- L77: `const res = await apiFetch('/api/v1/admin/mandatory-matrix', { noCache: true })`
- L91: `useEffect(() => {`
- L242: `const res = await apiFetch('/api/v1/admin/mandatory-matrix', {`

### src/app/admin/courses/new/page.tsx

- L30: `clearApiCache('/api/v1/courses');`
- L32: `const res = await apiFetch('/api/v1/courses', {`

### src/app/admin/courses/page.tsx

- L95: `useEffect(() => {`
- L96: `const cached = getCachedApiData<any>('/api/v1/courses?limit=100');`
- L105: `const res = await apiFetch('/api/v1/courses?limit=100');`
- L117: `clearApiCache('/api/v1/courses');`
- L118: `clearApiCache(\`/api/v1/courses/${courseId}\`);`
- L120: `const res = await apiFetch(\`/api/v1/courses/${courseId}/${action}\`, { method: 'POST' });`
- L122: `clearApiCache('/api/v1/courses');`
- L123: `clearApiCache(\`/api/v1/courses/${courseId}\`);`
- L146: `clearApiCache('/api/v1/courses');`
- L148: `const res = await apiFetch(\`/api/v1/courses/${courseId}\`, { method: 'DELETE' });`
- L160: `clearApiCache('/api/v1/courses');`
- L161: `clearApiCache(\`/api/v1/courses/${courseId}\`);`
- L163: `const res = await apiFetch(\`/api/v1/courses/${courseId}\`, {`
- L169: `clearApiCache('/api/v1/courses');`
- L170: `clearApiCache(\`/api/v1/courses/${courseId}\`);`

### src/app/admin/dashboard/page.tsx

- L15: `useEffect(() => {`
- L17: `const cached = getCachedApiData<any>('/api/v1/admin/overview');`
- L28: `clearApiCache('/api/v1/admin');`
- L31: `const res = await apiFetch('/api/v1/admin/overview', { noCache });`

### src/app/admin/invitations/page.tsx

- L32: `useEffect(() => {`
- L33: `const cached = getCachedApiData<any>('/api/v1/invitations?kind=LEAD');`
- L42: `const res = await apiFetch('/api/v1/invitations?kind=LEAD');`
- L57: `clearApiCache('/api/v1/invitations');`
- L58: `clearApiCache('/api/v1/chapters');`
- L60: `const res = await apiFetch('/api/v1/invitations/chapter-leader', {`
- L86: `const res = await apiFetch('/api/v1/invitations/dna-leader', { method: 'POST', body: JSON.stringify({ email: dnaEmail.trim().toLowerCase() }) });`
- L96: `clearApiCache('/api/v1/invitations');`
- L98: `const res = await apiFetch(\`/api/v1/invitations/${invitationId}/resend\`, { method: 'POST' });`
- L117: `clearApiCache('/api/v1/invitations');`
- L119: `const res = await apiFetch(\`/api/v1/invitations/${invitationId}\`, { method: 'DELETE' });`

### src/app/admin/layout.tsx

- L46: `useEffect(() => {`
- L59: `fetch('/api/v1/auth/refresh', { method: 'POST' })`
- L91: `useEffect(() => {`
- L97: `apiFetch(url).catch(() => {});`
- L104: `setTimeout(prefetchAll, 500);`

### src/app/admin/learning-policy/page.tsx

- L14: `const response = await apiFetch<any>('/api/v1/admin/learning-policy', { noCache: true })`
- L21: `useEffect(() => { load() }, [])`
- L24: `const response = await apiFetch('/api/v1/admin/learning-policy', { method: 'PUT', body: JSON.stringify({ courses: Object.entries(mapping).map(([courseId, programCode]) => ({ courseId, programCode: programCode || null })) }) })`
- L31: `const response = await apiFetch('/api/v1/admin/learning-policy', { method: 'PUT', body: JSON.stringify({ normalizeOrganization: true }) })`
- L38: `const response = await apiFetch('/api/v1/admin/learning-policy', { method: 'PUT', body: JSON.stringify({ retryOutboxIds: data.failed.map((event: any) => event.id) }) })`

### src/app/admin/users/[userId]/organization-history/page.tsx

- L11: `useEffect(() => {`
- L13: `apiFetch(\`/api/v1/admin/organization/history?userId=${encodeURIComponent(params.userId)}\`, { noCache: true }).then(result => {`

### src/app/admin/users/page.tsx

- L74: `useEffect(() => {`
- L75: `const cachedUsers = getCachedApiData<any>('/api/v1/users?page=1&limit=20');`
- L76: `const cachedChapters = getCachedApiData<any>('/api/v1/chapters');`
- L90: `const res = await apiFetch('/api/v1/chapters');`
- L106: `const res = await apiFetch(\`/api/v1/users?${params.toString()}\`, { noCache });`
- L172: `clearApiCache('/api/v1/users');`
- L173: `clearApiCache('/api/v1/admin/overview');`
- L175: `const res = await apiFetch(\`/api/v1/admin/users/${userId}/extend-deadline\`, {`
- L189: `clearApiCache('/api/v1/users');`
- L190: `clearApiCache('/api/v1/admin/overview');`
- L211: `const result = await apiFetch(\`/api/v1/chapters/${chapterId}/members/${userId}/course-progress\`, { noCache: true });`
- L248: `clearApiCache('/api/v1/users');`
- L249: `clearApiCache('/api/v1/admin/overview');`
- L269: `const res = await apiFetch(\`/api/v1/users/${userId}\`, {`
- L296: `clearApiCache('/api/v1/users');`
- L297: `clearApiCache('/api/v1/admin/overview');`
- L316: `const res = await apiFetch(\`/api/v1/users/${userId}/password-reset\`, { method: 'POST' });`

### src/app/chapter-manager/courses/page.tsx

- L42: `useEffect(() => {`
- L56: `const cached = getCachedApiData<any>(url);`
- L71: `clearApiCache('/api/v1/chapters');`
- L72: `clearApiCache('/api/v1/courses');`
- L74: `const cached = getCachedApiData<any>(url);`
- L83: `const res = await apiFetch(url, { noCache });`
- L98: `const cached = getCachedApiData<any>(url);`
- L108: `const res = await apiFetch(url);`
- L120: `const res = await apiFetch(\`/api/v1/courses/${course.courseId || course.id}\`);`
- L153: `const res = await apiFetch(\`/api/v1/assessments/${aId}\`);`

### src/app/chapter-manager/dashboard/page.tsx

- L15: `useEffect(() => {`
- L29: `const cachedMembers = getCachedApiData<any>(\`/api/v1/chapters/${currentChapter}/dashboard/members\`) ||`
- L30: `getCachedApiData<any>('/api/v1/chapters/me/dashboard/members');`
- L31: `const cachedCourses = getCachedApiData<any>(\`/api/v1/chapters/${currentChapter}/dashboard/courses\`) ||`
- L32: `getCachedApiData<any>('/api/v1/chapters/me/dashboard/courses');`
- L47: `clearApiCache('/api/v1/chapters');`
- L49: `const cachedMembers = getCachedApiData<any>(membersUrl);`
- L50: `const cachedCourses = getCachedApiData<any>(coursesUrl);`
- L60: `apiFetch(membersUrl, { noCache }),`
- L61: `apiFetch(coursesUrl, { noCache }),`

### src/app/chapter-manager/invitations/page.tsx

- L25: `useEffect(() => {`
- L47: `const cached = getCachedApiData<any>(url);`
- L54: `const res = await apiFetch(url, { noCache });`
- L66: `clearApiCache('/api/v1/invitations');`
- L68: `const res = await apiFetch('/api/v1/invitations/member', {`
- L90: `clearApiCache('/api/v1/invitations');`
- L92: `const res = await apiFetch(\`/api/v1/invitations/${invitationId}/resend\`, { method: 'POST' });`
- L111: `clearApiCache('/api/v1/invitations');`
- L113: `const res = await apiFetch(\`/api/v1/invitations/${invitationId}\`, { method: 'DELETE' });`

### src/app/chapter-manager/layout.tsx

- L47: `useEffect(() => {`
- L60: `fetch('/api/v1/auth/refresh', { method: 'POST' })`
- L71: `const effective = await apiFetch('/api/v1/auth/me', { noCache: true });`
- L95: `apiFetch('/api/v1/auth/me', { noCache: true })`
- L112: `useEffect(() => {`
- L126: `apiFetch(url).catch(() => {});`
- L133: `setTimeout(prefetchAll, 1500);`

### src/app/chapter-manager/members/[userId]/page.tsx

- L31: `const res = await apiFetch(\`/api/v1/users/${data.user.userId}\`, {`
- L43: `clearApiCache('/api/v1/chapters');`
- L44: `clearApiCache('/api/v1/users');`
- L58: `useEffect(() => {`
- L78: `const cached = getCachedApiData<any>(url);`
- L84: `const res = await apiFetch(url);`

### src/app/chapter-manager/members/page.tsx

- L50: `const res = await apiFetch<any>(\`/api/v1/chapters/${currentChapter}/members/${memberId}/course-progress\`, { noCache: true });`
- L61: `useEffect(() => {`
- L76: `const cached = getCachedApiData<any>(url);`
- L113: `const cached = noCache ? null : getCachedApiData<any>(url);`
- L123: `const res = await apiFetch(url, { noCache });`
- L163: `clearApiCache('/api/v1/chapters');`
- L164: `clearApiCache('/api/v1/invitations');`
- L166: `const res = await apiFetch('/api/v1/invitations/member', {`
- L200: `clearApiCache('/api/v1/chapters');`
- L201: `clearApiCache('/api/v1/users');`
- L202: `const res = await apiFetch(\`/api/v1/users/${userId}\`, {`
- L226: `clearApiCache('/api/v1/chapters');`

### src/app/chapter-manager/term-transition/page.tsx

- L74: `useEffect(() => {`
- L98: `const interval = setInterval(calculate, 1000);`
- L203: `setTimeout(() => {`
- L210: `useEffect(() => {`
- L237: `clearApiCache('/api/v1/chapters');`
- L239: `const res = await apiFetch(\`/api/v1/chapters/${chapterId}/current-roster\`, { noCache: force });`
- L250: `const meRes = await apiFetch('/api/v1/auth/me', { noCache: true });`
- L262: `useEffect(() => {`
- L298: `clearApiCache('/api/v1/chapters');`
- L300: `const res = await apiFetch(\`/api/v1/chapters/${chapterId}/reorganizations\`, { noCache: force });`
- L333: `const res = await apiFetch(\`/api/v1/chapters/${user.chapterId}/reorganizations/parse-sheet\`, {`
- L375: `const res = await apiFetch(`
- L483: `clearApiCache('/api/v1/chapters');`
- L498: `const res = await apiFetch(`
- L531: `clearApiCache('/api/v1/chapters');`
- L547: `const res = await apiFetch(\`/api/v1/users/${userId}\`, {`
- L570: `clearApiCache('/api/v1/chapters');`
- L571: `clearApiCache('/api/v1/users');`
- L585: `const res = await apiFetch(\`/api/v1/chapters/${user.chapterId}/members/bulk-deactivate\`, {`
- L604: `clearApiCache('/api/v1/chapters');`
- L605: `clearApiCache('/api/v1/users');`
- L619: `const res = await apiFetch(\`/api/v1/chapters/${user.chapterId}/members/bulk-deactivate\`, {`
- L643: `clearApiCache('/api/v1/chapters');`
- L644: `clearApiCache('/api/v1/users');`
- L657: `const res = await apiFetch(\`/api/v1/chapters/${user.chapterId}/reorganizations/${batchId}\`, {`
- L664: `clearApiCache('/api/v1/chapters');`
- L674: `clearApiCache('/api/v1/learning/me');`
- L675: `clearApiCache('/api/v1/courses');`
- L689: `const res = await apiFetch(\`/api/v1/chapters/${user.chapterId}/reorganizations/${batchId}\`, {`
- L696: `clearApiCache('/api/v1/chapters');`
- L706: `clearApiCache('/api/v1/learning/me');`
- L707: `clearApiCache('/api/v1/courses');`
- L726: `const res = await apiFetch(\`/api/v1/chapters/${user.chapterId}/reorganizations\`, {`
- L759: `clearApiCache('/api/v1/chapters');`
- L765: `clearApiCache('/api/v1/learning/me');`
- L766: `clearApiCache('/api/v1/courses');`

### src/app/organization-manager/courses/page.tsx

- L3: `export default function DnaCourses(){const [items,setItems]=useState<any[]>([]);useEffect(()=>{apiFetch('/api/v1/courses?status=PUBLISHED&limit=100').then(r=>r.ok&&setItems(r.data?.items||r.data||[]))},[]);return <div className="mx-auto max-w-7xl space-y-6"><header><h1 className="text-3xl font-bold text-[#172554]">Khóa học đã public</h1><p className="mt-1 text-sm text-[#737686]">Danh mục khóa học đang công khai trên hệ thống. Tài khoản Lead DNA chỉ quản lý và không ghi nhận tiến độ.</p></header><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{items.map(c=><Card key={c.courseId||c.id} className="overflow-hidden p-0">{c.coverUrl&&<img src={c.coverUrl} alt="" className="h-36 w-full object-cover"/>}<div className="p-5"><h2 className="font-bold text-[#172554]">{c.title}</h2><p className="mt-2 line-clamp-2 text-sm text-[#737686]">{c.description}</p></div></Card>)}</div></div>}`

### src/app/organization-manager/dashboard/page.tsx

- L5: `export default function DnaDashboard() { const [members,setMembers]=useState<any[]>([]); const [courses,setCourses]=useState<any[]>([]); useEffect(()=>{Promise.all([apiFetch('/api/v1/organization/dna-leaderboard'),apiFetch('/api/v1/courses?status=PUBLISHED&limit=100')]).then(([m,c])=>{if(m.ok)setMembers(m.data?.items||[]);if(c.ok)setCourses(c.data?.items||c.data||[])})},[]); return <div className="mx-auto max-w-7xl space-y-6"><header><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">DNA workspace</p><h1 className="mt-1 text-3xl font-bold text-[#172554]">Tổng quan DNA</h1><p className="mt-1 text-sm text-[#737686]">Theo dõi thành viên DNA và các khóa học đang được công khai.</p></header><div className="grid gap-4 md:grid-cols-3"><Card><p className="text-sm text-[#737686]">Thành viên DNA</p><p className="mt-2 text-3xl font-black text-[#172554]">{members.length}</p></Card><Card><p className="text-sm text-[#737686]">Khóa học đã public</p><p className="mt-2 text-3xl font-black text-blue-700">{courses.length}</p></Card><Card><p className="text-sm text-[#737686]">Tổng Star thành viên DNA</p><p className="mt-2 text-3xl font-black text-amber-500">{members.reduce((s,m)=>s+(m.stars||0),0)} ⭐</p></Card></div><Card><h2 className="font-bold text-[#172554]">Thành viên nổi bật</h2><div className="mt-3 divide-y">{members.slice(0,5).map(m=><div key={m.userId} className="flex justify-between py-3"><span><b>{m.displayName||'Chưa cập nhật tên'}</b><small className="ml-2 text-[#737686]">{m.email}</small></span><b className="text-amber-500">{m.stars} ⭐</b></div>)}</div></Card></div> }`

### src/app/organization-manager/invitations/page.tsx

- L3: `export default function InviteDna(){const [groups,setGroups]=useState<any[]>([]),[group,setGroup]=useState(''),[email,setEmail]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');useEffect(()=>{apiFetch('/api/v1/organization/managed-units').then(r=>{const g=(r.data?.items||[]).filter((u:any)=>u.type==='DNA_GROUP'&&['LDC','SGDC','TT'].includes(u.name));setGroups(g);setGroup(g[0]?.id||'')})},[]);async function submit(e:FormEvent){e.preventDefault();setBusy(true);const r=await apiFetch('/api/v1/invitations/member',{method:'POST',body:JSON.stringify({email:email.trim(),organizationUnitId:group}),noCache:true});setBusy(false);setMessage(r.ok?'Đã gửi lời mời thành viên DNA.':r.error?.message||'Không gửi được lời mời.');if(r.ok)setEmail('')}return <div className="mx-auto max-w-3xl space-y-6"><header><h1 className="text-3xl font-bold text-[#172554]">Mời thành viên DNA</h1><p className="mt-1 text-sm text-[#737686]">Mỗi thành viên mới phải được gắn vào một nhóm DNA: LDC, SGDC hoặc TT.</p></header><Card className="space-y-4"><form onSubmit={submit} className="space-y-4"><label className="block text-sm font-semibold">Email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-xl border px-4 py-3"/></label><label className="block text-sm font-semibold">Nhóm DNA<select required value={group} onChange={e=>setGroup(e.target.value)} className="mt-1 w-full rounded-xl border bg-white px-4 py-3">{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><Button type="submit" loading={busy} disabled={!group}>Gửi lời mời DNA</Button></form>{message&&<p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}</Card></div>}`

### src/app/organization-manager/layout.tsx

- L14: `useEffect(() => {`
- L16: `apiFetch('/api/v1/auth/me', { noCache: true }).then((result) => {`

### src/app/organization-manager/page.tsx

- L33: `useEffect(() => {`
- L37: `apiFetch('/api/v1/auth/me'),`
- L38: `apiFetch('/api/v1/organization/managed-units'),`
- L59: `useEffect(() => {`
- L70: `apiFetch(\`/api/v1/organization/units/${selected.id}/members?${params.toString()}\`),`
- L71: `selected.canManageMembers ? apiFetch(\`/api/v1/invitations?${invitationParams.toString()}\`) : Promise.resolve(null),`
- L100: `clearApiCache(\`/api/v1/organization/units/${selectedUnit.id}/members\`);`
- L102: `const result = await apiFetch(\`/api/v1/organization/units/${selectedUnit.id}/members\`, {`
- L120: `clearApiCache('/api/v1/invitations');`
- L125: `const result = await apiFetch('/api/v1/invitations/member', { method: 'POST', body: JSON.stringify(body), noCache: true });`
- L133: `const updated = await apiFetch(\`/api/v1/invitations?${params.toString()}\`, { noCache: true });`
- L140: `clearApiCache(\`/api/v1/organization/units/${selectedUnit.id}/members\`);`
- L141: `const result = await apiFetch(\`/api/v1/organization/units/${selectedUnit.id}/members\`, {`
- L152: `const result = await apiFetch(\`/api/v1/invitations/${invitation.id}${action === 'resend' ? '/resend' : ''}\`, {`
- L165: `const result = await apiFetch(\`/api/v1/chapters/${selectedUnit.chapterId}/reorganizations/parse-sheet\`, { method: 'POST', noCache: true, body: JSON.stringify({ url: rosterUrl.trim() }) });`
- L174: `const result = await apiFetch(\`/api/v1/chapters/${selectedUnit.chapterId}/reorganizations\`, {`

### src/app/organization-manager/units/[unitId]/members/[userId]/page.tsx

- L15: `useEffect(() => {`
- L17: `apiFetch(\`/api/v1/organization/units/${params.unitId}/members/${params.userId}/progress\`, { noCache: true }).then((result) => {`

### src/app/student/courses/[courseId]/page.tsx

- L15: `useEffect(() => {`
- L28: `const cached = getCachedApiData<any>(\`/api/v1/courses/${params.courseId}\`);`
- L33: `const cachedProg = getCachedApiData<any>(\`/api/v1/courses/${params.courseId}/my-progress\`);`
- L42: `if (!course && !getCachedApiData<any>(\`/api/v1/courses/${params.courseId}\`)) {`
- L48: `apiFetch(\`/api/v1/courses/${params.courseId}\`),`
- L49: `hasToken ? apiFetch(\`/api/v1/courses/${params.courseId}/my-progress\`) : Promise.resolve(null),`

### src/app/student/courses/[courseId]/quiz/page.tsx

- L28: `useEffect(() => {`
- L38: `useEffect(() => {`
- L41: `const timer = window.setInterval(() => setClockNow(Date.now()), 1000);`
- L48: `const result = await apiFetch(\`/api/v1/courses/${params.courseId}/final-assessment\`, { noCache: true, token: accessToken });`
- L113: `window.setTimeout(() => setStarReward(null), 3600);`

### src/app/student/courses/page.tsx

- L49: `useEffect(() => {`
- L50: `const timer = setInterval(() => setCurrentTime(Date.now()), 1000);`
- L54: `useEffect(() => {`
- L65: `const cachedCourses = getCachedApiData<any>('/api/v1/courses');`
- L70: `const cachedProgress = getCachedApiData<any>('/api/v1/members/me/courses');`
- L75: `const cachedStars = getCachedApiData<any>('/api/v1/stars/me?page=1&limit=20');`
- L93: `clearApiCache('/api/v1/courses');`
- L95: `clearApiCache('/api/v1/members/me/courses');`
- L96: `clearApiCache('/api/v1/members/me/deadlines');`
- L97: `clearApiCache('/api/v1/users/me');`
- L98: `clearApiCache('/api/v1/stars/me?page=1&limit=20');`
- L99: `clearApiCache('/api/v1/learning/me');`
- L102: `if (!courses.length && !getCachedApiData<any>('/api/v1/courses')?.items) {`
- L109: `const coursesRes = await apiFetch<any>('/api/v1/courses', { noCache: forceRefresh });`
- L119: `apiFetch<any>('/api/v1/courses', { noCache: forceRefresh }),`
- L120: `apiFetch<any>('/api/v1/members/me/courses', { noCache: forceRefresh }),`
- L121: `apiFetch<any>('/api/v1/members/me/deadlines', { noCache: forceRefresh }),`
- L122: `apiFetch<any>('/api/v1/users/me', { noCache: forceRefresh }),`
- L123: `apiFetch<any>('/api/v1/stars/me?page=1&limit=20', { noCache: forceRefresh }),`

### src/app/student/dashboard/page.tsx

- L18: `useEffect(() => {`
- L32: `const cachedCourses = getCachedApiData<any>('/api/v1/members/me/courses');`
- L33: `const cachedStreak = getCachedApiData<any>('/api/v1/streak');`
- L34: `const cachedStars = getCachedApiData<any>('/api/v1/stars/me');`
- L49: `apiFetch('/api/v1/members/me/courses'),`
- L50: `apiFetch('/api/v1/streak'),`
- L51: `apiFetch('/api/v1/stars/me'),`

### src/app/student/layout.tsx

- L25: `useEffect(() => {`
- L40: `fetch('/api/v1/auth/refresh', { method: 'POST' })`
- L60: `useEffect(() => {`
- L74: `apiFetch(url).catch(() => {});`
- L81: `setTimeout(prefetchAll, 1200);`

### src/app/student/learning/[lessonId]/page.tsx

- L21: `useEffect(() => {`
- L47: `useEffect(() => {`
- L63: `useEffect(() => {`
- L81: `const lessonRes = await apiFetch(\`/api/v1/lessons/${lessonId}\`);`
- L90: `apiFetch(\`/api/v1/courses/${courseId}\`),`
- L91: `activeToken ? apiFetch(\`/api/v1/lessons/${lessonId}/progress\`, { noCache: true }) : Promise.resolve<ApiResponse<any>>({ ok: false, status: 0 }),`
- L96: `void apiFetch(\`/api/v1/courses/${courseId}/my-progress\`, { noCache: true })`
- L101: `void apiFetch(\`/api/v1/stars/me?balanceOnly=1\`, { noCache: true })`
- L151: `apiFetch(\`/api/v1/lessons/${targetLessonId}/progress\`, { noCache: true, token: activeToken }),`
- L152: `cid ? apiFetch(\`/api/v1/courses/${cid}/my-progress\`, { noCache: true, token: activeToken }) : Promise.resolve<any>(null),`
- L172: `useEffect(() => {`
- L176: `timer = setTimeout(() => {`
- L239: `apiFetch(\`/api/v1/lessons/${newLessonId}\`, { signal: abortController.signal }),`
- L241: `? apiFetch(\`/api/v1/lessons/${newLessonId}/progress\`, { noCache: true, token: activeToken, signal: abortController.signal })`
- L294: `window.setTimeout(() => setStarReward(null), 3600);`
- L340: `clearApiCache(\`/api/v1/lessons/${targetLessonId}/progress\`);`
- L351: `clearApiCache(\`/api/v1/lessons/${targetLessonId}/progress\`);`
- L383: `const res = await apiFetch(\`/api/v1/documents/${documentId}/download\`);`
- L391: `const fileRes = await fetch(res.data.downloadUrl);`
- L401: `setTimeout(() => URL.revokeObjectURL(url), 10000);`

### src/app/student/learning/[lessonId]/quiz/page.tsx

- L47: `useEffect(() => {`
- L70: `apiFetch(\`/api/v1/lessons/${params.lessonId}\`, { noCache: true, token: accessToken }),`
- L71: `apiFetch(\`/api/v1/lessons/${params.lessonId}/progress\`, { noCache: true, token: accessToken }),`
- L88: `const attemptsRes = await apiFetch(\`/api/v1/assessments/${assessmentId}/attempts/me\`, {`
- L105: `apiFetch(\`/api/v1/lessons/${params.lessonId}/progress\`, { noCache: true, token: accessToken }),`
- L107: `? apiFetch(\`/api/v1/assessments/${assessmentId}/attempts/me\`, { noCache: true, token: accessToken })`
- L148: `useEffect(() => {`
- L160: `const timer = setInterval(update, 1000);`
- L271: `clearApiCache('/api/v1/courses');`
- L272: `clearApiCache('/api/v1/lessons');`
- L273: `clearApiCache('/api/v1/learning');`
- L310: `window.setTimeout(() => setStarReward(null), 3600);`

### src/app/student/profile/page.tsx

- L14: `useEffect(() => {`
- L15: `apiFetch('/api/v1/users/me').then((res) => {`
- L26: `const res = await apiFetch('/api/v1/users/me', {`
- L46: `clearApiCache('/api/v1/leaderboard')`
- L47: `clearApiCache('/api/v1/users/me')`
- L48: `clearApiCache('/api/v1/users')`

### src/app/student/progress/page.tsx

- L8: `useEffect(() => {`

### src/app/student/stars/page.tsx

- L59: `clearApiCache(cacheKey)`
- L63: `const result = await apiFetch<StarHistoryResponse>(cacheKey, { noCache: force })`
- L78: `useEffect(() => {`
- L81: `const cached = getCachedApiData<StarHistoryResponse>(cacheKey)`

### src/components/StarRewardCelebration.tsx

- L53: `useEffect(() => {`
- L59: `const timer = setTimeout(() => {`

### src/components/YouTubePlayer.tsx

- L176: `pauseRetryRef.current = setInterval(() => {`
- L188: `useEffect(() => {`
- L209: `const session = new VideoProgressSession(guard, (payload, signal) => apiFetch(\`/api/v1/lessons/${payload.lessonId}/progress\`, {`
- L245: `useEffect(() => {`
- L273: `useEffect(() => controls.setPlaying(displayPlaying), [controls, displayPlaying]);`
- L288: `useEffect(() => {`
- L292: `useEffect(() => {`
- L315: `useEffect(() => {`
- L326: `slowTimeout = setTimeout(() => {`
- L482: `setTimeout(initPlayer, 50);`
- L507: `poller = setInterval(() => {`
- L515: `initTimeout = setTimeout(() => {`
- L615: `await new Promise((resolve) => setTimeout(resolve, attempt * 1000));`
- L636: `uiTimerRef.current = setInterval(() => {`
- L684: `heartbeatRef.current = setInterval(() => {`
- L702: `useEffect(() => {`
- L795: `useEffect(() => {`
- L868: `useEffect(() => {`

### src/components/layout/AppShell.tsx

- L32: `useEffect(() => {`

### src/components/layout/PageTransition.tsx

- L9: `useEffect(() => setNavigating(false), [pathname])`
- L10: `useEffect(() => {`

### src/components/layout/Sidebar.tsx

- L137: `useEffect(() => { setMobileOpen(false); }, [pathname]);`
- L150: `useEffect(() => {`
- L160: `apiFetch('/api/v1/auth/me', { noCache: true }).then((result) => {`
- L181: `await fetch('/api/v1/auth/logout', {`
- L245: `item.prefetchUrls.forEach((url) => apiFetch(url).catch(() => {}));`

### src/components/learning/LearningPeriodSummary.tsx

- L9: `useEffect(() => {`
- L12: `apiFetch<any>('/api/v1/learning/me').then((result) => {`

### src/components/learning/PeriodLeaderboard.tsx

- L10: `useEffect(() => { apiFetch<any>('/api/v1/learning/periods').then((response) => { if (response.ok) setCatalog(response.data) }).catch(() => {}) }, [])`
- L11: `useEffect(() => { setPeriodId('') }, [group, periodType])`
- L12: `useEffect(() => {`
- L15: `apiFetch<any>(\`/api/v1/leaderboard?group=${group}&periodType=${periodType}${periodId ? \`&periodId=${encodeURIComponent(periodId)}\` : ''}\`).then((response) => {`

### src/components/learning/ProgramCourseTree.tsx

- L76: `clearApiCache('/api/v1/learning/me')`
- L79: `const res = await apiFetch<any>('/api/v1/learning/me', { noCache: force })`
- L115: `useEffect(() => {`
- L119: `useEffect(() => {`

### src/components/learning/UnifiedLeaderboard.tsx

- L65: `useEffect(() => { if (group !== 'CHAPTER' && periodType === 'ACTUAL_TERM') setPeriodType('TERM') }, [group, periodType])`
- L105: `const res = await apiFetch<any>(\`/api/v1/chapters/${targetChapter}/members/${memberId}/course-progress\`, { noCache: true })`
- L130: `useEffect(() => {`
- L151: `apiFetch<any>('/api/v1/learning/periods').then((res) => {`
- L183: `useEffect(() => {`
- L193: `clearApiCache('/api/v1/leaderboard')`
- L194: `clearApiCache('/api/v1/organization/dna-leaderboard')`
- L213: `const res = await apiFetch<any>(\`/api/v1/leaderboard?${params.toString()}\`, { noCache: forceRefresh })`
- L257: `useEffect(() => {`

### src/components/lesson/LessonComments.tsx

- L100: `useEffect(() => {`
- L110: `const res = await fetch(\`/api/v1/lessons/${lessonId}/comments\`, {`
- L138: `const res = await fetch(\`/api/v1/lessons/${lessonId}/comments\`, {`
- L177: `const res = await fetch(\`/api/v1/lessons/${lessonId}/comments\`, {`
- L224: `const res = await fetch(\`/api/v1/lessons/${lessonId}/comments/${commentId}\`, {`

### src/components/lesson/LessonQuiz.tsx

- L52: `useEffect(() => {`
- L70: `const res = await fetch(\`/api/v1/assessments/${assessmentId}/attempts\`, {`
- L126: `useEffect(() => {`
- L129: `timerRef.current = setInterval(() => {`
- L146: `useEffect(() => {`
- L208: `const res = await fetch(\`/api/v1/attempts/${attemptId}/submit\`, {`
- L221: `clearApiCache('/api/v1/courses');`
- L222: `clearApiCache('/api/v1/lessons');`
- L223: `clearApiCache('/api/v1/learning');`
- L262: `const res = await fetch(\`/api/v1/attempts/${attemptId}/cancel\`, {`
- L490: `clearApiCache('/api/v1/courses');`
- L491: `clearApiCache('/api/v1/lessons');`
- L492: `clearApiCache('/api/v1/learning');`

### src/components/ui/Modal.tsx

- L71: `useEffect(() => {`
- L75: `useEffect(() => {`
- L81: `useEffect(() => {`

### src/components/ui/MonthPicker.tsx

- L45: `useEffect(() => {`
- L55: `useEffect(() => {`
- L70: `useEffect(() => {`

### src/components/ui/Toast.tsx

- L21: `useEffect(() => {`
- L25: `useEffect(() => {`
- L27: `const timer = setTimeout(() => {`

