# P1 — Controls auto-hide và fullscreen iPhone

Ngày kiểm tra: 2026-10-25. Trạng thái: đã sửa và xác minh trên desktop/browser engines; **chưa nghiệm thu trên iPhone thật**.

## 1. HEAD và phạm vi

- Nhánh: `main`.
- HEAD trước sửa: `c33bdded77c8bfbbda15796a39dd6b224c0799d9`.
- Đã đối chiếu `git ls-remote origin refs/heads/main`: cùng SHA với local và baseline.
- Có sẵn thay đổi chưa commit trong `load-tests/`; các thay đổi đó được giữ nguyên.
- Người dùng xác nhận lỗi thực tế xảy ra trên **Safari iPhone và Chrome iPhone**. Chưa có model/iOS cụ thể và chưa có thiết bị iPhone được kết nối để nghiệm thu.
- Chưa commit, push hoặc deploy bản sửa.

## 2. Root cause controls

1. `isControlsPinned()` ghim cả hover trên controls và focus bất kỳ. Click chuột giữ focus trên nút được coi như điều hướng bàn phím; hover tĩnh cũng chặn timer vô thời hạn.
2. `handleControlsMouseEnter()` hủy timer; các lệnh tua/tốc độ/fullscreen không có đường thoát pin đáng tin cậy khi focus/hover vẫn còn. Rời player trong lúc seek vẫn có thể bị chặn bởi các cờ này.
3. Listener YouTube được tạo trong effect chỉ phụ thuộc video/retry, nhưng gọi scheduler đóng trên `displayPlaying` của render khởi tạo. Sau buffering, callback `PLAYING` có thể hiện controls rồi gọi scheduler đang thấy trạng thái paused cũ. Effect theo `displayPlaying` không chạy lại nếu video vẫn đang phát.
4. Seek chỉ dựa vào pointer capture và handler timeline; thiếu fallback ở window và `lostpointercapture`. `pointercancel` dùng chung đường commit seek với pointerup.
5. Hai timer controls/safe-zone được quản lý riêng, thiếu cleanup đồng nhất. Timeline còn xử lý cả pointer và click tương thích.

## 3. Root cause fullscreen và audit

- Wrapper gắn đồng thời `relative` và `fixed`. Kiểm tra CSS thực tế trong Chromium production cho `fixed relative` trả về **`position: relative`**. Đây là lỗi trực tiếp làm theater nằm trong layout thay vì phủ viewport.
- Trang học có các cha `overflow-hidden`, `overflow-y-auto`, `aspect-video`, `max-w-5xl`, `relative`. Transform/filter/stacking context có thể tiếp tục cản fixed fallback; chỉ tăng z-index không giải quyết được.
- iPhone cần một đường viewport theater đáng tin cậy khi wrapper không được native Fullscreen API chấp nhận. Chưa có bằng chứng trên thiết bị để kết luận thêm một lỗi riêng của Android native fullscreen.
- History cũ dùng `pushState({ bbeFullscreen: true })`, làm mất dữ liệu router trong entry. Native fullscreen cũng thêm entry tổng hợp; thoát bằng cơ chế của trình duyệt không luôn thu hồi entry đó.
- `fullscreenerror` có thể đến trước khi mode được đặt thành NATIVE, khiến handler bỏ qua; promise trả về muộn thiếu ràng buộc với lifecycle video.
- `Permissions-Policy` hiện tại không chặn fullscreen; iframe đã có `allowfullscreen`, quyền `fullscreen` và `playsinline: 1`. Không thay chính sách bảo mật hoặc cấu hình YouTube để chữa lỗi layout.
- Bỏ `touch-action: none` toàn html/body; chỉ timeline khóa thao tác cuộn khi kéo seek.

## 4. File thay đổi

| File | Mục đích |
|---|---|
| `src/components/YouTubePlayer.tsx` | Nối coordinator UI, pointer/focus đúng modality, kết thúc seek ở window và lifecycle fullscreen |
| `src/lib/video-controls.ts` | Một bộ điều phối controls và một deadline timer dùng trạng thái hiện tại |
| `src/lib/video-fullscreen.ts` | Native/theater, top layer không reparent, fallback CSS, history và request ownership |
| `src/app/globals.css` | Vị trí/kích thước viewport, `100dvh`, scroll lock và fallback ancestor |
| `src/test/video-player-ui.test.ts` | Fake timers chạy trực tiếp production coordinator |
| `src/test/video-controls-youtube-ux.test.ts` | Chuyển từ simulator sao chép sang các test production trên |
| `src/test/browser/video-player.spec.ts` | React component thật + CSS thật, external YouTube API mock có đo iframe loads |
| `playwright.player.config.ts` | Chromium/WebKit desktop và touch emulation, hỗ trợ chạy production build |
| `scripts/verify-player-live.cjs` | Smoke test YouTube thật, không inject mock |
| `package.json`, `package-lock.json` | Dev dependency Playwright và lệnh test |
| Báo cáo này | Kết quả, bằng chứng và các phần chưa nghiệm thu |

Không sửa backend, schema, VideoPlaybackGuard, heartbeat payload/chu kỳ, completion, progress hoặc công thức Star.

## 5. State/timer và lifecycle mới

- `playing`, `pointerInside`, `keyboardFocus`, `seekingPointerId` tách biệt. Hover không pin; focus do pointer không pin. Tab/focus bàn phím vẫn giữ controls và giữ DOM focus.
- Một timer 2.500ms với generation để loại callback cũ. Safe-zone 600ms dùng cùng bộ điều phối; cursor được suy ra từ visibility/fullscreen/play intent.
- Click capture trên controls tạo lại lịch ẩn. Callback `PLAYING` lặp sau buffering không tự hiện controls hoặc dời deadline.
- Pointer ID quyết định seek đang hoạt động. Có `pointerup`/`pointercancel` ở window, `lostpointercapture`, window blur, visibility hidden, chuyển fullscreen/video và unmount. Cancel/lost capture không commit tọa độ seek không hợp lệ.
- Dùng Pointer Events; compatibility click không seek thêm. Touch không đi qua nhánh mouse safe-zone; chuỗi mouse tương thích được bỏ qua trong 800ms.
- Theater dùng `showPopover()` để nâng **chính wrapper hiện tại** lên top layer. Không dùng Portal, không đổi parent của iframe. Trình duyệt thiếu Popover dùng lớp CSS tạm trên các ancestor và gỡ khi thoát.
- Native không thêm history entry. Theater giữ nguyên dữ liệu Next trong state và chỉ tiêu thụ entry mang token/URL của chính nó. Có bảo vệ traversal đang chờ giữa hai controller khi chuyển video.
- Fullscreen requests có generation và owner; kết quả native trả về muộn sau video switch/unmount không mở lại theater hoặc chiếm phiên mới. Pagehide gỡ presentation/lock mà không gọi history.back lúc rời document.

## 6. Kết quả controls

Các PASS bên dưới là bộ test React trên browser engines chạy Playwright headless trên Windows, **không phải xác nhận thiết bị thật**. YouTube được mock để kiểm soát buffering và đếm create/load iframe. Fake timers riêng chạy trực tiếp production coordinator: **23/23 PASS**.

| Thao tác | Chromium desktop | WebKit desktop | Chromium touch emulation | WebKit touch emulation |
|---|---|---|---|---|
| Play/Pause/Play, paused giữ controls | PASS | PASS | PASS | PASS |
| Tua tới/lùi 10s | PASS | PASS | PASS | PASS |
| Tốc độ 1x–2x, 50 lần liên tục | PASS | PASS | PASS | PASS |
| 50 lần tua tiến/lùi | PASS | PASS | PASS | PASS |
| Click seek, kéo rồi thả | PASS | PASS | PASS | PASS |
| Kéo ra ngoài, pointer capture thất bại | PASS | PASS | PASS | PASS |
| Pointercancel/lost capture/blur | PASS | PASS | PASS | PASS |
| Buffering rồi PLAYING khi chuột đã rời | PASS | PASS | PASS | PASS |
| Fullscreen vào/thoát rồi idle | PASS | PASS | PASS | PASS |
| Tab giữ controls/DOM focus | PASS | PASS | Không chạy | Không chạy |
| Touch + compatibility click | Pointer sequence | Pointer sequence | PASS | PASS |

Bộ production cuối: Chromium desktop 16 PASS/1 skip, WebKit desktop 15 PASS/2 skip, Chromium touch emulation 15 PASS/2 skip, WebKit touch emulation 15 PASS/2 skip. Bảy skip được khai báo theo môi trường: touch tap ở hai context desktop, keyboard ở hai context mobile, native Chromium API thật ở ba context còn lại.

Test idle xác nhận cả class ẩn, **computed opacity = 0** sau transition và **pointer-events = none**, không chỉ state trong simulator. Test theater đo wrapper phủ viewport, đổi chiều viewport, cùng object iframe, cùng số lần tạo/load và thời gian không reset.

## 7. Kết quả môi trường và kiểm tra

| Kiểm tra | Kết quả |
|---|---|
| `npx tsc --noEmit -p tsconfig.check.json` | PASS |
| `npm run build` | PASS, lint/type check và 73 static pages |
| `npm run test:video-guard` | 15/15 PASS |
| `npm run test:video-youtube-ux` | 23/23 PASS, production fake timers |
| `npm run test:video-controls` | 11/11 PASS; suite cũ có một phần mô phỏng, không dùng riêng để nghiệm thu |
| `npm run test:video-switching-leak` | 9/9 PASS |
| `npm run test:business-rules` | 66/66 PASS |
| Production Playwright suite | **61 PASS, 7 skip, 0 fail** (68 ca, 5,1 phút) |
| Chromium 156 trên Windows, YouTube thật, native | PASS; production build, thời gian 0:21 → 0:26, cùng iframe |
| Chromium 156 trên Windows, YouTube thật, theater | PASS; production build, thời gian 0:21 → 0:27, cùng iframe |
| Android Chrome thiết bị thật | CHƯA CHẠY; không có thiết bị |
| iPhone Safari thiết bị thật | CHƯA CHẠY; không có thiết bị |
| iPhone Chrome thiết bị thật | CHƯA CHẠY; không có thiết bị |

Lần chạy dev trước có 55 PASS/7 skip/2 fail ở test harness WebKit: deadline 45s cho 100 click và giả định Safari focus nút khi click như Chromium. Đã tăng riêng deadline stress và kiểm tra giữ nguyên focus theo hành vi từng engine. Lần chạy lại trên production build đạt toàn bộ ca được áp dụng; không dùng lần fail làm PASS.

## 8. Ảnh và kết quả có thể mở tại workspace

- [YouTube thật: native fullscreen, controls đã ẩn](../scratch/player-live/native-hidden.png).
- [YouTube thật: theater, controls đã ẩn](../scratch/player-live/theater-hidden.png).
- [WebKit touch emulation: theater, controls đã ẩn](../scratch/player-webkit-touch-emulation-theater-hidden.png) — ảnh mô phỏng, không phải ảnh iPhone.
- [Playwright HTML report](../scratch/player-browser-report/index.html).
- [Kết quả native với video thật](../scratch/player-live/native-result.json).
- [Kết quả theater với video thật](../scratch/player-live/theater-result.json).

Ảnh/report được tạo trong `scratch/` (đã gitignore), không tự upload. Native/theater ảnh thật được xem trực quan: có hình video, đúng letterbox, chỉ còn nút thoát rõ ràng khi thanh dưới đã ẩn.

## 9. Giới hạn trình duyệt

Theater phủ vùng viewport khả dụng; **không được gọi là native fullscreen** và không bảo đảm che được thanh địa chỉ/hệ thống trên iPhone. Việc dùng top layer tránh ancestor clipping mà không di chuyển iframe là hành vi của [Popover API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/showPopover). Native request vẫn cần activation và có thể bị trình duyệt từ chối theo [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen); khi từ chối, code dùng theater.

Video mẫu mặc định `dQw4w9WgXcQ` bị YouTube từ chối nhúng trong lần smoke đầu. Đã thử thành công `aqz-KE-bpKQ` qua input có sẵn; không thay video hoặc nghiệp vụ của ứng dụng.

## 10. Chưa chạy và cách chạy lại

Chưa chạy thao tác trên iPhone Safari/Chrome và Android thật, Back phần cứng, xoay thiết bị vật lý, safe-area với tai thỏ/home indicator thật, toolbar động iPhone, âm thanh trên loa thật, hoặc tích hợp tiến độ/Star với tài khoản học viên trên backend. Không có thay đổi vào logic backend; unit regression của guard/progress/reward đã chạy như trên.

PowerShell:

```powershell
npm run test:video-youtube-ux
npm run test:video-guard
npm run test:video-switching-leak
npm run build
$env:PLAYER_PRODUCTION='1'
npm run test:video-player-browser
```

Smoke YouTube thật cần Next server local đang chạy ở port 3117:

```powershell
npm run start -- --hostname 127.0.0.1 --port 3117
# Ở terminal khác:
node scripts/verify-player-live.cjs
$env:PLAYER_FULLSCREEN_MODE='THEATER'
node scripts/verify-player-live.cjs
```

Có thể chọn `PLAYER_YOUTUBE_ID` nếu video mẫu bị chặn nhúng. Cần cài browser lần đầu bằng `npx playwright install chromium webkit`.

**Điều kiện còn mở:** nghiệm thu bản sửa trên Safari và Chrome của iPhone thật trước khi đóng toàn bộ P1.
