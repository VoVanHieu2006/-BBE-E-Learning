import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { LEARNING_PROGRAMS, LEARNING_TARGETS, suggestLearningProgram } from '@/lib/learning-catalog'
import { normalizeLearningOrganization } from '@/lib/normalize-learning-organization'
import { checkSeasonConfiguration, resolveSeasonForWindow, seasonWindowOf } from '@/lib/transfer-season-lookup'

async function admin(request: NextRequest) {
  const auth = await authenticate(request)
  return auth.ok && auth.context?.role === 'ADMIN' ? auth.context : null
}

export async function GET(request: NextRequest) {
  if (!await admin(request)) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const [policy, programs, targets, courses, pending, failed, seasons] = await Promise.all([
    prisma.learningPolicy.findUnique({ where: { id: 'default' } }),
    prisma.learningProgram.findMany({ orderBy: { sort_order: 'asc' } }),
    prisma.learningTarget.findMany({ orderBy: { sort_order: 'asc' } }),
    prisma.course.findMany({ select: { id: true, title: true, program_id: true, status: true }, orderBy: { title: 'asc' } }),
    prisma.learningOutbox.count({ where: { processed_at: null } }),
    prisma.learningOutbox.findMany({ where: { processed_at: null, last_error: { not: null } }, take: 100, orderBy: { available_at: 'asc' } }),
    prisma.transferSeason.findMany({ orderBy: { starts_at: 'desc' } }),
  ])
  return NextResponse.json({ policy, programs, targets, courses: courses.map((course) => ({ ...course, proposal: suggestLearningProgram(course.title) })), pending, failed, seasons })
}

/** Admin supplies explicit codes/mappings. No title matching or automatic cutover. */
export async function PUT(request: NextRequest) {
  const actor = await admin(request)
  if (!actor) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const body = await request.json().catch(() => null)
  const code = /^[A-Z][A-Z0-9_]{0,99}$/
  if (!body || (body.programs && (!Array.isArray(body.programs) || body.programs.some((row: any) => !code.test(row.code) || typeof row.name !== 'string' || !row.name.trim() || !Number.isInteger(row.sortOrder)))) ||
    (body.targets && (!Array.isArray(body.targets) || body.targets.some((row: any) => !code.test(row.code) || typeof row.label !== 'string' || !row.label.trim() || !Number.isInteger(row.sortOrder))))) {
    return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  }
  try {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('learning-catalog-configuration'))::text`
    const policy = await tx.learningPolicy.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } })
    if (policy.cutover_at && (body.programs || body.targets || body.units || body.normalizeOrganization)) throw new Error('PolicyAlreadyScheduled')
    for (const season of body.seasons || []) {
      const startsAt = new Date(season.startsAt), endsAt = new Date(season.endsAt)
      const boundaryAt = new Date(season.rewardBoundaryAt)
      if (!code.test(season.code)) throw new Error('InvalidSeasonCode')
      const check = checkSeasonConfiguration(startsAt, endsAt, boundaryAt)
      if (!check.ok) throw new Error(check.reason === 'SEASON_BOUNDARY_MISMATCH' ? 'InvalidRewardBoundary' : 'InvalidSeasonWindow')
      const overlap = await tx.transferSeason.count({ where: { code: { not: season.code }, starts_at: { lt: endsAt }, ends_at: { gt: startsAt } } })
      if (overlap) throw new Error('OverlappingTransferSeason')
      const existingSeason = await tx.transferSeason.findUnique({ where: { code: season.code } })
      // A season may be corrected while it is still unused, including the
      // current window. Any APPLIED transfer tied to the season, already
      // attributed to its new window, or sitting in its previous window freezes
      // the configuration. A SCHEDULED batch that still points at this season
      // also freezes it: the worker trusts that link when it applies, so editing
      // the season now could attribute the batch to the wrong window.
      const previousWindow = existingSeason ? seasonWindowOf(existingSeason) : null
      const windows = [
        { startsAt, endsAt },
        ...(previousWindow ? [{ startsAt: previousWindow.startsAt, endsAt: previousWindow.endsAt }] : []),
      ]
      const used = await tx.chapterReorganization.count({
        where: {
          OR: [
            {
              status: 'APPLIED',
              OR: [
                ...(existingSeason ? [{ transfer_season_id: existingSeason.id }] : []),
                ...windows.map((window) => ({ effective_at: { gte: window.startsAt, lt: window.endsAt } })),
              ],
            },
            ...(existingSeason ? [{ status: 'SCHEDULED' as const, transfer_season_id: existingSeason.id }] : []),
          ],
        },
      })
      if (used) throw new Error('TransferSeasonAlreadyUsed')
      await tx.transferSeason.upsert({ where: { code: season.code }, create: { code: season.code, starts_at: startsAt, ends_at: endsAt, reward_boundary_at: boundaryAt }, update: { starts_at: startsAt, ends_at: endsAt, reward_boundary_at: boundaryAt } })
    }
    for (const program of LEARNING_PROGRAMS) await tx.learningProgram.upsert({ where: { code: program.code }, update: {}, create: program })
    for (const target of LEARNING_TARGETS) await tx.learningTarget.upsert({ where: { code: target.code }, update: {}, create: target })
    if (body.normalizeOrganization === true) await normalizeLearningOrganization(tx, actor.userId)
    for (const row of body.programs || []) await tx.learningProgram.upsert({ where: { code: row.code },
      create: { code: row.code, name: row.name.trim(), is_core: row.isCore === true, sort_order: row.sortOrder },
      update: { name: row.name.trim(), is_core: row.isCore === true, sort_order: row.sortOrder },
    })
    for (const row of body.targets || []) await tx.learningTarget.upsert({ where: { code: row.code },
      create: { code: row.code, label: row.label, department_code: row.departmentCode || null, position_code: row.positionCode || null, dna_unit_code: row.dnaUnitCode || null, sort_order: row.sortOrder },
      update: { label: row.label, department_code: row.departmentCode || null, position_code: row.positionCode || null, dna_unit_code: row.dnaUnitCode || null, sort_order: row.sortOrder },
    })
    for (const row of body.courses || []) {
      const program = row.programCode ? await tx.learningProgram.findUniqueOrThrow({ where: { code: row.programCode } }) : null
      if (policy.cutover_at) {
        const course = await tx.course.findUniqueOrThrow({ where: { id: row.courseId } })
        if (course.program_id === (program?.id || null)) continue
        if (course.status === 'PUBLISHED' || course.program_id) throw new Error('PublishedProgramMappingImmutable')
      }
      await tx.course.update({ where: { id: row.courseId }, data: { program_id: program?.id || null } })
    }
    for (const row of body.units || []) {
      if (!code.test(row.code)) throw new Error('InvalidUnitCode')
      await tx.organizationUnit.update({ where: { id: row.unitId }, data: { code: row.code } })
    }
    if (body.retryOutboxIds) {
      if (!Array.isArray(body.retryOutboxIds) || body.retryOutboxIds.length > 100 || body.retryOutboxIds.some((id: unknown) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('InvalidOutboxIds')
      await tx.learningOutbox.updateMany({ where: { id: { in: body.retryOutboxIds }, processed_at: null }, data: { available_at: new Date() } })
    }
    if (!policy.cutover_at && (body.courses || body.programs || body.targets || body.units || body.normalizeOrganization)) await tx.learningPolicy.update({ where: { id: 'default' }, data: { mapping_approved_at: null } })
    await tx.auditLog.create({ data: { actor_user_id: actor.userId, action: 'CONFIGURE_LEARNING_POLICY', entity_type: 'USER', entity_id: actor.userId, metadata: { programCount: body.programs?.length || 0, targetCount: body.targets?.length || 0 } } })
  }, { timeout: 30_000 })
  } catch (error) {
    const code = error instanceof Error && !('code' in error) ? error.message : 'ConfigurationInvalid'
    const messages: Record<string, string> = {
      InvalidSeasonCode: 'Mã mùa chuyển giao không hợp lệ. Mã chỉ gồm chữ in hoa, số và dấu gạch dưới.',
      InvalidRewardBoundary: 'Mốc thưởng phải đúng 01/04 hoặc 01/10 lúc 00:00 giờ Việt Nam và nằm trong mùa chuyển giao.',
      InvalidSeasonWindow: 'Mùa chuyển giao phải trùng đúng một giai đoạn: 01/01–30/06 hoặc 01/07–31/12.',
      OverlappingTransferSeason: 'Khoảng thời gian của mùa chuyển giao bị trùng với một mùa khác. Admin cần điều chỉnh để hai mùa không chồng lên nhau.',
      TransferSeasonAlreadyUsed: 'Mùa này đã có chapter chuyển giao hoặc đang có đợt chờ áp dụng nên không thể sửa. Admin chỉ có thể sửa mùa chưa được sử dụng.',
    }
    return NextResponse.json({ error: { code, message: messages[code] || 'Không lưu được cấu hình. Kiểm tra lại thông tin mùa chuyển giao và các lựa chọn đã nhập.' } }, { status: 409 })
  }
  return NextResponse.json({ saved: true })
}

export async function POST(request: NextRequest) {
  const actor = await admin(request)
  if (!actor) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (process.env.LEARNING_CUTOVER_ENABLED !== 'true') return NextResponse.json({ error: { code: 'ReleaseNotReady', message: 'Cutover chưa được mở trong cấu hình phát hành.' } }, { status: 409 })
  const body = await request.json().catch(() => null)
  const at = new Date(body?.cutoverAt)
  if (!Number.isFinite(at.getTime()) || at <= new Date()) return NextResponse.json({ error: { code: 'FutureCutoverRequired' } }, { status: 400 })
  const result = await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('learning-catalog-configuration'))::text`
  const [programs, targets, unclassified, legacyRules, ambiguousPositions, seasonResolution] = await Promise.all([
    tx.learningProgram.findMany(), tx.learningTarget.findMany(),
    tx.course.count({ where: { status: 'PUBLISHED', program_id: null } }),
    tx.learningRule.count({ where: { effective_until: null, OR: [{ target_code: null }, { target_code: { notIn: LEARNING_TARGETS.map((row) => row.code) } }] } }),
    tx.positionAssignment.count({ where: { position: { code: 'CHAPTER_MANAGER' }, OR: [{ ends_at: null }, { ends_at: { gt: at } }] } }),
    resolveSeasonForWindow(tx, at),
  ])
  if (programs.length !== 4 || LEARNING_PROGRAMS.some((program) => !programs.some((row) => row.code === program.code && row.is_core === program.is_core)) || targets.length !== 18 || LEARNING_TARGETS.some((target) => !targets.some((row) => row.code === target.code)) || unclassified || legacyRules || ambiguousPositions || !seasonResolution.ok) {
    return NextResponse.json({ error: { code: 'MappingIncomplete', message: seasonResolution.message || 'Cần duyệt chương trình, target, rule cũ, chức vụ chưa rõ và cấu hình mùa chuyển giao.', unclassifiedCourses: unclassified, legacyRules, ambiguousPositions, seasonConfigured: seasonResolution.ok } }, { status: 409 })
  }
  const saved = await tx.learningPolicy.updateMany({ where: { id: 'default', cutover_at: null }, data: { cutover_at: at, mapping_approved_at: new Date() } })
  if (!saved.count) return NextResponse.json({ error: { code: 'PolicyAlreadyScheduled' } }, { status: 409 })
  return NextResponse.json({ cutoverAt: at.toISOString() })
  })
  return result
}
