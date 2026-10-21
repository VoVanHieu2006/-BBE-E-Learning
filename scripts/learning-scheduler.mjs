/** Independent minute scheduler; no dotenv or implicit production destination. */
const base = process.env.LEARNING_CRON_BASE_URL
const secret = process.env.CRON_SECRET
if (!base || !secret) throw new Error('LEARNING_CRON_BASE_URL and CRON_SECRET are required.')
const origin = new URL(base)
if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Use HTTPS or loopback HTTP for the scheduler.')
const paths = ['/api/internal/organization/reorganizations/apply', '/api/internal/attempts/auto-submit', '/api/internal/learning/deadlines/enforce']
let busy = false
async function tick(scheduledAt) {
  if (busy) { console.error(JSON.stringify({ event: 'scheduler_overlap', scheduledAt })); return }
  busy = true
  const actualAt = new Date()
  const results = await Promise.allSettled(paths.map(async (path) => {
    const response = await fetch(new URL(path, origin), { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(55_000) })
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
    return { path, result: await response.json() }
  }))
  console.log(JSON.stringify({ scheduledAt, actualAt, lagMs: actualAt.getTime() - scheduledAt.getTime(), results: results.map((result) => result.status === 'fulfilled' ? result.value : { error: result.reason.message }) }))
  busy = false
}
const first = new Date()
void tick(first)
let next = first.getTime() + 60_000
const timer = setInterval(() => { const scheduledAt = new Date(next); next += 60_000; void tick(scheduledAt) }, 60_000)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); process.exit(0) })
