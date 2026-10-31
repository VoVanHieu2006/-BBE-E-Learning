import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { competitionMonthBounds } from '../lib/learning-cycle-rules'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

describe('monthly star reset', () => {
  it('derives the current month from the calendar even before its row exists', () => {
    const bounds = competitionMonthBounds(new Date('2026-10-31T17:00:00Z'))
    assert.equal(bounds.key, '2026-11')
    assert.equal(bounds.startsAt.toISOString(), '2026-10-31T17:00:00.000Z')
  })

  it('quiz start gate does not skip the replay check when the month row is missing', () => {
    const source = read('src/app/api/v1/assessments/[assessmentId]/attempts/route.ts')
    assert.match(source, /const monthBounds = competitionMonthBounds\(now, \(await loadLearningPolicy\(prisma\)\)\?\.cutover_at\)/)
    assert.match(source, /submitted_at: \{ lt: monthBounds\.startsAt \}/)
    assert.match(source, /competitionMonth\.findUnique\(\{ where: \{ key: monthBounds\.key \}/)
    assert.doesNotMatch(source, /competitionMonth\.findFirst/)
    // Without a month row there is no replay, so the learner is asked to replay.
    assert.match(source, /const replay = currentMonth && await prisma\.monthlyVideoReplay\.findUnique/)
    assert.match(source, /if \(!replay \|\| !replay\.completed_at\)/)
  })

  it('an attempt started last month needs a replay this month before earning stars', () => {
    const source = read('src/lib/quiz-submission.ts')
    assert.match(source, /attempt\.started_at < context\.month\.starts_at/)
    assert.match(source, /competition_month_id: context\.month\.id, learning_cycle_id: context\.cycle\.id \} \},\s*select: \{ completed_at: true \}/)
    assert.match(source, /if \(monthlyReplayDone && \(eligible \|\| paused\)\)/)
  })

  it('reward budgets stay keyed by month and learning cycle', () => {
    assert.match(read('src/lib/video-heartbeat.ts'), /`video:\$\{userId\}:\$\{lesson\.video\.id\}:\$\{context\.month\.id\}:\$\{context\.cycle\.id\}`/)
    assert.match(read('src/lib/quiz-submission.ts'), /competition_month_id: context\.month\.id, learning_cycle_id: context\.cycle\.id \}\s*const mark = await tx\.quizRewardHighWaterMark\.upsert/)
  })
})
