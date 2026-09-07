
BBE E-LEARNING — API DESIGN

Base path: /api/v1 Response lỗi chuẩn hoá: { "error": { "code": "STRING_CODE", "message": "..." } } Tất cả API danh sách hỗ trợ page, limit (mặc định 20, tối đa 100), trả kèm totalItems, totalPages. Tất cả API (trừ mục đánh dấu Public) yêu cầu header Authorization: Bearer <accessToken></accesstoken>.

MODULE 1 — AUTHENTICATION & ACCOUNT

1.1 SendChapterLeaderInvitation

Thuộc tính

Nội dung

Use case

SendChapterLeaderInvitation

Actor

Admin

Method + Path

POST /api/v1/invitations/chapter-leader

Request Body

email, chapterName, chapterDescription?

Authorization

role = ADMIN

Processing

Tạo chapter mới (status ACTIVE) trong cùng transaction → tạo invitation (role=CHAPTER_LEADER, chapterId vừa tạo, token ngẫu nhiên, hash lưu DB) → gửi email chứa link kèm token

Business rule

Không tạo invitation nếu email đã gắn tài khoản Active (BR-02); chapter name phải unique

Output

invitationId, chapterId, status: "PENDING", expiresAt

Errors

Unauthorized, EmailAlreadyActive, ChapterNameConflict, ValidationError

1.2 SendMemberInvitation

Thuộc tính

Nội dung

Use case

SendMemberInvitation

Actor

BĐHU (Chapter Leader)

Method + Path

POST /api/v1/invitations/member

Request Body

email (chapterId lấy từ token của actor, không cho truyền tay)

Authorization

role = CHAPTER_LEADER, account Active

Processing

Tạo invitation (role=MEMBER, chapterId = chapter của BĐHU) → gửi email

Business rule

Không tạo nếu email đã Active (BR-02); BĐHU chỉ mời vào chapter của chính mình (OQ-05 → mặc định KHÔNG cho mời ngoài chapter, cần Admin xác nhận lại)

Output

invitationId, chapterId, status: "PENDING", expiresAt

Errors

Unauthorized, EmailAlreadyActive, AccessDenied, ValidationError

1.3 ResendInvitation

Thuộc tính

Nội dung

Use case

ResendInvitation

Actor

Admin, BĐHU

Method + Path

POST /api/v1/invitations/{invitationId}/resend

Request Body

—

Authorization

Admin: bất kỳ invitation nào mình gửi; BĐHU: chỉ invitation do mình gửi trong chapter mình

Processing

Nếu status = PENDING → vô hiệu token cũ, sinh token mới, gia hạn expiresAt = now + 24h, gửi lại email. Nếu status = EXPIRED/CANCELLED → tạo lại vòng đời invitation (status → PENDING, token mới)

Business rule

Không resend invitation đã ACCEPTED (BR-02)

Output

invitationId, status: "PENDING", expiresAt

Errors

Unauthorized, AccessDenied, InvitationNotFound, InvalidState (đã Accepted)

1.4 CancelInvitation

Thuộc tính

Nội dung

Use case

CancelInvitation

Actor

Admin, BĐHU

Method + Path

DELETE /api/v1/invitations/{invitationId}

Request Body

—

Authorization

Giống 1.3 — chỉ huỷ invitation mình có quyền quản lý, và phải đang PENDING

Processing

Cập nhật status → CANCELLED, cancelledAt = now, vô hiệu token

Business rule

Chỉ huỷ được khi PENDING (BR-02)

Output

invitationId, status: "CANCELLED"

Errors

Unauthorized, AccessDenied, InvitationNotFound, InvalidState

1.5 GetInvitationList

Thuộc tính

Nội dung

Use case

GetInvitationList

Actor

Admin, BĐHU

Method + Path

GET /api/v1/invitations?status=&chapterId=&page=&limit=

Request Params

status?, chapterId? (Admin only), page, limit

Authorization

Admin: xem toàn bộ; BĐHU: chỉ xem invitation do mình gửi / trong chapter mình

Processing

Query có filter theo actor scope, kèm join account status hiện tại của email đó

Business rule

BĐHU không thấy invitation của chapter khác

Output

items: [{ invitationId, email, chapterId, invitedBy, status, createdAt, expiresAt, accountStatus }], totalItems, totalPages

Errors

Unauthorized, AccessDenied

1.6 AcceptInvitation (Public — tạo mật khẩu)

Thuộc tính

Nội dung

Use case

AcceptInvitation

Actor

Guest (người nhận email)

Method + Path

POST /api/v1/invitations/accept

Request Body

token, password, confirmPassword

Authorization

Không cần đăng nhập — xác thực bằng token hợp lệ

Processing

Verify token hash + chưa hết hạn + status=PENDING → tạo/kích hoạt user (status=ACTIVE, role theo invitation) → gắn chapter_members → invitation.status = ACCEPTED, acceptedAt = now

Business rule

Token dùng 1 lần (BR-02); token hết hạn sau 24h

Output

userId, email, role, status: "ACTIVE"

Errors

InvitationNotFound, TokenExpired, TokenAlreadyUsed, PasswordMismatch, WeakPassword

1.7 Login

Thuộc tính

Nội dung

Use case

Login

Actor

Admin, BĐHU, Member

Method + Path

POST /api/v1/auth/login

Request Body

email, password

Authorization

Public

Processing

Kiểm tra email tồn tại → so khớp password_hash → nếu sai, tăng failed_login_count; nếu đúng, reset counter, phát accessToken + refreshToken

Business rule

10 lần sai liên tiếp → status = LOCKED (FR-AUTH); tài khoản Inactive/Locked không login được

Output

accessToken, refreshToken, user: { id, email, role, status, chapterId }

Errors

InvalidCredentials, AccountInactive, AccountLocked

1.8 Logout

Thuộc tính

Nội dung

Use case

Logout

Actor

Đã đăng nhập

Method + Path

POST /api/v1/auth/logout

Request Body

refreshToken

Authorization

Bearer token hợp lệ

Processing

Thu hồi (revoke) refreshToken hiện tại

Business rule

—

Output

success: true

Errors

Unauthorized

1.9 RequestPasswordReset

Thuộc tính

Nội dung

Use case

RequestPasswordReset

Actor

Guest

Method + Path

POST /api/v1/auth/password-reset/request

Request Body

email

Authorization

Public

Processing

Nếu email tồn tại → tạo password_reset_tokens (expires 15 phút) → gửi email. Luôn trả cùng 1 message dù email có tồn tại hay không (chống dò email)

Business rule

Không tiết lộ email có tồn tại hay không

Output

message: "Nếu email tồn tại, link đặt lại mật khẩu đã được gửi"

Errors

ValidationError

1.10 ResetPassword

Thuộc tính

Nội dung

Use case

ResetPassword

Actor

Guest (giữ link reset)

Method + Path

POST /api/v1/auth/password-reset/confirm

Request Body

token, newPassword, confirmPassword

Authorization

Public — xác thực bằng token

Processing

Verify token chưa hết hạn/chưa dùng → cập nhật password_hash → token.used_at = now → nếu account đang LOCKED thì chuyển về ACTIVE, reset failed_login_count

Business rule

Token hết hạn sau 15 phút, dùng 1 lần (FR-AUTH)

Output

success: true

Errors

TokenExpired, TokenAlreadyUsed, PasswordMismatch, WeakPassword

1.11 GetCurrentUser

Thuộc tính

Nội dung

Use case

GetCurrentUser

Actor

Đã đăng nhập

Method + Path

GET /api/v1/users/me

Authorization

Bearer token hợp lệ

Processing

Trả thông tin user + chapter hiện tại (nếu có)

Output

id, email, role, status, chapterId, chapterName

Errors

Unauthorized

MODULE 2 — CHAPTER & ACCOUNT MANAGEMENT

2.1 GetChapterList

Thuộc tính

Nội dung

Use case

GetChapterList

Actor

Admin

Method + Path

GET /api/v1/chapters?page=&limit=

Authorization

role = ADMIN

Processing

Trả danh sách chapter kèm số lượng thành viên hiện Active

Output

items: [{ chapterId, name, status, memberCount }], totalItems

Errors

Unauthorized

2.2 GetChapterMembers

Thuộc tính

Nội dung

Use case

GetChapterMembers

Actor

Admin (mọi chapter), BĐHU (chỉ chapter mình)

Method + Path

GET /api/v1/chapters/{chapterId}/members?status=&search=&page=&limit=

Authorization

Admin: bất kỳ chapterId; BĐHU: chapterId phải trùng chapter của actor

Processing

Trả danh sách user role=MEMBER (Admin xem thêm được role=CHAPTER_LEADER) kèm status tài khoản

Business rule

BĐHU không truy cập chapter khác (FR-DB)

Output

items: [{ userId, email, status, joinedAt }], totalItems

Errors

Unauthorized, AccessDenied

2.3 UpdateAccountStatus

Thuộc tính

Nội dung

Use case

UpdateAccountStatus

Actor

Admin (BĐHU + Member), BĐHU (Member trong chapter mình)

Method + Path

PATCH /api/v1/users/{userId}/status

Request Body

status: "ACTIVE" | "INACTIVE"

Authorization

Admin: mọi user trừ Admin khác; BĐHU: chỉ Member thuộc chapter mình

Processing

Cập nhật users.status; ghi audit_logs (actor, action=UPDATE_STATUS, entity)

Business rule

Không set status của chính Admin qua API này; LOCKED không đổi qua API này (chỉ qua reset password)

Output

userId, status

Errors

Unauthorized, AccessDenied, UserNotFound, InvalidTransition

2.4 RemoveMemberFromChapter

Thuộc tính

Nội dung

Use case

RemoveMemberFromChapter

Actor

BĐHU, Admin

Method + Path

DELETE /api/v1/chapters/{chapterId}/members/{userId}

Authorization

Admin: mọi chapter; BĐHU: chapter mình

Processing

chapter_members → xoá dòng liên kết (hoặc đánh dấu LEFT theo membership_status); tài khoản user vẫn giữ nguyên (BR-02: rời chapter vẫn giữ tài khoản)

Business rule

Tài khoản không bị xoá/Inactive khi rời chapter

Output

userId, chapterId, membershipStatus: "LEFT"

Errors

Unauthorized, AccessDenied, MembershipNotFound

MODULE 3 — COURSE / SESSION / LESSON / CONTENT (Admin)

3.1 CreateCourse

Thuộc tính

Nội dung

Use case

CreateCourse

Actor

Admin

Method + Path

POST /api/v1/courses

Request Body

title, description?, visibility: "PUBLIC" | "PRIVATE"

Authorization

role = ADMIN

Processing

Tạo course với status = DRAFT

Output

courseId, title, status: "DRAFT", visibility

Errors

Unauthorized, ValidationError

3.2 UpdateCourse

Thuộc tính

Nội dung

Use case

UpdateCourse

Actor

Admin

Method + Path

PATCH /api/v1/courses/{courseId}

Request Body

title?, description?, visibility?

Authorization

role = ADMIN

Processing

Cập nhật field truyền vào

Output

courseId, title, description, visibility, status

Errors

Unauthorized, CourseNotFound, ValidationError

3.3 PublishCourse

Thuộc tính

Nội dung

Use case

PublishCourse

Actor

Admin

Method + Path

POST /api/v1/courses/{courseId}/publish

Authorization

role = ADMIN

Processing

Kiểm tra course có ≥1 session, mỗi session có ≥1 lesson → set status=PUBLISHED, published_at=now

Business rule

Không publish course/session rỗng (Module 5.2)

Output

courseId, status: "PUBLISHED", publishedAt

Errors

Unauthorized, CourseNotFound, EmptyCourse, EmptySession

3.4 UnpublishCourse

Thuộc tính

Nội dung

Use case

UnpublishCourse

Actor

Admin

Method + Path

POST /api/v1/courses/{courseId}/unpublish

Authorization

role = ADMIN

Processing

status = DRAFT — nội dung ẩn khỏi mọi role khác

Output

courseId, status: "DRAFT"

Errors

Unauthorized, CourseNotFound

3.5 GetCourseList

Thuộc tính

Nội dung

Use case

GetCourseList

Actor

Admin, BĐHU, Member, Khách

Method + Path

GET /api/v1/courses?page=&limit=

Authorization

Public (Khách chỉ thấy Published+Public); Bearer token nếu có để mở rộng phạm vi

Processing

Filter theo role: Admin → tất cả; BĐHU/Member → Published; Khách/không token → Published + Public

Business rule

BR-01 course visibility

Output

items: [{ courseId, title, status, visibility, sessionCount }], totalItems

Errors

—

3.6 GetCourseDetail

Thuộc tính

Nội dung

Use case

GetCourseDetail

Actor

Admin, BĐHU, Member, Khách

Method + Path

GET /api/v1/courses/{courseId}

Authorization

Theo BR-01: Private course chỉ Active user (Member/BĐHU) hoặc Admin

Processing

Trả course kèm sessions → lessons (ẩn nội dung DRAFT với non-Admin)

Output

courseId, title, description, status, visibility, sessions: [{ sessionId, title, lessons: [{ lessonId, title, hasVideo, documentCount }] }]

Errors

CourseNotFound, AccessDenied

3.7 CreateSession

Thuộc tính

Nội dung

Use case

CreateSession

Actor

Admin

Method + Path

POST /api/v1/courses/{courseId}/sessions

Request Body

title, description?, sortOrder

Authorization

role = ADMIN

Processing

Tạo session gắn courseId

Output

sessionId, courseId, title, sortOrder

Errors

Unauthorized, CourseNotFound, ValidationError

3.8 ReorderSessions

Thuộc tính

Nội dung

Use case

ReorderSessions

Actor

Admin

Method + Path

PATCH /api/v1/courses/{courseId}/sessions/reorder

Request Body

sessions: [{ sessionId, sortOrder }]

Authorization

role = ADMIN

Processing

Cập nhật sort_order hàng loạt trong 1 transaction

Output

success: true

Errors

Unauthorized, CourseNotFound, ValidationError

3.9 CreateLesson

Thuộc tính

Nội dung

Use case

CreateLesson

Actor

Admin

Method + Path

POST /api/v1/sessions/{sessionId}/lessons

Request Body

title, description?, sortOrder, video: { provider, youtubeVideoId, durationSeconds }

Authorization

role = ADMIN

Processing

Tạo lesson + tạo video con (1-1, bắt buộc) trong cùng transaction

Business rule

Mỗi lesson đúng 1 video (Module 5.2)

Output

lessonId, sessionId, title, video: { videoId, durationSeconds }

Errors

Unauthorized, SessionNotFound, ValidationError (thiếu video)

3.10 UpdateLesson

Thuộc tính

Nội dung

Use case

UpdateLesson

Actor

Admin

Method + Path

PATCH /api/v1/lessons/{lessonId}

Request Body

title?, description?, sortOrder?, video?

Authorization

role = ADMIN

Processing

Cập nhật lesson / thay video nếu có

Output

lessonId, title, video

Errors

Unauthorized, LessonNotFound, ValidationError

3.11 UploadLessonDocument

Thuộc tính

Nội dung

Use case

UploadLessonDocument

Actor

Admin

Method + Path

POST /api/v1/lessons/{lessonId}/documents (multipart/form-data)

Request Body

file

Authorization

role = ADMIN

Processing

Upload file lên storage → lưu storage_key, fileName, mimeType, fileSize gắn lessonId

Output

documentId, fileName, fileSize

Errors

Unauthorized, LessonNotFound, FileTooLarge, UnsupportedFileType

3.12 DeleteLessonDocument

Thuộc tính

Nội dung

Use case

DeleteLessonDocument

Actor

Admin

Method + Path

DELETE /api/v1/documents/{documentId}

Authorization

role = ADMIN

Processing

Xoá record + file trên storage

Output

documentId, deleted: true

Errors

Unauthorized, DocumentNotFound

MODULE 4 — LEARNING PROGRESS (Member)

4.1 GetMemberCourseList

Thuộc tính

Nội dung

Use case

GetMemberCourseList

Actor

Member

Method + Path

GET /api/v1/members/me/courses?page=&limit=

Authorization

account Active

Processing

Trả Published course kèm % tiến độ cá nhân đã tính trước (denormalized hoặc tính realtime)

Output

items: [{ courseId, title, progressPercentage }], totalItems

Errors

Unauthorized, AccountInactive

4.2 GetCourseDetailWithProgress

Thuộc tính

Nội dung

Use case

GetCourseDetailWithProgress

Actor

Member

Method + Path

GET /api/v1/courses/{courseId}/my-progress

Authorization

account Active, course phải Published (Private cần Active)

Processing

Trả cấu trúc course + với từng lesson: completed, watchedUntil từ lesson_progress

Output

courseId, progressPercentage, sessions: [{ lessons: [{ lessonId, completed, watchedUntil }] }]

Errors

Unauthorized, CourseNotFound, AccessDenied

4.3 UpdateLearningProgress

Thuộc tính

Nội dung

Use case

UpdateLearningProgress

Actor

Member

Method + Path

PATCH /api/v1/lessons/{lessonId}/progress

Request Body

{

  "positionSeconds": Number (second),

  "furthestWatchedPositionSeconds": Number (second)

}

Authorization

User phải Active và có quyền truy cập Lesson (course Published, Private→cần Active)

Processing

Việc tua lùi và tiến video được xử lý sẽ được xử lý ở frontend. Backend chỉ nhận ở cập nhật theo heartbeat theo công thức để tránh heartbeat cùng lúc. nhưng từ 10 - 15s hoặc nhỏ hoặc hơn tý vẫn chấp nhận được.  Lưu về DB

last_position_seconds = positionSeconds

Kiểm tra: furthestWatchedPositionSeconds > furthest_watched_position_seconds -> True

furthest_watched_position_seconds = furthestWatchedPositionSeconds

progressPercentage = furthestWatchedPositionSeconds / duration_seconds

Business rule

progressPercentage >= 85 → completed = true, completed_at = now (BR-03); tua tới không tính đoạn bị bỏ qua là đã xem

Output

lessonId, progressPercentage, completed

Errors

Unauthorized, LessonNotFound, AccessDenied, SeekAheadNotAllowed

4.4 GetLessonProgress

Thuộc tính

Nội dung

Use case

GetLessonProgress

Actor

Member

Method + Path

GET /api/v1/lessons/{lessonId}/progress

Authorization

User Active, có quyền truy cập Lesson

Processing

Trả trạng thái progress hiện tại để FE resume video (đồng bộ đa thiết bị — NFR-PERF-02)

Output

lessonId, completed, watchedUntil, lastPosition, updatedAt

Errors

Unauthorized, LessonNotFound, AccessDenied

MODULE 5 — ASSESSMENT

5.1 CreateAssessment

Thuộc tính

Nội dung

Use case

CreateAssessment

Actor

Admin

Method + Path

POST /api/v1/courses/{courseId}/assessment

Request Body

title, description?, questions: [{ questionText, type, points, durationSeconds, options: [{ optionText, isCorrect }], explanation }]

Authorization

role = ADMIN

Processing

Tạo assessment (unique theo courseId) + questions + options trong 1 transaction

Business rule

Mỗi course tối đa 1 assessment (unique course_id)

Output

assessmentId, courseId, questionCount

Errors

Unauthorized, CourseNotFound, AssessmentAlreadyExists, ValidationError

5.2 UpdateAssessment

Thuộc tính

Nội dung

Use case

UpdateAssessment

Actor

Admin

Method + Path

PATCH /api/v1/assessments/{assessmentId}

Request Body

title?, description?, questions? (thêm/sửa/xoá câu hỏi)

Authorization

role = ADMIN

Processing

Cập nhật assessment/questions/options

Output

assessmentId, questionCount

Errors

Unauthorized, AssessmentNotFound, ValidationError

5.3 StartAttempt

Thuộc tính

Nội dung

Use case

StartAttempt

Actor

Member

Method + Path

POST /api/v1/assessments/{assessmentId}/attempts

Authorization

account Active

Processing

Kiểm tra tất cả lesson trong course đã completed=true (BR-04) → kiểm tra thời gian chờ 24h kể từ attempt trước (trừ khi đạt điểm tuyệt đối) → tạo attempt (status=IN_PROGRESS, expires_at = now + questionCount*2phút) → xáo trộn câu hỏi + đáp án → lưu attempt_questions

Business rule

Chưa hoàn thành hết lesson → chặn; attempt trước bị huỷ giữa chừng không tính là đã làm nhưng vẫn phải chờ 24h (BR-04)

Output

attemptId, expiresAt, questions: [{ questionId, questionText, options: [{ optionId, optionText }] }] (không trả isCorrect)

Errors

Unauthorized, AccountInactive, LessonsNotCompleted, CooldownActive, AssessmentNotFound

5.4 SaveAnswer

Thuộc tính

Nội dung

Use case

SaveAnswer

Actor

Member

Method + Path

PUT /api/v1/attempts/{attemptId}/answers/{questionId}

Request Body

selectedOptionId

Authorization

attempt thuộc chính actor, status = IN_PROGRESS, chưa hết expiresAt

Processing

Upsert vào attempt_answers (không tính is_correct ngay); tính giờ theo server time — nếu mất mạng, câu đã chọn được lưu tạm ở client và đồng bộ khi có mạng lại (BR-04)

Business rule

Không sửa được sau khi attempt đã SUBMITTED/AUTO_SUBMITTED

Output

questionId, saved: true

Errors

Unauthorized, AccessDenied, AttemptNotInProgress, AttemptExpired, QuestionNotInAttempt

5.5 SubmitAttempt

Thuộc tính

Nội dung

Use case

SubmitAttempt

Actor

Member

Method + Path

POST /api/v1/attempts/{attemptId}/submit

Authorization

attempt thuộc actor, status = IN_PROGRESS

Processing

Chấm từng attempt_answers theo question_options.is_correct → tính score = tổng điểm đúng → passed = score >= 85 (BR-04) → status = SUBMITTED, submitted_at = now

Business rule

passed=true → trả đáp án đúng + giải thích tất cả câu; passed=false → chỉ trả đúng/sai từng câu, không lộ đáp án đúng (BR-04)

Output

attemptId, score, passed, answers: [{ questionId, isCorrect, correctOptionId?, explanation? }]

Errors

Unauthorized, AccessDenied, AttemptNotInProgress

5.6 AutoSubmitAttempt (internal / scheduler)

Thuộc tính

Nội dung

Use case

AutoSubmitAttempt

Actor

System (cron job nội bộ, không expose public)

Method + Path

POST /internal/attempts/{attemptId}/auto-submit

Authorization

Service-to-service token

Processing

Với attempt IN_PROGRESS đã quá expires_at → chấm các câu đã trả lời, câu chưa trả lời tính sai → status = AUTO_SUBMITTED

Business rule

Hệ thống tự nộp toàn bộ khi hết giờ (BR-04)

Output

attemptId, score, passed, status: "AUTO_SUBMITTED"

Errors

AttemptNotFound, AttemptAlreadySubmitted

5.7 GetAttemptHistory

Thuộc tính

Nội dung

Use case

GetAttemptHistory

Actor

Member

Method + Path

GET /api/v1/assessments/{assessmentId}/attempts/me

Authorization

account Active

Processing

Trả lịch sử attempt của chính actor (không tính attempt đã huỷ giữa chừng vào điểm — BR-04)

Output

items: [{ attemptId, attemptNumber, status, score, passed, submittedAt }]

Errors

Unauthorized, AssessmentNotFound

5.8 GetAttemptResult

Thuộc tính

Nội dung

Use case

GetAttemptResult

Actor

Member

Method + Path

GET /api/v1/attempts/{attemptId}

Authorization

attempt thuộc chính actor

Processing

Trả kết quả attempt đã SUBMITTED/AUTO_SUBMITTED, áp dụng rule ẩn đáp án nếu passed=false

Output

attemptId, score, passed, answers: [...]

Errors

Unauthorized, AccessDenied, AttemptNotFound

MODULE 6 — BĐHU DASHBOARD

6.1 GetChapterMemberProgress

Thuộc tính

Nội dung

Use case

GetChapterMemberProgress

Actor

BĐHU

Method + Path

GET /api/v1/chapters/{chapterId}/dashboard/members?search=&page=&limit=

Authorization

chapterId phải trùng chapter của actor (FR-DB)

Processing

Trả danh sách member kèm % hoàn thành trung bình các course Published

Business rule

Không truy cập chapter khác

Output

items: [{ userId, email, completedCourses, totalCourses, avgProgress }], totalItems

Errors

Unauthorized, AccessDenied

6.2 GetCourseCompletionStats

Thuộc tính

Nội dung

Use case

GetCourseCompletionStats

Actor

BĐHU

Method + Path

GET /api/v1/chapters/{chapterId}/dashboard/courses?page=&limit=

Authorization

chapterId trùng chapter của actor

Processing

Với mỗi course Published, đếm số member trong chapter đã progressPercentage = 100%

Output

items: [{ courseId, title, completedCount, totalMembers }], totalItems

Errors

Unauthorized, AccessDenied

MODULE 7 — ADMIN OVERVIEW

7.1 GetSystemOverview

Thuộc tính

Nội dung

Use case

GetSystemOverview

Actor

Admin

Method + Path

GET /api/v1/admin/overview

Authorization

role = ADMIN

Processing

Tổng hợp: số chapter, số tài khoản theo status, số course theo status, tỷ lệ hoàn thành trung bình toàn hệ thống

Output

chapterCount, accountStats: { active, inactive, locked }, courseStats: { draft, published }, avgCompletionRate

Errors

Unauthorized
