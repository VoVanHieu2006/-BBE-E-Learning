import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== BẮT ĐẦU AUDIT SORT_ORDER CHO SESSIONS VÀ LESSONS ===')

  // 1. Tạo bảng backup an toàn trước khi thực hiện bất kỳ thay đổi nào
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS session_sort_order_backup AS 
      SELECT id, course_id, sort_order, created_at FROM sessions;
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS lesson_sort_order_backup AS 
      SELECT id, session_id, sort_order, created_at FROM lessons;
    `)
    console.log('✓ Đã tạo/kiểm tra bảng backup: session_sort_order_backup và lesson_sort_order_backup')
  } catch (err) {
    console.warn('! Cảnh báo khi tạo bảng backup (có thể do quyền hạn hoặc bảng đã tồn tại):', err)
  }

  // 2. Audit Session sort_order
  const courses = await prisma.course.findMany({
    include: {
      sessions: {
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        include: {
          lessons: {
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
          },
        },
      },
    },
  })

  let sessionAnomalies = 0
  let lessonAnomalies = 0

  for (const course of courses) {
    const sessionOrders = new Map<number, string[]>()
    for (const session of course.sessions) {
      const list = sessionOrders.get(session.sort_order) || []
      list.push(session.id)
      sessionOrders.set(session.sort_order, list)
    }

    const dupSessions = Array.from(sessionOrders.entries()).filter(([order, ids]) => ids.length > 1 || order <= 0)
    if (dupSessions.length > 0) {
      sessionAnomalies++
      console.log(`\n[Khóa học: ${course.title} (${course.id})]`)
      for (const [order, ids] of dupSessions) {
        console.log(`  - Trùng/Sai Session sort_order: ${order} (Có ${ids.length} sessions bị trùng)`)
      }
    }

    // 3. Audit Lesson sort_order trong từng session
    for (const session of course.sessions) {
      const lessonOrders = new Map<number, string[]>()
      for (const lesson of session.lessons) {
        const list = lessonOrders.get(lesson.sort_order) || []
        list.push(lesson.id)
        lessonOrders.set(lesson.sort_order, list)
      }

      const dupLessons = Array.from(lessonOrders.entries()).filter(([order, ids]) => ids.length > 1 || order <= 0)
      if (dupLessons.length > 0) {
        lessonAnomalies++
        console.log(`  [Session: ${session.title} (${session.id})]`)
        for (const [order, ids] of dupLessons) {
          console.log(`    - Trùng/Sai Lesson sort_order: ${order} (Có ${ids.length} bài học bị trùng)`)
        }
      }
    }
  }

  console.log('\n=== KẾT QUẢ AUDIT ===')
  console.log(`Tổng số khóa học kiểm tra: ${courses.length}`)
  console.log(`Số bất thường về Session: ${sessionAnomalies}`)
  console.log(`Số bất thường về Lesson: ${lessonAnomalies}`)

  if (sessionAnomalies === 0 && lessonAnomalies === 0) {
    console.log('✓ Dữ liệu sort_order hiện tại hoàn toàn nhất quán và không bị trùng lặp!')
  } else {
    console.log('! Phát hiện dữ liệu trùng hoặc <= 0 cần chuẩn hóa theo phương án sư phạm.')
  }
}

main()
  .catch((err) => {
    console.error('Lỗi khi chạy script audit:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
