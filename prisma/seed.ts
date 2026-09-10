/**
 * BBE E-Learning — Full Development Seed
 *
 * - Xoá toàn bộ records (giữ schema/migration), seed lại 1 Admin + dữ liệu realistic.
 * - Điểm attempt lưu dạng ratio 0..1 (passed khi >= 0.85) — khớp submit route.
 * - Chạy: npm run db:seed   (hoặc prisma migrate reset sẽ gọi seed này)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

require("dotenv").config({ path: ".env" });

const prisma = new PrismaClient();

const SHARED_PASSWORD = "Password123!";

// ---------- Helpers ----------
function daysAgo(n: number, hour = 9): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function wipeAll(): Promise<void> {
  console.log("🧹 Wiping all records (FK-safe order)...");
  // Con -> cha
  await prisma.auditLog.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.attemptAnswer.deleteMany();
  await prisma.attemptQuestion.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.questionOption.deleteMany();
  await prisma.question.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.lessonProgress.deleteMany();
  await prisma.document.deleteMany();
  await prisma.video.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.session.deleteMany();
  await prisma.course.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.chapterMember.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.user.deleteMany();
}

interface UserSpec {
  name: string;
  email: string;
  role: "ADMIN" | "CHAPTER_LEADER" | "MEMBER";
  chapter?: string;
  status?: "ACTIVE" | "INACTIVE" | "LOCKED";
}

async function main(): Promise<void> {
  console.log("🌱 Starting full seed...");

  const adminEmail = process.env.ADMIN_EMAIL || "bbetrainerteam@gmail.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123!";

  await wipeAll();

  const passwordHash = await bcrypt.hash(SHARED_PASSWORD, 12);
  const adminHash = await bcrypt.hash(adminPassword, 12);

  // ==========================================================
  // 1. CHAPTERS
  // ==========================================================
  console.log("📚 Creating chapters...");
  const chapters = await Promise.all(
    [
      {
        name: "Chi hội Hà Nội",
        description: "Chi hội khu vực phía Bắc — tập trung đào tạo kỹ năng số và ngoại ngữ.",
        created: 120,
      },
      {
        name: "Chi hội TP. Hồ Chí Minh",
        description: "Chi hội khu vực phía Nam — đào tạo chuyên sâu quản trị và tài chính.",
        created: 110,
      },
      {
        name: "Chi hội Đà Nẵng",
        description: "Chi hội khu vực miền Trung — đào tạo kỹ năng mềm và truyền thông.",
        created: 95,
      },
    ].map((c) =>
      prisma.chapter.create({
        data: { name: c.name, description: c.description, status: "ACTIVE", created_at: daysAgo(c.created) },
      })
    )
  );
  const [hn, hcm, dn] = chapters;

  // ==========================================================
  // 2. USERS (1 Admin + 3 BĐHU + 8 TV + 1 TV khoá)
  // ==========================================================
  console.log("👤 Creating users...");
  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      password_hash: adminHash,
      role: "ADMIN",
      status: "ACTIVE",
      created_at: daysAgo(365),
    },
  });

  const userSpecs: UserSpec[] = [
    { name: "Nguyễn Phương Hoa", email: "phuong.hoa@bbe.vn", role: "CHAPTER_LEADER", chapter: hn.id },
    { name: "Trần Quốc Bảo", email: "quoc.bao@bbe.vn", role: "CHAPTER_LEADER", chapter: hcm.id },
    { name: "Lê Thị Mai Anh", email: "mai.anh@bbe.vn", role: "CHAPTER_LEADER", chapter: dn.id },
    { name: "Phạm Văn Đức", email: "van.duc@bbe.vn", role: "MEMBER", chapter: hn.id },
    { name: "Vũ Ngọc Linh", email: "ngoc.linh@bbe.vn", role: "MEMBER", chapter: hn.id },
    { name: "Đặng Thu Trang", email: "thu.trang@bbe.vn", role: "MEMBER", chapter: hn.id },
    { name: "Hoàng Minh Tuấn", email: "minh.tuan@bbe.vn", role: "MEMBER", chapter: hcm.id },
    { name: "Bùi Khánh Vy", email: "khanh.vy@bbe.vn", role: "MEMBER", chapter: hcm.id },
    { name: "Ngô Gia Hưng", email: "gia.hung@bbe.vn", role: "MEMBER", chapter: hcm.id },
    { name: "Đỗ Bảo Châu", email: "bao.chau@bbe.vn", role: "MEMBER", chapter: dn.id },
    { name: "Lý Thanh Hà", email: "thanh.ha@bbe.vn", role: "MEMBER", chapter: dn.id },
  ];

  const users: Record<string, { id: string; email: string; role: string }> = {};
  let dayOffset = 300;
  for (const spec of userSpecs) {
    const u = await prisma.user.create({
      data: {
        email: spec.email,
        password_hash: passwordHash,
        role: spec.role,
        status: "ACTIVE",
        created_at: daysAgo(dayOffset),
      },
    });
    users[spec.email] = { id: u.id, email: u.email, role: u.role };
    if (spec.chapter) {
      await prisma.chapterMember.create({
        data: { chapter_id: spec.chapter, user_id: u.id, joined_at: daysAgo(dayOffset - 2) },
      });
    }
    dayOffset -= 15;
  }

  // 1 tài khoản TV bị khoá (test RBAC/account inactive)
  const lockedUser = await prisma.user.create({
    data: {
      email: "locked.member@bbe.vn",
      password_hash: passwordHash,
      role: "MEMBER",
      status: "LOCKED",
      created_at: daysAgo(80),
    },
  });
  await prisma.chapterMember.create({
    data: { chapter_id: dn.id, user_id: lockedUser.id, joined_at: daysAgo(78) },
  });

  // ==========================================================
  // 3. COURSES → SESSIONS → LESSONS (Video/Document)
  // ==========================================================
  console.log("🎓 Creating courses, sessions, lessons...");
  const yt = (id: string, dur: number, title: string) => ({ id, dur, title });

  interface LessonSpec {
    title: string;
    desc: string;
    video: { id: string; dur: number; title: string };
    doc?: { name: string; key: string; mime: string; size: number };
  }
  interface CourseSpec {
    title: string;
    description: string;
    status: "DRAFT" | "PUBLISHED";
    visibility: "PUBLIC" | "PRIVATE";
    sessions: { title: string; lessons: LessonSpec[] }[];
    publishedAgo?: number;
  }

  const courseSpecs: CourseSpec[] = [
    {
      title: "Tin học văn phòng cơ bản",
      description:
        "Nắm vững Word, Excel, PowerPoint từ con số 0. Khoá học nền tảng dành cho mọi thành viên mới.",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      publishedAgo: 90,
      sessions: [
        {
          title: "Microsoft Word — Soạn thảo văn bản",
          lessons: [
            { title: "Làm quen với giao diện Word", desc: "Cơ bản về Ribbon, trang, và định dạng chữ.", video: yt("S-QqTDbsuBA", 720, "Word cơ bản bài 1") },
            { title: "Định dạng văn bản chuyên nghiệp", desc: "Style, heading, bảng mục lục tự động.", video: yt("S-QqTDbsuBA", 840, "Word cơ bản bài 2") },
            { title: "Thực hành: soạn công văn chuẩn", desc: "Bài tập thực hành theo mẫu công văn nhà nước.", video: yt("S-QqTDbsuBA", 900, "Word cơ bản bài 3") },
          ],
        },
        {
          title: "Microsoft Excel — Bảng tính",
          lessons: [
            { title: "Công thức và hàm cơ bản", desc: "SUM, AVERAGE, IF và tham chiếu ô.", video: yt("S-QqTDbsuBA", 780, "Excel cơ bản bài 1"), doc: { name: "excel-cheatsheet.pdf", key: "courses/excel/cheatsheet.pdf", mime: "application/pdf", size: 524288 } },
            { title: "Vẽ biểu đồ trực quan hoá dữ liệu", desc: "Chọn đúng loại biểu đồ cho từng loại dữ liệu.", video: yt("S-QqTDbsuBA", 960, "Excel cơ bản bài 2") },
          ],
        },
        {
          title: "PowerPoint — Thuyết trình",
          lessons: [
            { title: "Thiết kế slide đẹp và hiệu quả", desc: "Nguyên tắc 1 slide - 1 ý, typography, màu sắc.", video: yt("S-QqTDbsuBA", 660, "PPT cơ bản bài 1") },
          ],
        },
      ],
    },
    {
      title: "Kỹ năng thuyết trình hiệu quả",
      description: "Tự tin trước đám đông, cấu trúc bài nói thuyết phục và xử lý câu hỏi khó.",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      publishedAgo: 75,
      sessions: [
        {
          title: "Nền tảng thuyết trình",
          lessons: [
            { title: "Vượt qua nỗi sợ nói trước đám đông", desc: "Kỹ thuật thở, chuẩn bị tinh thần.", video: yt("S-QqTDbsuBA", 540, "Thuyết trình bài 1") },
            { title: "Cấu trúc bài thuyết trình 3 phần", desc: "Mở đầu cuốn hút — thân bài logic — kết thúc đắt giá.", video: yt("S-QqTDbsuBA", 720, "Thuyết trình bài 2") },
          ],
        },
        {
          title: "Thực chiến và phản biện",
          lessons: [
            { title: "Kỹ thuật xử lý câu hỏi khó", desc: "Phương pháp bridging và làm rõ câu hỏi.", video: yt("S-QqTDbsuBA", 600, "Thuyết trình bài 3") },
            { title: "Ngôn ngữ cơ thể trên sân khấu", desc: "Ánh mắt, tư thế, đi lại và cử chỉ.", video: yt("S-QqTDbsuBA", 480, "Thuyết trình bài 4"), doc: { name: "body-language-checklist.pdf", key: "courses/presenting/checklist.pdf", mime: "application/pdf", size: 314572 } },
          ],
        },
      ],
    },
    {
      title: "Quản lý tài chính cá nhân",
      description: "Lập ngân sách, tiết kiệm và đầu tư thông minh cho người mới bắt đầu.",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      publishedAgo: 60,
      sessions: [
        {
          title: "Nền tảng tài chính",
          lessons: [
            { title: "Quy tắc 50/30/20 trong chi tiêu", desc: "Cách phân bổ thu nhập hợp lý nhất.", video: yt("S-QqTDbsuBA", 690, "Tài chính bài 1") },
            { title: "Xây dựng quỹ dự phòng 6 tháng", desc: "Vì sao và cách tạo quỹ khẩn cấp.", video: yt("S-QqTDbsuBA", 570, "Tài chính bài 2") },
          ],
        },
        {
          title: "Đầu tư cơ bản",
          lessons: [
            { title: "Hiểu về lãi suất kép", desc: "Cỗ máy thời gian của đồng tiền.", video: yt("S-QqTDbsuBA", 540, "Tài chính bài 3") },
            { title: "Các kênh đầu tư phổ biến tại Việt Nam", desc: "Gửi tiết kiệm, chứng khoán, quỹ mở — ưu nhược điểm.", video: yt("S-QqTDbsuBA", 810, "Tài chính bài 4"), doc: { name: "investment-comparison.xlsx", key: "courses/finance/comparison.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 786432 } },
          ],
        },
      ],
    },
    {
      title: "Tiếng Anh giao tiếp cơ bản",
      description: "Khoá PRIVATE dành cho thành viên chi hội — 100 mẫu câu giao tiếp hàng ngày.",
      status: "PUBLISHED",
      visibility: "PRIVATE",
      publishedAgo: 45,
      sessions: [
        {
          title: "Giao tiếp cơ bản",
          lessons: [
            { title: "Chào hỏi và giới thiệu bản thân", desc: "Mẫu câu giới thiệu tên, nghề nghiệp, quê quán.", video: yt("S-QqTDbsuBA", 630, "Tiếng Anh bài 1") },
            { title: "Tiếng Anh trong công việc", desc: "Email, họp, trao đổi với đồng nghiệp.", video: yt("S-QqTDbsuBA", 750, "Tiếng Anh bài 2") },
          ],
        },
      ],
    },
    {
      title: "An toàn thông tin trong thời đại số",
      description: "Bảo vệ tài khoản, nhận diện lừa đảo trực tuyến và an toàn trên mạng xã hội.",
      status: "PUBLISHED",
      visibility: "PUBLIC",
      publishedAgo: 30,
      sessions: [
        {
          title: "Bảo mật tài khoản",
          lessons: [
            { title: "Tạo và quản lý mật khẩu mạnh", desc: "Password manager, 2FA và thói quen an toàn.", video: yt("S-QqTDbsuBA", 600, "Bảo mật bài 1") },
            { title: "Nhận diện email và tin nhắn lừa đảo", desc: "Dấu hiệu nhận biết phishing.", video: yt("S-QqTDbsuBA", 540, "Bảo mật bài 2") },
          ],
        },
      ],
    },
    {
      title: "Lãnh đạo và quản lý đội nhóm",
      description: "Khoá DRAFT đang xây dựng — dự kiến phát hành quý tới.",
      status: "DRAFT",
      visibility: "PRIVATE",
      sessions: [
        {
          title: "Nền tảng lãnh đạo",
          lessons: [
            { title: "Phong cách lãnh đạo hiện đại", desc: "Servant leadership và coaching mindset.", video: yt("S-QqTDbsuBA", 720, "Lãnh đạo bài 1") },
          ],
        },
      ],
    },
  ];

  const courses: Record<string, string> = {}; // title -> id
  const lessonsByCourse: Record<string, string[]> = {}; // courseTitle -> lessonIds
  const lessonVideoDuration: Record<string, number> = {}; // lessonId -> duration

  for (const cs of courseSpecs) {
    const course = await prisma.course.create({
      data: {
        title: cs.title,
        description: cs.description,
        status: cs.status,
        visibility: cs.visibility,
        created_by: admin.id,
        published_at: cs.publishedAgo ? daysAgo(cs.publishedAgo) : null,
        created_at: daysAgo((cs.publishedAgo || 40) + 14),
      },
    });
    courses[cs.title] = course.id;
    lessonsByCourse[cs.title] = [];

    for (let si = 0; si < cs.sessions.length; si++) {
      const sessionSpec = cs.sessions[si];
      const session = await prisma.session.create({
        data: {
          course_id: course.id,
          title: sessionSpec.title,
          sort_order: si + 1,
          description: `Học phần ${si + 1} của khoá ${cs.title}.`,
        },
      });
      for (let li = 0; li < sessionSpec.lessons.length; li++) {
        const ls = sessionSpec.lessons[li];
        const lesson = await prisma.lesson.create({
          data: {
            session_id: session.id,
            title: ls.title,
            description: ls.desc,
            sort_order: li + 1,
          },
        });
        await prisma.video.create({
          data: {
            lesson_id: lesson.id,
            provider: "YOUTUBE",
            youtube_video_id: ls.video.id,
            duration_seconds: ls.video.dur,
            title: ls.video.title,
          },
        });
        lessonVideoDuration[lesson.id] = ls.video.dur;
        lessonsByCourse[cs.title].push(lesson.id);
        if (ls.doc) {
          await prisma.document.create({
            data: {
              lesson_id: lesson.id,
              file_name: ls.doc.name,
              storage_key: ls.doc.key,
              mime_type: ls.doc.mime,
              file_size: BigInt(ls.doc.size),
            },
          });
        }
      }
    }
  }

  // ==========================================================
  // 4. ASSESSMENTS (1 khoá học = 1 quiz), QUESTIONS + OPTIONS
  // ==========================================================
  console.log("📝 Creating assessments, questions, options...");
  interface QSpec {
    text: string;
    type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE";
    options: { text: string; correct: boolean }[];
    explanation: string;
  }
  const assessmentSpecs: Record<string, QSpec[]> = {
    "Tin học văn phòng cơ bản": [
      {
        text: "Trong Word, phím tắt nào dùng để lưu tài liệu?",
        type: "SINGLE_CHOICE",
        options: [{ text: "Ctrl + S", correct: true }, { text: "Ctrl + P", correct: false }, { text: "Ctrl + N", correct: false }, { text: "Ctrl + W", correct: false }],
        explanation: "Ctrl + S là phím tắt chuẩn để lưu tài liệu trong hầu hết ứng dụng văn phòng.",
      },
      {
        text: "Hàm nào trong Excel dùng để tính tổng một vùng dữ liệu?",
        type: "SINGLE_CHOICE",
        options: [{ text: "SUM", correct: true }, { text: "COUNT", correct: false }, { text: "MAX", correct: false }, { text: "AVERAGE", correct: false }],
        explanation: "Hàm SUM cộng tổng các giá trị trong vùng chọn.",
      },
      {
        text: "Những phát biểu nào đúng về PowerPoint?",
        type: "MULTIPLE_CHOICE",
        options: [
          { text: "Một slide nên truyền tải một ý chính", correct: true },
          { text: "Nên nhồi càng nhiều chữ càng tốt vào slide", correct: false },
          { text: "Có thể chèn video và hình ảnh vào slide", correct: true },
          { text: "Presenter View giúp người nói thấy ghi chú riêng", correct: true },
        ],
        explanation: "Slide hiệu quả tập trung vào một ý; chữ quá nhiều làm người xem mất tập trung.",
      },
      {
        text: "Ctrl + C là phím tắt để sao chép dữ liệu đang chọn.",
        type: "TRUE_FALSE",
        options: [{ text: "Đúng", correct: true }, { text: "Sai", correct: false }],
        explanation: "Ctrl + C = Copy, Ctrl + X = Cut, Ctrl + V = Paste.",
      },
    ],
    "Kỹ năng thuyết trình hiệu quả": [
      {
        text: "Cấu trúc bài thuyết trình hiệu quả gồm 3 phần nào?",
        type: "SINGLE_CHOICE",
        options: [{ text: "Mở đầu — Thân bài — Kết luận", correct: true }, { text: "Chào hỏi — Đọc slide — Kết thúc", correct: false }, { text: "Tiểu sử — Dữ liệu — Hỏi đáp", correct: false }, { text: "Bối cảnh — Câu chuyện — Trình chiếu", correct: false }],
        explanation: "Ba phần kinh điển: mở đầu cuốn hút, thân bài logic, kết thúc đắt giá.",
      },
      {
        text: "Khi bị hỏi câu hỏi ngoài phạm vi, nên phản ứng thế nào?",
        type: "SINGLE_CHOICE",
        options: [{ text: "Ghi nhận câu hỏi và hẹn trao đổi sau", correct: true }, { text: "Im lặng để né tránh", correct: false }, { text: "Tranh luận đến cùng với người hỏi", correct: false }, { text: "Bỏ qua và đổi chủ đề ngay", correct: false }],
        explanation: "Kỹ thuật bridging: ghi nhận, trả lời ngắn và hẹn trao đổi riêng sau buổi nói.",
      },
      {
        text: "Ngôn ngữ cơ thể nào giúp tăng sự tự tin khi thuyết trình?",
        type: "MULTIPLE_CHOICE",
        options: [
          { text: "Giao tiếp bằng mắt với khán giả", correct: true },
          { text: "Đứng thẳng, tư thế mở", correct: true },
          { text: "Cúi mặt nhìn vào giấy đọc suốt buổi", correct: false },
          { text: "Cử chỉ tay minh hoạ ý nói", correct: true },
        ],
        explanation: "Ánh mắt và tư thế mở tạo kết nối; đọc giấy liên tục phá vỡ sự kết nối đó.",
      },
    ],
    "Quản lý tài chính cá nhân": [
      {
        text: "Theo quy tắc 50/30/20, phần nào dành cho tiết kiệm và đầu tư?",
        type: "SINGLE_CHOICE",
        options: [{ text: "20% thu nhập", correct: true }, { text: "30% thu nhập", correct: false }, { text: "50% thu nhập", correct: false }, { text: "10% thu nhập", correct: false }],
        explanation: "50% nhu cầu thiết yếu, 30% mong muốn, 20% tiết kiệm & đầu tư.",
      },
      {
        text: "Quỹ dự phòng nên đủ chi trả cho bao lâu?",
        type: "SINGLE_CHOICE",
        options: [{ text: "3–6 tháng chi tiêu", correct: true }, { text: "1 tháng chi tiêu", correct: false }, { text: "10 năm chi tiêu", correct: false }, { text: "Không cần quỹ dự phòng", correct: false }],
        explanation: "Quỹ dự phòng 3–6 tháng giúp vượt qua biến cố mất việc, ốm đau.",
      },
      {
        text: "Lãi suất kép giúp tiền sinh sôi nhanh hơn theo thời gian.",
        type: "TRUE_FALSE",
        options: [{ text: "Đúng", correct: true }, { text: "Sai", correct: false }],
        explanation: "Lãi nhập vốn làm giá trị tăng theo hàm mũ theo thời gian.",
      },
    ],
    "Tiếng Anh giao tiếp cơ bản": [
      {
        text: "Which phrase is best to introduce yourself?",
        type: "SINGLE_CHOICE",
        options: [{ text: "Nice to meet you, my name is...", correct: true }, { text: "Goodbye, see you later", correct: false }, { text: "What is your problem?", correct: false }, { text: "I am hungry", correct: false }],
        explanation: "\"Nice to meet you, my name is...\" là cách giới thiệu lịch sự nhất.",
      },
      {
        text: "\"Could you please send me the report?\" là câu yêu cầu lịch sự.",
        type: "TRUE_FALSE",
        options: [{ text: "Đúng", correct: true }, { text: "Sai", correct: false }],
        explanation: "Could you please... là mẫu câu yêu cầu lịch sự trong công việc.",
      },
    ],
    "An toàn thông tin trong thời đại số": [
      {
        text: "Yếu tố nào tạo nên một mật khẩu mạnh?",
        type: "SINGLE_CHOICE",
        options: [{ text: "Dài, trộn chữ hoa/thường, số và ký tự đặc biệt", correct: true }, { text: "Dùng ngày sinh của mình", correct: false }, { text: "Dùng chung một mật khẩu cho mọi trang", correct: false }, { text: "Dùng tên thú cưng", correct: false }],
        explanation: "Mật khẩu mạnh: độ dài tối thiểu 12 ký tự, đa dạng loại ký tự, không tái sử dụng.",
      },
      {
        text: "Những dấu hiệu nào của email lừa đảo (phishing)?",
        type: "MULTIPLE_CHOICE",
        options: [
          { text: "Địa chỉ người gửi lạ, giống nhưng không đúng tên miền", correct: true },
          { text: "Tạo cảm giác khẩn cấp, đe dọa khoá tài khoản", correct: true },
          { text: "Yêu cầu nhập mật khẩu qua link đính kèm", correct: true },
          { text: "Chữ ký công ty đầy đủ, đúng chính tả toàn bộ", correct: false },
        ],
        explanation: "Phishing thường tạo áp lực khẩn cấp và đánh cắp thông tin qua link giả.",
      },
      {
        text: "Xác thực hai yếu tố (2FA) giúp bảo vệ tài khoản kể cả khi mật khẩu bị lộ.",
        type: "TRUE_FALSE",
        options: [{ text: "Đúng", correct: true }, { text: "Sai", correct: false }],
        explanation: "2FA yêu cầu yếu tố thứ hai, khiến kẻ xấu khó truy cập dù có mật khẩu.",
      },
    ],
  };

  // Lưu câu hỏi + option theo course để build attempt nhất quán
  const questionBank: Record<string, { id: string; type: string; correctOptionIds: string[]; optionIds: string[]; points: number }[]> = {};

  for (const [courseTitle, questions] of Object.entries(assessmentSpecs)) {
    const courseId = courses[courseTitle];
    const assessment = await prisma.assessment.create({
      data: {
        course_id: courseId,
        title: `Bài kiểm tra cuối khoá — ${courseTitle}`,
        description: "Trả lời đúng ít nhất 85% để vượt qua bài kiểm tra.",
        created_by: admin.id,
        created_at: daysAgo(25),
      },
    });
    questionBank[courseTitle] = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const question = await prisma.question.create({
        data: {
          assessment_id: assessment.id,
          question_text: q.text,
          question_type: q.type,
          points: 1,
          duration_seconds: 45,
          sort_order: qi + 1,
          explanation: q.explanation,
        },
      });
      const opts = await Promise.all(
        q.options.map((o, oi) =>
          prisma.questionOption.create({
            data: { question_id: question.id, option_text: o.text, is_correct: o.correct, sort_order: oi + 1 },
          })
        )
      );
      questionBank[courseTitle].push({
        id: question.id,
        type: q.type,
        correctOptionIds: opts.filter((_, i) => q.options[i].correct).map((o) => o.id),
        optionIds: opts.map((o) => o.id),
        points: 1,
      });
    }
  }

  // ==========================================================
  // 5. LESSON PROGRESS (thành viên học bài)
  // ==========================================================
  console.log("📈 Creating lesson progress...");
  // Kịch bản:
  //  - van.duc (HN): học gần hết 2 khoá đầu
  //  - ngoc.linh (HN): học ~50% khoá 1
  //  - minh.tuan (HCM): học hết khoá thuyết trình
  //  - khanh.vy (HCM): học ~1/3 khoá tài chính
  //  - bao.chau (DN): mới bắt đầu khoá 1
  const progressPlans: { email: string; courseTitle: string; completeCount: number; inProgressIdx?: number }[] = [
    { email: "van.duc@bbe.vn", courseTitle: "Tin học văn phòng cơ bản", completeCount: 6, inProgressIdx: 0 },
    { email: "van.duc@bbe.vn", courseTitle: "Kỹ năng thuyết trình hiệu quả", completeCount: 3, inProgressIdx: 0 },
    { email: "ngoc.linh@bbe.vn", courseTitle: "Tin học văn phòng cơ bản", completeCount: 3, inProgressIdx: 1 },
    { email: "minh.tuan@bbe.vn", courseTitle: "Kỹ năng thuyết trình hiệu quả", completeCount: 4 },
    { email: "minh.tuan@bbe.vn", courseTitle: "Tin học văn phòng cơ bản", completeCount: 2, inProgressIdx: 1 },
    { email: "khanh.vy@bbe.vn", courseTitle: "Quản lý tài chính cá nhân", completeCount: 2, inProgressIdx: 1 },
    { email: "bao.chau@bbe.vn", courseTitle: "Tin học văn phòng cơ bản", completeCount: 1, inProgressIdx: 0 },
    { email: "thu.trang@bbe.vn", courseTitle: "Tiếng Anh giao tiếp cơ bản", completeCount: 2 },
    { email: "gia.hung@bbe.vn", courseTitle: "An toàn thông tin trong thời đại số", completeCount: 1, inProgressIdx: 1 },
    { email: "thanh.ha@bbe.vn", courseTitle: "Kỹ năng thuyết trình hiệu quả", completeCount: 1, inProgressIdx: 0 },
  ];

  for (const plan of progressPlans) {
    const lessonIds = lessonsByCourse[plan.courseTitle] || [];
    const userId = users[plan.email].id;
    for (let i = 0; i < lessonIds.length; i++) {
      const completed = i < plan.completeCount;
      const inProgress = !completed && plan.inProgressIdx === i;
      if (!completed && !inProgress) continue;
      const dur = lessonVideoDuration[lessonIds[i]] || 600;
      const watchedAt = daysAgo(Math.max(3, 20 - i * 2), 15);
      await prisma.lessonProgress.create({
        data: {
          user_id: userId,
          lesson_id: lessonIds[i],
          completed,
          completed_at: completed ? watchedAt : null,
          last_position_seconds: completed ? dur : Math.floor(dur * 0.4),
          furthest_watched_position_seconds: completed ? dur : Math.floor(dur * 0.4),
          last_watched_at: watchedAt,
        },
      });
    }
  }

  // ==========================================================
  // 6. ATTEMPTS (quiz) — score là ratio 0..1, passed khi >= 0.85
  // ==========================================================
  console.log("🏆 Creating quiz attempts...");
  interface AttemptSpec {
    email: string;
    courseTitle: string;
    correctRatio: number; // 0..1 số câu đúng / tổng câu
    attemptNumber: number;
    daysAgoN: number;
  }
  const attemptSpecs: AttemptSpec[] = [
    { email: "van.duc@bbe.vn", courseTitle: "Tin học văn phòng cơ bản", correctRatio: 1.0, attemptNumber: 1, daysAgoN: 18 },
    { email: "van.duc@bbe.vn", courseTitle: "Kỹ năng thuyết trình hiệu quả", correctRatio: 2 / 3, attemptNumber: 1, daysAgoN: 12 },
    { email: "van.duc@bbe.vn", courseTitle: "Kỹ năng thuyết trình hiệu quả", correctRatio: 1.0, attemptNumber: 2, daysAgoN: 10 },
    { email: "ngoc.linh@bbe.vn", courseTitle: "Tin học văn phòng cơ bản", correctRatio: 3 / 4, attemptNumber: 1, daysAgoN: 8 },
    { email: "minh.tuan@bbe.vn", courseTitle: "Kỹ năng thuyết trình hiệu quả", correctRatio: 1.0, attemptNumber: 1, daysAgoN: 15 },
    { email: "minh.tuan@bbe.vn", courseTitle: "Tin học văn phòng cơ bản", correctRatio: 0.5, attemptNumber: 1, daysAgoN: 7 },
    { email: "khanh.vy@bbe.vn", courseTitle: "Quản lý tài chính cá nhân", correctRatio: 2 / 3, attemptNumber: 1, daysAgoN: 6 },
    { email: "thu.trang@bbe.vn", courseTitle: "Tiếng Anh giao tiếp cơ bản", correctRatio: 1.0, attemptNumber: 1, daysAgoN: 5 },
    { email: "gia.hung@bbe.vn", courseTitle: "An toàn thông tin trong thời đại số", correctRatio: 0.5, attemptNumber: 1, daysAgoN: 4 },
    { email: "bao.chau@bbe.vn", courseTitle: "Tin học văn phòng cơ bản", correctRatio: 0.25, attemptNumber: 1, daysAgoN: 3 },
  ];

  for (const spec of attemptSpecs) {
    const questions = questionBank[spec.courseTitle];
    const userId = users[spec.email].id;
    const courseId = courses[spec.courseTitle];
    const assessment = await prisma.assessment.findUnique({ where: { course_id: courseId } });
    if (!assessment || !questions) continue;

    const startedAt = daysAgo(spec.daysAgoN, 14);
    const submittedAt = new Date(startedAt.getTime() + 12 * 60 * 1000); // làm bài 12 phút
    const correctCount = Math.round(spec.correctRatio * questions.length);
    const ratio = correctCount / questions.length;
    const passed = ratio >= 0.85;

    const attempt = await prisma.attempt.create({
      data: {
        assessment_id: assessment.id,
        user_id: userId,
        attempt_number: spec.attemptNumber,
        status: "SUBMITTED",
        started_at: startedAt,
        expires_at: new Date(startedAt.getTime() + 30 * 60 * 1000),
        submitted_at: submittedAt,
        score: Math.round(ratio * 100) / 100,
        passed,
      },
    });

    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const isCorrect = qi < correctCount;
      await prisma.attemptQuestion.create({
        data: { attempt_id: attempt.id, question_id: q.id, display_order: qi + 1 },
      });
      // Câu đúng: chọn đáp án đúng đầu tiên. Câu sai: chọn 1 option sai.
      const selectedId = isCorrect
        ? q.correctOptionIds[0]
        : q.optionIds.find((id) => !q.correctOptionIds.includes(id)) || null;
      await prisma.attemptAnswer.create({
        data: {
          attempt_id: attempt.id,
          question_id: q.id,
          selected_option_id: selectedId,
          answered_at: new Date(startedAt.getTime() + (qi + 1) * 90 * 1000),
          is_correct: isCorrect,
        },
      });
    }
  }

  // 1 attempt IN_PROGRESS (test tính năng tiếp tục làm bài)
  const resumeAssessment = await prisma.assessment.findUnique({ where: { course_id: courses["Tin học văn phòng cơ bản"] } });
  if (resumeAssessment) {
    const startedAt = new Date(Date.now() - 10 * 60 * 1000);
    const inProgress = await prisma.attempt.create({
      data: {
        assessment_id: resumeAssessment.id,
        user_id: users["bao.chau@bbe.vn"].id,
        attempt_number: 2,
        status: "IN_PROGRESS",
        started_at: startedAt,
        expires_at: new Date(startedAt.getTime() + 30 * 60 * 1000),
      },
    });
    const qs = questionBank["Tin học văn phòng cơ bản"];
    for (let qi = 0; qi < qs.length; qi++) {
      await prisma.attemptQuestion.create({
        data: { attempt_id: inProgress.id, question_id: qs[qi].id, display_order: qi + 1 },
      });
    }
  }

  // ==========================================================
  // 7. INVITATIONS
  // ==========================================================
  console.log("✉️  Creating invitations...");
  await prisma.invitation.create({
    data: {
      email: "new.member.hn@gmail.com",
      role: "MEMBER",
      chapter_id: hn.id,
      invited_by: users["phuong.hoa@bbe.vn"].id,
      token_hash: "seed-pending-invite-token-hash-0001",
      status: "PENDING",
      expires_at: daysFromNow(7),
      created_at: daysAgo(1),
    },
  });
  await prisma.invitation.create({
    data: {
      email: "expired.leader.hcm@gmail.com",
      role: "CHAPTER_LEADER",
      chapter_id: hcm.id,
      invited_by: admin.id,
      token_hash: "seed-expired-invite-token-hash-0002",
      status: "EXPIRED",
      expires_at: daysAgo(3),
      created_at: daysAgo(10),
    },
  });
  await prisma.invitation.create({
    data: {
      email: "accepted.member.dn@gmail.com",
      role: "MEMBER",
      chapter_id: dn.id,
      invited_by: users["mai.anh@bbe.vn"].id,
      token_hash: "seed-accepted-invite-token-hash-0003",
      status: "ACCEPTED",
      expires_at: daysAgo(2),
      accepted_at: daysAgo(3),
      created_at: daysAgo(9),
    },
  });

  // ==========================================================
  // 8. AUDIT LOGS (mẫu cho trang admin)
  // ==========================================================
  console.log("🧾 Creating audit logs...");
  const auditSpecs: { actorEmail: string; action: string; entityType: string; entityId: string }[] = [
    { actorEmail: adminEmail, action: "COURSE_PUBLISH", entityType: "Course", entityId: courses["An toàn thông tin trong thời đại số"] },
    { actorEmail: adminEmail, action: "COURSE_CREATE", entityType: "Course", entityId: courses["Lãnh đạo và quản lý đội nhóm"] },
    { actorEmail: "phuong.hoa@bbe.vn", action: "INVITATION_CREATE", entityType: "Invitation", entityId: hn.id },
    { actorEmail: "quoc.bao@bbe.vn", action: "MEMBER_VIEW", entityType: "Chapter", entityId: hcm.id },
    { actorEmail: "van.duc@bbe.vn", action: "ATTEMPT_SUBMIT", entityType: "Assessment", entityId: courses["Tin học văn phòng cơ bản"] },
    { actorEmail: "minh.tuan@bbe.vn", action: "LESSON_COMPLETE", entityType: "Lesson", entityId: lessonsByCourse["Kỹ năng thuyết trình hiệu quả"][0] },
  ];
  for (let i = 0; i < auditSpecs.length; i++) {
    const a = auditSpecs[i];
    await prisma.auditLog.create({
      data: {
        actor_user_id: users[a.actorEmail]?.id || admin.id,
        action: a.action,
        entity_type: a.entityType,
        entity_id: a.entityId,
        metadata: { source: "seed", seq: i + 1 },
        created_at: daysAgo(auditSpecs.length - i),
      },
    });
  }

  // ==========================================================
  // SUMMARY
  // ==========================================================
  const counts = {
    users: await prisma.user.count(),
    chapters: await prisma.chapter.count(),
    chapterMembers: await prisma.chapterMember.count(),
    courses: await prisma.course.count(),
    sessions: await prisma.session.count(),
    lessons: await prisma.lesson.count(),
    videos: await prisma.video.count(),
    documents: await prisma.document.count(),
    lessonProgress: await prisma.lessonProgress.count(),
    assessments: await prisma.assessment.count(),
    questions: await prisma.question.count(),
    questionOptions: await prisma.questionOption.count(),
    attempts: await prisma.attempt.count(),
    attemptQuestions: await prisma.attemptQuestion.count(),
    attemptAnswers: await prisma.attemptAnswer.count(),
    invitations: await prisma.invitation.count(),
    auditLogs: await prisma.auditLog.count(),
  };
  console.log("\n✅ Seed completed. Record counts:");
  console.table(counts);
  console.log(`\n👑 Admin: ${adminEmail} / ${adminPassword}`);
  console.log(`🔑 Shared password for other accounts: ${SHARED_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
