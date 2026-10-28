// Read-only, sequential production probe. Credentials are supplied only via process env.
const base = process.env.API_BASE_URL
const accounts = [
  ['admin', process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD],
  ['lead', process.env.LEAD_EMAIL, process.env.LEAD_PASSWORD],
]
if (!base || accounts.some(([, email, password]) => !email || !password)) {
  throw new Error('Set API_BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, LEAD_EMAIL and LEAD_PASSWORD')
}

async function timed(url, options = {}) {
  const started = performance.now()
  try {
    const response = await fetch(new URL(url, base), { ...options, signal: AbortSignal.timeout(20000) })
    const body = await response.json().catch(() => null)
    return { status: response.status, ms: Math.round(performance.now() - started), body }
  } catch (error) {
    return { status: 'ERR', ms: Math.round(performance.now() - started), error: error.cause?.code || error.name }
  }
}

for (const [role, email, password] of accounts) {
  const login = await timed('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  console.log(`${role} login: ${login.status} ${login.ms}ms`)
  if (login.status !== 200 || !login.body?.accessToken) continue
  const headers = { Authorization: `Bearer ${login.body.accessToken}`, 'Cache-Control': 'no-cache' }
  const chapterList = role === 'admin' ? await timed('/api/v1/chapters', { headers }) : null
  const chapterId = login.body.user?.chapterId || chapterList?.body?.items?.[0]?.chapterId || chapterList?.body?.items?.[0]?.id || 'me'
  const courseList = await timed('/api/v1/courses', { headers })
  const courseId = courseList.body?.items?.[0]?.courseId || courseList.body?.items?.[0]?.id
  const userList = await timed(role === 'admin'
    ? '/api/v1/users?page=1&limit=20'
    : `/api/v1/chapters/${chapterId}/dashboard/members?page=1&limit=20`, { headers })
  const userId = userList.body?.items?.[0]?.userId || userList.body?.items?.[0]?.id
  const paths = role === 'admin'
    ? [
        '/api/v1/auth/me',
        '/api/v1/admin/overview',
        '/api/v1/users?page=1&limit=20',
        '/api/v1/users?page=2&limit=20',
        '/api/v1/users?search=demo&page=1&limit=20',
        '/api/v1/chapters',
        '/api/v1/courses',
        '/api/v1/leaderboard/chapters',
        '/api/v1/admin/mandatory-matrix',
        '/api/v1/admin/organization',
        '/api/v1/admin/learning-rules',
        '/api/v1/invitations',
        `/api/v1/chapters/${chapterId}/kpi`,
        ...(courseId ? [
          `/api/v1/courses/${courseId}`,
          `/api/v1/courses/${courseId}/final-assessment`,
        ] : []),
        ...(userId ? [`/api/v1/chapters/all/members/${userId}/course-progress`] : []),
      ]
    : [
        '/api/v1/auth/me',
        `/api/v1/chapters/${chapterId}/dashboard/members`,
        `/api/v1/chapters/${chapterId}/dashboard/courses`,
        `/api/v1/chapters/${chapterId}/members?page=1&limit=20`,
        '/api/v1/courses',
        '/api/v1/invitations',
        `/api/v1/chapters/${chapterId}/current-roster`,
        `/api/v1/chapters/${chapterId}/reorganizations`,
        '/api/v1/leaderboard/chapters',
        ...(courseId ? [
          `/api/v1/courses/${courseId}`,
          `/api/v1/courses/${courseId}/students?chapterId=${chapterId}`,
        ] : []),
        ...(userId ? [`/api/v1/chapters/${chapterId}/members/${userId}/course-progress`] : []),
      ]
  for (const path of paths) {
    const samples = []
    for (let i = 0; i < 3; i += 1) {
      const result = await timed(path, { headers })
      samples.push(`${result.status}/${result.ms}${result.error ? `(${result.error})` : ''}`)
      if (result.status === 'ERR') break
    }
    console.log(`${role} ${path}: ${samples.join(' ')}`)
  }
}
