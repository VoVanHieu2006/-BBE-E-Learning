# API hiện hành

Danh mục đọc từ 96 file route trong `src/app/api`. Đường dẫn động dùng `[id]` theo Next.js. Mỗi mục dẫn thẳng tới handler; schema validation và service được gọi là nguồn xác định đầy đủ kiểu, trường bắt buộc và điều kiện lỗi. Các trường liệt kê dưới đây là tên JSON/query/form đọc trực tiếp và trường response thấy trong handler, không phải OpenAPI schema hay cam kết rằng mọi trường đều bắt buộc. Response qua service được ghi tên biểu thức thay vì suy đoán cấu trúc.

## Quy ước chung

- API JSON dùng `Content-Type: application/json`; upload trực tiếp dùng multipart/form-data. Thời gian phản hồi JSON thường là ISO 8601; ngày tháng/kỳ dùng UTC+7 theo nghiệp vụ.
- Xác thực nhận `Authorization: Bearer <accessToken>` hoặc cookie. `authenticate` kiểm tra trạng thái tài khoản, affiliation và Lead scope trong DB; token còn hạn không tự bảo đảm còn quyền.
- Lỗi thường có dạng `{error:{code,message?}}`. Không phải route nào cũng phân biệt 401/403 giống nhau: helper Admin có thể trả 403 cả khi chưa xác thực. Đọc handler để lấy status chính xác.
- `authenticate` là xác thực; quyền chức vụ/đơn vị phải đọc cùng `authorization`, `organization-auth`, `chapter-lead` và service của route. Tên guard trong bảng cho biết nhánh kiểm soát thực tế, không cấp thêm quyền.
- `/api/internal/organization/reorganizations/apply` yêu cầu Bearer `CRON_SECRET`; auto-submit/deadline còn hỗ trợ cron header hoặc Admin theo handler. Các endpoint này ghi dữ liệu kể cả một số GET, không dùng làm health probe. `GET /api/v1/health` là endpoint sức khỏe riêng.
- Khách có thể đọc danh mục/khóa/bài/tài liệu công khai, và một số bảng xếp hạng. Authentication xuất hiện trong handler công khai có thể là optional; xem nhãn dưới đây và điều kiện visibility trong source.
- Pagination, tên ID, response alias (ví dụ `id` và `courseId`) được giữ theo từng route; không chuẩn hóa payload trong đợt dọn repo.

## Hợp đồng luồng quan trọng

| Luồng | Request và response chính | Quyền / lỗi đáng chú ý |
|---|---|---|
| Đăng nhập / refresh | login nhận email/password; trả token và user, đồng thời đặt cookie; refresh nhận token/cookie theo handler | ACTIVE và affiliation hợp lệ; cookie HttpOnly, Secure ở production; không log token |
| Tiến độ video | GET trả lifetime/cycle progress, replay tháng và trạng thái thưởng; PATCH nhận vị trí/thời lượng, playback rate, event, viewing session và video identity theo handler | Chỉ chủ tiến độ; backend khóa và giới hạn theo thời gian đã quan sát; không tin completed/furthest do client tự khai |
| Attempt | Tạo attempt từ assessment; lưu đáp án theo question thuộc attempt; submit/cancel; GET để resume/kết quả | Ownership, course publication, video/progression gate, server expiry, snapshot câu hỏi/grading và idempotency; không sửa payload cũ |
| Course authoring | Draft → session/lesson/video/document → assessment/bank → publish; draft snapshot/publish riêng | Admin; used bank/version và content publishing có guard; không tự reset attempt |
| Chuyển giao | Đọc roster, parse sheet, preview/POST batch, apply/cancel theo batch | Scope Chapter thực tế; GET danh sách/roster hiện có thể apply đợt đến hạn (xem known-issues); scheduling chưa reset; successful apply mới reset và tạo outbox |
| BXH kỳ | `group=MEMBER/LT/DNA/CHAPTER`, `periodType=MONTH/TERM/ACTUAL_TERM`; thêm periodId/chapterId theo source | ACTUAL_TERM chỉ CHAPTER, statisticsOnly; bảng đóng đọc snapshot, thiếu dữ liệu trả reason; thành viên/manager bị giới hạn đơn vị |
| Learning policy | Admin GET cấu hình/readiness; PUT catalog/mapping/season; POST activation/retry theo action | Cutover cần gate rõ ràng; mapping đề xuất chưa được tự duyệt; season không chồng lấn, boundary April/October UTC+7 |

## Danh mục route

### `/api/internal/attempts/auto-submit`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/internal/attempts/auto-submit/route.ts#L6) | `CRON_SECRET`, `authenticate`, `role ADMIN` | — | `processed, attempts` | `Unauthorized` |
| [GET](../src/app/api/internal/attempts/auto-submit/route.ts) | Cùng guard với POST | Cùng POST | Cùng POST | Cùng POST |

### `/api/internal/learning/deadlines/enforce`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/internal/learning/deadlines/enforce/route.ts#L91) | `CRON_SECRET`, `authenticate`, `role ADMIN` | — | — | — |
| [POST](../src/app/api/internal/learning/deadlines/enforce/route.ts#L95) | `CRON_SECRET`, `authenticate`, `role ADMIN` | — | — | — |

### `/api/internal/organization/reorganizations/apply`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/internal/organization/reorganizations/apply/route.ts#L9) | `CRON_SECRET` | — | `initialized, applied, dnaResets, synchronization, retired, supplementalViolations, closedMonths, completedKpis, closedTerms` | `Unauthorized` |

### `/api/v1/admin/learning-policy`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/admin/learning-policy/route.ts#L13) | `admin`, `authenticate`, `role ADMIN` | — | `policy, programs, targets, courses, pending, failed, seasons` | `AccessDenied` |
| [PUT](../src/app/api/v1/admin/learning-policy/route.ts#L28) | `admin`, `authenticate`, `role ADMIN` | `body.courses`, `body.normalizeOrganization`, `body.programs`, `body.retryOutboxIds`, `body.seasons`, `body.targets`, `body.units` | `saved` | `AccessDenied`, `ValidationError` |
| [POST](../src/app/api/v1/admin/learning-policy/route.ts#L92) | `admin`, `authenticate`, `role ADMIN` | `body.cutoverAt` | `cutoverAt` | `AccessDenied`, `FutureCutoverRequired`, `MappingIncomplete`, `PolicyAlreadyScheduled`, `ReleaseNotReady` |

### `/api/v1/admin/learning-rules/[ruleId]/materialize`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/admin/learning-rules/[ruleId]/materialize/route.ts#L8) | `authenticate`, `role ADMIN` | `body.dueAt` | `ruleId, eligibleUsers, createdAssignments` | `AccessDenied`, `RuleInactive`, `RuleNotFound`, `ValidationError` |

### `/api/v1/admin/learning-rules/[ruleId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [PATCH](../src/app/api/v1/admin/learning-rules/[ruleId]/route.ts#L8) | `authenticate`, `role ADMIN` | `body.action` | `rule, affectedUsers, endedAssignments` | `AccessDenied`, `RuleInactive`, `RuleNotFound`, `ValidationError` |

### `/api/v1/admin/learning-rules`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/admin/learning-rules/route.ts#L9) | `authenticate`, `role ADMIN` | — | `items, pagination` | `AccessDenied` |
| [POST](../src/app/api/v1/admin/learning-rules/route.ts#L36) | `authenticate`, `role ADMIN` | — | `rule` | `AccessDenied`, `CourseNotFound`, `OrganizationUnitNotFound`, `PositionNotFound` |

### `/api/v1/admin/mandatory-matrix`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/admin/mandatory-matrix/route.ts#L126) | `authenticate`, `requireAdmin`, `role ADMIN` | — | `courses, targets, cells, catalogComplete, configuredTargetCount, legacyRuleCount` | — |
| [PUT](../src/app/api/v1/admin/mandatory-matrix/route.ts#L167) | `authenticate`, `requireAdmin`, `role ADMIN` | `body.changes`, `body.courseId`, `body.rowDefaults` | `updated, rules` | `ScopeNotConfigured`, `ValidationError` |

### `/api/v1/admin/organization/history`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/admin/organization/history/route.ts#L7) | `authenticate`, `role ADMIN` | `query.userId` | `user, chapters, memberships, positions` | `AccessDenied`, `NotFound`, `ValidationError` |

### `/api/v1/admin/organization`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/admin/organization/route.ts#L42) | `authenticate`, `role ADMIN` | — | `payload` | `AccessDenied`, `ValidationError` |
| [POST](../src/app/api/v1/admin/organization/route.ts#L506) | `authenticate`, `role ADMIN`, `test` | — | — | `OrganizationConflict` |

### `/api/v1/admin/overview`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/admin/overview/route.ts#L13) | `authenticate`, `getAdminOverviewCache`, `role ADMIN`, `setAdminOverviewCache` | — | `cached`, `resultData` | `AccessDenied` |

### `/api/v1/admin/restrictions`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/admin/restrictions/route.ts#L9) | `authenticate`, `role ADMIN` | `query.limit`, `query.page` | `items, total, page, limit, totalPages` | `AccessDenied` |
| [POST](../src/app/api/v1/admin/restrictions/route.ts#L34) | `authenticate`, `includes`, `role ADMIN`, `role CHAPTER_LEADER` | `body.action`, `body.reason`, `body.reasonType`, `body.sourceReference`, `body.targetId`, `body.targetType` | `chapterId, unlocked, unlockedUsers, stillLockedUsers`, `restriction, lockedUsers`, `restriction, status, cascadedChapterIds, lockedUsers`, `userId, unlocked, remainingRestriction` | `AccessDenied`, `ChapterOrganizationMissing`, `InvalidTransition`, `NotFound`, `ValidationError` |

### `/api/v1/admin/users/[userId]/extend-deadline`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/admin/users/[userId]/extend-deadline/route.ts#L6) | `authenticate`, `role ADMIN` | `body.extensionDays`, `body.reason` | `ok, userId, extensionDays, newDueAt, accountStatus, accountLockReason, unlocked` | `AccessDenied`, `ValidationError` |

### `/api/v1/assessments/[assessmentId]/attempts/me`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/assessments/[assessmentId]/attempts/me/route.ts#L6) | `authenticate` | — | `cooldownMinutes, cooldownUntil, remainingMs, items` | — |

### `/api/v1/assessments/[assessmentId]/attempts`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/assessments/[assessmentId]/attempts/route.ts#L26) | `authenticate`, `isLearningManager`, `role ADMIN` | `body.forceNew` | `attemptId, id, attemptNumber, expiresAt, isResumed, existingAnswers, questionCount, durationMinutes, passingPercent, questions`, `attemptId, id, attemptNumber, expiresAt, isResumed, questionCount, durationMinutes, passingPercent, existingAnswers, questions` | `AccountInactive`, `AssessmentNotFound`, `AttemptAlreadyInProgress`, `CooldownActive`, `FinalExamAlreadyPassed`, `FinalExamBankTooSmall`, `FinalExamVersionChanged`, `FinalExamVersionUnavailable`, `ManagementOnlyAccount`, `MonthlyVideoReplayRequired`, `ProgressionChanged`, `VideoNotCompleted` |

### `/api/v1/assessments/[assessmentId]/pools`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/assessments/[assessmentId]/pools/route.ts#L7) | `authenticate`, `role ADMIN` | — | `items` | `AccessDenied` |
| [PUT](../src/app/api/v1/assessments/[assessmentId]/pools/route.ts#L18) | `authenticate`, `role ADMIN` | `body.pools`, `body.questionAssignments` | `items` | `AccessDenied`, `AssessmentNotFound`, `AssessmentVersionRequired`, `QuestionPoolAssignmentRequired`, `UseFinalExamEditor`, `ValidationError` |

### `/api/v1/assessments/[assessmentId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/assessments/[assessmentId]/route.ts#L14) | `authenticate` | — | `assessmentId, id, lessonId, title, description, durationMinutes, questionCount, pools, questions` | `AccessDenied`, `AssessmentNotFound`, `UNAUTHORIZED`, `Unauthorized` |
| [PATCH](../src/app/api/v1/assessments/[assessmentId]/route.ts#L80) | `assertFinalExamBankCapacity`, `authenticate`, `role ADMIN` | — | `assessmentId, questionCount`, `bankError` | `AccessDenied`, `AssessmentNotFound`, `AssessmentVersionRequired`, `LessonNotFound`, `UseFinalExamEditor`, `ValidationError` |
| [DELETE](../src/app/api/v1/assessments/[assessmentId]/route.ts#L195) | `assertFinalExamBankCapacity`, `authenticate`, `role ADMIN` | — | `bankError`, `success, message, assessmentId, lessonId, courseId, assessmentType` | `AccessDenied`, `AssessmentNotFound`, `AssessmentVersionRequired`, `LessonNotFound` |

### `/api/v1/attempts/[attemptId]/answers/[questionId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [PUT](../src/app/api/v1/attempts/[attemptId]/answers/[questionId]/route.ts#L9) | `authenticate` | — | `questionId, saved` | `AccessDenied`, `AttemptExpired`, `AttemptNotFound`, `AttemptNotInProgress`, `OptionNotInQuestion`, `QuestionNotInAttempt`, `ValidationError` |

### `/api/v1/attempts/[attemptId]/answers`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/attempts/[attemptId]/answers/route.ts#L7) | `authenticate` | — | `isBatch ? { saved: true, count: result.savedCount } : { questionId: entries[0][0], saved: true }` | `AccessDenied`, `AttemptExpired`, `AttemptNotFound`, `AttemptNotInProgress`, `ValidationError` |

### `/api/v1/attempts/[attemptId]/cancel`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/attempts/[attemptId]/cancel/route.ts#L11) | `authenticate` | — | `success, message, status, cancelledAt, cooldownMinutes, cooldownUntil` | `AccessDenied`, `AttemptNotFound` |

### `/api/v1/attempts/[attemptId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/attempts/[attemptId]/route.ts#L7) | `authenticate` | — | `attemptId, score, passed, answers` | `AccessDenied`, `AttemptNotFound`, `AttemptNotSubmitted` |
| [DELETE](../src/app/api/v1/attempts/[attemptId]/route.ts#L65) | `authenticate` | — | `attemptId, status, message` | `AccessDenied`, `AttemptNotFound`, `AttemptNotInProgress` |

### `/api/v1/attempts/[attemptId]/submit`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/attempts/[attemptId]/submit/route.ts#L5) | `authenticate` | `body.answers` | `attemptId, score, totalPoints, scorePercent, passed, starReward, answers` | `ValidationError` |

### `/api/v1/attempts/auto-submit`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/attempts/auto-submit/route.ts) | Re-export: [handler](../src/app/api/internal/attempts/auto-submit/route.ts); cron secret hoặc Admin | Theo handler được dẫn | Theo handler được dẫn | Theo handler được dẫn |

### `/api/v1/auth/login`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/auth/login/route.ts#L15) | `getLearningManagerKind` | `body.cookies`, `body.email`, `body.password` | `accessToken, refreshToken, user` | `AccountInactive`, `AccountLocked`, `ConfigError`, `InvalidCredentials`, `NoActiveAffiliation`, `ServerError`, `ValidationError` |

### `/api/v1/auth/logout`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/auth/logout/route.ts#L9) | `Không có guard trực tiếp; xem handler/service` | `body.cookies`, `body.refreshToken` | `success` | — |

### `/api/v1/auth/me`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/auth/me/route.ts#L8) | `authenticate`, `getLearningManagerKind` | — | `user` | `NotFound` |

### `/api/v1/auth/password-reset/confirm`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/auth/password-reset/confirm/route.ts#L15) | `Không có guard trực tiếp; xem handler/service` | `body.confirmPassword`, `body.newPassword`, `body.token` | `success` | `PasswordMismatch`, `ServerError`, `TokenAlreadyUsed`, `TokenExpired`, `ValidationError`, `WeakPassword` |

### `/api/v1/auth/password-reset/request`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/auth/password-reset/request/route.ts#L11) | `Không có guard trực tiếp; xem handler/service` | `body.email` | `message, sent` | `ValidationError` |

### `/api/v1/auth/refresh`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/auth/refresh/route.ts#L13) | `Không có guard trực tiếp; xem handler/service` | `body.cookies`, `body.refreshToken` | `accessToken, user` | `AccountInactive`, `InvalidToken`, `ServerError`, `ValidationError` |

### `/api/v1/chapters/[chapterId]/current-roster`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/chapters/[chapterId]/current-roster/route.ts#L11) | `authenticate`, `canAccessChapterPermission`, `role ADMIN`, `role CHAPTER_LEADER`, `role MEMBER` | — | `chapterId, chapterName, currentTermNumber, roster, unassignedMembers, departments, scheduledBatch, totalMembers` | `AccessDenied`, `ChapterNotFound` |

### `/api/v1/chapters/[chapterId]/dashboard/courses`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/chapters/[chapterId]/dashboard/courses/route.ts#L13) | `authenticate`, `canAccessChapterPermission`, `role ADMIN` | `query.limit`, `query.page` | `items, totalItems, totalPages, page, limit` | `AccessDenied`, `ChapterScopeRequired` |

### `/api/v1/chapters/[chapterId]/dashboard/members`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/chapters/[chapterId]/dashboard/members/route.ts#L14) | `authenticate`, `canAccessChapterPermission`, `role ADMIN` | `query.department`, `query.limit`, `query.page`, `query.roleType`, `query.search` | `rosterAsOf, items, summary, totalItems, totalPages, page, limit, totalLessonsSystem, totalCoursesSystem` | `AccessDenied`, `ChapterScopeRequired` |

### `/api/v1/chapters/[chapterId]/kpi`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/chapters/[chapterId]/kpi/route.ts#L11) | `authenticate`, `canAccessChapterPermission`, `role ADMIN` | — | `items` | `AccessDenied` |
| [PUT](../src/app/api/v1/chapters/[chapterId]/kpi/route.ts#L24) | `authenticate`, `role ADMIN` | — | `month, status, note` | `AccessDenied`, `NotFound`, `ValidationError` |

### `/api/v1/chapters/[chapterId]/members/[userId]/course-progress`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/chapters/[chapterId]/members/[userId]/course-progress/route.ts#L14) | `authenticate`, `hasChapterPermission`, `role ADMIN`, `role CHAPTER_LEADER` | — | `user, summary, courses, learningDetail` | `AccessDenied`, `ChapterScopeRequired`, `NotFound` |

### `/api/v1/chapters/[chapterId]/members/[userId]/department`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/chapters/[chapterId]/members/[userId]/department/route.ts#L11) | `authenticate`, `canAccessChapterPermission` | `body.departmentUnitId`, `body.makeLead` | `success` | `AccessDenied`, `ChapterNotFound`, `InternalError`, `InvalidDepartment`, `MemberNotInChapter` |

### `/api/v1/chapters/[chapterId]/members/[userId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [DELETE](../src/app/api/v1/chapters/[chapterId]/members/[userId]/route.ts#L7) | `authenticate`, `canAccessChapterPermission` | — | `userId, chapterId, membershipStatus` | `AccessDenied`, `ChapterNotFound`, `MembershipNotFound`, `ValidationError` |

### `/api/v1/chapters/[chapterId]/members/bulk-deactivate`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/chapters/[chapterId]/members/bulk-deactivate/route.ts#L10) | `authenticate`, `canAccessChapterPermission`, `role ADMIN` | `body.userIds` | `success, count, message` | `AccessDenied`, `ChapterNotFound`, `MemberScopeInvalid`, `ValidationError` |

### `/api/v1/chapters/[chapterId]/members`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/chapters/[chapterId]/members/route.ts#L8) | `authenticate`, `canAccessChapterPermission`, `role ADMIN` | `query.limit`, `query.page`, `query.search`, `query.status` | `items, totalItems, totalPages` | `AccessDenied`, `ValidationError` |

### `/api/v1/chapters/[chapterId]/reorganizations/[batchId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/chapters/[chapterId]/reorganizations/[batchId]/route.ts#L11) | `authenticate`, `canAccessChapterPermission` | — | `success, item, appliedImmediately`, `success, message` | `AccessDenied`, `BatchNotFound`, `TransferApplyFailed`, `TransferNotScheduled` |
| [DELETE](../src/app/api/v1/chapters/[chapterId]/reorganizations/[batchId]/route.ts#L49) | `authenticate`, `canAccessChapterPermission` | — | `success, message` | `AccessDenied`, `BatchNotFound`, `TransferStateChanged` |

### `/api/v1/chapters/[chapterId]/reorganizations/parse-sheet`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/chapters/[chapterId]/reorganizations/parse-sheet/route.ts#L40) | `authenticate`, `canAccessChapterPermission`, `role ADMIN`, `role CHAPTER_LEADER` | `body.url` | `sourceUrl, items, matchedNewTerm, unmatchedSheetMembers, unmatchedCurrentMembers, errors, valid, summary` | `AccessDenied`, `ChapterOrganizationMissing`, `DocumentNotPublic`, `SheetEmpty`, `ValidationError` |

### `/api/v1/chapters/[chapterId]/reorganizations`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/chapters/[chapterId]/reorganizations/route.ts#L9) | `authenticate`, `canAccessChapterPermission`, `role ADMIN` | — | `items` | `AccessDenied` |
| [POST](../src/app/api/v1/chapters/[chapterId]/reorganizations/route.ts#L62) | `authenticate`, `canAccessChapterPermission`, `role ADMIN` | `body.effectiveAt`, `body.items`, `body.sourceUrl`, `body.termNumber` | `item, appliedImmediately` | `AccessDenied`, `ChapterNotFound`, `ChapterPresidentPositionRequired`, `DepartmentScopeInvalid`, `DuplicateUser`, `InvalidTermNumber`, `MemberScopeInvalid`, `MultipleChapterPresidents`, `PositionScopeInvalid`, `ScheduledReorganizationExists`, `TransferApplyFailed`, `TransferSeasonAlreadyApplied`, `TransferSeasonNotConfigured`, `ValidationError` |

### `/api/v1/chapters`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/chapters/route.ts#L6) | `authenticate`, `role ADMIN` | `query.limit`, `query.page` | `responsePayload` | `AccessDenied` |

### `/api/v1/courses/[courseId]/assessment`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/courses/[courseId]/assessment/route.ts#L7) | `Không có guard trực tiếp; xem handler/service` | — | — | `DeprecatedEndpoint` |
| [POST](../src/app/api/v1/courses/[courseId]/assessment/route.ts#L23) | `Không có guard trực tiếp; xem handler/service` | — | — | `DeprecatedEndpoint` |

### `/api/v1/courses/[courseId]/cover`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/courses/[courseId]/cover/route.ts#L23) | `authenticate`, `role ADMIN` | `body.error`, `body.public_id`, `body.secure_url` | `courseId, coverUrl, coverPublicId` | `AccessDenied`, `CloudinaryNotConfigured`, `CloudinaryUploadFailed`, `CourseNotFound`, `CoursePublished`, `InvalidImage` |

### `/api/v1/courses/[courseId]/draft/publish`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/courses/[courseId]/draft/publish/route.ts#L11) | `authenticate`, `executePublishCourseRequirements`, `role ADMIN` | — | `courseId, status, publishedAt` | `AccessDenied`, `BaseVersionMismatch`, `CourseNotFound`, `DraftNotFound`, `PublishFailed`, `PublishedCourseProgramRequired` |

### `/api/v1/courses/[courseId]/draft`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/courses/[courseId]/draft/route.ts#L7) | `authenticate`, `role ADMIN` | — | `draft, course`, `draft, initialContent, course` | `AccessDenied`, `CourseNotFound` |
| [PUT](../src/app/api/v1/courses/[courseId]/draft/route.ts#L163) | `authenticate`, `role ADMIN` | `body.content`, `body.expectedDraftVersion` | `draft` | `AccessDenied`, `ConcurrencyConflict`, `CourseNotFound`, `ValidationError` |

### `/api/v1/courses/[courseId]/final-assessment`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/courses/[courseId]/final-assessment/route.ts#L15) | `authenticate`, `role ADMIN` | — | `courseId, courseTitle, assessment, availableQuestions, attemptCount`, `courseId, courseTitle, assessment, canStart, gateReady, alreadyPassed, completionPassed, cooldownMinutes, cooldownUntil, cooldownRemainingMs, gateCode, gateMessage, attempts` | — |
| [POST](../src/app/api/v1/courses/[courseId]/final-assessment/route.ts#L136) | `authenticate`, `role ADMIN` | `body.description`, `body.durationMinutes`, `body.questionCount`, `body.title` | `assessmentId, id, assessmentType, courseId, title, description, questionCount, availableQuestions, versionNumber`, `bankError` | — |
| [DELETE](../src/app/api/v1/courses/[courseId]/final-assessment/route.ts#L193) | `authenticate`, `role ADMIN` | — | `success, assessmentId, assessmentType` | — |

### `/api/v1/courses/[courseId]/my-progress`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/courses/[courseId]/my-progress/route.ts#L7) | `authenticate`, `role ADMIN` | — | `courseId, learningCycleId, id, progressPercentage, percentage, totalLessons, completedLessons, finalAssessmentAttempt, sessions` | `AccessDenied`, `CourseNotFound` |

### `/api/v1/courses/[courseId]/publish`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/courses/[courseId]/publish/route.ts#L7) | `authenticate`, `publishCourseRequirements`, `role ADMIN` | — | `courseId, status, publishedAt` | `AccessDenied`, `CourseNotFound`, `EmptyCourse`, `EmptySession` |

### `/api/v1/courses/[courseId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/courses/[courseId]/route.ts#L9) | `authenticate`, `includes`, `role ADMIN`, `role CHAPTER_LEADER`, `role MEMBER`, `Đọc công khai có điều kiện; auth optional` | — | `cached`, `payload` | `AccessDenied`, `CourseNotFound`, `UNAUTHORIZED` |
| [PATCH](../src/app/api/v1/courses/[courseId]/route.ts#L172) | `authenticate`, `role ADMIN` | `body.coverUrl`, `body.description`, `body.programCode`, `body.programId`, `body.title`, `body.visibility` | `courseId, id, title, description, status, visibility, publishedAt, coverUrl, programId, programCode, program` | `AccessDenied`, `CourseNotFound`, `CoursePublished`, `ProgramNotFound`, `ValidationError` |
| [DELETE](../src/app/api/v1/courses/[courseId]/route.ts#L277) | `authenticate`, `role ADMIN` | — | `success` | `AccessDenied`, `CourseNotFound` |

### `/api/v1/courses/[courseId]/sessions/reorder`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [PATCH](../src/app/api/v1/courses/[courseId]/sessions/reorder/route.ts#L5) | `authenticate`, `role ADMIN` | `body.sessions` | `success` | `AccessDenied`, `CourseNotFound`, `ValidationError` |

### `/api/v1/courses/[courseId]/sessions`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/courses/[courseId]/sessions/route.ts#L5) | `authenticate`, `role ADMIN` | `body.description`, `body.sortOrder`, `body.title` | `sessionId, id, courseId, title, description, sortOrder` | `AccessDenied`, `CourseNotFound`, `CoursePublished`, `ValidationError` |

### `/api/v1/courses/[courseId]/students`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/courses/[courseId]/students/route.ts#L14) | `authenticate`, `canAccessChapterPermission`, `role ADMIN`, `role CHAPTER_LEADER` | `query.chapterId` | `courseId, courseTitle, totalLessons, summary, items` | `AccessDenied`, `CourseNotFound` |

### `/api/v1/courses/[courseId]/unpublish`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/courses/[courseId]/unpublish/route.ts#L6) | `authenticate`, `role ADMIN` | — | `courseId, status, warnings` | `AccessDenied`, `AlreadyDraft`, `CourseNotFound` |

### `/api/v1/courses`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/courses/route.ts#L8) | `authenticate`, `role ADMIN`, `role CHAPTER_LEADER`, `role GUEST`, `role MEMBER`, `Đọc công khai có điều kiện; auth optional` | `query.limit`, `query.page` | `cached`, `responsePayload` | `UNAUTHORIZED` |
| [POST](../src/app/api/v1/courses/route.ts#L104) | `authenticate`, `role ADMIN` | `body.coverUrl`, `body.description`, `body.title`, `body.visibility` | `courseId, id, title, description, status, visibility, coverUrl, createdAt` | `AccessDenied`, `ValidationError` |

### `/api/v1/documents/[documentId]/download`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/documents/[documentId]/download/route.ts#L17) | `authenticate`, `role ADMIN`, `Đọc công khai có điều kiện; auth optional` | — | `downloadUrl, fileName, mimeType, fileSize, expiresIn` | `AccessDenied`, `DocumentNotFound`, `DownloadFailed`, `UNAUTHORIZED` |

### `/api/v1/documents/[documentId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [DELETE](../src/app/api/v1/documents/[documentId]/route.ts#L15) | `authenticate`, `role ADMIN` | — | `documentId, deleted` | `AccessDenied`, `DocumentNotFound` |

### `/api/v1/health`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/health/route.ts#L5) | `Không có guard trực tiếp; xem handler/service` | — | `status, checks, healthy` | — |

### `/api/v1/invitations/[id]/resend`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/invitations/[id]/resend/route.ts#L9) | `authenticate`, `canAccessOrganizationUnitPermission`, `role ADMIN` | — | `invitationId, status, expiresAt, emailSent, emailError` | `AccessDenied`, `InvitationNotFound`, `ValidationError` |

### `/api/v1/invitations/[id]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [DELETE](../src/app/api/v1/invitations/[id]/route.ts#L9) | `authenticate`, `canAccessOrganizationUnitPermission`, `role ADMIN` | — | `invitationId, status` | `AccessDenied`, `InvitationNotFound`, `ValidationError` |

### `/api/v1/invitations/accept`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/invitations/accept/route.ts#L9) | `Không có guard trực tiếp; xem handler/service` | `body.confirmPassword`, `body.password`, `body.token` | `userId, email, role, status` | `PasswordMismatch`, `ValidationError`, `WeakPassword` |

### `/api/v1/invitations/chapter-leader`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/invitations/chapter-leader/route.ts#L11) | `authenticate`, `role ADMIN` | `body.chapterDescription`, `body.chapterName`, `body.email` | `invitationId, chapterId, status, expiresAt, emailSent, emailError` | `AccessDenied`, `ValidationError` |

### `/api/v1/invitations/dna-leader`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/invitations/dna-leader/route.ts#L7) | `authenticate`, `role ADMIN` | `body.email` | `result` | `AccessDenied`, `ValidationError` |

### `/api/v1/invitations/member`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/invitations/member/route.ts#L18) | `authenticate`, `canAccessChapterPermission`, `canAccessOrganizationUnitPermission`, `role ADMIN`, `role CHAPTER_LEADER` | `body.chapterId`, `body.email`, `body.organizationUnitId` | `invitationId, id, chapterId, organizationUnitId, status, expiresAt, emailSent, emailError` | `AccessDenied`, `OrganizationUnitNotFound`, `ValidationError` |

### `/api/v1/invitations`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/invitations/route.ts#L10) | `authenticate`, `canAccessChapterPermission`, `canAccessOrganizationUnitPermission`, `role ADMIN`, `role CHAPTER_LEADER`, `role MEMBER` | `query.chapterId`, `query.kind`, `query.limit`, `query.organizationUnitId`, `query.page`, `query.status` | `cached`, `result` | `AccessDenied`, `ValidationError` |

### `/api/v1/invitations/validate`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/invitations/validate/route.ts#L9) | `Không có guard trực tiếp; xem handler/service` | `query.token` | `valid, email, role, chapterName, organizationUnitId, expiresAt` | `ValidationError` |

### `/api/v1/leaderboard/chapters/[chapterId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/leaderboard/chapters/[chapterId]/route.ts#L10) | `authenticate`, `canAccessChapterPermission`, `includes`, `role ADMIN`, `role CHAPTER_LEADER` | — | `chapterId, items` | `AccessDenied`, `ChapterNotFound` |

### `/api/v1/leaderboard/chapters`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/leaderboard/chapters/route.ts#L10) | `authenticate`, `Đọc công khai có điều kiện; auth optional` | `query.month` | `cachedData`, `data`, `month, availableMonths, formulaVersion, items, excluded, state` | — |

### `/api/v1/leaderboard`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/leaderboard/route.ts#L17) | `authenticate`, `Đọc công khai có điều kiện; auth optional` | `query.limit`, `query.page` | `items, page, limit, totalCount` | — |

### `/api/v1/learning/me`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/learning/me/route.ts#L9) | `authenticate`, `role MEMBER` | — | `payload` | — |

### `/api/v1/learning/periods`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/learning/periods/route.ts#L10) | `authenticate`, `getLearningManagerKind`, `role ADMIN`, `role MEMBER` | — | `readiness, months, terms, seasons, actualTerms, periodTypes, scope` | — |

### `/api/v1/lessons/[lessonId]/assessment`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/lessons/[lessonId]/assessment/route.ts#L19) | `authenticate`, `role ADMIN` | — | `assessmentId, id, lessonId, title, description, questionCount, durationMinutes, totalQuestionCount, pools, questions` | `AccessDenied`, `AssessmentNotFound`, `LessonNotFound`, `UNAUTHORIZED` |
| [POST](../src/app/api/v1/lessons/[lessonId]/assessment/route.ts#L111) | `assertFinalExamBankCapacity`, `authenticate`, `role ADMIN` | `body.durationMinutes`, `body.questionCount` | `assessmentId, id, lessonId, title, description, questionCount, durationMinutes, pools, questions`, `bankError` | `AccessDenied`, `AssessmentVersionRequired`, `LessonNotFound`, `QuestionPoolIncomplete`, `QuestionPoolQuotaExceeded`, `ServerError`, `ValidationError` |
| [DELETE](../src/app/api/v1/lessons/[lessonId]/assessment/route.ts#L364) | `assertFinalExamBankCapacity`, `authenticate`, `role ADMIN` | — | `bankError`, `success, message, lessonId, assessmentId` | `AccessDenied`, `AssessmentNotFound`, `AssessmentVersionRequired`, `LessonNotFound` |

### `/api/v1/lessons/[lessonId]/comments/[commentId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [DELETE](../src/app/api/v1/lessons/[lessonId]/comments/[commentId]/route.ts#L10) | `authenticate` | — | `success, message` | `Forbidden`, `NotFound`, `ServerError` |

### `/api/v1/lessons/[lessonId]/comments`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/lessons/[lessonId]/comments/route.ts#L10) | `authenticate`, `role ADMIN` | — | `comments` | `ServerError` |
| [POST](../src/app/api/v1/lessons/[lessonId]/comments/route.ts#L96) | `authenticate`, `role ADMIN` | `body.content`, `body.parentId` | `comment` | `NotFound`, `ServerError`, `ValidationError` |

### `/api/v1/lessons/[lessonId]/documents/confirm`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/lessons/[lessonId]/documents/confirm/route.ts#L8) | `authenticate`, `role ADMIN` | — | `documentId, fileName, storageKey, mimeType, fileSize` | `AccessDenied`, `ServerError`, `ValidationError` |

### `/api/v1/lessons/[lessonId]/documents/presign`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/lessons/[lessonId]/documents/presign/route.ts#L18) | `authenticate`, `role ADMIN` | — | `storageKey, fileName, mimeType, fileSize, uploadUrl, expiresIn` | `AccessDenied`, `ServerError`, `ValidationError` |

### `/api/v1/lessons/[lessonId]/documents/upload`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/lessons/[lessonId]/documents/upload/route.ts#L19) | `authenticate`, `role ADMIN` | `form.file` | `documentId, id, fileName, storageKey, mimeType, fileSize` | `AccessDenied`, `LessonNotFound`, `UploadFailed`, `ValidationError` |

### `/api/v1/lessons/[lessonId]/progress`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [PATCH](../src/app/api/v1/lessons/[lessonId]/progress/route.ts#L18) | `authenticate`, `isLearningManager`, `role ADMIN` | `body.currentPositionSeconds`, `body.event`, `body.furthest`, `body.furthestWatchedPositionSeconds`, `body.playbackEvent`, `body.playbackRate`, `body.playback_rate`, `body.playerDuration`, `body.playerDurationSeconds`, `body.position`, `body.positionSeconds`, `body.viewSessionId` | `result` | `InvalidVideoDuration`, `InvalidVideoEvent`, `InvalidVideoProgress`, `InvalidViewSession`, `LessonNotFound`, `ManagementOnlyAccount` |
| [POST](../src/app/api/v1/lessons/[lessonId]/progress/route.ts#L74) | `authenticate`, `role ADMIN` | — | — | — |
| [GET](../src/app/api/v1/lessons/[lessonId]/progress/route.ts#L142) | `authenticate` | — | `learningCycleId, lessonId, progressContext, lifetime, cycleProgress, rewardStatus, replay, videoStarsThisMonth, replayHistory, id, completed, lessonCompleted, videoCompleted, watchedUntil, lastPosition, lastPositionSeconds, furthestWatchedPositionSeconds, durationSeconds, progressPercentage, completedAt, updatedAt` | `UNAUTHORIZED` |

### `/api/v1/lessons/[lessonId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/lessons/[lessonId]/route.ts#L36) | `authenticate`, `role ADMIN`, `Đọc công khai có điều kiện; auth optional` | — | `lessonId, id, sessionId, title, description, sortOrder, session, video, assessment, documents` | `AccessDenied`, `LessonNotFound` |
| [PATCH](../src/app/api/v1/lessons/[lessonId]/route.ts#L119) | `authenticate`, `role ADMIN` | `body.description`, `body.sortOrder`, `body.title`, `body.video` | `lessonId, id, sessionId, title, description, video` | `AccessDenied`, `LessonNotFound`, `ValidationError` |
| [PUT](../src/app/api/v1/lessons/[lessonId]/route.ts#L203) | `authenticate`, `role ADMIN` | — | — | — |
| [DELETE](../src/app/api/v1/lessons/[lessonId]/route.ts#L207) | `assertFinalExamBankCapacity`, `authenticate`, `role ADMIN` | — | `bankError`, `success, message` | `AccessDenied`, `AssessmentVersionRequired`, `LessonNotFound` |

### `/api/v1/members/me/courses`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/members/me/courses/route.ts#L7) | `authenticate`, `isLearningManager`, `role ADMIN`, `role CHAPTER_LEADER`, `role MEMBER` | `query.limit`, `query.page` | `items, totalItems, totalPages, summary`, `items, totalItems, totalPages, summary, managementOnly` | `AccessDenied` |

### `/api/v1/members/me/deadlines`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/members/me/deadlines/route.ts#L6) | `authenticate` | — | `summary, items` | — |

### `/api/v1/organization/dna-leaderboard`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/organization/dna-leaderboard/route.ts#L7) | `authenticate`, `getLearningManagerKind`, `role ADMIN` | — | `items, totalCount` | `AccessDenied` |

### `/api/v1/organization/managed-units`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/organization/managed-units/route.ts#L6) | `authenticate` | — | `items` | — |

### `/api/v1/organization/units/[unitId]/members/[userId]/progress`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/organization/units/[unitId]/members/[userId]/progress/route.ts#L13) | `authenticate`, `canAccessOrganizationUnitPermission`, `role ADMIN`, `role MEMBER` | — | `user, summary, courses, learningDetail` | `AccessDenied`, `MemberNotFound`, `OrganizationUnitNotFound`, `ValidationError` |

### `/api/v1/organization/units/[unitId]/members`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/organization/units/[unitId]/members/route.ts#L37) | `authenticate`, `canAccessOrganizationUnitPermission`, `role ADMIN` | — | `rosterAsOf, unit, canManageMembers, items, pagination` | `AccessDenied`, `OrganizationUnitNotFound`, `ValidationError` |
| [POST](../src/app/api/v1/organization/units/[unitId]/members/route.ts#L158) | `authenticate`, `canAccessOrganizationUnitPermission`, `role ADMIN`, `role MEMBER`, `test` | `body.action`, `body.email`, `body.userId` | `membership`, `removed, endedMemberships` | `AccessDenied`, `AccountInactive`, `ChapterMembershipConflict`, `MemberNotFound`, `MembershipChangedConcurrently`, `MembershipExists`, `MembershipNotFound`, `OrganizationConflict`, `OrganizationUnitNotFound`, `UnknownAction`, `ValidationError` |

### `/api/v1/quiz/parse-sheet`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/quiz/parse-sheet/route.ts#L47) | `authenticate`, `role ADMIN` | `body.url` | `questions, errors, pools, total`, `total, pools` | `AccessDenied`, `NoQuestionsParsed`, `ValidationError` |

### `/api/v1/sessions/[sessionId]/lessons`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/sessions/[sessionId]/lessons/route.ts#L6) | `authenticate`, `role ADMIN` | `body.description`, `body.durationSeconds`, `body.sortOrder`, `body.title`, `body.video`, `body.youtubeVideoId` | `lessonId, id, sessionId, title, video` | `AccessDenied`, `CoursePublished`, `SessionNotFound`, `ValidationError` |
| [PATCH](../src/app/api/v1/sessions/[sessionId]/lessons/route.ts#L104) | `authenticate`, `role ADMIN` | `body.lessons` | `success` | `AccessDenied`, `ValidationError` |

### `/api/v1/sessions/[sessionId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/sessions/[sessionId]/route.ts#L6) | `Không có guard trực tiếp; xem handler/service` | — | `sessionId, id, courseId, title, description, sortOrder, lessons` | `SessionNotFound` |
| [PATCH](../src/app/api/v1/sessions/[sessionId]/route.ts#L53) | `authenticate`, `role ADMIN` | `body.description`, `body.sortOrder`, `body.title` | `sessionId, id, courseId, title, description, sortOrder` | `AccessDenied`, `SessionNotFound` |
| [PUT](../src/app/api/v1/sessions/[sessionId]/route.ts#L85) | `authenticate`, `role ADMIN` | — | — | — |
| [DELETE](../src/app/api/v1/sessions/[sessionId]/route.ts#L89) | `assertFinalExamBankCapacity`, `authenticate`, `role ADMIN` | — | `bankError`, `success, message` | `AccessDenied`, `AssessmentVersionRequired`, `SessionNotFound` |

### `/api/v1/stars/me`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/stars/me/route.ts#L7) | `authenticate` | `query.balanceOnly`, `query.limit`, `query.page` | `balance`, `balance, items, page, limit, totalItems, totalPages` | — |

### `/api/v1/streak`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/streak/route.ts#L9) | `authenticate` | — | `currentStreak, longestStreak, totalActiveDays, lastActiveDay` | `INTERNAL_ERROR` |

### `/api/v1/users/[userId]/password-reset`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [POST](../src/app/api/v1/users/[userId]/password-reset/route.ts#L7) | `authenticate`, `role ADMIN` | — | `message` | `AccessDenied`, `EmailSendFailed`, `UserNotFound` |

### `/api/v1/users/[userId]/profile`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [PATCH](../src/app/api/v1/users/[userId]/profile/route.ts#L6) | `authenticate`, `canAccessChapterPermission`, `role ADMIN` | `body.chapterId`, `body.displayName` | `id, email, displayName` | `AccessDenied`, `ValidationError` |

### `/api/v1/users/[userId]`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [PATCH](../src/app/api/v1/users/[userId]/route.ts#L13) | `assertCanChangeUserStatus`, `authenticate`, `canAccessChapterPermission`, `invalidateAdminOverviewCache`, `role ADMIN`, `role CHAPTER_LEADER` | — | `userId, status, affectedCount` | `AccessDenied`, `AccountRetired`, `UserNotFound`, `ValidationError` |

### `/api/v1/users/me`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/users/me/route.ts#L29) | `authenticate`, `getLearningManagerKind` | — | `id, email, displayName, role, status, chapterId, chapterName, currentTermNumber, currentTermLabel, currentDepartment, departmentHistory, department, dna, positions, managerKind, capabilities` | `UserNotFound` |
| [PATCH](../src/app/api/v1/users/me/route.ts#L134) | `authenticate` | `body.displayName` | `id, email, displayName` | `ValidationError` |

### `/api/v1/users`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/users/route.ts#L59) | `authenticate`, `role ADMIN`, `role CHAPTER_LEADER`, `role CHAPTER_MEMBER`, `role DNA`, `role DNA_LEAD`, `role LT`, `role MEMBER` | `query.chapterId`, `query.compact`, `query.limit`, `query.page`, `query.role`, `query.search`, `query.status` | `items, totalItems, totalPages, page, limit`, `responsePayload` | `AccessDenied` |

### `/api/v1/youtube/info`

| Method | Truy cập / guard | Đầu vào đọc trực tiếp | Response thành công | Mã lỗi thấy trong handler |
|---|---|---|---|---|
| [GET](../src/app/api/v1/youtube/info/route.ts#L10) | `Không có guard trực tiếp; xem handler/service` | `query.videoId` | `videoId, title, authorName, durationSeconds, durationFormatted, durationKnown, source, reason, thumbnail` | `FetchError`, `InvalidVideoId`, `VideoNotFound` |

Tổng cộng **96 route / 132 HTTP handler**. Dấu “—” nghĩa là handler không đọc/ghi trực tiếp dạng đó (có thể ủy quyền cho service), không có nghĩa là endpoint không validation hoặc không trả lỗi. Mã lỗi động từ service, lỗi xác thực chung và lỗi hạ tầng không được nhân bản vào từng dòng.
