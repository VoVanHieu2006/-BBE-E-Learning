# Kiểm thử heartbeat video theo nhiều độ dài (20/11/2026)

Kiểm lại thay đổi phiên 7: heartbeat tiến độ video là **3 s khi video < 30 s** và **20 s khi video ≥ 30 s** (`videoHeartbeatIntervalMs`, ngưỡng `SHORT_VIDEO_HEARTBEAT_THRESHOLD_SECONDS = 30` trong `src/lib/video-progress-rules.ts`). Server không đổi. Yêu cầu bắt buộc: **xem hết thì phải ghi 100%**, không được kẹt 98%.

Phiên này chỉ kiểm thử, không sửa code app.

## Kết luận nhanh

- **Đánh dấu hoàn thành đúng ở mọi lượt đã xem hết.** Có 22 lượt xem tới cuối (trong đó 3 lượt là mở lại bài đang dở). Lượt nào YouTube phát tới cuối và gửi ENDED thì giao diện đều hiện "✓ Đã xem hết video (100%)", và DB có `lesson_progress.completed = true`, `furthest_watched_position_seconds` = thời lượng, `cycle_lesson_progress.completed_at` có giá trị. Không lượt nào xem hết mà lại kẹt 98%.
- **Nhịp heartbeat đúng ngưỡng.**
  - Video 7 s, 19 s, 29 s: 3 s, lệch không quá 0,2 s.
  - Video 30 s, 33 s, 66 s, 213 s, 609 s: 20 s, lệch không quá 0,6 s.
  - Video đúng 30 s dùng nhịp 20 s, khớp quy tắc `< 30`.
- **Có 2 vấn đề cần chủ dự án biết.** Chưa sửa vì phiên này không sửa code.
  1. **Video tự tạm dừng (5/28 lượt, chưa tính C1c), sau đó hiện 98% / 84% / 4%.** YouTube báo trạng thái dừng (state 2) khi video chưa hết, nên không có ENDED. Trong khi đó không có thao tác nào của người dùng. Giao diện báo đúng là chưa xem hết, nên đây **không phải lỗi đánh dấu sai**. Bấm phát lại thì lên 100%. Nghi do môi trường test (Chrome tự động hóa, nhiều trình duyệt chạy cùng lúc), chưa loại trừ được hẳn. Xem mục [Vấn đề 1](#vấn-đề-1--video-tự-tạm-dừng-giữa-chừng).
  2. **Mở lại bài đang dở thì video phát lại từ 0:00.** Giao diện hiện đúng vị trí cũ (ví dụ 0:12), nhưng bấm phát thì YouTube chạy từ đầu. Đã tái hiện 4/4 lần. Hậu quả: học viên bị dừng ở 98% phải xem lại cả video mới được 100%. Xem mục [Vấn đề 2](#vấn-đề-2--mở-lại-bài-dở-video-phát-lại-từ-đầu).

## Môi trường và cách đo

- **Web và DB:** web `next dev` ở `localhost:3005` (cấu hình `e2e-localdb`). DB local `bbe_test_e2e` trong container `bbe-test-pg`. Không đụng Supabase thật.
- **Khóa test:** `5d340f01-…`. Thêm buổi "Test heartbeat 20/11" qua trình sửa khóa (thêm hàng loạt, rồi "Cập nhật khóa học"). Thời lượng lấy từ `/api/v1/youtube/info` và khớp DB.
- **Video dùng để test** (đều nhúng được):

| Video | Thời lượng | Mã YouTube |
|---|---|---|
| V1 | 7 s | `QC8iQqtG0hg` |
| V2 | 19 s | `jNQXAC9IVRw` |
| V3 | 29 s | `8IabGmr_bCs` |
| V4 | 30 s | `tWoo8i_VkvI` |
| V5 | 33 s | `UgFdtIkDvSU` |
| V6 | 66 s | `6H8jMHyvDbk` |
| V7 | 213 s | `dQw4w9WgXcQ` |
| V8 | 609 s | `lMVv3qz-rHs` |

  V2 và V7 là 2 bài có sẵn ở buổi 1.
- **Cách chạy:** ban đầu chạy trong trình duyệt của app, nhưng ngăn trình duyệt bị ẩn nên trang bị đóng băng và video dừng ở 40 s. Lượt đó không tính. Sau đó chuyển sang **Playwright điều khiển Chrome thật (headless)**:
  - đăng nhập bằng form;
  - bấm đúng các nút của trình phát app: phát/tạm dừng, chọn tốc độ 1.5x/2x, lùi 10 s;
  - script `addInitScript` bọc `window.fetch` và ghi mọi `PATCH /api/v1/lessons/:id/progress`: thời điểm, sự kiện, vị trí, furthest, tốc độ, trạng thái tab, mã HTTP, và `completed`/`videoCompleted`/`progressPercentage` trong response;
  - khi kết thúc, đọc giao diện và truy vấn DB bằng `docker exec bbe-test-pg psql`.
- **Dữ liệu chỉnh trong DB test (chỉ DB local):**
  - Xóa tiến độ cũ của `member.demo` ở bài 213 s và 19 s.
  - Đặt lại tiến độ bài 213 s của `minh.tuan`, `khanh.vy`, `thu.trang` trước khi chạy lại.
  - Bài học bị khóa tuần tự. Với các tài khoản phụ, tôi chèn dòng `cycle_lesson_progress` có `unlocked_at` (provenance `NATIVE`) cho **đúng bài cần test**, để mở bài đó mà không phải giả hoàn thành các bài trước.
  - `member.demo` xem 8 bài đúng thứ tự, không cần mở khóa.
- **Ẩn tab:** Playwright luôn giữ trang ở `visible` (đã thử tab mới, thu nhỏ cửa sổ, tắt focus emulation qua CDP, đều không được). Vì vậy D1c và D2b **giả lập** bằng cách đặt `document.visibilityState = 'hidden'` rồi phát `visibilitychange`, giữ một lúc rồi trả về `visible`. Cách này kiểm được logic ẩn/hiện của app, nhưng không có cơ chế giảm tốc độ tab nền của Chrome (tab đang phát tiếng thì Chrome cũng không giảm). D1, D1b, D2 chạy trước đó không ẩn được tab, nên chỉ tính như xem liền.
- **Máy ngủ:** máy tính ngủ 2 lần trong lúc test (19:39–20:39 và 20:39–21:14). Chỉ lượt A8b bị treo trong thời gian này, và video của A8b đã tự dừng từ trước đó (19:29).
- **Log thô và script:** đã copy vào thư mục ghi chú chung của nhóm phiên (`side-session-notes/…/video-heartbeat-2026-11-20/`), gồm 28 file JSON, 3 ảnh chụp, `hbrun.cjs` và `resume.cjs`.

## Bảng kết quả

"Khoảng cách" là khoảng giữa 2 heartbeat liên tiếp (giây, theo đồng hồ trình duyệt). "Đầu" là thời gian từ PLAY đến heartbeat đầu tiên. Mọi request `/progress` đều trả HTTP 200.

| # | Video | Thời lượng | Tốc độ | Kịch bản | Số heartbeat | Khoảng cách | Kết quả | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| A1 | V1 | 7 s | 1x | xem liền | 2 | 3,0 (đầu 3,0) | ✅ 100%, DB 7/7 | nhịp 3 s |
| A2 | V2 | 19 s | 1x | xem liền | 6 | 2,9–3,1 | ✅ 100%, DB 19/19 | nhịp 3 s |
| A3 | V3 | 29 s | 1x | xem liền | 9 | 2,9–3,1 | ✅ 100%, DB 29/29 | sát ngưỡng, vẫn 3 s đúng quy tắc |
| A4 | V4 | **30 s** | 1x | xem liền | 1 | đầu 20,1 | ✅ 100%, DB 30/30 | **đúng ngưỡng → 20 s** |
| A5 | V5 | 33 s | 1x | xem liền | 1 | đầu 20,0 | ✅ 100%, DB 33/33 | nhịp 20 s |
| A6 | V6 | 66 s | 1x | xem liền | 3 | 20,0 | ✅ 100%, DB 66/66 | |
| A7 | V7 | 213 s | 1x | xem liền | 10 | 19,8–20,2 | ✅ 100%, DB 213/213 | |
| A8 | V8 | 609 s | 1x | xem liền | 25 | 19,5–20,6 | ⚠️ 84%, DB 516, `completed=false` | YouTube tự PAUSE ở 516 s, không ai bấm, xem Vấn đề 1 |
| RA8 | V8 | 609 s | 1x | mở lại bài A8 rồi xem | 30 | 19,7–20,3 | ✅ 100%, DB 609/609 | phát lại từ 0 (Vấn đề 2) |
| A8b | V8 | 609 s | 1x | xem liền (tài khoản khác) | 1 | đầu 19,5 | ⚠️ 4%, DB 28 | YouTube tự PAUSE ở 28 s, rồi máy ngủ, xem Vấn đề 1 |
| B1 | V7 | 213 s | 2x | xem liền | 6 | 17,5–20 | ✅ 100%, DB 213/213 | đổi tốc độ gửi thêm 1 heartbeat ngay lập tức |
| B2 | V8 | 609 s | 2x | xem liền | 16 | 19,4–20,1 | ⚠️ 98%, DB 602, `completed=false` | YouTube tự PAUSE ở 602 s, chạy song song với 4 trình duyệt khác |
| RB2 | V8 | 609 s | 1x | mở lại bài B2 rồi xem | 30 | 19,9–20,1 | ✅ 100%, DB 609/609 | phát lại từ 0 (Vấn đề 2) |
| B2b | V8 | 609 s | 2x | xem liền, chạy một mình | 16 | 19,5–20,1 | ✅ 100%, DB 609/609 | |
| B3 | V6 | 66 s | 1.5x | xem liền | 3 | 19,5–20,1 | ✅ 100%, DB 66/66 | |
| C1 | V7 | 213 s | 1x | dừng 120 s ở 203 s rồi phát tiếp | 10 | 19,9–20,1 | ⚠️ 98%, DB 209 | phát tiếp 6 s thì YouTube tự PAUSE ở 209 s |
| C1b | V7 | 213 s | 1x | (định dừng ở 200 s) | 9 | 20,0–20,1 | ⚠️ 88%, DB 188 | YouTube tự PAUSE ở 188,9 s, trước khi script kịp bấm dừng |
| RC1b | V7 | 213 s | 1x | mở lại bài C1b rồi xem | 10 | 19,9–20,1 | ✅ 100%, DB 213/213 | phát lại từ 0 (Vấn đề 2) |
| C1d | V6 | 66 s | 1x | **dừng 120 s ở 60 s** rồi phát tiếp, chạy một mình | 2 | 20,0 | ✅ 100%, DB 66/66 | PAUSE ở 60 s → PLAY sau 121 s → ENDED |
| C2 | V5 | 33 s | 1x | (định dừng ở 28 s) | 1 | đầu 19,9 | ✅ 100%, DB 33/33 | script đọc vị trí trễ, ENDED đến trước khi kịp dừng, nên không kiểm được kịch bản dừng |
| D1c | V6 | 66 s | 1x | ẩn tab 30 s ở 21 s (giả lập) | 3 | 19,9–20,1 | ✅ 100%, DB 66/66 | ẩn → PAUSE (`hidden`), heartbeat vẫn đều khi ẩn, hiện lại → PLAY |
| D2b | V3 | 29 s | 1x | ẩn tab 10 s ở 12 s (giả lập) | 9 | 3,0–3,1 | ✅ 100%, DB 29/29 | như trên, nhịp 3 s giữ nguyên khi ẩn |
| D1, D1b | V7 | 213 s | 1x | (ẩn tab không có hiệu lực) | 10 / 10 | 19,9–20,2 | ✅ 100%, DB 213/213 | chỉ tính như xem liền |
| D2 | V3 | 29 s | 1x | (ẩn tab không có hiệu lực) | 9 | 2,9–3,2 | ✅ 100%, DB 29/29 | chỉ tính như xem liền |
| E1 | V7 | 213 s | 1x | lùi 6×10 s ở 126 s (về 66 s) rồi xem hết | 19 | 20 khi phát đều; 6 request trong khoảng 1,5 s lúc bấm lùi | ✅ 100%, DB 213/213 | furthest giữ 126 khi lùi |
| E2 | V6 | 66 s | 1x | lùi 2×10 s ở 55 s rồi xem hết | 5 | 3,2–20 | ✅ 100%, DB 66/66 | |

Ghi chú thêm:
- **C1c không hợp lệ.** Tôi đặt lại tiến độ trực tiếp trong DB khi trang còn lưu trạng thái cũ, nên giao diện hiện "100% · Hoàn thành". Video lại tự dừng ở 8 s. Lỗi này do cách thiết lập test.
- **Sau mỗi lần hoàn thành,** app tua về 0 và gọi `pauseVideo()` (`YouTubePlayer.tsx` dòng 612–615). Vì vậy luôn có thêm 2 request PLAY rồi PAUSE ở vị trí 0. Server vẫn giữ `completed = true`.

## Vấn đề 1 — Video tự tạm dừng giữa chừng

**Hiện tượng:** 5 lượt (A8, A8b, B2, C1, C1b; tính cả C1c là 6). Đang phát bình thường thì có `PATCH …/progress` với `event: "PAUSE"`, vị trí ở giữa video, và không có thao tác nào của script. Sau đó không có heartbeat và không có ENDED. Giao diện hiện "98% · Đang xem" (hoặc 84%, 4%) cùng nút "Bấm để phát".

| Lượt | Lúc dừng | Thời lượng | Tốc độ | Chạy song song |
|---|---|---|---|---|
| C1c | 8 s | 213 s | 1x | 4 trình duyệt |
| A8b | 28 s | 609 s | 1x | một mình |
| C1b | 188,9 s | 213 s | 1x | 4 trình duyệt |
| C1 | 209,5 s (6 s sau khi phát tiếp từ lần dừng 2 phút) | 213 s | 1x | 5 trình duyệt |
| A8 | 516 s | 609 s | 1x | 5 trình duyệt |
| B2 | 602,7 s | 609 s | 2x | 5 trình duyệt |

**Trạng thái DB khi kẹt (ví dụ B2):** `lesson_progress.completed = false`, `furthest = 602`, `last_position = 602`, `cycle_lesson_progress.furthest_seconds = 602`, `completed_at` để trống. Request cuối:

```json
{"ev":"PAUSE","pos":602.74,"fur":602.29,"rate":2,"pdur":609,"st":200,"c":false,"vc":false,"pct":98,"f":602}
```

Ảnh chụp lúc kẹt: trình phát ở **10:02 / 10:09**, nút "Bấm để phát", khung YouTube đứng yên.

**Vì sao nghi môi trường, không phải app:**
- App chỉ gửi PAUSE khi YouTube báo `onStateChange` = 2 (`YouTubePlayer.tsx` dòng 447–460), hoặc khi tab bị ẩn. Trong các lượt này tab không bị ẩn (`vis: visible`).
- App chỉ tự gọi `pauseVideo()` ở 2 chỗ: khi gỡ trình phát (dòng 542, chỉ khi đổi video) và sau khi ENDED đã được xác nhận (dòng 614). `VideoPlaybackGuard` không gọi tạm dừng.
- Các vị trí dừng là ngẫu nhiên (8 s đến 602 s), không gắn với gần cuối hay ngưỡng nào.
- Chạy lại cùng video khi máy rảnh thì đạt: RA8, RB2 (609 s ở 1x), B2b (609 s ở 2x). Đặc biệt kịch bản dừng 2 phút gần cuối (C1d) đạt 100%.
- Cả 3 bài đang kẹt (RA8, RB2, RC1b) khi mở lại và xem tiếp đều lên 100%.

**Chưa loại trừ:** A8b chạy một mình vẫn bị dừng ở 28 s. Có thể do YouTube xử lý trình duyệt tự động hóa (`navigator.webdriver = true`) hoặc do máy chậm. Cần **một lần thử tay trên Chrome thường** (xem hết video 609 s) để chắc chắn người dùng thật không gặp.

**Cách tái hiện:** chạy song song 4–5 phiên Playwright headless, mỗi phiên một tài khoản, xem video 213 s hoặc 609 s. Script: `hbrun.cjs` trong thư mục ghi chú.

**Đánh giá:** khi bị dừng, app không đánh dấu sai. Video chưa xem hết thì chưa ghi 100%, đúng với luật server. Rủi ro thật là nếu YouTube cũng tự dừng với người dùng thật, họ sẽ thấy kẹt 98% cho đến khi bấm phát lại. Khi đó Vấn đề 2 khiến họ phải xem lại từ đầu.

## Vấn đề 2 — Mở lại bài dở, video phát lại từ đầu

**Hiện tượng:** mở lại bài đã xem dở thì giao diện hiện đúng vị trí cũ. Nhưng bấm phát thì YouTube phát từ 0:00.

**Tái hiện có kiểm soát** (`resume.cjs`, `ngoc.linh`, bài 30 s):
1. Xem 12 s rồi dừng. Giao diện hiện `0:12 / 0:31`.
2. Mở lại trang. GET `/progress` trả `lastPosition = 12`, `lastPositionSeconds = 12`, `furthest = 12`, `monthlyReview = false`.
3. Chờ 10 s. Giao diện hiện **`0:12 / 0:31`**.
4. Bấm phát, chờ 4 s. Giao diện hiện **`0:03 / 0:30`**, tức là đã phát lại từ đầu.

**Gặp lại trong RA8, RB2, RC1b:** request PLAY đầu tiên có `pos = 0,0–0,1`, trong khi DB có `last_position` lần lượt là 516, 602, 188. Cả 3 lượt phải xem lại toàn bộ video (10 phút cho V8).

**Nghi vấn (chưa sửa):** `seekTo(initialPosition)` được gọi trong `onReady` và trong effect đồng bộ props (`YouTubePlayer.tsx` dòng 412–414 và 268–275) khi video còn chưa phát. Lệnh này dường như bị YouTube bỏ qua, nên khi `playVideo()` thì phát từ 0. Lỗi không ảnh hưởng tính hoàn thành, nhưng làm học viên mất công và tốn thêm khoảng 30 heartbeat cho một video 10 phút.

## Các quan sát nhỏ khác

- **Bấm lùi 10 s liên tiếp:** mỗi lần bấm gửi 1 request ngay. E1 bấm 6 lần thì có 6 request trong khoảng 1,5 s. Không sai, nhưng có thể gom lại nếu muốn tiết kiệm CPU.
- **Đổi tốc độ:** gửi 1 heartbeat ngay (B1, B2, B3, sau PLAY khoảng 0,4 s).
- **Thời lượng hiển thị:** trình phát lấy thời lượng từ YouTube nên có lúc lệch 1 s so với DB (ví dụ 0:31 so với 30 s, 3:34 so với 213 s). Server vẫn tính theo thời lượng trong DB, và các lượt hoàn thành đều có furthest = thời lượng DB.

## Chưa làm / hạn chế

- Chưa thử trên Chrome thường do người thật thao tác, và chưa thử trên điện thoại.
- Ẩn tab chỉ là giả lập ở mức trang (xem phần môi trường).
- Kịch bản dừng 2 phút gần cuối chỉ đạt chắc chắn với video 66 s (C1d). Với video 213 s, cả 2 lần (C1, C1b) đều bị Vấn đề 1 chen vào.
