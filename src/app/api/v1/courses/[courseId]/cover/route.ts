import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateCoursesServerCache } from '@/lib/server-cache'

export const runtime = 'nodejs'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function cloudinaryConfig() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

/** Server-side Cloudinary upload: credentials and signature never reach the browser. */
export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const config = cloudinaryConfig()
  if (!config) return NextResponse.json({ error: { code: 'CloudinaryNotConfigured', message: 'Cloudinary environment variables are missing.' } }, { status: 503 })

  const course = await prisma.course.findUnique({ where: { id: params.courseId }, select: { id: true, status: true } })
  if (!course) return NextResponse.json({ error: { code: 'CourseNotFound' } }, { status: 404 })
  if (course.status === 'PUBLISHED') return NextResponse.json({ error: { code: 'CoursePublished', message: 'Unpublish the course before changing its cover.' } }, { status: 409 })

  const data = await request.formData().catch(() => null)
  const file = data?.get('file')
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: { code: 'InvalidImage', message: 'Upload a JPG, PNG, or WebP image up to 8 MB.' } }, { status: 400 })
  }

  const timestamp = Math.floor(Date.now() / 1000)
  const folder = process.env.CLOUDINARY_FOLDER || 'course-covers'
  const publicId = `course-${course.id}`
  const signatureBase = `folder=${folder}&overwrite=true&public_id=${publicId}&timestamp=${timestamp}${config.apiSecret}`
  const signature = crypto.createHash('sha1').update(signatureBase).digest('hex')
  const upload = new FormData()
  upload.set('file', file, file.name)
  upload.set('api_key', config.apiKey)
  upload.set('timestamp', String(timestamp))
  upload.set('folder', folder)
  upload.set('public_id', publicId)
  upload.set('overwrite', 'true')
  upload.set('signature', signature)

  const cloudinaryResponse = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, { method: 'POST', body: upload })
  const payload = await cloudinaryResponse.json().catch(() => ({})) as { secure_url?: string; public_id?: string; error?: { message?: string } }
  if (!cloudinaryResponse.ok || !payload.secure_url || !payload.public_id) {
    return NextResponse.json({ error: { code: 'CloudinaryUploadFailed', message: payload.error?.message || 'Cloudinary rejected the image.' } }, { status: 502 })
  }

  const updated = await prisma.course.update({
    where: { id: course.id }, data: { cover_url: payload.secure_url, cover_public_id: payload.public_id },
    select: { id: true, cover_url: true, cover_public_id: true },
  })
  invalidateCoursesServerCache()
  return NextResponse.json({ courseId: updated.id, coverUrl: updated.cover_url, coverPublicId: updated.cover_public_id })
}
