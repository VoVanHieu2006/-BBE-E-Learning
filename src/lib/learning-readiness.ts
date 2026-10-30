import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { readinessForReason } from './learning-readiness-rules'

/** Read only: readiness never manufactures periods or snapshots. The policy row is historical metadata only. */
export async function readLearningReadiness(db: Prisma.TransactionClient = prisma, at = new Date()) {
  const policy = await db.learningPolicy.findUnique({ where: { id: 'default' } })
  return { ...readinessForReason('READY'), policy, asOf: at }
}
