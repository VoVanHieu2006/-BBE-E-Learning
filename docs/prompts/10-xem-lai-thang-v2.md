# Prompt 10: "Xem lại tháng này" v2 + nhãn tháng + hiệu ứng nhận sao + đổi chữ "chu kỳ" → "nhiệm kỳ"

Bạn đang làm trong git worktree riêng, nhánh `feat/monthly-review-v2` (tạo từ `main`). `node_modules` là junction dùng chung với repo chính.

## Luật làm việc
- Đọc `AGENTS.md` trước. Chỉ sửa những gì trong prompt này. Không đổi Prisma schema, không tạo migration, không đổi tên biến/bảng/cột.
- Commit riêng cho từng mục A, B, C, D, E (message tiếng Việt hoặc Anh, kiểu `feat(learning): ...`). KHÔNG push, KHÔNG merge.
- Giữ file `HANDOFF.md` ở gốc worktree: đã xong / còn lại / bước kế tiếp; cập nhật sau mỗi commit (không commit file này).
- Trước khi kết thúc: `npx tsc --noEmit` phải sạch và `npm test` (unit) phải pass. Nếu test cũ hỏng vì hành vi đổi có chủ đích, sửa test và ghi lý do vào HANDOFF.md.
- `canvas-confetti` và `@types/canvas-confetti` đã được cài và commit sẵn, không cần cài lại.

## Context
Nút "Xem lại tháng này" vừa lên main nhưng còn 4 vấn đề người dùng thấy trên trang học bài (`/student/learning/[lessonId]`):
1. Nút nằm trong ô thứ 3 của lưới 3 cột → cả hàng bị kéo cao, 2 ô kia trống to phía dưới.
2. Bài 2 không có nút: bài này đã có dòng `MonthlyVideoReplay` tháng 11 (9 giây, tạo từ trước) nên `reviewAvailable=false` → nút bị ẩn hẳn.
3. Hiệu ứng nhận sao (`StarRewardCelebration`) quá đơn giản, ngôi sao trông giả.
4. Bấm nút xong không reset gì trên giao diện: video vẫn ở 6:39, vẫn "Có thể tua" (player lấy `initialFurthest` từ tiến độ nhiệm kỳ = 100%), không hỏi xác nhận. Thiếu nhãn/% tháng; "Những tháng trước" còn hiện cả tháng hiện tại (T11).
Thêm: đổi mọi chữ hiển thị "chu kỳ" → "nhiệm kỳ" (chỉ chữ, không đổi tên biến/DB).

## Quy tắc đã chốt
- Nút luôn hiện khi bài đã xem xong video trong nhiệm kỳ (người dùng mô tả: lúc đầu màu xanh, bấm xong thì màu xám).
  - Chưa có lượt xem tháng này → **xanh**, bấm được.
  - Đã mở lượt tháng này (đã bấm, hoặc có dòng cũ như bài 2) → **xám**, bị khóa, ghi "Đã bấm xem lại tháng này".
  - Đã nhận sao tháng này → xám, ghi "Tháng sau mới xem lại được".
  - Sang tháng mới → nút xanh trở lại. Lượt tháng 11 xem dở thì bỏ, không chuyển sang tháng 12.
- Bấm nút → hộp xác nhận → bấm "Xác nhận" → gọi API → tải lại bài: video về 0:00, **không tua được** tới chỗ chưa xem trong tháng, quiz hiện nhãn "Làm lại tháng này".
- Hai mốc chạy độc lập: **Nhiệm kỳ** giữ "Hoàn thành" sau khi reset. **Tháng này** hiện % tăng dần theo lượt xem tháng và chỉ "Hoàn thành" khi xem đủ.

## Các thay đổi

### A. Server
- `src/lib/video-heartbeat.ts` (`getVideoReplayState` và kết quả heartbeat): thêm `reviewState: 'AVAILABLE' | 'STARTED' | 'AWARDED'` (AVAILABLE = `isFreeReviewLesson`; AWARDED = đã có StarLedger tháng này; còn lại STARTED). Giữ `reviewAvailable` cũ để không vỡ chỗ khác.
- `src/app/api/v1/lessons/[lessonId]/progress/route.ts`:
  - trả thêm `reviewState`, `monthPercent` (= replay.watchedSeconds / duration).
  - `getLessonVideoHistory`: lọc tháng hiện tại khỏi `replayHistory` (chỉ giữ tháng trước).
- `src/lib/monthly-review.ts` / route `monthly-review`: không đổi logic (vẫn chỉ tạo dòng mới, idempotent). Đổi chữ "chu kỳ" trong message.

### B. Trang học bài `src/app/student/learning/[lessonId]/page.tsx`
- Lưới 3 ô: các ô cùng một kiểu gọn (tiêu đề + 1 dòng phụ + thanh % mảnh). Nút chuyển thành viên thuốc nhỏ nằm cạnh tiêu đề ô 3 (flex `justify-between`), không thêm dòng → hết khoảng trống.
  - Ô 1 "Nhiệm kỳ · video": ✓ Hoàn thành / X%.
  - Ô 2 "Nhiệm kỳ · bài học": như cũ, đổi chữ.
  - Ô 3 "Tháng 11/2026": X% + thanh tiến độ; trạng thái Hoàn thành / Đang xem / Chưa xem lại; +N ⭐ nếu có; nút xanh/xám theo `reviewState`.
- Player: khi `progressContext.monthlyReplayRequired` → `initialFurthest = replay.watchedSeconds`, `initialPosition = min(lastPosition, replay.watchedSeconds)` (0 ngay sau reset). Thêm `reviewNonce` vào `key` của `YouTubePlayer` để remount sau khi xác nhận.
- Thêm nhãn tháng trên player cạnh "Đã xem hết video (100%)": "Tháng này: 37%" (tìm chỗ render nhãn trong `src/components/YouTubePlayer.tsx`, truyền thêm prop `monthPercent`).
- Sidebar danh sách bài: bài có lượt tháng mở mà chưa xong + có quiz → nhãn quiz "Làm lại tháng này".

### C. `src/components/learning/MonthlyReviewButton.tsx`
- Prop `state` (`AVAILABLE|STARTED|AWARDED`) → xanh / xám (disabled + chữ tương ứng).
- Bấm → modal xác nhận nhỏ (tự viết, cùng style thẻ trắng bo góc): "Xem lại bài này trong tháng 11/2026? Video sẽ bắt đầu lại từ 0:00, không tua được, quiz cần làm lại để nhận Star tháng này. Tiến độ nhiệm kỳ vẫn giữ Hoàn thành." [Hủy] [Xác nhận].
- Thành công → `onDone()` → trang refetch progress + tăng `reviewNonce`.

### D. Hiệu ứng nhận sao `src/components/StarRewardCelebration.tsx`
- Thêm `canvas-confetti` (npm, có types `@types/canvas-confetti`).
- Ngôi sao SVG tự vẽ dễ thương: góc bo tròn, gradient vàng cam, mắt + miệng cười + má hồng, có ánh sáng bóng.
- Trình tự (~3.5s): sao nảy từ dưới lên (scale + bounce), xoay nhẹ, chớp mắt → nổ 2 đợt pháo giấy vàng/cam/xanh hai bên + một vòng lấp lánh hình sao quanh thẻ → số "+11" đếm lên → tổng sao. Tôn trọng `prefers-reduced-motion` (chỉ hiện thẻ, không pháo).
- Giữ nguyên props (`amount`, `balance`, `message`, `onClose`) → 3 chỗ đang dùng không phải sửa.

### E. Đổi chữ "chu kỳ" → "nhiệm kỳ"
- Chỉ chuỗi người dùng thấy: `page.tsx` học bài, `LearningPeriodSummary.tsx`, `UnifiedLeaderboard.tsx`, `learning-readiness-rules.ts`, message trong các route API (`attempts`, `monthly-review`), `docs/*.md` liên quan. Chỗ đã có "nhiệm kỳ" (vd "Chu kỳ nhiệm kỳ DNA", "Chu kỳ Tháng / Nhiệm kỳ") sửa câu cho khỏi lặp.
- Không đổi tên biến, comment code, bảng/cột DB.

## Ghi chú kỹ thuật đã tìm sẵn
- Nút ẩn ở bài 2 vì `isFreeReviewLesson(cycleComplete, Boolean(replay))` trong `src/lib/monthly-review.ts`: có dòng replay tháng này ⇒ `reviewAvailable=false`. Dùng nó để suy ra `reviewState`: AVAILABLE khi `isFreeReviewLesson` true; AWARDED khi có StarLedger `reward_key = video:${userId}:${videoId}:${monthId}:${cycleId}` (hoặc `source_type:'VIDEO', source_id: videoId, competition_month_id`); còn lại STARTED (có dòng replay). Bài chưa xem xong video trong nhiệm kỳ thì không hiện nút (giữ như cũ, `reviewState` có thể là null).
- Player nhận `initialFurthest` ở `src/app/student/learning/[lessonId]/page.tsx` khoảng dòng 626-647; hiện lấy tiến độ nhiệm kỳ nên vẫn "Có thể tua" sau khi reset. `src/lib/video-progress-session.ts` `confirmProgress` đã lấy `min(training, replay.watchedSeconds)` khi `monthlyReplayRequired` — làm phía khởi tạo player cho khớp.
- Lượt replay vừa bấm có `furthest_seconds=0`, chưa có `last_heartbeat_at`; heartbeat đầu tiên chỉ đặt mốc (xem comment trong `src/lib/video-heartbeat.ts`). Đừng phá logic chống gian lận này.
- Quiz: `src/app/api/v1/assessments/[assessmentId]/attempts/route.ts` đã chặn làm lại quiz của tháng trước nếu replay tháng này chưa xong; giữ nguyên, chỉ đổi chữ.
- Lịch sử "Những tháng trước" đang chứa cả tháng hiện tại (T11/2026) — lọc ra trong `getLessonVideoHistory` của `src/app/api/v1/lessons/[lessonId]/progress/route.ts`.
- Nhãn "Đã xem hết video (100%)" trên player: tìm trong `src/components/YouTubePlayer.tsx`; thêm nhãn tháng bên cạnh, hiển thị "Tháng này: X%" (hoặc "✓ Tháng này") chỉ khi có `monthPercent` (học viên, không phải admin/khách).
- UI dùng Tailwind, màu chính #2563EB, chữ đậm #172554, thẻ trắng bo `rounded-2xl`, viền #eff4ff. Toàn bộ chữ giao diện tiếng Việt có dấu, viết hoa kiểu câu.
- Tests nằm ở `src/test/*.test.ts` (chạy bằng `npm test`). Thêm test cho: suy ra `reviewState`, lọc tháng hiện tại khỏi lịch sử, giá trị `initialFurthest/initialPosition` của player khi `monthlyReplayRequired` (tách thành hàm thuần nếu cần để test được).

## Khi xong
In ra tóm tắt: danh sách commit, file đã đổi, kết quả tsc + test, điểm còn nghi ngờ.
