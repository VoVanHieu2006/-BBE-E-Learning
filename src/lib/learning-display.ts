export interface LearnerDisplayState {
  canView?: boolean; isNew?: boolean; quizIsNew?: boolean; assessmentPassed?: boolean
  completed?: boolean; lessonCompleted?: boolean; videoCompleted?: boolean
}

/** Video completion is sticky; a quiz added later must still be passed. */
export function allCourseLessonsDone(sessions: any[], progressSessions: any[]): boolean {
  const states = new Map<string, LearnerDisplayState>(progressSessions.flatMap(s => (s.lessons || []).map((l: any) => [l.lessonId || l.id, l])))
  const lessons = sessions.flatMap(s => s.lessons || [])
  return lessons.length > 0 && lessons.every(l => {
    const state = states.get(l.lessonId || l.id)
    return Boolean(state && (state.videoCompleted ?? state.completed ?? state.lessonCompleted) && (!l.assessment || state.assessmentPassed))
  })
}
