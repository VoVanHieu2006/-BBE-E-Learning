# 📦 SEED DATA REPORT — BBE E-Learning (Development)

> **Ngày thực hiện:** 2025-09-09
> **Phạm vi:** Reset toàn bộ records DB development (Supabase PostgreSQL), giữ nguyên schema/migrations, seed lại dữ liệu hợp lệ + realistic + nhất quán.
> **Cách chạy lại:** `npm run db:seed` (script: `prisma/seed.ts`, đã sửa npm script + `prisma/tsconfig.seed.json` để chạy được trên Windows).

---

## 1. Kết quả Reset

- ✅ Xoá sạch **19 bảng** theo đúng thứ tự FK-safe (audit_logs → refresh_tokens → ... → users).
- ✅ **Không** đụng tới schema, migrations, hay bảng (không `migrate reset`, không `db push`).
- ✅ Giữ lại đúng **1 tài khoản Admin duy nhất** trong toàn hệ thống (theo `ADMIN_EMAIL` trong `.env`).

## 2. Tổng quan dữ liệu sau seed

| Entity | Số bản ghi | Ghi chú |
|---|---|---|
| Users | 13 | 1 ADMIN + 3 CHAPTER_LEADER (BĐHU) + 9 MEMBER (8 ACTIVE + 1 LOCKED) |
| Chapters | 3 | Hà Nội / TP.HCM / Đà Nẵng |
| ChapterMembers | 12 | Mỗi user BĐHU/TV thuộc đúng 1 chapter |
| Courses | 6 | 5 PUBLISHED (4 PUBLIC + 1 PRIVATE) + 1 DRAFT |
| Sessions | 10 | 2–3 học phần mỗi khoá |
| Lessons | 19 | 1–3 bài mỗi học phần, có `sort_order` |
| Videos | 19 | Mỗi lesson 1 video YOUTUBE (provider=YOUTUBE, có duration) |
| Documents | 3 | PDF/XLSX gắn lesson, `file_size` BigInt |
| LessonProgress | 26 | Completed + in-progress, `last_position ≤ duration` |
| Assessments | 5 | 1 quiz / khoá PUBLISHED (DRAFT không có) |
| Questions | 15 | Đủ 3 loại: SINGLE_CHOICE, MULTIPLE_CHOICE, TRUE_FALSE |
| QuestionOptions | 52 | Mỗi câu 2–4 options, luôn có ≥1 đáp án đúng |
| Attempts | 11 | 10 SUBMITTED (có score) + 1 IN_PROGRESS (test resume) |
| AttemptQuestions | 38 | 1 dòng / câu / attempt |
| AttemptAnswers | 33 | Câu SUBMITTED đều có option được chọn |
| Invitations | 3 | 1 PENDING + 1 EXPIRED + 1 ACCEPTED |
| AuditLogs | 6 | Các action mẫu cho trang admin |
| RefreshTokens / PasswordResetTokens | 0 | Sinh tự nhiên khi login — không seed |

**Kích thước nhỏ (≈200 bản ghi) — đủ test mọi chức năng, không gây chậm/treo.**

## 3. 🔑 Tài khoản — Name + Email + Password + Role

> **Mật khẩu dùng chung cho mọi tài khoản seeded (trừ Admin): `Password123!`**

| Name | Email | Password | Role | Chapter | Ghi chú |
|---|---|---|---|---|---|
| BBE Admin | `bbetrainerteam@gmail.com` | `BBEelearning123!` | ADMIN | — | Admin duy nhất (từ `.env`) |
| Nguyễn Phương Hoa | `phuong.hoa@bbe.vn` | `Password123!` | CHAPTER_LEADER (BĐHU) | Hà Nội | |
| Trần Quốc Bảo | `quoc.bao@bbe.vn` | `Password123!` | CHAPTER_LEADER (BĐHU) | TP. Hồ Chí Minh | |
| Lê Thị Mai Anh | `mai.anh@bbe.vn` | `Password123!` | CHAPTER_LEADER (BĐHU) | Đà Nẵng | |
| Phạm Văn Đức | `van.duc@bbe.vn` | `Password123!` | MEMBER (TV) | Hà Nội | Học nhiều nhất, đã pass quiz, có leaderboard point 73 |
| Vũ Ngọc Linh | `ngoc.linh@bbe.vn` | `Password123!` | MEMBER (TV) | Hà Nội | |
| Đặng Thu Trang | `thu.trang@bbe.vn` | `Password123!` | MEMBER (TV) | Hà Nội | Pass quiz Tiếng Anh |
| Hoàng Minh Tuấn | `minh.tuan@bbe.vn` | `Password123!` | MEMBER (TV) | TP.HCM | |
| Bùi Khánh Vy | `khanh.vy@bbe.vn` | `Password123!` | MEMBER (TV) | TP.HCM | |
| Ngô Gia Hưng | `gia.hung@bbe.vn` | `Password123!` | MEMBER (TV) | TP.HCM | |
| Đỗ Bảo Châu | `bao.chau@bbe.vn` | `Password123!` | MEMBER (TV) | Đà Nẵng | Có 1 attempt IN_PROGRESS để test resume |
| Lý Thanh Hà | `thanh.ha@bbe.vn` | `Password123!` | MEMBER (TV) | Đà Nẵng | |
| TV bị khoá | `locked.member@bbe.vn` | `Password123!` | MEMBER (TV) | Đà Nẵng | `status=LOCKED` — login phải bị từ chối 403 |

## 4. Kịch bản dữ liệu (realistic & nhất quán)

### Khóa học (6)
| Khoá | Status | Visibility | Sessions/Lessons | Quiz |
|---|---|---|---|---|
| Tin học văn phòng cơ bản | PUBLISHED | PUBLIC | 3 / 6 | ✅ 4 câu |
| Kỹ năng thuyết trình hiệu quả | PUBLISHED | PUBLIC | 2 / 4 | ✅ 3 câu |
| Quản lý tài chính cá nhân | PUBLISHED | PUBLIC | 2 / 4 | ✅ 3 câu |
| Tiếng Anh giao tiếp cơ bản | PUBLISHED | PRIVATE | 1 / 2 | ✅ 2 câu |
| An toàn thông tin trong thời đại số | PUBLISHED | PUBLIC | 1 / 2 | ✅ 3 câu |
| Lãnh đạo và quản lý đội nhóm | DRAFT | PRIVATE | 1 / 1 | ❌ |

### Tiến độ học (LessonProgress) — khớp thực tế
- `van.duc`: Tin học **6/6** (hoàn thành), Thuyết trình **3/4** (đang học)
- `ngoc.linh`: Tin học **3/6** (đang học)
- `minh.tuan`: Thuyết trình **4/4** (hoàn thành), Tin học 2/6
- `khanh.vy`: Tài chính **2/4**; `bao.chau`: Tin học 1/6; `thu.trang`, `gia.hung`, `thanh.ha`: mới bắt đầu

### Điểm quiz (score = ratio 0..1, passed khi ≥ 0.85 — khớp logic submit API)
- 4 attempt đạt (score = 1.0 → passed), 6 attempt chưa đạt (0.25 → 0.75), 1 IN_PROGRESS (không có score)
- `attempt_number` tăng dần khi làm lại (van.duc làm lại Thuyết trình lần 2 và đạt)
- Mọi `attempt_answer.is_correct` khớp đúng/sai với đáp án được chọn

## 5. ✅ Verification kết quả

### 5.1. FK & Data consistency (SQL checks — 15/15 PASS)
Orphan FK (progress/attempt/answer), assessment↔course, question↔options, duplicate unique keys, passed-vs-score threshold, score = correct/total, số admin = 1 — **tất cả PASS, 0 mismatch**.

### 5.2. Login API (HTTP thực qua dev server — 14/14 PASS)
- 12 tài khoản ACTIVE login thành công (đúng role trả về trong response) — ~1.9s/lần (first-compile dev).
- `locked.member@bbe.vn` → **HTTP 403** (bị chặn đúng) ✅
- Sai mật khẩu → **HTTP 401** ✅

### 5.3. RBAC & phân quyền (PASS)
| Test | Kết quả |
|---|---|
| `/courses` anon → 4 PUBLIC-PUBLISHED; MEMBER → 5 PUBLISHED; ADMIN → 6 (thấy DRAFT) | ✅ đúng visibility |
| `/chapters` ADMIN 200; CHAPTER_LEADER/MEMBER → 403 | ✅ |
| `/chapters/{HN}/members` BĐHU HN → 200 (3 members); BĐHU HN xem chapter HCM → **403** | ✅ không lộ chéo chapter |
| `/users` ADMIN 200; MEMBER → 403 | ✅ |
| `/api/v1/*` không token → 401 | ✅ |

### 5.4. Chức năng đọc dữ liệu seed (không loading vô hạn)
- `GET /leaderboard` → van.duc: score **89**, progress **50%**, point **73**, chapter "Chi hội Hà Nội" ✅
- `GET /assessments/{id}/attempts/me` → attempt score **100, passed=true** ✅
- `GET /members/me/courses` → 6/6, 3/4,... khớp đúng progress đã seed ✅
- Tất cả endpoint phản hồi < 3s (dev first-compile), **0 case treo/timeout**.

### 5.5. Sự cố gặp phải & cách xử lý
| Sự cố | Nguyên nhân | Xử lý |
|---|---|---|
| 500 khi GET `/chapters/{id}/members` lần đầu | Test script dùng sai field (`id` thay vì `chapterId` trong response) → URL `chapters/undefined` | Sửa test script → PASS. Lưu ý: route trả 500 thay vì 400 khi `chapterId` không hợp lệ — đề xuất cải tiến (không bắt buộc) |
| `npm run db:seed` lỗi JSON parse trên Windows | npm script quote `--compiler-options '{...}'` sai trên cmd | Tạo `prisma/tsconfig.seed.json` + đổi script thành `ts-node -P prisma/tsconfig.seed.json prisma/seed.ts` |
| Dev server cũ trả kết quả sai sau khi reset DB | Server chạy từ trước khi wipe DB | Restart dev server + xoá `.next` → sạch |

## 6. Script & file thay đổi
| File | Thay đổi |
|---|---|
| `prisma/seed.ts` | **Viết lại hoàn toàn** — full seed (chapters, users, courses, lessons, videos, docs, progress, quiz, attempts, invitations, audit logs) |
| `prisma/tsconfig.seed.json` | **Mới** — tsconfig riêng cho seed (CommonJS) |
| `package.json` | Sửa `db:seed` + `prisma.seed` để chạy được trên Windows |
| `scratch/test-login.js`, `scratch/test-rbac.js`, `scratch/test-rbac2.js`, `scratch/verify-seed.js`, `scratch/test-query.js` | **Mới** — bộ verify có thể chạy lại bất cứ lúc nào |

## 7. Lưu ý
- Video YouTube đang dùng chung 1 placeholder ID (`S-QqTDbsuBA`) — thay bằng ID video thật khi có nội dung.
- Không seed `RefreshToken`/`PasswordResetToken` — chúng sinh tự nhiên khi login/reset.
- Cần re-seed: `npm run db:seed` (script tự wipe rồi seed lại, idempotent).
- ⚠️ **Chỉ dùng cho môi trường development** — script xoá toàn bộ data.
