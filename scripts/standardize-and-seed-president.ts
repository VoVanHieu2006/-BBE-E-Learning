import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { EXACT_7_BANS } from '../src/lib/departments'

const prisma = new PrismaClient()

function getTitleCaseName(name: string): string {
  const norm = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

  if (norm.includes('chu tich')) return 'Chủ Tịch'
  if (norm.includes('chat luong')) return 'Ban Chất Lượng'
  if (norm.includes('noi dung')) return 'Ban Nội Dung'
  if (norm.includes('khach moi')) return 'Ban Khách Mời'
  if (norm.includes('tt') || norm.includes('truyen thong')) return 'Ban TT&SK'
  if (norm.includes('thanh vien')) return 'Ban Thành Viên'
  if (norm.includes('thu ky')) return 'Ban Thư Ký'
  return name.trim()
}

async function main() {
  console.log('=== CHUẨN HÓA TITLE CASE 7 BAN & SEED CHỦ TỊCH CHAPTER MỚI ===')

  // 1. Chuẩn hóa tên tất cả OrganizationUnit có type === 'DEPARTMENT'
  const allDepts = await prisma.organizationUnit.findMany({
    where: { type: 'DEPARTMENT' },
  })

  for (const dept of allDepts) {
    const titleCase = getTitleCaseName(dept.name)
    if (dept.name !== titleCase) {
      console.log(`Đổi tên: "${dept.name}" -> "${titleCase}" (ID: ${dept.id})`)
      await prisma.organizationUnit.update({
        where: { id: dept.id },
        data: { name: titleCase },
      })
    }
  }

  // 2. Tìm Chapter của chapter.lead.demo@bbe.vn
  const leadUser = await prisma.user.findUnique({
    where: { email: 'chapter.lead.demo@bbe.vn' },
    include: {
      chapter_members: {
        include: { chapter: true },
      },
    },
  })

  if (!leadUser || !leadUser.chapter_members.length) {
    console.error('Không tìm thấy user chapter.lead.demo@bbe.vn hoặc chapter!')
    return
  }

  const demoChapter = leadUser.chapter_members[0].chapter
  console.log(`Tìm thấy Chapter: ${demoChapter.name} (${demoChapter.id})`)


  const chapterUnitId = demoChapter.organization_unit_id

  // Đảm bảo cả 7 Ban chuẩn đều tồn tại trong Chapter Demo
  const currentDepts = await prisma.organizationUnit.findMany({
    where: { parent_id: chapterUnitId, type: 'DEPARTMENT' },
  })

  const deptMap = new Map<string, string>()
  for (const dept of currentDepts) {
    deptMap.set(dept.name, dept.id)
  }

  for (const standardName of EXACT_7_BANS) {
    if (!deptMap.has(standardName)) {
      const created = await prisma.organizationUnit.create({
        data: {
          parent_id: chapterUnitId,
          type: 'DEPARTMENT',
          name: standardName,
        },
      })
      deptMap.set(standardName, created.id)
      console.log(`Đã tạo ban mới thiếu: ${standardName}`)
    }
  }

  // 3. Tạo/Cập nhật tài khoản Chủ Tịch mới
  const presidentEmail = 'chutich.demo@bbe.vn'
  const passwordHash = await bcrypt.hash('Demo@123456', 12)

  let presidentUser = await prisma.user.findUnique({
    where: { email: presidentEmail },
  })

  if (!presidentUser) {
    presidentUser = await prisma.user.create({
      data: {
        email: presidentEmail,
        display_name: 'Nguyễn Văn Chủ Tịch',
        password_hash: passwordHash,
        role: 'MEMBER',
        status: 'ACTIVE',
      },
    })
    console.log(`Đã tạo tài khoản Chủ Tịch mới: ${presidentEmail}`)
  } else {
    presidentUser = await prisma.user.update({
      where: { id: presidentUser.id },
      data: {
        display_name: 'Nguyễn Văn Chủ Tịch',
        role: 'MEMBER',
        status: 'ACTIVE',
      },
    })
    console.log(`Đã cập nhật tài khoản Chủ Tịch: ${presidentEmail}`)
  }

  // Thêm vào chapterMember nếu chưa có
  await prisma.chapterMember.upsert({
    where: {
      chapter_id_user_id: {
        chapter_id: demoChapter.id,
        user_id: presidentUser.id,
      },
    },
    update: {},
    create: {
      chapter_id: demoChapter.id,
      user_id: presidentUser.id,
    },
  })

  // Đảm bảo có vị trí DEPARTMENT_LEAD
  const leadPos = await prisma.position.upsert({
    where: { code: 'DEPARTMENT_LEAD' },
    update: { name: 'LT Ban', scope: 'DEPARTMENT', is_manager: true },
    create: { code: 'DEPARTMENT_LEAD', name: 'LT Ban', scope: 'DEPARTMENT', is_manager: true },
  })

  const chuTichUnitId = deptMap.get('Chủ Tịch')!

  // Xóa mọi thành viên khác khỏi ban Chủ Tịch (đặc biệt là chapter.lead.demo@bbe.vn)
  if (leadUser) {
    await prisma.organizationMembership.deleteMany({
      where: {
        user_id: leadUser.id,
        unit_id: { in: Array.from(deptMap.values()) },
      },
    })
    await prisma.positionAssignment.deleteMany({
      where: {
        user_id: leadUser.id,
        unit_id: { in: Array.from(deptMap.values()) },
      },
    })
    console.log(`Đã rút ${leadUser.email} ra khỏi các Ban của Chapter (giữ nguyên quyền Chapter Leader của Chapter Unit)`)
  }

  // Xóa membership cũ trong ban Chủ Tịch
  await prisma.organizationMembership.deleteMany({
    where: { unit_id: chuTichUnitId },
  })
  await prisma.positionAssignment.deleteMany({
    where: { unit_id: chuTichUnitId },
  })

  // Gán chutich.demo@bbe.vn làm Chủ Tịch duy nhất
  await prisma.organizationMembership.create({
    data: {
      user_id: presidentUser.id,
      unit_id: chuTichUnitId,
      status: 'ACTIVE',
      starts_at: new Date('2025-01-01'),
    },
  })

  await prisma.positionAssignment.create({
    data: {
      user_id: presidentUser.id,
      unit_id: chuTichUnitId,
      position_id: leadPos.id,
      is_primary: true,
      starts_at: new Date('2025-01-01'),
    },
  })

  console.log(`Đã gán thành công ${presidentUser.email} làm Chủ Tịch trong ban [Chủ Tịch]`)
  console.log('=== HOÀN TẤT CHUẨN HÓA VÀ SEED CHỦ TỊCH ===')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
