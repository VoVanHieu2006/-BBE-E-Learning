# Báo cáo sửa P0 tiến độ video MEMBER

## Phạm vi và trạng thái

- Base/HEAD: `c6671286b2b9733cb48fb9b92c3ab67ab72f4509`.
- Sửa trực tiếp workspace theo yêu cầu; chưa commit/stage/push/deploy.
- Chỉ sửa luồng video MEMBER. Bảo toàn các thay đổi `load-tests` và tài liệu có sẵn.
- Người dùng xác nhận tài liệu là `C:\Users\Acer\Desktop\FB.docx`, không phải `FB(1).docx`.
- Người dùng chưa cung cấp tài khoản kiểm thử. Không giả định tài khoản, không ghi DB thật, không gửi email, không reset tiến độ hay kích hoạt policy/cutover.
- **PASS phần unit/integration giả lập,6 ca DOM P0 Chromium, stress WebKit desktop1x và production build; nghiệm thu YouTube/DB thật: NOT VERIFIED.**

## Nguyên nhân và thay đổi

1. Seek thay vị trí thực trước khi chốt đoạn phát. PLAY/PAUSE ở vị trí mới cập nhật `last_watched_at`; server mất cửa sổ thời gian để xác minh đoạn vừa xem. Client vẫn cho tua tới local progress, nhưng các heartbeat sau đó tiếp tục vượt cap và bị giữ nguyên tiến độ.
2. PLAYING lặp sau seek khởi động lại interval, có thể dời heartbeat liên tục.
3. Guard dùng YouTube ID, response trả video UUID trong DB. Callback HTTP của trang học cập nhật UI trước khi guard kiểm tra identity/sequence.
4. Request lỗi không kết thúc pending request; callback/retry cũ có thể chạm phiên mới.
5. FIFO đơn thuần vẫn lỗi khi mạng chậm: hàng trăm marker seek cũ cập nhật mốc thời gian backend sau khi người học đã xem nội dung mới. Review độc lập đã tái hiện trường hợp này.

| File/function | Thay đổi trực tiếp |
|---|---|
| `src/components/YouTubePlayer.tsx` — `seekTo`, timeline, `seekDelta`, `setSpeed` | Chụp vị trí thực trước seek; một checkpoint mỗi drag; chung đường xử lý chuột/nút/phím; checkpoint tốc độ dùng tốc độ cũ. |
| `src/components/YouTubePlayer.tsx` — `startHeartbeat`, state callback, `finishPlayback` | Interval đang chạy được giữ nguyên; loại PLAYING trùng; completion dùng callback hiện tại và phiên gốc, kiểm tra phiên trước mỗi retry. |
| `src/lib/video-progress-session.ts` | Transport tuần tự theo guard/session; gộp heartbeat thường và marker dư trong đoạn đã xác minh hoặc nằm dưới checkpoint thực được giữ phía trước; giữ checkpoint phát mới, ENDED và ranh giới rate cần thiết. Timeout/abort và finally kết thúc đúng request gốc. |
| `src/lib/video-playback-guard.ts` | Kết thúc/log request lỗi; log seek source/ceiling, HTTP status, sequence và lý do; tối đa 300 log. |
| `src/app/student/learning/[lessonId]/page.tsx` | Truyền DB video ID; callback `onProgressApplied` chỉ cập nhật trang sau khi transport/guard chấp nhận response. |
| `src/test/video-progress-session.test.ts`, `src/test/browser/video-player.spec.ts`, `package.json` | Regression và lệnh chạy test phiên tiến độ. |

Không thay đổi server cap, anti-seek, tolerance, công thức hoàn thành, chu kỳ heartbeat 3/10 giây, schema hoặc reward gate. Seek không đổi key iframe.

## Bằng chứng RED → GREEN

| Ca | Trước sửa | Sau sửa |
|---|---|---|
| Component thật phát 100→108, seek rồi tiếp tục | FAIL: không có request chốt vị trí thực108 được cap chấp nhận (`scratch/p0-red.log`). | PASS ca DOM 100 seek qua nút/phím/drag và ít nhất3 heartbeat nội dung mới. Server giả lập gọi `capVideoProgress` thật. |
| 100 seek, HTTP giả lập trễ1 giây, đổi rate trong đoạn đã xem | FAIL: backend108 trong khi expected259 (`scratch/p0-latency-red.log`). | PASS: ba heartbeat mới đều cập nhật theo cap, số request không tăng theo100 seek. |
| PLAYING lặp | FAIL: phát sinh thêm24 PLAY; callback drag muộn có thể gửi theo từng move. | PASS: không phát sinh PLAY từ trạng thái PLAYING trùng; heartbeat vẫn đến hạn. |
| Chuyển video trong delay retry ENDED | FAIL: request ENDED thứ hai dùng session mới (`scratch/p0-review-red.log`). | PASS: chỉ request của phiên gốc; không gửi ENDED vào phiên mới. |
| Log stress | FAIL:800 log không giới hạn. | PASS: giữ tối đa300 bản ghi. |
| Marker PAUSE đã xếp hàng trước khi server xác nhận | FAIL:101 request dư. | PASS: sau ACK gộp còn checkpoint thực và marker trạng thái cuối;17 test phiên tiến độ pass. |

Review độc lập đã chỉ ra backlog FIFO, retry completion và PLAYING muộn; các sửa tương ứng có regression RED→GREEN. Reviewer không sửa file/DB. Phần sửa sau review được kiểm chứng bằng test, chưa có review độc lập lần hai.

## Kiểm chứng và giới hạn

- Unit/integration dùng class/guard/cap thật, chỉ giả lập transport, đồng hồ và dữ liệu.
- Ca DOM dùng React/CSS/trang MEMBER thật; YouTube và HTTP được giả lập. Kiểm tra ba nguồn seek, buffering callbacks, tốc độ1x/1.5x/2x, heartbeat, identity, completion retry và iframe không remount.
- Refresh chỉ xác nhận hợp đồng đọc lại tiến độ từ API giả lập. **Không phải bằng chứng ghi/đọc DB thật.**
- Full TypeScript `npx tsc --noEmit -p tsconfig.json`: PASS (exit0).
- Production `npm run build`: PASS (exit0), gồm compile, lint/type validation và sinh trang. Không deploy.
- Unit/business/video được chạy lại sau sửa cuối: `test:business-rules`, `test:video-guard`, `test:video-controls`, `test:video-youtube-ux`, `test:video-switching-leak`, `test:video-player-ui`, `test:video-progress-session`, cùng `video-continuity-security.test.ts` và `learning-flow-p0.test.ts`:186 lượt PASS. Một số script có nhập lại cùng test controls; không coi186 là số test duy nhất.
- Ca A→B→A, timeout/late response reorder, HTTP lỗi và latency được kiểm tra ở lớp session với transport giả lập; không coi đó là nghiệm thu điều hướng/DB thật.
- Có một lần mở rộng stress FAIL do assertion số thực `18.999999999999986 >= 19`; dung sai test0,01 giây xử lý sai số này, không thay đổi tolerance nghiệp vụ.
- Khi mở rộng WebKit, ba heartbeat vẫn được cap chấp nhận nhưng chênh lệch vị trí giữa lần đầu/cuối là17 giây, khác giả định sampling19 giây của fixture. Assertion cuối kiểm tra đúng hợp đồng: ít nhất3 heartbeat ở nội dung mới, từng request được backend cap chấp nhận và tiến độ tăng sau từng lần. Unit test vẫn xác minh chính xác các cửa sổ10 giây ở cả3 tốc độ.
- Full desktop suite:24 PASS,1 SKIP,2 FAIL ở lần chạy trước điều chỉnh fixture: assertion số thực nói trên và `theater escapes clipped/transformed ancestors, preserves iframe, rotates and exits (top layer)`. Test fullscreen đòi `popover='manual'` nhưng mã fullscreen hiện tại và HEAD không triển khai popover. Không sửa fullscreen ngoài phạm vi; không tuyên bố full suite xanh.
- Log/trace chỉ dùng subject/token giả lập; không chứa thông tin đăng nhập thật. File log nội bộ ở `scratch/`, không stage.

| Hạng mục | Trạng thái |
|---|---|
| Unit/business/video suites | PASS —186 lượt kiểm tra, gồm17 test phiên tiến độ mới; không có test thất bại trong lần chạy unit cuối |
| P0 Chromium DOM cuối | PASS —6/6, gồm100 seek ở1x/1.5x/2x, PLAYING lặp, retry cũ, trang MEMBER và refresh giả lập (`scratch/p0-browser-chromium-final.log`) |
| WebKit desktop stress1x cuối | PASS —100 DOM seek và4 heartbeat nội dung mới; từng payload được cap chấp nhận, tiến độ tăng (`scratch/p0-webkit-final.log`) |
| Production build | PASS — `npm run build`, exit0 (`scratch/p0-build.log`) |
| Touch/mobile stress | NOT VERIFIED — đợt mở rộng4 cấu hình đã dừng để sửa giả định sampling trong fixture; chưa chạy đủ các cấu hình touch |
| Full desktop browser suite | FAIL ngoài phạm vi tại test top-layer fullscreen nói trên; ca P0 số thực đã được sửa fixture và chạy lại PASS |
| DB thật trước/sau, refresh với tài khoản thật, media YouTube thật | NOT VERIFIED — chưa có tài khoản được chỉ định |
| Đối chiếu nguyên văn V01–V15 | BLOCKED — chưa có nguyên văn mục6 của prompt trước; không tự đặt tên15 ca thay thế |
| Các lỗi feedback khác và Phase2 | BLOCKED — người dùng yêu cầu chỉ sửa video ở lượt này |
| Audit Chapter, A–E, 12 câu hỏi | BLOCKED — xem `NEW_CHAPTER_TERM_REWARD_AUDIT.md` |
