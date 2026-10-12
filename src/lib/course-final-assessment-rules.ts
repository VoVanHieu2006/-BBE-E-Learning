export interface CourseFinalLessonRequirement {
  videoComplete: boolean
  assessmentId: string | null
}

/** Pure gate rules used before a learner may start a course-final assessment. */
export function evaluateCourseFinalRequirements(
  lessons: CourseFinalLessonRequirement[],
  passedAssessmentIds: ReadonlySet<string>,
) {
  if (lessons.length === 0) {
    return { ok: false as const, code: 'CourseHasNoLessons', message: 'Khóa học chưa có nội dung để thi cuối khóa.' }
  }
  if (lessons.some((lesson) => !lesson.videoComplete)) {
    return { ok: false as const, code: 'CourseVideosIncomplete', message: 'Bạn cần xem hoàn tất 100% tất cả video trong khóa học trước khi thi cuối khóa.' }
  }
  if (lessons.some((lesson) => lesson.assessmentId && !passedAssessmentIds.has(lesson.assessmentId))) {
    return { ok: false as const, code: 'LessonAssessmentsIncomplete', message: 'Bạn cần đạt tất cả quiz từng bài học trước khi thi cuối khóa.' }
  }
  return { ok: true as const }
}
