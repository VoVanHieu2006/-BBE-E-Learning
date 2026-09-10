import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'

export async function GET() {
  const checks = {
    database: false,
    r2: false,
    auth: false,
    timestamp: new Date().toISOString(),
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = true
  } catch (e: any) {
    checks.database = false
  }

  try {
    const s3 = new S3Client({
      region: 'auto', endpoint: process.env.R2_ENDPOINT,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    })
    await s3.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET_NAME! }))
    checks.r2 = true
  } catch (e: any) {
    checks.r2 = false
  }

  checks.auth = !!process.env.ADMIN_EMAIL && !!process.env.ADMIN_PASSWORD
  ;(checks as any).jwtAccessSecret = !!process.env.JWT_ACCESS_SECRET
  ;(checks as any).jwtRefreshSecret = !!process.env.JWT_REFRESH_SECRET
  ;(checks as any).tokenHashPepper = !!process.env.TOKEN_HASH_PEPPER

  const healthy = checks.database && checks.r2 && checks.auth && (checks as any).jwtAccessSecret && (checks as any).jwtRefreshSecret
  return NextResponse.json({ status: healthy ? 'healthy' : 'degraded', checks, healthy }, { status: healthy ? 200 : 503 })
}
