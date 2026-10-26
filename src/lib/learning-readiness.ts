import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { policyReadiness } from './learning-readiness-rules'

/** Read only: readiness must never manufacture policy, periods or snapshots. */
export async function readLearningReadiness(db: Prisma.TransactionClient = prisma, at = new Date()) {
  const policy = await db.learningPolicy.findUnique({ where: { id: 'default' } })
  return { ...policyReadiness(policy, at), policy, asOf: at }
}
