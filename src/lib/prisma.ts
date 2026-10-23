import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.PRISMA_QUERY_LOG === '1'
    ? [{ emit: 'event', level: 'query' }, 'error']
    : process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
})
if (process.env.PRISMA_QUERY_LOG === '1') {
  ;(prisma as any).$on('query', (event: any) => console.log(`[SQL ${event.duration}ms] ${event.query}`))
}

// Always cache prisma instance on globalThis for warm serverless lambdas on Vercel
globalForPrisma.prisma = prisma
