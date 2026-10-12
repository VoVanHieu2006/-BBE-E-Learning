import { NextRequest, NextResponse } from 'next/server'
import { applyDueChapterReorganizations } from '@/lib/chapter-reorganizations'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')
  if (!secret || authorization !== `Bearer ${secret}`) return NextResponse.json({ error: { code: 'Unauthorized' } }, { status: 401 })
  const applied = await applyDueChapterReorganizations()
  return NextResponse.json({ applied })
}
