import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { capVideoProgress, hasWatchedFullVideo } from '../lib/video-progress-rules'
import { starsForCourseFinalScore, starsForQuizScore, starsForVideoDuration } from '../lib/reward-rules'
import { matchesLearningRulePositionScope } from '../lib/learning-rule-scope'
import { orderOrganizationTree, organizationParentTypeMatches, organizationSubtreeIds, positionScopeMatchesUnitType, validateOrganizationMove } from '../lib/organization-scope'
import { selectQuizQuestions, validateQuizPoolAssignments } from '../lib/quiz-pool-selection'
import { mergeChapterMemberRecords } from '../lib/chapter-membership-rules'
import { normalizeStarHistoryPagination } from '../lib/star-history-rules'
import { gradeQuizAttempt, validateAttemptAnswerSelections } from '../lib/quiz-attempt-rules'
import { isOrganizationId, normalizeOrganizationPagination, normalizeOrganizationSearch, parseAssignmentFilterStatus, parseMembershipFilterStatus } from '../lib/organization-admin-rules'
import { parseLearningRuleInput } from '../lib/learning-rule-rules'
import { canDeleteLessonComment, hasPermissionInOrganizationScope, isLegacyChapterCompatibilityPermission, resolveLegacyChapterMembershipScope } from '../lib/authorization-rules'
import { calculateChapterLeaderboardMetrics, calculateMandatoryCompletionPercentByUser, normalizeChapterKpiInput, parseChapterKpiMonthStart, scoreChapterLeaderboard } from '../lib/chapter-leaderboard-rules'
import { getCachedChapterLeaderboard, invalidateChapterLeaderboardCache, setCachedChapterLeaderboard } from '../lib/chapter-leaderboard-cache'
import { evaluateCourseFinalRequirements } from '../lib/course-final-assessment-rules'
import { canActivateAfterRestrictionLift, canDeadlineLockAccount, collectChapterAccountIds } from '../lib/account-restriction-rules'

describe('Account restriction rules', () => {
  it('includes legacy members, current organization members, and active position holders once', () => {
    assert.deepEqual(collectChapterAccountIds(
      ['legacy-member', 'shared-user'],
      ['org-only-member', 'shared-user'],
      ['position-only-holder'],
    ), ['legacy-member', 'shared-user', 'org-only-member', 'position-only-holder'])
  })

  it('does not reactivate an account while any direct or cascade restriction remains', () => {
    assert.equal(canActivateAfterRestrictionLift(true), false)
    assert.equal(canActivateAfterRestrictionLift(false), true)
  })

  it('never lets automatic course deadlines disable Admin accounts', () => {
    assert.equal(canDeadlineLockAccount('ADMIN'), false)
    assert.equal(canDeadlineLockAccount('MEMBER'), true)
    assert.equal(canDeadlineLockAccount('CHAPTER_LEADER'), true)
  })
})

describe('Course-final assessment progression', () => {
  const lessons = [
    { videoComplete: true, assessmentId: 'lesson-quiz-1' },
    { videoComplete: true, assessmentId: null },
  ]

  it('blocks the final exam until every video is watched completely', () => {
    assert.equal(evaluateCourseFinalRequirements(
      [{ videoComplete: false, assessmentId: null }], new Set(),
    ).code, 'CourseVideosIncomplete')
  })

  it('blocks until all configured per-lesson quizzes are passed', () => {
    assert.equal(evaluateCourseFinalRequirements(lessons, new Set()).code, 'LessonAssessmentsIncomplete')
    assert.deepEqual(evaluateCourseFinalRequirements(lessons, new Set(['lesson-quiz-1'])), { ok: true })
  })

  it('does not consider an empty course ready for a final assessment', () => {
    assert.equal(evaluateCourseFinalRequirements([], new Set()).code, 'CourseHasNoLessons')
  })
})

describe('Course-final Star rewards', () => {
  it('rewards passing once at a predictable, capped rate', () => {
    assert.deepEqual(starsForCourseFinalScore(0.84), { passStars: 0, bonusStars: 0 })
    assert.deepEqual(starsForCourseFinalScore(0.85), { passStars: 3, bonusStars: 0 })
    assert.deepEqual(starsForCourseFinalScore(0.90), { passStars: 3, bonusStars: 1 })
    assert.deepEqual(starsForCourseFinalScore(1), { passStars: 3, bonusStars: 2 })
  })
})

describe('Organization-scoped authorization rules', () => {
  it('derives legacy Chapter scope from current membership rather than a stale token claim', () => {
    assert.equal(resolveLegacyChapterMembershipScope([]), undefined)
    assert.equal(resolveLegacyChapterMembershipScope(['current-chapter']), 'current-chapter')
  })

  it('grants a parent position downward but never sideways or upward', () => {
    assert.equal(hasPermissionInOrganizationScope(['dna'], ['department-a', 'chapter-a', 'dna']), true)
    assert.equal(hasPermissionInOrganizationScope(['department-a'], ['chapter-a', 'dna']), false)
    assert.equal(hasPermissionInOrganizationScope(['department-b'], ['department-a', 'chapter-a', 'dna']), false)
  })

  it('limits legacy Chapter Leader compatibility to the two transitional permissions', () => {
    assert.equal(isLegacyChapterCompatibilityPermission('VIEW_MEMBER_PROGRESS'), true)
    assert.equal(isLegacyChapterCompatibilityPermission('MANAGE_CHAPTER_MEMBERS'), true)
    assert.equal(isLegacyChapterCompatibilityPermission('UNLOCK_USER'), false)
    assert.equal(isLegacyChapterCompatibilityPermission('APPOINT_POSITION'), false)
  })

  it('limits comment deletion to the author or Admin, never a global legacy Chapter Leader role', () => {
    assert.equal(canDeleteLessonComment('MEMBER', true), true)
    assert.equal(canDeleteLessonComment('ADMIN', false), true)
    assert.equal(canDeleteLessonComment('CHAPTER_LEADER', false), false)
    assert.equal(canDeleteLessonComment('MEMBER', false), false)
  })
})

describe('Organization admin list query rules', () => {
  it('caps page size and clamps page numbers to available results', () => {
    assert.deepEqual(normalizeOrganizationPagination('900', '999', 41), {
      page: 1, limit: 50, total: 41, totalPages: 1, skip: 0,
    })
    assert.deepEqual(normalizeOrganizationPagination('900', '20', 41), {
      page: 3, limit: 20, total: 41, totalPages: 3, skip: 40,
    })
    assert.deepEqual(normalizeOrganizationPagination('-1', '5', 0), {
      page: 1, limit: 5, total: 0, totalPages: 0, skip: 0,
    })
  })

  it('uses safe defaults for malformed numeric filters and bounds search text', () => {
    assert.deepEqual(normalizeOrganizationPagination('1.5', 'NaN', 12), {
      page: 1, limit: 20, total: 12, totalPages: 1, skip: 0,
    })
    assert.equal(normalizeOrganizationSearch('  LT  '), 'LT')
    assert.equal(normalizeOrganizationSearch('x'.repeat(140)).length, 120)
  })

  it('fails closed to ALL for unknown status filter values', () => {
    assert.equal(parseMembershipFilterStatus('DELETED'), 'ALL')
    assert.equal(parseMembershipFilterStatus('ACTIVE'), 'ACTIVE')
    assert.equal(parseAssignmentFilterStatus('CANCELLED'), 'ALL')
    assert.equal(parseAssignmentFilterStatus('SCHEDULED'), 'SCHEDULED')
  })

  it('accepts UUID identifiers and rejects arbitrary query/body values', () => {
    assert.equal(isOrganizationId('11111111-1111-4111-8111-111111111111'), true)
    assert.equal(isOrganizationId('not-an-id'), false)
    assert.equal(isOrganizationId('11111111-1111-4111-8111-11111111111x'), false)
  })
})

describe('Learning rule input validation', () => {
  const courseId = '11111111-1111-4111-8111-111111111111'
  const unitId = '22222222-2222-4222-8222-222222222222'
  const positionId = '33333333-3333-4333-8333-333333333333'
  const now = new Date('2026-10-11T00:00:00Z')

  it('normalizes a valid targeted rule and defaults Stars off for viewer-only rules', () => {
    const result = parseLearningRuleInput({
      courseId,
      organizationUnitId: unitId,
      positionId,
      dueDays: '30',
      canView: true,
      canAssess: false,
      effectiveFrom: '2026-10-11T00:00:00.000Z',
      effectiveUntil: '2027-01-01T00:00:00.000Z',
    }, now)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.mandatory, true)
    assert.equal(result.value.canEarnStars, false)
    assert.equal(result.value.dueDays, 30)
    assert.equal(result.value.effectiveFrom.toISOString(), '2026-10-11T00:00:00.000Z')
  })

  it('rejects malformed IDs, dates, deadlines and contradictory view/assessment/reward flags', () => {
    const invalidInputs = [
      { courseId: 'not-a-uuid' },
      { courseId, effectiveFrom: 'not-a-date' },
      { courseId, effectiveUntil: '2026-10-10T00:00:00.000Z' },
      { courseId, dueDays: 3651 },
      { courseId, canView: false, canAssess: true },
      { courseId, canAssess: false, canEarnStars: true },
      { courseId, canAssess: 'false' },
    ]
    for (const input of invalidInputs) assert.equal(parseLearningRuleInput(input, now).ok, false)
  })
})

describe('Star history pagination', () => {
  it('uses safe defaults and caps the requested page size', () => {
    assert.deepEqual(normalizeStarHistoryPagination(null, null, 41), { page: 1, limit: 20, totalPages: 3 })
    assert.deepEqual(normalizeStarHistoryPagination('2', '1000', 120), { page: 2, limit: 50, totalPages: 3 })
  })

  it('rejects malformed values, clamps pages to available results, and handles an empty ledger', () => {
    assert.deepEqual(normalizeStarHistoryPagination('1.5', '-5', 11), { page: 1, limit: 20, totalPages: 1 })
    assert.deepEqual(normalizeStarHistoryPagination('999999999999999999', '10', 0), { page: 1, limit: 10, totalPages: 0 })
  })
})

describe('Quiz attempt grading', () => {
  const questions = [
    {
      id: 'question-1', points: 2, explanation: null,
      options: [
        { id: 'q1-correct', text: 'Correct answer', correct: true },
        { id: 'q1-wrong', text: 'Wrong answer', correct: false },
      ],
    },
    {
      id: 'question-2', points: 1, explanation: 'Review this topic.',
      options: [
        { id: 'q2-correct', text: 'Correct answer', correct: true },
        { id: 'q2-wrong', text: 'Wrong answer', correct: false },
      ],
    },
  ]

  it('counts only options belonging to the answered question and treats missing answers as incorrect', () => {
    const result = gradeQuizAttempt(questions, [
      { questionId: 'question-1', selectedOptionId: 'q2-correct' },
    ], 0.85)

    assert.equal(result.totalPoints, 3)
    assert.equal(result.score, 0)
    assert.equal(result.passed, false)
    assert.equal(result.results[0].isCorrect, false)
    assert.equal(result.results[1].selectedOptionId, null)
  })

  it('calculates weighted scores and passes exactly at the configured threshold', () => {
    const result = gradeQuizAttempt(questions, [
      { questionId: 'question-1', selectedOptionId: 'q1-correct' },
      { questionId: 'question-2', selectedOptionId: 'q2-wrong' },
    ], 2 / 3)

    assert.equal(result.score, 2)
    assert.equal(result.scoreRatio, 2 / 3)
    assert.equal(result.passed, true)
    assert.equal(result.results[1].explanation, 'Review this topic.')
  })

  it('defaults non-positive question points and clamps invalid passing thresholds', () => {
    const result = gradeQuizAttempt([
      { id: 'question-1', points: 0, options: [{ id: 'q1-correct', text: 'A', correct: true }] },
      { id: 'question-2', points: -4, options: [{ id: 'q2-correct', text: 'B', correct: true }] },
    ], [
      { questionId: 'question-1', selectedOptionId: 'q1-correct' },
      { questionId: 'question-2', selectedOptionId: 'q2-correct' },
    ], Number.NaN)

    assert.equal(result.totalPoints, 2)
    assert.equal(result.score, 2)
    assert.equal(result.passed, true)
  })
})

describe('Quiz answer selection validation', () => {
  const attemptQuestions = ['question-1', 'question-2']
  const optionQuestionIds = new Map([
    ['option-1a', 'question-1'],
    ['option-1b', 'question-1'],
    ['option-2a', 'question-2'],
  ])

  it('accepts only a selected option belonging to a question in the attempt', () => {
    assert.deepEqual(validateAttemptAnswerSelections(
      attemptQuestions,
      optionQuestionIds,
      [['question-1', 'option-1b'], ['question-2', 'option-2a']],
    ), {
      ok: true,
      answers: [
        { questionId: 'question-1', selectedOptionId: 'option-1b' },
        { questionId: 'question-2', selectedOptionId: 'option-2a' },
      ],
    })
  })

  it('rejects answers for questions outside the attempt and cross-question options', () => {
    assert.deepEqual(validateAttemptAnswerSelections(
      attemptQuestions,
      optionQuestionIds,
      [['question-3', 'option-1a']],
    ), { ok: false, code: 'QuestionNotInAttempt' })
    assert.deepEqual(validateAttemptAnswerSelections(
      attemptQuestions,
      optionQuestionIds,
      [['question-1', 'option-2a']],
    ), { ok: false, code: 'OptionNotInQuestion' })
  })

  it('rejects malformed option values and skips intentionally blank selections', () => {
    assert.deepEqual(validateAttemptAnswerSelections(
      attemptQuestions,
      optionQuestionIds,
      [['question-1', 123]],
    ), { ok: false, code: 'ValidationError' })
    assert.deepEqual(validateAttemptAnswerSelections(
      attemptQuestions,
      optionQuestionIds,
      [['question-1', null], ['question-2', '']],
    ), { ok: true, answers: [] })
  })
})

describe('Chapter membership projection', () => {
  it('deduplicates legacy and organization memberships while preserving the earliest Chapter join date', () => {
    const base = {
      email: 'member@example.com',
      status: 'ACTIVE',
      role: 'MEMBER',
      createdAt: new Date('2024-01-01T00:00:00Z'),
    }
    const merged = mergeChapterMemberRecords(
      [{ ...base, userId: 'member-1', joinedAt: new Date('2024-03-01T00:00:00Z') }],
      [
        { ...base, userId: 'member-1', joinedAt: new Date('2024-02-01T00:00:00Z') },
        { ...base, userId: 'member-2', email: 'other@example.com', joinedAt: new Date('2024-04-01T00:00:00Z') },
      ],
    )

    assert.equal(merged.length, 2)
    assert.equal(merged[0].userId, 'member-2')
    assert.equal(merged[1].userId, 'member-1')
    assert.equal(merged[1].joinedAt.toISOString(), '2024-02-01T00:00:00.000Z')
  })
})

describe('strict video progress', () => {
  it('requires the full known duration, with no percentage or seconds tolerance', () => {
    assert.equal(hasWatchedFullVideo(299, 300), false)
    assert.equal(hasWatchedFullVideo(299.99, 300), false)
    assert.equal(hasWatchedFullVideo(300, 300), true)
  })

  it('does not treat missing, invalid, or non-finite duration as completion', () => {
    assert.equal(hasWatchedFullVideo(100, 0), false)
    assert.equal(hasWatchedFullVideo(100, -10), false)
    assert.equal(hasWatchedFullVideo(Number.POSITIVE_INFINITY, 100), false)
    assert.equal(hasWatchedFullVideo(100, Number.NaN), false)
  })

  it('limits reported progress to elapsed time at 2x, retaining prior progress', () => {
    assert.deepEqual(capVideoProgress(0, 600, 600, 10), {
      furthestWatchedPositionSeconds: 20,
      lastPositionSeconds: 20,
    })
    assert.deepEqual(capVideoProgress(40, 5, 100, 10), {
      furthestWatchedPositionSeconds: 60,
      lastPositionSeconds: 5,
    })
    assert.equal(capVideoProgress(20, 500, 500, 0).furthestWatchedPositionSeconds, 20)
  })

  it('safely handles malformed client numbers without making progress', () => {
    assert.deepEqual(capVideoProgress(10, Number.NaN, Number.POSITIVE_INFINITY, Number.NaN), {
      furthestWatchedPositionSeconds: 10,
      lastPositionSeconds: 0,
    })
  })
})

describe('Star reward rules', () => {
  it('rewards completed videos by full-minute duration with a one-Star minimum', () => {
    assert.equal(starsForVideoDuration(30), 1)
    assert.equal(starsForVideoDuration(179), 2)
    assert.equal(starsForVideoDuration(180), 3)
    assert.equal(starsForVideoDuration(360), 6)
    assert.equal(starsForVideoDuration(3600), 60)
    assert.equal(starsForVideoDuration(Number.NaN), 0)
  })

  it('rewards passing quizzes once per score band and caps the perfect-score reward', () => {
    assert.equal(starsForQuizScore(0.849), 0)
    assert.equal(starsForQuizScore(0.85), 2)
    assert.equal(starsForQuizScore(0.9), 3)
    assert.equal(starsForQuizScore(0.95), 4)
    assert.equal(starsForQuizScore(1), 5)
    assert.equal(starsForQuizScore(0.85, 0.9), 0)
  })
})

describe('Chapter leaderboard scoring', () => {
  it('scales size influence until 51 members and caps it afterwards', () => {
    const chapter30 = calculateChapterLeaderboardMetrics(Array(30).fill(80), 10, 'YELLOW')
    const chapter50 = calculateChapterLeaderboardMetrics(Array(51).fill(80), 10, 'YELLOW')
    const score30 = scoreChapterLeaderboard(chapter30, 10)
    const score50 = scoreChapterLeaderboard(chapter50, 10)

    assert.equal(chapter30.averageCompletion, chapter50.averageCompletion)
    assert.equal(chapter30.averageStars, chapter50.averageStars)
    assert.ok(chapter30.sizeScore < chapter50.sizeScore)
    assert.equal(chapter50.sizeScore, 100)
    assert.ok(score50.score > score30.score)
  })

  it('penalizes uneven learning instead of letting a few high performers carry the Chapter', () => {
    const evenlyLearning = calculateChapterLeaderboardMetrics(Array(30).fill(70), 5, 'YELLOW')
    const unevenLearning = calculateChapterLeaderboardMetrics([
      ...Array(15).fill(100), ...Array(15).fill(0),
    ], 5, 'YELLOW')

    assert.equal(evenlyLearning.eligible, true)
    assert.equal(unevenLearning.eligible, true)
    assert.equal(evenlyLearning.at70Rate, 1)
    assert.equal(unevenLearning.at70Rate, 0.5)
    assert.ok(evenlyLearning.completionScore > unevenLearning.completionScore)
  })

  it('applies member, completion-distribution, and red-KPI eligibility gates', () => {
    assert.equal(calculateChapterLeaderboardMetrics(Array(19).fill(100), 5, 'GREEN').eligible, false)
    assert.equal(calculateChapterLeaderboardMetrics([...Array(9).fill(100), ...Array(11).fill(0)], 5, 'YELLOW').eligible, false)
    assert.equal(calculateChapterLeaderboardMetrics(Array(20).fill(70), 5, 'RED').eligible, false)
    assert.equal(calculateChapterLeaderboardMetrics(Array(20).fill(70), 5, 'YELLOW').eligible, true)
  })

  it('normalizes Stars per member, caps outliers, and awards only green KPI bonus', () => {
    const baseline = calculateChapterLeaderboardMetrics(Array(20).fill(70), 20, 'GREEN')
    const outlier = calculateChapterLeaderboardMetrics(Array(20).fill(70), 100, 'YELLOW')
    const greenScore = scoreChapterLeaderboard(baseline, 10)
    const yellowScore = scoreChapterLeaderboard({ ...baseline, kpiStatus: 'YELLOW' }, 10)
    const outlierScore = scoreChapterLeaderboard(outlier, 10)

    assert.equal(greenScore.starScore, 100)
    assert.equal(greenScore.kpiBonus - yellowScore.kpiBonus, 20)
    assert.equal(outlierScore.starScore, 100)
  })
})

describe('Chapter leaderboard mandatory completion', () => {
  it('counts required videos, lesson quizzes, and the course-final quiz as separate milestones', () => {
    const completion = calculateMandatoryCompletionPercentByUser(
      ['learner-1'],
      [{
        userId: 'learner-1',
        lessonIds: ['lesson-1', 'lesson-2'],
        lessonAssessmentIds: ['quiz-1', 'quiz-2'],
        finalAssessmentId: 'final-quiz',
      }],
      new Map([['learner-1', new Set(['lesson-1', 'lesson-2'])]]),
      new Map([['learner-1', new Set(['quiz-1'])]]),
    )

    assert.equal(completion.get('learner-1'), 60)
  })

  it('does not require assessments the assignment does not allow the learner to take', () => {
    const completion = calculateMandatoryCompletionPercentByUser(
      ['viewer'],
      [{
        userId: 'viewer',
        lessonIds: ['lesson-1', 'lesson-2'],
        lessonAssessmentIds: ['quiz-1', 'quiz-2'],
        finalAssessmentId: 'final-quiz',
        canAssess: false,
      }],
      new Map([['viewer', new Set(['lesson-1', 'lesson-2'])]]),
      new Map(),
    )
    assert.equal(completion.get('viewer'), 100)
  })

  it('keeps missing assignments at zero and deduplicates overlapping assignment requirements', () => {
    const completion = calculateMandatoryCompletionPercentByUser(
      ['no-assignment', 'assigned'],
      [
        { userId: 'assigned', lessonIds: ['lesson-1'], lessonAssessmentIds: ['quiz-1'] },
        { userId: 'assigned', lessonIds: ['lesson-1'], lessonAssessmentIds: ['quiz-1'] },
      ],
      new Map([['assigned', new Set(['lesson-1'])]]),
      new Map(),
    )
    assert.equal(completion.get('no-assignment'), 0)
    assert.equal(completion.get('assigned'), 50)
  })

  it('ignores assignments whose content is not visible to the learner', () => {
    const completion = calculateMandatoryCompletionPercentByUser(
      ['hidden'],
      [{ userId: 'hidden', lessonIds: ['lesson-1'], canView: false }],
      new Map(),
      new Map(),
    )
    assert.equal(completion.get('hidden'), 0)
  })
})

describe('Chapter KPI month input', () => {
  it('normalizes an HTML month value to the UTC first day of that month', () => {
    assert.equal(parseChapterKpiMonthStart('2026-01')?.toISOString(), '2026-01-01T00:00:00.000Z')
    assert.deepEqual(normalizeChapterKpiInput({ month: '2026-12', status: 'GREEN', note: '  good  ' }), {
      monthStart: new Date('2026-12-01T00:00:00.000Z'),
      status: 'GREEN',
      note: 'good',
    })
  })

  it('rejects missing, malformed, out-of-range months and invalid or oversized KPI fields', () => {
    assert.equal(parseChapterKpiMonthStart(undefined), null)
    assert.equal(parseChapterKpiMonthStart('2026-13'), null)
    assert.equal(parseChapterKpiMonthStart('2026-2'), null)
    assert.equal(parseChapterKpiMonthStart('2026-02-15'), null)
    assert.equal(normalizeChapterKpiInput({ status: 'GREEN' }), null)
    assert.equal(normalizeChapterKpiInput({ month: '2026-05', status: 'BLUE' }), null)
    assert.equal(normalizeChapterKpiInput({ month: '2026-05', status: 'RED', note: 'x'.repeat(501) }), null)
    assert.equal(normalizeChapterKpiInput({ month: '2026-05', status: 'YELLOW', note: 123 }), null)
  })
})

describe('Chapter leaderboard cache', () => {
  it('expires after its TTL and clears immediately after a KPI update', () => {
    invalidateChapterLeaderboardCache()
    const cached = { items: [{ chapterId: 'chapter-1', score: 50 }] }
    setCachedChapterLeaderboard(cached, 1000)
    assert.equal(getCachedChapterLeaderboard(1000), cached)
    assert.equal(getCachedChapterLeaderboard(30_999), cached)
    assert.equal(getCachedChapterLeaderboard(31_000), null)

    setCachedChapterLeaderboard(cached, 2000)
    invalidateChapterLeaderboardCache()
    assert.equal(getCachedChapterLeaderboard(2000), null)
  })
})

describe('learning rule position scope', () => {
  const chapterA = new Set(['chapter-a', 'department-a1'])
  const positions = [
    { positionId: 'lt', unitId: 'chapter-b' },
    { positionId: 'lt', unitId: 'department-a1' },
    { positionId: 'member', unitId: 'chapter-a' },
  ]

  it('does not grant a Chapter A rule from a same-position tenure in Chapter B', () => {
    assert.equal(matchesLearningRulePositionScope(
      { positionId: 'lt', organizationUnitId: 'chapter-a' },
      [positions[0]],
      chapterA,
    ), false)
  })

  it('allows a tenure in the target unit subtree and position-only rules globally', () => {
    assert.equal(matchesLearningRulePositionScope(
      { positionId: 'lt', organizationUnitId: 'chapter-a' },
      [positions[1]],
      chapterA,
    ), true)
    assert.equal(matchesLearningRulePositionScope(
      { positionId: 'lt', organizationUnitId: null },
      [positions[0]],
    ), true)
  })

  it('does not constrain rules that target an organization only', () => {
    assert.equal(matchesLearningRulePositionScope(
      { positionId: null, organizationUnitId: 'chapter-a' },
      [],
    ), true)
  })
})

describe('position assignment unit scope', () => {
  it('only permits appointments at the matching organization level', () => {
    assert.equal(positionScopeMatchesUnitType('PLATFORM', 'ROOT'), true)
    assert.equal(positionScopeMatchesUnitType('DNA', 'DNA'), true)
    assert.equal(positionScopeMatchesUnitType('CHAPTER', 'CHAPTER'), true)
    assert.equal(positionScopeMatchesUnitType('DEPARTMENT', 'DEPARTMENT'), true)
    assert.equal(positionScopeMatchesUnitType('CHAPTER', 'DEPARTMENT'), false)
    assert.equal(positionScopeMatchesUnitType('DNA', 'CHAPTER'), false)
    assert.equal(positionScopeMatchesUnitType('UNKNOWN', 'ROOT'), false)
  })
})

describe('organization hierarchy changes', () => {
  const units = [
    { id: 'root', parentId: null, type: 'ROOT' },
    { id: 'chapter', parentId: 'root', type: 'CHAPTER' },
    { id: 'department', parentId: 'chapter', type: 'DEPARTMENT' },
    { id: 'other', parentId: 'root', type: 'CHAPTER' },
    { id: 'other-root', parentId: null, type: 'ROOT' },
  ]

  it('finds a subtree and allows moving it under another existing unit', () => {
    assert.deepEqual(Array.from(organizationSubtreeIds(units, 'chapter')).sort(), ['chapter', 'department'])
    assert.deepEqual(validateOrganizationMove(units, 'department', 'other'), { ok: true })
    assert.deepEqual(validateOrganizationMove(units, 'chapter', null), { ok: true })
    assert.equal(organizationParentTypeMatches('DNA', 'ROOT'), true)
    assert.equal(organizationParentTypeMatches('CHAPTER', 'DNA'), false)
    assert.equal(organizationParentTypeMatches('DEPARTMENT', 'CHAPTER'), true)
  })

  it('rejects self/descendant cycles, unknown units, and parenting a ROOT', () => {
    assert.deepEqual(validateOrganizationMove(units, 'chapter', 'chapter'), { ok: false, code: 'OrganizationCycle' })
    assert.deepEqual(validateOrganizationMove(units, 'chapter', 'department'), { ok: false, code: 'OrganizationCycle' })
    assert.deepEqual(validateOrganizationMove(units, 'missing', null), { ok: false, code: 'OrganizationUnitNotFound' })
    assert.deepEqual(validateOrganizationMove(units, 'chapter', 'missing'), { ok: false, code: 'OrganizationParentNotFound' })
    assert.deepEqual(validateOrganizationMove(units, 'root', 'other-root'), { ok: false, code: 'OrganizationParentTypeInvalid' })
    assert.deepEqual(validateOrganizationMove(units, 'department', 'root'), { ok: false, code: 'OrganizationParentTypeInvalid' })
  })

  it('renders a stable nested order and remains finite for corrupt legacy cycles', () => {
    const ordered = orderOrganizationTree(units).map(({ unit, depth }) => [unit.id, depth])
    assert.deepEqual(ordered, [['other-root', 0], ['root', 0], ['chapter', 1], ['department', 2], ['other', 1]])
    const cyclic = orderOrganizationTree([
      { id: 'cycle-a', parentId: 'cycle-b' },
      { id: 'cycle-b', parentId: 'cycle-a' },
    ])
    assert.equal(cyclic.length, 2)
    assert.deepEqual(new Set(cyclic.map(({ unit }) => unit.id)), new Set(['cycle-a', 'cycle-b']))
  })
})

describe('quiz question pools', () => {
  const identityShuffle = <T>(items: readonly T[]) => [...items]
  const pools = Array.from({ length: 5 }, (_, index) => ({ id: `pool-${index + 1}` }))
  const questions = pools.flatMap((pool, poolIndex) => Array.from({ length: 4 }, (_, questionIndex) => ({
    id: `${pool.id}-question-${questionIndex + 1}`,
    poolId: pool.id,
    poolIndex,
  })))

  it('selects the requested question count evenly from every pool', () => {
    const selection = selectQuizQuestions(pools, questions, identityShuffle)
    assert.equal(selection.ok, true)
    if (!selection.ok) return
    assert.equal(selection.mode, 'POOLED')
    assert.equal(selection.questions.length, 20)
    assert.equal(new Set(selection.questions.map((question) => question.id)).size, 20)
    for (const pool of pools) {
      assert.equal(selection.questions.filter((question) => question.poolId === pool.id).length, 4)
    }
  })

  it('supports a variable number of pools and rejects more than twenty', () => {
    const partial = selectQuizQuestions(pools.slice(0, 4), questions.filter((question) => question.poolId !== 'pool-5'), identityShuffle, 10)
    assert.equal(partial.ok, true)
    assert.deepEqual(selectQuizQuestions([...pools, ...Array.from({ length: 16 }, (_, index) => ({ id: `extra-${index}` }))], questions, identityShuffle), {
      ok: false,
      code: 'QuestionPoolCountInvalid',
    })
  })

  it('redistributes from small pools and rejects empty or unassigned pools', () => {
    const redistributed = selectQuizQuestions(
      pools,
      questions.filter((question) => question.poolId !== pools[0].id || question.id !== `${pools[0].id}-question-4`)
        .filter((question) => question.poolId !== pools[0].id || question.id !== `${pools[0].id}-question-3`),
      identityShuffle,
      15,
    )
    assert.equal(redistributed.ok, true)

    assert.deepEqual(selectQuizQuestions(pools, questions.filter((question) => question.poolId !== pools[0].id), identityShuffle), {
      ok: false, code: 'QuestionPoolIncomplete',
    })

    assert.deepEqual(selectQuizQuestions(
      pools,
      [...questions, { id: 'unassigned-question', poolId: null }],
      identityShuffle,
    ), { ok: false, code: 'QuestionPoolQuestionUnassigned' })
  })

  it('preserves all-question behavior only for genuinely legacy assessments', () => {
    const legacy = [{ id: 'q1', poolId: null }, { id: 'q2', poolId: null }]
    const selection = selectQuizQuestions([], legacy, identityShuffle)
    assert.equal(selection.ok, true)
    if (selection.ok) {
      assert.equal(selection.mode, 'LEGACY')
      assert.equal(selection.questions.length, 2)
    }
    assert.deepEqual(selectQuizQuestions([], questions, identityShuffle), {
      ok: false,
      code: 'QuestionPoolCountInvalid',
    })
  })
})

describe('quiz pool admin assignment validation', () => {
  const questionIds = Array.from({ length: 15 }, (_, index) => `question-${index + 1}`)
  const assignments = questionIds.map((questionId, index) => ({ questionId, poolIndex: Math.floor(index / 3) }))

  it('accepts a complete mapping with at least one question in each pool', () => {
    const result = validateQuizPoolAssignments(5, questionIds, assignments)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(Object.keys(result.poolIndexByQuestionId).length, 15)
      assert.equal(result.poolIndexByQuestionId['question-15'], 4)
    }
  })

  it('rejects missing, duplicate, unknown, out-of-range, and incomplete assignments', () => {
    assert.deepEqual(validateQuizPoolAssignments(5, questionIds, assignments.slice(1)), {
      ok: false, code: 'QuestionPoolAssignmentInvalid',
    })
    assert.deepEqual(validateQuizPoolAssignments(5, questionIds, [
      ...assignments.slice(0, -1), assignments[0],
    ]), { ok: false, code: 'QuestionPoolAssignmentInvalid' })
    assert.deepEqual(validateQuizPoolAssignments(5, questionIds, [
      ...assignments.slice(0, -1), { questionId: 'not-a-question', poolIndex: 4 },
    ]), { ok: false, code: 'QuestionPoolAssignmentInvalid' })
    assert.deepEqual(validateQuizPoolAssignments(5, questionIds, [
      ...assignments.slice(0, -1), { questionId: 'question-15', poolIndex: 5 },
    ]), { ok: false, code: 'QuestionPoolAssignmentInvalid' })
    const emptyLastPool = assignments.map((item) => item.poolIndex === 4 ? { ...item, poolIndex: 3 } : item)
    assert.deepEqual(validateQuizPoolAssignments(5, questionIds, emptyLastPool), { ok: false, code: 'QuestionPoolIncomplete' })
  })
})
