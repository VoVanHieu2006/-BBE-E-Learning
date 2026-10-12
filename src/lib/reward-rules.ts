/** Keep video rewards bounded so very long videos do not dominate the Star economy. */
export function starsForVideoDuration(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 120) return 0
  return Math.min(5, Math.max(1, Math.ceil((durationSeconds / 60) / 3)))
}

/** A passed quiz grants 2 Stars, plus up to 3 for each full 5-point band above the pass mark. */
export function starsForQuizScore(scoreRatio: number, passRatio = 0.85): number {
  if (!Number.isFinite(scoreRatio) || !Number.isFinite(passRatio)) return 0
  const score = Math.min(1, Math.max(0, scoreRatio))
  const threshold = Math.min(1, Math.max(0, passRatio))
  if (score < threshold) return 0

  // A tiny epsilon prevents 95% (for example) from falling just below a band
  // because of binary floating-point representation.
  const bonus = Math.min(3, Math.max(0, Math.floor((score - threshold) / 0.05 + 1e-9)))
  return 2 + bonus
}

/** A final exam gives 3 Stars for passing, plus up to 2 Stars for high scores. */
export function starsForCourseFinalScore(scoreRatio: number, passRatio = 0.85): { passStars: number; bonusStars: number } {
  if (!Number.isFinite(scoreRatio) || !Number.isFinite(passRatio) || scoreRatio < passRatio) {
    return { passStars: 0, bonusStars: 0 }
  }
  const score = Math.min(1, Math.max(0, scoreRatio))
  const bonusStars = Math.min(2, Math.max(0, Math.floor((score - passRatio) / 0.05 + 1e-9)))
  return { passStars: 3, bonusStars }
}
