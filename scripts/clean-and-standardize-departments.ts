import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

import { EXACT_7_BANS } from '../src/lib/departments'

function getStandardName(name: string): string | null {
  const norm = name.trim().toLowerCase()
  if (norm === 'chủ tịch' || norm === 'ban chủ tịch') return 'Chủ tịch'
  if (norm === 'ban chất lượng') return 'Ban chất lượng'
  if (norm === 'ban nội dung') return 'Ban nội dung'
  if (norm === 'ban khách mời') return 'Ban khách mời'
  if (norm === 'ban tt&sk') return 'Ban TT&SK'
  if (norm === 'ban thành viên') return 'Ban Thành viên'
  if (norm === 'ban thư ký') return 'Ban Thư ký'
  return null
}

async function main() {
  console.log('=== TIẾN HÀNH CHUẨN HÓA 7 BAN VÀ GÁN LT / THÀNH VIÊN ===')

  const deptLead = await prisma.position.upsert({
    where: { code: 'DEPARTMENT_LEAD' },
    update: { name: 'LT Ban', scope: 'DEPARTMENT', is_manager: true },
    create: { code: 'DEPARTMENT_LEAD', name: 'LT Ban', scope: 'DEPARTMENT', is_manager: true },
  })
  const memberPos = await prisma.position.upsert({
    where: { code: 'MEMBER' },
    update: { name: 'Thành viên', scope: 'DEPARTMENT', is_manager: false },
    create: { code: 'MEMBER', name: 'Thành viên', scope: 'DEPARTMENT', is_manager: false },
  })
  const chapterManager = await prisma.position.upsert({
    where: { code: 'CHAPTER_MANAGER' },
    update: { name: 'Lead Chapter / Chủ tịch', scope: 'CHAPTER', is_manager: true },
    create: { code: 'CHAPTER_MANAGER', name: 'Lead Chapter / Chủ tịch', scope: 'CHAPTER', is_manager: true },
  })

  // 1. Duyệt qua tất cả các OrganizationUnit là Chapter
  const chapters = await prisma.chapter.findMany({
    where: { organization_unit_id: { not: null } },
    include: {
      chapter_members: {
        include: { user: true },
        orderBy: { joined_at: 'asc' },
      },
    },
  })

  for (const chapter of chapters) {
    const orgUnitId = chapter.organization_unit_id!
    const isDemo = chapter.name.includes('Demo')
    console.log(`\n--- Xử lý Chapter: ${chapter.name} (${chapter.id}) ---`)

    const currentDepts = await prisma.organizationUnit.findMany({
      where: { parent_id: orgUnitId, type: 'DEPARTMENT' },
    })

    // Map chuẩn hóa tên
    const standardMap = new Map<string, string>() // standardName -> unitId

    for (const d of currentDepts) {
      const stdName = getStandardName(d.name)
      if (stdName) {
        // Kiểm tra xem đã có unit nào mang tên stdName trong DB chưa
        const existingWithStdName = currentDepts.find((x) => x.id !== d.id && x.name === stdName)
        if (existingWithStdName) {
          // Gộp d vào existingWithStdName
          await prisma.organizationMembership.updateMany({
            where: { unit_id: d.id },
            data: { unit_id: existingWithStdName.id },
          })
          await prisma.positionAssignment.updateMany({
            where: { unit_id: d.id },
            data: { unit_id: existingWithStdName.id },
          })
          await prisma.learningRule.deleteMany({ where: { organization_unit_id: d.id } })
          await prisma.organizationUnit.delete({ where: { id: d.id } })
          standardMap.set(stdName, existingWithStdName.id)
          console.log(`Đã gộp ban trùng [${d.name}] vào [${stdName}]`)
        } else {
          if (d.name !== stdName) {
            await prisma.organizationUnit.update({ where: { id: d.id }, data: { name: stdName } })
            console.log(`Đổi tên ban [${d.name}] -> [${stdName}]`)
          }
          standardMap.set(stdName, d.id)
        }
      } else {
        // Ban hoàn toàn lỗi thời (e.g. Ban Truyền thông, Ban Nhân sự, Ban Đối ngoại, Ban Sự kiện, Ban Tài chính)
        console.log(`Ban lỗi thời cần xóa: [${d.name}] (${d.id})`)
        await prisma.organizationMembership.deleteMany({ where: { unit_id: d.id } })
        await prisma.positionAssignment.deleteMany({ where: { unit_id: d.id } })
        await prisma.learningRule.deleteMany({ where: { organization_unit_id: d.id } })
        await prisma.organizationUnit.delete({ where: { id: d.id } })
      }
    }

    // Đảm bảo đủ 7 ban chuẩn
    for (const name of EXACT_7_BANS) {
      if (!standardMap.has(name)) {
        const created = await prisma.organizationUnit.create({
          data: { parent_id: orgUnitId, type: 'DEPARTMENT', name },
        })
        standardMap.set(name, created.id)
        console.log(`Tạo mới ban chuẩn: [${name}]`)
      }
    }

    // Nếu là Chapter Demo, phân bổ chính xác 1 Chủ tịch và 6 LT + thành viên
    if (isDemo) {
      console.log('\nPhân bổ chính xác cho Chapter Demo:')
      const allMembers = chapter.chapter_members
      const president = allMembers.find(m => m.user.email === 'chapter.lead.demo@bbe.vn')
        || allMembers.find(m => m.user.role === 'CHAPTER_LEADER')
        || allMembers[0]

      const otherMembers = allMembers.filter(m => m.user_id !== president.user_id)

      const sixBans = [
        'Ban chất lượng',
        'Ban nội dung',
        'Ban khách mời',
        'Ban TT&SK',
        'Ban Thành viên',
        'Ban Thư ký',
      ] as const

      const allDeptIds = Array.from(standardMap.values())
      await prisma.organizationMembership.deleteMany({
        where: { unit_id: { in: allDeptIds } },
      })
      await prisma.positionAssignment.deleteMany({
        where: { unit_id: { in: allDeptIds } },
      })

      // Gán Chủ tịch (1 người duy nhất)
      const chuTichUnitId = standardMap.get('Chủ tịch')!
      await prisma.organizationMembership.create({
        data: {
          user_id: president.user_id,
          unit_id: chuTichUnitId,
          status: 'ACTIVE',
        },
      })
      await prisma.positionAssignment.create({
        data: {
          user_id: president.user_id,
          unit_id: chuTichUnitId,
          position_id: chapterManager.id,
          is_primary: true,
        },
      })
      console.log(`👑 [Chủ tịch]: ${president.user.display_name} (${president.user.email}) - Vừa là thành viên vừa là LT!`)

      // Chọn 6 LT cho 6 ban
      const preferredLtEmails = [
        'department.lead.demo@bbe.vn',
        'member01.demo@bbe.vn',
        'member02.demo@bbe.vn',
        'member03.demo@bbe.vn',
        'member04.demo@bbe.vn',
        'member05.demo@bbe.vn',
      ]
      const lts: typeof otherMembers = []
      for (const email of preferredLtEmails) {
        const found = otherMembers.find(m => m.user.email === email)
        if (found && !lts.includes(found)) lts.push(found)
      }
      for (const m of otherMembers) {
        if (lts.length >= 6) break
        if (!lts.includes(m)) lts.push(m)
      }

      const regularMembers = otherMembers.filter(m => !lts.includes(m))

      console.log('\n--- 6 TRƯỞNG BAN (LT BAN) ---')
      for (let i = 0; i < sixBans.length; i++) {
        const banName = sixBans[i]
        const unitId = standardMap.get(banName)!
        const lt = lts[i]
        await prisma.organizationMembership.create({
          data: {
            user_id: lt.user_id,
            unit_id: unitId,
            status: 'ACTIVE',
          },
        })
        await prisma.positionAssignment.create({
          data: {
            user_id: lt.user_id,
            unit_id: unitId,
            position_id: deptLead.id,
            is_primary: true,
          },
        })
        console.log(`- [${banName}] LT: ${lt.user.display_name} (${lt.user.email})`)
      }

      console.log(`\n--- PHÂN BỔ ${regularMembers.length} THÀNH VIÊN VÀO 6 BAN ---`)
      const regMembershipsData = regularMembers.map((m, i) => ({
        user_id: m.user_id,
        unit_id: standardMap.get(sixBans[i % sixBans.length])!,
        status: 'ACTIVE' as const,
      }))
      const regPositionsData = regularMembers.map((m, i) => ({
        user_id: m.user_id,
        unit_id: standardMap.get(sixBans[i % sixBans.length])!,
        position_id: memberPos.id,
        is_primary: false,
      }))
      await prisma.organizationMembership.createMany({ data: regMembershipsData })
      await prisma.positionAssignment.createMany({ data: regPositionsData })
      console.log(`Đã gán xong ${regularMembers.length} thành viên thường vào 6 ban qua batch createMany.`)
    }
  }

  console.log('\n=== HOÀN TẤT CHUẨN HÓA 7 BAN VÀ GÁN DỮ LIỆU THÀNH CÔNG ===')
}

main()
  .catch((e) => {
    console.error('Lỗi:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
