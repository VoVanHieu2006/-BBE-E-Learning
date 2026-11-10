import { readinessForReason } from './learning-readiness-rules'

export async function readLearningReadiness(at = new Date()) {
  return { ...readinessForReason('READY'), asOf: at }
}
