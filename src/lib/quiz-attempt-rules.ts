export interface GradingOption {
  id: string
  text: string
  correct: boolean
}

export interface GradingQuestion {
  id: string
  points: number | null | undefined
  explanation?: string | null
  options: GradingOption[]
}

export interface SubmittedAnswer {
  questionId: string
  selectedOptionId: string | null
}

export type AttemptAnswerValidation =
  | { ok: true; answers: Array<{ questionId: string; selectedOptionId: string }> }
  | { ok: false; code: 'ValidationError' | 'QuestionNotInAttempt' | 'OptionNotInQuestion' }

export function validateAttemptAnswerSelections(
  attemptQuestionIds: Iterable<string>,
  optionQuestionIds: Map<string, string>,
  entries: Array<[string, unknown]>,
): AttemptAnswerValidation {
  const allowedQuestions = new Set(attemptQuestionIds)
  const answers: Array<{ questionId: string; selectedOptionId: string }> = []

  for (const [questionId, selectedOption] of entries) {
    if (selectedOption === null || selectedOption === undefined || selectedOption === '') continue
    if (typeof selectedOption !== 'string') return { ok: false, code: 'ValidationError' }
    if (!allowedQuestions.has(questionId)) return { ok: false, code: 'QuestionNotInAttempt' }
    if (optionQuestionIds.get(selectedOption) !== questionId) {
      return { ok: false, code: 'OptionNotInQuestion' }
    }
    answers.push({ questionId, selectedOptionId: selectedOption })
  }

  return { ok: true, answers }
}

export function gradeQuizAttempt(
  questions: GradingQuestion[],
  answers: SubmittedAnswer[],
  passingRatio: number,
) {
  const answerByQuestion = new Map(answers.map((answer) => [answer.questionId, answer.selectedOptionId]))
  const questionPoints = questions.map((question) => {
    const points = Number(question.points || 1)
    return Number.isFinite(points) && points > 0 ? points : 1
  })
  const totalPoints = questionPoints.reduce((total, points) => total + points, 0)

  const results = questions.map((question, index) => {
    const selectedOptionId = answerByQuestion.get(question.id) || null
    const selectedOption = question.options.find((option) => option.id === selectedOptionId)
    const correctOption = question.options.find((option) => option.correct) || null
    const isCorrect = Boolean(selectedOption?.correct)

    return {
      questionId: question.id,
      isCorrect,
      selectedOptionId,
      correctOptionId: correctOption?.id || null,
      explanation: question.explanation || (correctOption ? `Đáp án đúng: ${correctOption.text}` : null),
      points: questionPoints[index],
    }
  })

  const score = results.reduce((total, result) => total + (result.isCorrect ? result.points : 0), 0)
  const scoreRatio = totalPoints > 0 ? score / totalPoints : 0
  const threshold = Number.isFinite(passingRatio) ? Math.min(Math.max(passingRatio, 0), 1) : 1

  return {
    score,
    totalPoints,
    scoreRatio,
    passed: scoreRatio >= threshold,
    results,
  }
}

/**
 * A submit sent when the countdown hits zero reaches the server slightly after
 * expires_at (latency, a modal waiting for the learner). Inside this window the
 * answers in the request are still graded; after it only answers already saved
 * on the server count, exactly like the scheduled auto-submit.
 */
export const QUIZ_SUBMIT_GRACE_MS = 60_000

export type SubmissionTiming = 'ON_TIME' | 'LATE_WITHIN_GRACE' | 'TOO_LATE'

export function submissionTiming(expiresAt: Date, now: Date, graceMs = QUIZ_SUBMIT_GRACE_MS): SubmissionTiming {
  const late = now.getTime() - expiresAt.getTime()
  if (late < 0) return 'ON_TIME'
  return late <= graceMs ? 'LATE_WITHIN_GRACE' : 'TOO_LATE'
}
