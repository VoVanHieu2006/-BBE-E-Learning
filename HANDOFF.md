# HANDOFF — Prompt 02b

## Sửa lỗi reviewer chéo — đã triển khai, nghiệm thu một phần
- Phạm vi: (1), (3), (4), (5), (6), (7); thêm test hồi quy trước khi sửa, không đổi schema/nghiệp vụ.
- Đã xác nhận đúng nhánh `feat/p02b-editor-nhan-moi`. Ban đầu có `.impeccable/` và browser artifacts chưa track; giữ ngoài commit.
- Không push/install/generate/migrate/DB thật. Để thay đổi trong working tree nếu Git metadata không ghi được.
- (6): chặn khóa/buổi rỗng khi publish trước mọi write; vẫn cho lưu draft đang soạn dở.
- Rủi ro còn lại (2): race giữa bắt đầu quiz và xóa đáp án chưa sửa theo yêu cầu; cần xử lý riêng đồng bộ/khóa hai luồng và test cạnh tranh trên DB test.
- Đã sửa (1): xóa pool bỏ đi trước, chuyển các pool giữ lại sang vị trí tạm rồi gán thứ tự cuối; bảo toàn câu/đáp án đã có attempt.
- Đã sửa (3), (4): PATCH visibility và unpublish tăng OCC nguyên tử; capture requirement dùng version không thấp hơn content_version hiện tại để republish không khôi phục base version cũ. Không đổi công thức hạn/quyền/schema.
- Đã sửa (5): so sánh tài liệu theo ID, đúng session/lesson và toàn bộ metadata với snapshot đang chạy, chỉ áp giới hạn size cho tài liệu mới/đổi; GET/PUT/publish đều dùng snapshot tin cậy, PUT đọc trong khóa course.
- Đã sửa (6): kiểm tra EmptyCourse/EmptySession trước mọi write của applyCourseDraft.
- Đã sửa (7): selector đúng “Bắt đầu làm bài thi cuối khóa”, thêm kiểm tra nút khóa disabled và hai case quiz chưa đạt/đã đạt để kiểm chứng selector dương tính.
- Test RED đã tái hiện lỗi unique pool, version không tăng, legacy bị chặn, publish rỗng và version bị lùi. Sau sửa: course-draft 8/8, course-draft-publish 10/10, course-draft-routes 8/8 PASS (26/26); dùng alias-hook của runner, không DB.
- Kiểm chứng cuối của lượt sửa này:
  - `npx tsc --noEmit`: PASS, exit 0.
  - `npm run test:unit`: exit 1, **605 PASS / 2 FAIL**, 42 suite đã chạy. Hai FAIL ở `scripts/test/database-safety.test.cjs`: “DB suites refuse missing, remote, application, schema override and rerouting targets before loading Prisma” và “DB suites select only the explicit disposable loopback URL”, cùng do `spawnSync C:\nvm4w\nodejs\node.exe EPERM`. Không sửa/vượt guard. Hai suite cuối `load-tests/tests/safety.test.mjs`, `load-tests/tests/profiler.test.mjs` chưa chạy do runner dừng.
  - Ba suite liên quan trong unit tổng: `course-draft` 8/8, `course-draft-publish` 10/10, `course-draft-routes` 8/8 PASS; thêm 8 test unit hồi quy.
  - `npx playwright test -c playwright.course-update.config.ts`: exit 1, `Error: spawn EPERM`; **0 test browser thực thi**. Cấu hình hiện có mock API và trỏ DB về loopback port 1, không DB thật. Thêm hai case browser (chưa chạy), tổng 9 spec × desktop/mobile = 18 case dự kiến.
  - `git -c core.whitespace=cr-at-eol -c core.safecrlf=false diff --check`: PASS.
  - Rà soát chỉ đọc độc lập: không tìm thấy lỗi correctness mới trong diff. Chưa kiểm chứng constraint/concurrency bằng DB test hoặc UI bằng browser.
- Lệch/giới hạn: kiểm tra rỗng chỉ ở publish để giữ thao tác lưu draft trung gian; thêm một dòng bảo vệ version trong `course-requirements.ts` là phần cần thiết của (4), không đổi nghiệp vụ hạn. Mọi PATCH có trường visibility đều tăng version, kể cả DRAFT/no-op, để bao phủ trường hợp đua với publication.
- Trạng thái Git: `git add -- <12 file chỉ định>` thất bại: không tạo được `C:/Users/Acer/Desktop/E-learning/.git/worktrees/p02b/index.lock` (`Permission denied`). Thay đổi còn trong working tree, chưa commit/push; `.impeccable/` và browser artifacts có sẵn không thuộc thay đổi cần commit. Không đổi quyền hoặc thao tác ở thư mục gốc/nhánh khác.
- File thay đổi trong **lượt sửa reviewer này** (12 file):
  - `HANDOFF.md`.
  - `src/lib/apply-course-draft.ts`, `src/lib/course-draft.ts`, `src/lib/course-requirements.ts`.
  - `src/app/api/v1/courses/[courseId]/route.ts`, `unpublish/route.ts`, `draft/route.ts`, `draft/publish/route.ts` (ba đường dẫn sau cùng chung thư mục courseId).
  - `src/test/course-draft.test.ts`, `src/test/course-draft-publish.test.ts`, `src/test/course-draft-routes.test.ts`, `src/test/browser/course-update.spec.ts`.

Phần dưới là lịch sử triển khai trước lượt sửa reviewer này; kết quả kiểm chứng hiện tại lấy ở mục trên.

- Nhánh: `feat/p02b-editor-nhan-moi`; chỉ làm trong worktree hiện tại. Không push, cài dependencies, generate Prisma hoặc kết nối DB.
- Trạng thái ban đầu: working tree sạch. Đã đọc quy tắc chung, worker ngoài và prompt 02b.

## Tiến độ theo prompt
1. **Đã triển khai, nghiệm thu một phần:** editor nối GET/PUT/publish/discard có OCC (draft ID + version + base version), lưu session/bài/quiz/pool/đề cuối/tài liệu/ảnh bìa vào draft khi PUBLISHED, DRAFT giữ trực tiếp. Có nút Cập nhật khóa học/trạng thái/bỏ thay đổi/tải lại khi xung đột. Hủy xuất bản riêng, xác nhận hậu quả KHBB 6.3. Upload draft không tạo liên kết tài liệu hoặc ghi đè ảnh bìa xuất bản. Draft cũ sai cấu trúc có thông báo và cho bỏ để tạo lại. Browser chưa khởi chạy được.
2. **Đã triển khai, nghiệm thu một phần:** `course-draft.ts`, `course-draft-snapshot.ts`, `apply-course-draft.ts`; publish áp dụng cây đầy đủ, bảo toàn ID/pool/lịch sử, chặn xóa đã có attempt, kiểm tra video/ngân hàng, tạo final version khi cấu hình hoặc nguồn đổi, cache đủ và audit. PUT/DELETE khóa course, kiểm tra phiên bản cả lần lưu đầu. Transaction double và route tests PASS; chưa có DB test.
3. API: đã đọc xác nhận my-progress spread `...state`, lesson progress spread `...learningState`, learning/me trả `lessonStates` từ hàm server. Không thêm dữ liệu cá nhân vào hai endpoint cache chung.
4. **Đã triển khai, nghiệm thu một phần:** chip theo style hiện có ở trang khóa (cả khóa/mở), sidebar/tiêu đề/tab/trang quiz và ProgramCourseTree. Quiz đạt/tab/trang quiz dùng assessmentPassed; allLessonsDone yêu cầu video và quiz. Giữ điều hướng bài tiếp theo; unit điều hướng 6/6 PASS. Browser chưa chạy được.
5. **Một phần:** đã sửa integration assertion sang khóa đã xong mở lại từ lúc cập nhật (fixture thêm đủ video+quiz), sửa audit fixture, cập nhật known issues, đăng ký cả unit và browser. Unit tổng còn 2 FAIL do môi trường; audit tổng còn 2 FAIL ngoài phạm vi. Không tuyên bố hoàn tất nghiệm thu.

## Kiểm chứng
- Baseline `npx tsc --noEmit`: PASS (exit 0).
- Sau mục 2: `npx ts-node -P tsconfig.test.json src/test/course-draft.test.ts`: PASS 6/6; `npx tsc --noEmit`: PASS.
- Test mới đã chạy RED trước implementation (thiếu module), rồi GREEN.
- Sau mục 1/3/4: `npx tsc --noEmit`: PASS; test learning-display: PASS 3/3.
- Lần chạy cuối `npm run test:unit`: exit 1; **597 PASS / 2 FAIL**, 42 suite đã chạy. Hai FAIL thuộc `scripts/test/database-safety.test.cjs`: `spawnSync C:\nvm4w\nodejs\node.exe EPERM`; không sửa guard để vượt lỗi. Hai suite load-test safety/profiler ở cuối runner chưa được chạy do runner dừng tại lỗi.
- Trong lần chạy tổng trên: `course-draft` 7/7, `course-draft-publish` 6/6, `course-draft-routes` 5/5, `learning-display` 3/3: **21 test mới PASS**. Logic nền: `course-update-rules` 19/19, `lesson-new-label` 13/13, `lesson-navigation` 6/6 PASS.
- `node scripts/audit/audit-handbook-formulas.cjs`: exit 1, **9 PASS / 2 FAIL**; `HANDBOOK-DEADLINE-ADDED` PASS (ngày 26). Hai lỗi ngoài phạm vi: BOOK-6/13 actual 4 vs expected 10; BOOK-VI manager alias fixture thiếu `count`. Không sửa logic/chính sách của worker khác.
- `npx playwright test -c playwright.course-update.config.ts`: exit 1 ngay lúc khởi chạy, `spawn EPERM`; **0 browser test thực thi**, chưa có screenshot. Đã thêm 7 spec chạy desktop/mobile, mock toàn bộ API, được TypeScript kiểm tra; chưa chứng nhận browser QA.
- Lần cuối `npx tsc --noEmit`: PASS (exit 0). `git -c core.whitespace=cr-at-eol -c core.safecrlf=false diff --check`: PASS (exit 0).
- Không chạy integration: không có DB test riêng/.env; không tìm credentials, không kết nối DB thật/cloud. Đã đọc guard của suite learning-cycles và giữ nguyên.

## Thiết kế và kế hoạch thực hiện
- Áp dụng brainstorming/writing-plans trong phạm vi đặc tả đã chốt; không đổi kiến trúc hoặc mở rộng nghiệp vụ.
- [x] 2. Tách kiểm tra/reconcile draft, transaction writer và unit tests.
- [x] 1. Nối editor với snapshot draft/OCC/publish/discard; giữ sửa trực tiếp DRAFT.
- [x] 3–4. Xác nhận API cá nhân, thêm chip và sửa trạng thái quiz.
- [x] 5. Sửa integration/audit assertion, known issues, chạy unit/TypeScript và thử browser.
- [ ] Nghiệm thu đầy đủ: giải quyết giới hạn môi trường, chạy lại unit tổng, browser và integration với DB test đúng guard.
- Mỗi mục lớn cập nhật handoff và commit khi TypeScript sạch. Review tập trung: hai Admin đồng thời, ID ngoài khóa, câu hỏi đã có attempt, xóa làm thiếu ngân hàng, quiz mới trên bài đã xong.

## Quyết định và nghi ngờ
- Dùng lại logic update rules, requirements, guard, final version và learning state đã có; không viết lại.
- Đã rà soát KHBB mục 9: dòng 10 (mở lại/hạn từ cập nhật), 11 (Mới/không chặn bài sau), 12 (bài giữ xong, quiz Mới/chưa đạt), 15 (draft editor/publish), 18 (chia ngày video/quiz, final +3/đổi đề +0). **Không phát hiện lệch có chủ đích trong code của các dòng này**; chỉ có bằng chứng unit/transaction double và đọc mã, chưa đủ DB/browser để ký nghiệm thu.
- Draft publish vẫn gọi executePublishCourseRequirements đúng một lần trong transaction/khóa hiện có. Bổ sung tăng content_version cho cập nhật chỉ metadata để OCC không bỏ sót thay đổi; fingerprint yêu cầu giữ idempotent. ID draft ngăn yêu cầu cũ khớp nhầm draft mới sau discard.
- Câu hỏi đã có tham chiếu attempt/answer: giữ nguyên nội dung và ID đáp án, chặn thay đổi grading/xóa; không clone câu hỏi quiz. Đề cuối tạo version khi cấu hình/nguồn đổi, giữ attempt/điểm cũ.
- Object upload bị bỏ draft hoặc OCC thất bại có thể thành asset chưa liên kết; không tự xóa cloud objects vì chưa có vòng đời cleanup trong phạm vi prompt.
- Draft publish khóa user trước course/exam bank để khớp thứ tự của luồng tạo attempt, tránh deadlock. Không thay đổi policy/cutover, schema/migration, role/nhóm học, package/lockfile hoặc công thức prompt 01.

## Xung đột có thể
- **Không commit được**: `git add HANDOFF.md; git commit ...` bị sandbox từ chối tạo `C:/Users/Acer/Desktop/E-learning/.git/worktrees/p02b/index.lock`. Metadata Git nằm ngoài writable root; không đổi quyền hoặc chạy ở thư mục khác. Các checkpoint được lưu trong working tree/HANDOFF.

## File sửa/thêm (trạng thái cuối)
- `.impeccable/config.json` (mới, bổ sung sau stop hook): ngoại lệ `side-tab=*` chỉ cho `src/app/student/learning/[lessonId]/page.tsx`.
- `HANDOFF.md`, `docs/known-issues.md`, `playwright.course-update.config.ts`.
- `scripts/audit/audit-handbook-formulas.cjs`, `scripts/test/run-tests.cjs`, `scripts/test/test-learning-cycles-integration.cjs`.
- `src/app/admin/courses/[courseId]/edit/`: `useCourseEditor.ts`, `page.tsx`, `CourseInfo.tsx`, `CourseOutline.tsx`, `CourseAssessmentEditor.tsx`, `LessonDocuments.tsx`.
- `src/app/api/v1/courses/[courseId]/`: `draft/route.ts`, `draft/publish/route.ts`, `draft/documents/upload/route.ts` (mới), `cover/route.ts`.
- `src/app/student/`: `courses/[courseId]/page.tsx`, `learning/[lessonId]/page.tsx`, `learning/[lessonId]/quiz/page.tsx`.
- `src/components/learning/`: `NewContentChip.tsx` (mới), `ProgramCourseTree.tsx`.
- `src/lib/` (mới): `course-draft.ts`, `course-draft-snapshot.ts`, `apply-course-draft.ts`, `course-draft-editor.ts`, `learning-display.ts`.
- `src/test/` (mới): `course-draft.test.ts`, `course-draft-publish.test.ts`, `course-draft-routes.test.ts`, `learning-display.test.ts`, `browser/course-update.spec.ts`.

## Việc tiếp theo
1. Chạy lại 7 browser spec (desktop/mobile) trên máy cho phép Playwright tạo tiến trình, render/screenshot và xử lý nếu có lỗi thực tế.
2. Chạy unit tổng trên máy cho phép child process; giữ nguyên guard DB. Chạy integration trên DB disposable `bbe_test_learning_cycles` loopback đúng guard, tập trung transaction rollback, cạnh tranh attempt/publish và lưu trữ asset.
3. Commit checkpoint trên **chính nhánh này** khi quyền ghi metadata Git cho phép; hiện **không có commit mới**, không push/merge/rebase/đổi nhánh. Tất cả thay đổi còn trong working tree.

## Triage design hook sau báo cáo
- Hook báo `side-tab` ở dòng 1054. Đối chiếu `git show HEAD` và diff xác nhận `border-l-4` đã có từ trước, chỉ hiển thị khi `isCurrent`: dấu chọn bài đang học của sidebar, không phải trang trí mới do 02b.
- Giữ giao diện có chủ đích; thêm ignore hẹp bằng CLI chính thức: `hooks ignore-value side-tab "*" --file src/app/student/learning/[lessonId]/page.tsx`, kèm lý do và bằng chứng từ HEAD. Không ignore-file/ignore-rule, không đổi source UI.
- Chạy detector trước: 1 finding; sau ngoại lệ: exit 0, không còn finding regex cho file này. Detector regex không thay thế kiểm tra render/contrast bằng browser.
- Tổng file cuối sau triage: 32 (thêm config). Không chạy lại unit/TypeScript vì chỉ đổi cấu hình detector và tài liệu; kết quả kiểm chứng code ở trên giữ nguyên.
