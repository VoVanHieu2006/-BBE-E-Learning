import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('--- CLEANUP DATABASE AND RESET USER ---');

  // 1. User tnguynn1509@gmail.com reset
  const targetUser = await prisma.user.findFirst({
    where: { email: { contains: 'tnguynn1509' } },
  });

  if (targetUser) {
    console.log(`Found user: ${targetUser.email} (${targetUser.id})`);

    const delLp = await prisma.lessonProgress.deleteMany({
      where: { user_id: targetUser.id },
    });
    console.log(`Deleted ${delLp.count} LessonProgress records`);

    const delClp = await prisma.cycleLessonProgress.deleteMany({
      where: { user_id: targetUser.id },
    });
    console.log(`Deleted ${delClp.count} CycleLessonProgress records`);

    const delAtt = await prisma.attempt.deleteMany({
      where: { user_id: targetUser.id },
    });
    console.log(`Deleted ${delAtt.count} Attempt records`);

    const delReplay = await prisma.monthlyVideoReplay.deleteMany({
      where: { user_id: targetUser.id },
    });
    console.log(`Deleted ${delReplay.count} MonthlyVideoReplay records`);

    const delStars = await prisma.starLedger.deleteMany({
      where: { user_id: targetUser.id },
    });
    console.log(`Deleted ${delStars.count} StarLedger records`);

    console.log(`Reset all learning progress for ${targetUser.email} successfully.`);
  } else {
    console.log('User tnguynn1509@gmail.com not found!');
  }

  // 2. Fix sort_order for course 5a701947-f65a-4c65-ad76-108c84403ace
  const targetCourseId = '5a701947-f65a-4c65-ad76-108c84403ace';
  const course = await prisma.course.findUnique({
    where: { id: targetCourseId },
    include: { sessions: { include: { lessons: true } } },
  });

  if (course && course.sessions.length > 0) {
    const session = course.sessions[0];
    console.log(`Normalizing lessons in course: ${course.title} (Session: ${session.id})`);
    
    // Sort lessons canonically: Kiếp Má Hồng = 1, Vách Ngọc Ngà = 2
    for (const lesson of session.lessons) {
      let newOrder = 1;
      if (lesson.title.includes('Kiếp Má Hồng')) {
        newOrder = 1;
      } else if (lesson.title.includes('Vách Ngọc Ngà')) {
        newOrder = 2;
      }
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { sort_order: newOrder },
      });
      console.log(`  Set lesson "${lesson.title}" -> sort_order: ${newOrder}`);
    }
  }

  // 3. Remove dummy/empty "Chapter đẹp trai"
  const deletedDepTrai = await prisma.chapter.deleteMany({
    where: { name: 'Chapter đẹp trai' },
  });
  console.log(`Deleted empty "Chapter đẹp trai": ${deletedDepTrai.count}`);

  // 4. Clean up duplicate test reorganizations in Chapter Demo (keep the latest applied one)
  const chapterDemo = await prisma.chapter.findFirst({
    where: { name: 'Chapter Demo' },
  });

  if (chapterDemo) {
    const reorgs = await prisma.chapterReorganization.findMany({
      where: { chapter_id: chapterDemo.id, status: 'APPLIED' },
      orderBy: { applied_at: 'desc' },
    });

    if (reorgs.length > 1) {
      // Keep the latest one, remove older duplicate test batches
      const [latest, ...older] = reorgs;
      console.log(`Chapter Demo has ${reorgs.length} reorgs. Keeping latest (${latest.id} applied at ${latest.applied_at?.toISOString()}), removing ${older.length} duplicate interim batches.`);
      
      const olderIds = older.map((o) => o.id);
      await prisma.chapterReorganizationItem.deleteMany({
        where: { reorganization_id: { in: olderIds } },
      });
      await prisma.chapterReorganization.deleteMany({
        where: { id: { in: olderIds } },
      });
      console.log(`Cleaned up ${olderIds.length} duplicate reorg batches.`);
    }

    // Ensure Chapter Demo has an active GREEN KPI for 2026-10
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (admin) {
      await prisma.chapterMonthlyKpi.upsert({
        where: {
          chapter_id_month_start: {
            chapter_id: chapterDemo.id,
            month_start: monthStart,
          },
        },
        update: { status: 'GREEN' },
        create: {
          chapter_id: chapterDemo.id,
          month_start: monthStart,
          status: 'GREEN',
          note: 'KPI tháng hiện tại',
          configured_by_user_id: admin.id,
        },
      });
      console.log(`Ensured Chapter Demo has GREEN KPI for ${monthStart.toISOString().slice(0, 7)}`);
    }
  }

  console.log('--- CLEANUP COMPLETED SUCCESSFULLY ---');
}

main()
  .catch((e) => {
    console.error('Cleanup failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
