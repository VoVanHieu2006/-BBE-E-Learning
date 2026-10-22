import { NextRequest, NextResponse } from 'next/server'
import { applyDueChapterReorganizations } from '@/lib/chapter-reorganizations'
import { processLearningOutbox } from '@/lib/learning-outbox'
import { retireInactiveAccounts } from '@/lib/account-retirement'
import { initializeLearningCutover } from '@/lib/learning-cutover'
import { closeCompetitionMonths, completePendingCompetitionKpis, closeCompetitionTerms } from '@/lib/competition-snapshots'
import { applyDueDnaCycleResets } from '@/lib/dna-cycle-resets'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')
  if (!secret || authorization !== `Bearer ${secret}`) return NextResponse.json({ error: { code: 'Unauthorized' } }, { status: 401 })
  const initialized = await initializeLearningCutover()
  const applied = await applyDueChapterReorganizations()
  const dnaResets = await applyDueDnaCycleResets()
  const synchronization = await processLearningOutbox()
  const retired = await retireInactiveAccounts()
  const supplementalViolations = 0
  const closedMonths = await closeCompetitionMonths()
  const completedKpis = await completePendingCompetitionKpis()
  const closedTerms = await closeCompetitionTerms()
  return NextResponse.json({ initialized, applied, dnaResets, synchronization, retired, supplementalViolations, closedMonths, completedKpis, closedTerms })
}
