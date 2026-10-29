# Kế hoạch: sửa lỗi nút "Lên lịch chuyển giao nhiệm kỳ" + viết lại `docs/CKNK.md` thành tài liệu non-tech

> **Trạng thái (29/10/2026):** nhóm A (P0–P4) **đã triển khai**. Nhóm B (viết lại toàn bộ `docs/CKNK.md`) **không thực hiện trong đợt này**; tài liệu được cập nhật tại chỗ theo hành vi mới.
>
> **Đã xong:** tách helper mốc gần nhất/mốc đã qua; cửa sổ chuyển giao nửa mở; tra mùa theo cửa sổ với lý do cụ thể; chặn trùng theo cửa sổ; áp dụng trễ dùng `effective_at`; thời gian nghiệp vụ `min(effective_at, applied_at)`; bỏ quy tắc chờ 6 tháng; sửa seed, test đơn vị, fixture integration; thêm tab Admin chỉ đọc `/admin/transfer-seasons`, chỉ tính chapter đã tồn tại trong giai đoạn; hiện trước giai đoạn và mốc thưởng ngay dưới ô chọn thời điểm.
>
> **Ngoài phạm vi:** đổi tên vai trò P5 (`PRESIDENT`), xoá `TRAINEE`, khung `chapter_competition_terms` cố định, viết lại toàn bộ `CKNK.md`.
>
> **Kiểm tra:** `npm test` qua 25 bộ unit; `npm run typecheck` sạch; `npm run build` thành công (có route `/admin/transfer-seasons`). Các bộ cần DB (`test:six-month-transfer`, integration) chưa chạy được vì môi trường hiện tại không có `TEST_DATABASE_URL` trỏ tới `bbe_test_learning_cycles`.
>
> **Nguồn:** lập từ `docs/CKNK.md` (bản ngày 29/10/2026) sau khi đã chốt quy tắc nghiệp vụ.
>
> **Phạm vi ban đầu:** hai nhóm việc độc lập nhưng liên quan —
> (A) sửa mã để nút "Lên lịch chuyển giao nhiệm kỳ" ở role Lead Chapter hết báo lỗi vô cớ và để mã khớp quy tắc đã thống nhất;
> (B) viết lại `docs/CKNK.md` thành tài liệu non-tech đọc được, xoá hết phần dư.
>
> **Ghi chú:** kế hoạch bên dưới giữ nguyên như bản lập ban đầu để đối chiếu. Tên file thực tế là `src/lib/transfer-windows.ts` (số nhiều) và `src/lib/transfer-season-lookup.ts`; một số mã lý do đã được tinh chỉnh so với bản dự thảo. `chapterRewardBoundary` vẫn là **mốc đã qua** (không đổi sang mốc gần nhất); đặt lịch dùng `anchorNearest`/`windowOf`. Response `POST` dùng `normalized` thay cho cặp `normalizedAnchor`/`window`; phần kiểm tra tra mùa nằm chung trong `src/test/transfer-windows.test.ts`.

---

## 0. Mục tiêu & tiêu chí hoàn thành

| # | Mục tiêu | Tiêu chí hoàn thành (đo được) |
|---|---|---|
| M1 | Nút **"Lên lịch chuyển giao nhiệm kỳ"** ở role Lead Chapter không còn báo lỗi vô cớ | Bấm nút với mọi thời điểm hợp lệ (bất kỳ ngày/giờ nào trong năm) → **201**; không còn thông điệp chung chung *"Admin cần cấu hình mùa chuyển giao cho thời điểm đã chọn."* khi nguyên nhân thật là trùng mùa / ngoài cửa sổ / lệch múi giờ |
| M2 | Mã khớp quy tắc đã thống nhất | Các mục P0–P4 của §7.2 trong `CKNK.md` đã xử lý; các mục P5 và khung nhiệm kỳ cố định nằm ngoài phạm vi |
| M3 | `CKNK.md` phản ánh đúng hành vi | Cập nhật tại chỗ các mục bị sai (công thức tạm dừng, tra mùa, áp dụng trễ, thời gian thực tế, dữ liệu mẫu, §7.2); **không** viết lại toàn bộ trong đợt P0–P4 |
| M4 | Trả lời câu hỏi tài liệu non-tech | Không thực hiện trong đợt P0–P4 |
| M5 | Không phá vỡ hiện trạng | `npm run typecheck` + `npm run build` xanh; `npm test` qua 25 bộ unit; integration chạy trên DB loopback riêng khi có `TEST_DATABASE_URL` |

---

## 1. Chẩn đoán lỗi nút "Lên lịch chuyển giao nhiệm kỳ" (đã truy ra, không phải phỏng đoán)

Nút này gọi `POST /api/v1/chapters/[chapterId]/reorganizations`. Có **8 mã 4xx** khác nhau nhưng giao diện chỉ hiện `message` do server trả về, nên người dùng thấy một câu chung chung. Nguyên nhân gốc:

**R1 — Tra mùa bằng "khoảng chứa thời điểm" thay vì "cửa sổ chứa thời điểm"** (`reorganizations/route.ts:177-184`).
Mã đòi **đúng một** mùa thoả `starts_at <= effectiveAt < ends_at`. Nếu Admin cấu hình mùa theo khối 6 tháng liền nhau (`1/4→1/10`, `1/10→1/4`) thì mọi thời điểm đều khớp đúng 1 mùa — nhưng khi hai mùa chồng lấn (ví dụ `1/1–30/6` và `1/4–30/9` cùng tồn tại) thì `seasons.length === 2` → 409. Cùng một câu thông điệp cho cả 3 tình huống rất khác nhau: **0 mùa**, **>1 mùa**, **thời điểm nằm ngoài mọi mùa**.

**R2 — Mùa cấu hình lệch múi giờ** → `effectiveAt` từ ô `datetime-local` (giờ VN) đem so với `starts_at`/`ends_at` lưu UTC. Người dùng chọn `01/10 00:00` giờ VN, mùa bắt đầu `01/10 00:00` UTC (= 07:00 VN) → `effectiveAt < starts_at` → 409 dù nhìn trên lịch là "đúng ngày".

**R3 — Áp dụng trễ rơi ra ngoài mùa** (`chapter-reorganizations.ts:38`): lịch đặt sát `ends_at`, worker quét sau `ends_at` → `TransferOutsideSeasonWindow`, hiện ra thành `TransferApplyFailed`. Đợt vẫn `SCHEDULED` và lỗi lặp lại mãi.

**R4 — Chặn trùng theo mùa thay vì theo cửa sổ**: chapter đã chuyển giao trong cửa sổ `1/1–30/6` (mùa A) thì không lên lịch được lần nữa trong cùng cửa sổ — đúng. Nhưng khi mùa được cấu hình lại, `TransferSeasonAlreadyApplied` bắn ra ở tình huống nghiệp vụ hợp lệ.

**R5 — Banner "thưởng đang tạm dừng"** (`chapter-reward-gate.ts:31-32`) tra mùa bằng `findUnique({ where: { reward_boundary_at: boundary } })` — so khớp **bằng đúng**. Chỉ cần mốc lưu lệch 1 giây là không tìm thấy mùa → hiện `TRANSFER_SEASON_NOT_CONFIGURED` *"Chưa cấu hình mùa chuyển giao nên thưởng đang tạm dừng."* Đây là nguồn của cảm giác "lỗi do lên lịch gì đó".

**R6 — `chapterRewardBoundary` trả "mốc đã qua gần nhất"** thay vì "mốc gần nhất" → trong `1/1–31/3` và `1/7–30/9` mốc bị lùi về mốc cũ, nên mùa tra được là mùa cũ đã `APPLIED` → 409 `TransferSeasonAlreadyApplied` dù thực tế chapter chưa chuyển giao trong cửa sổ hiện tại.

> ✅ **Điều chỉnh khi triển khai:** **không** đổi `chapterRewardBoundary` sang mốc gần nhất. Hàm này giữ nghĩa "mốc đã qua" cho ngừng thưởng và reset DNA; việc đặt lịch/tra mùa dùng `anchorNearest` / `windowOf`. R6 được xử lý bằng cách **tách hai khái niệm mốc**, không đổi một hàm dùng chung.

---

## 2. Thay đổi mã — nhóm A: sửa lỗi nút lên lịch (ưu tiên 1)

### A1. Một module quy tắc cửa sổ duy nhất — `src/lib/transfer-windows.ts` (mới)

Nguồn chân lý duy nhất cho mọi phép tính cửa sổ, thay vì mỗi nơi tự suy:

```
anchorNearest(at)        → mốc gần nhất (1/4 hoặc 1/10 00:00 VN)   // dùng cho đặt lịch/tra mùa
anchorElapsed(at)        → mốc đã qua gần nhất                      // dùng cho ngừng thưởng và DNA reset
windowOf(at)             → { startsAt, endsAt, anchor }            // [1/1,1/7) hoặc [1/7,1/1 năm sau)
windowOfAnchor(anchor)   → cùng cấu trúc
termOfAnchor(anchor)     → { startsAt: anchor, endsAt: anchor + 6 tháng }
```

- Toàn bộ tính toán bằng **giờ VN (UTC+7)** qua `getVietnamParts` / `addCalendarMonthsVietnam` trong `src/lib/vietnam-calendar.ts` (mới); `chapter-term-rules.ts` chỉ tái xuất các helper cũ.
- Cửa sổ **nửa mở** `[startsAt, endsAt)` → mọi thời điểm rơi vào **đúng một** cửa sổ.

### A2. Tra mùa theo cửa sổ + mã lý do tách bạch

`src/lib/transfer-season-lookup.ts` (mới), dùng chung cho **cả 3 nơi** đang tự tra mùa:

| Nơi | Hiện tại | Sau khi sửa |
|---|---|---|
| `reorganizations/route.ts:177-184` | `findMany(starts_at <= t < ends_at)`, `length !== 1` → 1 câu lỗi | gọi `resolveSeasonForWindow(tx, at)` |
| `chapter-reorganizations.ts:36-37` | như trên, throw `TransferSeasonNotConfigured` | gọi cùng hàm, throw theo `reason` |
| `chapter-reward-gate.ts:31-32` | `findUnique(reward_boundary_at = boundary)` | gọi cùng hàm theo **cửa sổ chứa `t`** |
| `admin/learning-policy/route.ts:106` | `findUnique(reward_boundary_at = chapterRewardBoundary(at))` | gọi cùng hàm theo **cửa sổ chứa `cutoverAt`** |

`resolveSeasonForWindow(tx, at)` trả:

| `reason` | Điều kiện | Thông điệp tiếng Việt hiển thị cho người dùng |
|---|---|---|
| `OK` | đúng 1 mùa phủ trọn cửa sổ | — |
| `SEASON_NOT_CONFIGURED` | 0 mùa giao với cửa sổ | "Chưa có mùa chuyển giao cho giai đoạn này. Admin cần tạo mùa cho giai đoạn {tên cửa sổ}." |
| `SEASON_NOT_COVERING_DATE` | có mùa nhưng không phủ hết cửa sổ | "Mùa chuyển giao đang cấu hình chưa phủ hết giai đoạn {tên cửa sổ}. Admin cần sửa lại ngày bắt đầu/kết thúc." |
| `SEASON_OVERLAP` | ≥ 2 mùa cùng phủ | "Có nhiều mùa chuyển giao trùng nhau ở giai đoạn này. Admin cần xoá hoặc sửa để chỉ còn một mùa." |
| `SEASON_ALREADY_APPLIED` | mùa đó đã có đợt `APPLIED` trong **cùng cửa sổ** | "Giai đoạn này đã chuyển giao rồi. Lần chuyển giao kế tiếp là giai đoạn {cửa sổ kế}." |
| `WINDOW_ALREADY_APPLIED` | đã có đợt `APPLIED` khác mùa nhưng cùng cửa sổ | như trên |

> **Thực tế triển khai:** lookup tách thêm `SEASON_LEGACY_WINDOW`, `SEASON_WINDOW_MISMATCH`, `SEASON_BOUNDARY_MISMATCH`. Việc chặn "đã chuyển giao" nằm ở route/worker với `WINDOW_ALREADY_APPLIED` (theo `effective_at`), không đưa vào kết quả tra mùa.

→ Mỗi nguyên nhân có **câu riêng, chỉ đúng việc cần làm**. Đây là phần trả lời trực tiếp cho "bị lỗi do lên lịch gì đó".

### A3. Chuẩn hoá thời điểm trước khi kiểm tra (chặn R2)

Trong `POST` route, **trước** mọi kiểm tra:

1. Lấy `effectiveAt` người dùng chọn (giờ VN).
2. `anchor = anchorNearest(effectiveAt)`, `window = windowOf(effectiveAt)`.
3. Tra mùa theo **window**, không theo `effectiveAt` so trực tiếp với `starts_at/ends_at`.
4. Trả kèm trong response `201`: `{ item, appliedImmediately, normalized: { anchor, startsAt, endsAt, label, proposedEffectiveAt } }` để vẫn kiểm tra được cửa sổ sau khi lưu.
5. UI (`TransferDraft.tsx`, dùng chung state với `useTermTransition.ts`) hiện dòng xác nhận **trước** khi gửi: *"Thời điểm này thuộc giai đoạn {1/1–30/6}, mốc thưởng của giai đoạn là 01/04/2026."* — tính trực tiếp bằng `windowOf`/`describeWindow`, không chờ response.

### A4. Bỏ chặn trùng theo mùa → chặn theo cửa sổ (chặn R4)

- `TransferSeasonAlreadyApplied` → thay bằng `WINDOW_ALREADY_APPLIED` khi đã có `APPLIED` có `effective_at ∈ window` (cửa sổ nghiệp vụ của đợt). Dùng `effective_at` thay vì `applied_at` để một đợt áp dụng sớm cho cửa sổ sau không bị tính nhầm vào cửa sổ hiện tại.
- **Giữ nguyên** luật: mỗi chapter tối đa **1 đợt `SCHEDULED`**; tối đa **1 lần chuyển giao mỗi cửa sổ**; **không** chặn 2 lần trong một nhiệm kỳ (nhiệm kỳ = mốc + 6 tháng, cắt ngang 2 cửa sổ).
- Kiểm tra lại trong `$transaction` (đã có sẵn chỗ) để không có khe hở race.

### A5. Áp dụng trễ không còn rơi ra ngoài mùa (chặn R3)

`chapter-reorganizations.ts:33-41`: kiểm tra mùa theo **`effective_at`** (thời điểm đã đặt, đã chuẩn hoá) thay vì `appliedAt`. `appliedAt = clock_timestamp()` vẫn dùng cho mọi ghi dữ liệu (không backdate — giữ nguyên hành vi đã chốt). Nhờ vậy worker chạy trễ bao lâu cũng không sinh `TransferOutsideSeasonWindow` giả.

### A6. Giữ `chapterRewardBoundary` = mốc đã qua; tách phép tính mốc gần nhất cho đặt lịch (chặn R6)

- `chapter-reward-gate.ts`: `chapterRewardBoundary` = `anchorElapsed` (**không** đổi sang `anchorNearest`). Đây là mốc cho ngừng thưởng, DNA reset và admin cutover.
- Đặt lịch và tra mùa dùng `anchorNearest` / `windowOf` trong `transfer-windows.ts`; không dùng chung một hàm với ngừng thưởng.
- `chapter-reward-gate.ts`: kiểm tra bằng chứng `APPLIED` theo **đầu cửa sổ** `windowOfAnchor(anchorElapsed(at)).startsAt`, không so trực tiếp `applied_at >= boundary`.
- `chapter-term-rules.ts`: dùng chung `isChapterTransferPausedAt`; khoảng xét là `[S(t), t]`, mở rộng qua cuối cửa sổ để đợt áp dụng trễ vẫn đóng được khoảng thiếu.
- Xoá hẳn nhánh 6 tháng: `firstEligibleAt`, `INITIAL_SEASON_SKIPPED` — đã chốt "không có thời gian chờ".

### A7. Validate cấu hình mùa của Admin (chặn nguyên nhân gốc)

`admin/learning-policy/route.ts:42-53`: `starts_at`/`ends_at` phải **bằng đúng** `00:00 1/1`, `00:00 1/7`, `00:00 1/1 năm sau` (giờ VN) — tức mùa = trọn một cửa sổ. Từ chối mùa khối 6 tháng và mùa chồng lấn **ngay lúc lưu**, kèm thông điệp nêu rõ cửa sổ hợp lệ. Nhờ đó `SEASON_OVERLAP` / `SEASON_NOT_COVERING_DATE` gần như không thể xảy ra trên dữ liệu mới.

### A8. Dữ liệu & test đi kèm

- `scripts/db/seed-rich-demo.ts:26-27`, `:496-505`: mùa `2026-APR` = `1/1–30/6`, `2026-OCT` = `1/7–31/12` (giờ VN).
- `src/test/chapter-six-month-transfer.test.ts`: cập nhật mùa về cửa sổ chuẩn, `reward_boundary_at = 1/10 00:00`; bỏ assert `INITIAL_SEASON_SKIPPED`; giữ các kiểm tra lịch.
- `src/test/chapter-initial-rewards.test.ts`: mùa → cửa sổ chuẩn; bỏ `INITIAL_SEASON_SKIPPED`; thêm ca áp dụng sớm cho cửa sổ sau.
- `src/test/learning-cycles.test.ts`: giữ kiểm tra `chapterRewardBoundary` = **mốc đã qua**; không tách helper `chapterRewardBoundaryElapsed` vì `chapterRewardBoundary` đã mang nghĩa đó.
- **Test mới** `src/test/transfer-windows.test.ts` (unit, không cần DB): mọi ngày trong năm quy về đúng 1 cửa sổ; `anchorNearest` vs `anchorElapsed` khác nhau đúng ở `1/1–31/3` và `1/7–30/9`; `termOfAnchor` = mốc + 6 tháng; biên `1/7 00:00` và `1/1 00:00` (giờ VN) rơi đúng cửa sổ.
- Phần tra mùa (0 mùa / lệch ngày / 2 mùa chồng lấn / mùa cũ 6 tháng / mốc sai) được kiểm trong cùng `src/test/transfer-windows.test.ts`; không tạo file integration riêng `transfer-season-lookup.test.ts`.

### A9. Việc đổi tên cơ học (làm **một lần riêng**, sau khi A1–A8 xanh)

- `CHAPTER_PRESIDENT` → `PRESIDENT`: 7 file mã + 2 migration + 3 test + 1 component + 1 trang admin.
- Xoá `TRAINEE` khỏi 4 danh sách loại trừ **sau khi** `SELECT code FROM positions WHERE code = 'TRAINEE'` trả 0 dòng.
- `learning-periods.ts:88-92`: thêm `CHAPTER_MANAGER` để alias Lead Chapter không còn nhận sao.
- `chapter_competition_terms` mở/đóng theo nhiệm kỳ cố định `mốc + 6 tháng` thay vì theo `applied_at`.

---

## 3. Thay đổi tài liệu — nhóm B: `docs/CKNK.md` viết lại thành tài liệu non-tech

### B1. Nguyên tắc viết lại

1. **Ngôn ngữ người dùng trước**, không có tên bảng/tên hàm/tên file. Thuật ngữ kỹ thuật chỉ giữ khi nó **là tên người dùng nhìn thấy trên màn hình** (ví dụ "Lên lịch chuyển giao", "Áp dụng ngay").
2. Mỗi quy tắc = **1 câu quy tắc + 1 ví dụ có ngày tháng cụ thể**.
3. **Không** kể lại mô hình cũ đã bị bác bỏ. Chỉ ghi quy tắc đang có hiệu lực. (Ngoại lệ duy nhất: một ô "Những hiểu nhầm thường gặp" ở cuối, viết dạng "nhiều người tưởng X — thực tế Y", không nhắc đến mã.)
4. **Không** có mục nào nói về việc sửa mã. Tài liệu mô tả **quy tắc nghiệp vụ**, không mô tả trạng thái mã.
5. Bảng dùng cột ngắn; câu dài chuyển thành đoạn văn — để đọc trên điện thoại.

### B2. Cấu trúc mới (thay toàn bộ 1111 dòng hiện tại)

| Phần | Nội dung | Lấy từ |
|---|---|---|
| **Mở đầu** | Tài liệu dành cho ai, đọc trong bao lâu, 3 điều quan trọng nhất | mới |
| **Bảng tra nhanh** (6 câu hỏi) | giữ, bỏ mọi ký hiệu kỹ thuật | §Bảng tra nhanh hiện tại |
| **Phần 1 — Chuyển giao vào ngày nào** | 2 mốc 1/4 & 1/10; quy về mốc gần nhất; 2 giai đoạn `1/1–30/6` / `1/7–31/12`; ví dụ bảng ngày→mốc | §1.1, §1.2 |
| **Phần 2 — Ai được chuyển giao, bao nhiêu lần** | 1 lần mỗi giai đoạn, tối đa 2 lần/năm; nhiệm kỳ = mốc + 6 tháng (nên 1 nhiệm kỳ có thể có 2 lần chuyển giao — **hợp lệ**); chapter mới không phải chờ | §1.4, §1.5, §2.1 |
| **Phần 3 — Sao bị ngừng khi nào** | quy tắc gốc; chapter chưa từng chuyển giao thì không bao giờ ngừng; ngừng từ mốc, liên tục tới khi xong; không cộng bù; bảng 7 tình huống | §1.3, §2.2, §2.3, §4.1–4.4 |
| **Phần 4 — Khi chuyển giao xảy ra** | chốt sổ cũ, reset chu kỳ học, viết lại Ban/chức vụ; người học giữ sao & lịch sử nhưng tiến độ bài về 0; ví dụ số | §3.2–3.5 |
| **Phần 5 — Lên lịch chuyển giao trên hệ thống** | các bước bấm nút; chọn ngày giờ; áp dụng ngay vs hẹn giờ; hệ thống tự kiểm tra gì; **bảng 6 câu báo lỗi có thể gặp + cách xử lý**; chỉ 1 lịch chờ mỗi chapter | §1.9.4–1.9.6 + A2 |
| **Phần 6 — Điểm bảng xếp hạng trong kỳ chuyển giao** | công thức `A₁/N₁ + A₂/N₂`; bình quân gia quyền; 70% core của cái gì; 3 điều kiện dự xếp hạng; ai vào bảng nào; ví dụ số đầy đủ | §5.1–5.9 |
| **Phần 7 — Vai trò và Ban** | 3 cấp ADMIN/LEAD/MEMBER; 7 Ban; 3 vị trí DNA; ai nhận sao, ai lên bảng xếp hạng; **cách xác định một người giữ vai trò gì** (đọc vị trí đang giữ, không đọc "role") | §0.1, §0.2, §5.6 |
| **Phần 8 — Những hiểu nhầm thường gặp** | 8–10 dòng "tưởng X / thực tế Y" | gom từ các ghi chú rải rác |
| **Phụ lục — Bảng thuật ngữ** | chỉ những từ người dùng cần: mốc, giai đoạn, nhiệm kỳ, mùa, chu kỳ học | §0 từ điển, rút gọn |

### B3. Nội dung bị xoá khỏi `CKNK.md` (danh sách kiểm)

| Mục hiện tại | Lý do xoá |
|---|---|
| Blockquote `:3-7` (cách đọc, phạm vi sửa, 🔧/⚠️/✅/🧪/📄) | mô tả tài liệu, không phải nghiệp vụ |
| `:71-77` legend 5 ký hiệu | không còn ký hiệu nào |
| `§0.2` bảng 6 bảng CSDL + `prisma/schema.prisma` | non-tech không cần |
| `§1.1:105`, `§1.2:118`, `§1.3:133-138,140,164`, `§1.5:170-191`, `§1.6:203-210`, `§1.7` toàn bộ | 🔧 + kể lại mô hình cũ (cửa sổ con `1/3–1/5`, mốc `30/4`/`31/9`, `1/3→1/9`) |
| `§1.8` dữ liệu mẫu + bảng định nghĩa mùa 5 dòng | vận hành kỹ thuật |
| `§1.9` toàn bộ 10 tiểu mục (worker, cron, `setInterval`, `vercel.json`, SQL, bảng hiệu năng) | hạ tầng — chuyển hết sang `docs/operations.md` (đã có mục cron) |
| `§1.10` DNA reset | hạ tầng → `docs/operations.md` |
| `§2.4:544`, `§2.5:551` | ⚠️/🔧 |
| `§3.2` bảng 21 bước + cột "Dòng" | thay bằng 6 câu nghiệp vụ |
| `§3.4` 🧪, `§4.5` mã lý do, `§4.6` mã trạng thái | kỹ thuật → giữ bản dịch tiếng Việt ở Phần 5 |
| `§5.1:714`, `§5.2:726`, `§5.3:741,766`, `§5.4:777`, `§5.5:789`, `§5.6:794-799,818-823,835-836`, `§5.7:848`, `§5.8:856` | `file:line`, khối TS, 🔧/⚠️ |
| **`Phần 6`** sơ đồ ASCII 30 dòng | thay bằng bảng 7 dòng ở Phần 3 |
| **`Phần 7` toàn bộ** (§7.1 lỗi nút, §7.2 17 dòng 🔧, §7.3, §7.4, §7.5, §7.6) | đây là nội dung kỹ thuật; chuyển sang `docs/known-issues.md` (đã có) + xoá khỏi `CKNK.md` |
| **`Phần 8`** bảng truy vết 40 dòng `file:line` | không còn `file:line` nào trong tài liệu |
| `:1109-1111` italic kết (nhánh git, "không có mã nào bị sửa") | mô tả quá trình, không phải nghiệp vụ |

### B4. Nội dung chuyển sang tài liệu khác (không mất thông tin)

| Nội dung | Đích |
|---|---|
| §1.9 worker/cron/60 giây/3 endpoint/vercel | `docs/operations.md` — thêm mục "Nhịp chạy chuyển giao nhiệm kỳ" |
| §1.10 DNA reset | `docs/operations.md` |
| §7.1 lỗi nút + 8 mã 4xx + cách chẩn đoán | `docs/known-issues.md` — mục mới, kèm bảng mã lỗi sau khi A2 xong |
| §7.2 17 dòng 🔧 | đóng dần theo tiến độ nhóm A; dòng nào xong ghi "Đã sửa <ngày>" |
| §7.3 `4` vs `10` | đã có ở `known-issues.md:13` — giữ nguyên |
| §7.4 alias `CHAPTER_MANAGER` | đã có ở `known-issues.md:12` — giữ nguyên |
| §7.5 GET có tác dụng phụ | đã có ở `known-issues.md:21` — giữ nguyên |
| §7.6 phạm vi chưa kiểm chứng | đã có ở `known-issues.md:32-33` — giữ nguyên |
| §0.2 bảng lưu trữ | `docs/architecture.md` — thêm mục "Vị trí và Ban lưu ở đâu" |
| §8 truy vết `file:line` | `docs/architecture.md` hoặc bỏ (thông tin đã có trong mã) |

---

## 4. Câu hỏi "hiện tại chỉ có `handbook-formulas.md` và `CKNK.md` là tài liệu non-tech đọc được, đúng không?"

**Đúng một nửa.** Đo thực tế trên 9 tài liệu trong `docs/`:

| Tài liệu | Dòng | Tham chiếu `file:dòng` | Khối mã | Bảng | Đọc được bởi non-tech? |
|---|---|---|---|---|---|
| `docs/reference/handbook-formulas.md` | 421 | **0** | 0 | 87 | ✅ **Có** — thuần công thức + quy tắc, không có tên file/hàm |
| `docs/CKNK.md` (sau khi viết lại) | ~450 | **0** | 0 | ~45 | ✅ **Có** — sau kế hoạch này |
| `docs/business-rules.md` | 107 | 0 | 1 | 17 | ⚠️ **Gần được** — không có `file:dòng`, nhưng còn mã vai trò legacy (`ADMIN`, `CHAPTER_LEADER`, `CHAPTER_PRESIDENT`) ở dòng 21 và 1 khối mã. **Sửa 1 dòng là đọc được** |
| `docs/known-issues.md` | 47 | 2 | 0 | 20 | ❌ Không — nói về mã, test, migration |
| `docs/operations.md` | 68 | 3 | 0 | 10 | ❌ Không — vận hành, cron, endpoint |
| `docs/architecture.md` | 80 | 19 | 1 | 16 | ❌ Không |
| `docs/performance.md` | 82 | 1 | 0 | 29 | ❌ Không — số liệu hạ tầng |
| `docs/testing.md` | 81 | 11 | 1 | 37 | ❌ Không |
| `docs/api.md` | 642 | 133 | 0 | 333 | ❌ Không — tài liệu API |

**Kết luận:** hiện tại **chỉ có `handbook-formulas.md`** là đọc được bởi non-tech. `CKNK.md` **chưa** — đó chính là việc nhóm B làm. `business-rules.md` là ứng viên thứ ba, cách đích đúng **1 dòng**.

**Đề xuất (chờ bạn duyệt):** sửa luôn dòng 21 của `business-rules.md` (bỏ 3 mã legacy, thay bằng "Chủ tịch / Lead / Thành viên") để có **3 tài liệu non-tech** thay vì 1. Không làm gì khác ở file đó.

---

## 5. Thứ tự thực hiện

| Bước | Việc | Kiểm tra sau bước |
|---|---|---|
| 1 | `transfer-windows.ts` + `transfer-season-lookup.ts` + unit test | `npm run test -- transfer-window` xanh |
| 2 | Nối 4 nơi tra mùa sang hàm chung; **giữ** `chapterRewardBoundary` = mốc đã qua | typecheck xanh |
| 3 | Sửa `POST` route: chuẩn hoá → tra mùa theo cửa sổ → 7 mã lý do; trả `normalized` | gọi thử các tình huống, mỗi tình huống ra đúng câu |
| 4 | Sửa `applyDueChapterReorganizations`: kiểm mùa theo `effective_at`; chặn trùng theo cửa sổ | integration test apply |
| 5 | Dùng chung `isChapterTransferPausedAt`; xoá nhánh 6 tháng | 3 bộ test nền 138/138 |
| 6 | Validate mùa ở `admin/learning-policy/route.ts`; seed; 3 file test cũ | integration test |
| 7 | UI `TransferDraft.tsx`/`useTermTransition.ts`: hiện "giai đoạn + mốc thưởng" trước khi gửi; hiện đúng câu lỗi theo mã | xem tay trên giao diện |
| 8 | **Ngoài phạm vi P0–P4:** đổi tên `CHAPTER_PRESIDENT`→`PRESIDENT`, xoá `TRAINEE`, thêm `CHAPTER_MANAGER`, nhiệm kỳ cố định | để đợt riêng |
| 9 | **Thay bằng:** cập nhật tại chỗ `docs/CKNK.md` theo hành vi P0–P4 (không viết lại toàn bộ) | đọc lại các mục đã sửa |
| 10 | Cập nhật `operations.md`, `known-issues.md`, `architecture.md`, `business-rules.md:21` | đọc lại từng file |
| 11 | Chạy lại toàn bộ kiểm tra cuối | bảng tiêu chí §0 |

---

## 6. Trường hợp biên & cách xử lý

| Tình huống | Hành vi |
|---|---|
| Chọn `01/07 00:00` giờ VN | Rơi đúng biên → cửa sổ `1/7–31/12` (nửa mở), mốc `1/10`. Có test riêng |
| Chọn `31/12 23:59` | Cửa sổ `1/7–31/12`, mốc `1/10` cùng năm |
| Chọn thời điểm trong quá khứ | Vẫn cho đặt; `applied_at` = giờ DB thật, không backdate |
| Chapter mới thành lập hôm nay | Đặt lịch được ngay; không có thời gian chờ |
| Chapter đã chuyển giao trong cửa sổ này | Báo `WINDOW_ALREADY_APPLIED` + nêu cửa sổ kế tiếp |
| Admin chưa tạo mùa | Báo `SEASON_NOT_CONFIGURED` + nêu tên giai đoạn cần tạo |
| Admin tạo 2 mùa chồng lấn | Báo `SEASON_OVERLAP` + nêu tên 2 mùa |
| Worker chạy trễ vài ngày | Không lỗi; `applied_at` = giờ chạy thật; thời gian nghiệp vụ = `min(effective_at, applied_at)` nên vẫn tính theo giờ hẹn; dữ liệu học reset tại giờ chạy thật |
| Mất kết nối DB khi bấm nút | 409 "Đợt chuyển giao đã thay đổi. Hãy tải lại trạng thái." — giữ nguyên |
| Có người trong sheet đã rời chapter | 409 `TransferMemberNoLongerInChapter` + nêu tên — giữ nguyên |
| 2 người được gán Chủ tịch | 409 "Ban Chủ Tịch chỉ được phép có tối đa 1 người" — giữ nguyên |

---

## 7. Kiểm thử & tiêu chí nghiệm thu

**Tự động**

- `npm run typecheck` — 0 lỗi.
- `npm run build` — thành công.
- `npm test` — 25 bộ unit qua.
- `chapter-six-month-transfer`, `chapter-initial-rewards` — đã cập nhật theo cửa sổ chuẩn; `learning-cycles` giữ kiểm tra mốc đã qua; chạy được khi có `TEST_DATABASE_URL`.
- Test mới: `src/test/transfer-windows.test.ts` (unit, không cần DB), gồm cả tra mùa.
- Integration hiện có: `test-chapter-transfer-integration.cjs`, `test-reward-pause-integration.cjs`, `test-fb-fixes.cjs`, `test-learning-cycles-integration.cjs`, `test-completed-lessons-integration.cjs`; fixture mùa/cửa sổ đã cập nhật, chưa chạy do thiếu DB kiểm thử.

**Thủ công trên giao diện (role Lead Chapter)** — 8 lần bấm, mỗi lần ra đúng 1 câu:

1. Chọn `28/10/2026 09:00` khi đã có mùa `1/7–31/12` → **thành công**, hiện "giai đoạn 1/7–31/12, mốc 01/10/2026".
2. Chọn `28/10/2026 09:00` khi chưa có mùa → "Chưa có mùa chuyển giao cho giai đoạn 1/7–31/12…".
3. Chọn `28/10/2026` khi có 2 mùa chồng lấn → "Có nhiều mùa chuyển giao trùng nhau…".
4. Chọn `28/10/2026` khi mùa chỉ phủ `1/10–31/12` → "Mùa chuyển giao chưa phủ hết giai đoạn…".
5. Đã chuyển giao trong `1/7–31/12`, bấm lần nữa → "Giai đoạn này đã chuyển giao rồi. Lần kế tiếp là 1/1–30/6…".
6. Đã có 1 lịch chờ, bấm lần nữa → "Đã có đợt chuyển giao đang được lên lịch…".
7. Chọn "bây giờ" → áp dụng ngay, thấy kết quả trên màn hình.
8. Chọn `15/01/2027` → thành công với mốc `01/04/2027`.

**Kiểm tra tài liệu** — các mục dưới thuộc nhóm B (viết lại toàn bộ `CKNK.md`), **không thực hiện trong đợt P0–P4**; `CKNK.md` hiện được cập nhật tại chỗ nên vẫn còn phần kỹ thuật lịch sử.

- 0 ký tự trong tập `🔧 ⚠️ ✅ 🧪 📄`.
- 0 chuỗi khớp `\.(ts|tsx|prisma|json|mjs|cjs)\b` và `:\d+-\d+`.
- 0 khối mã có nhãn `sql` / `ts` / `tsx`.
- 0 link nội bộ gãy (kiểm bằng script slug GitHub).
- 0 ký tự thay thế `U+FFFD`.
- Không còn các chuỗi: `sáu tháng lịch`, `01/03–30/04`, `30/9`, `31/3`, `INITIAL_SEASON_SKIPPED`, `firstEligibleAt`, `paused(t)`, `reward_boundary_at`, `SCHEDULED`, `APPLIED`.
- Mọi bảng cân số cột `|`.

---

## 8. Giả định & rủi ro

**Giả định**

1. Quy tắc "mốc gần nhất" + "1 lần mỗi giai đoạn" + "nhiệm kỳ = mốc + 6 tháng" + "chapter mới không phải chờ" + "chapter chưa từng chuyển giao không bao giờ ngừng sao" là **đã chốt** và không đổi trong kế hoạch này.
2. Mùa chuyển giao **phải phủ trọn một giai đoạn** (`1/1–30/6` hoặc `1/7–31/12`). Đây là hệ quả trực tiếp của quy tắc "1 lần mỗi giai đoạn" — nếu mùa là khối 6 tháng thì không thể biết chapter đã chuyển giao trong giai đoạn nào.
3. **Giữ** `chapterRewardBoundary` = mốc đã qua, nên hành vi thưởng ở `1/1–31/3` và `1/7–30/9` không đổi. Việc đặt lịch/tra mùa dùng `anchorNearest`; đây là chủ đích để không phá cơ chế ngừng thưởng và DNA reset.
4. Audit `audit:handbook-formulas` vẫn đỏ (`actual 4 / expected 10`) cho tới khi cập nhật fixture — **không** sửa công thức production để ép xanh.
5. Không có migration phá dữ liệu: `CHAPTER_PRESIDENT`→`PRESIDENT` làm bằng migration cập nhật dữ liệu, giữ nguyên `id`.

**Rủi ro & giảm thiểu**

| Rủi ro | Giảm thiểu |
|---|---|
| Tra mùa theo cửa sổ làm lộ cấu hình mùa cũ không chuẩn | Chỉ chặn **đặt lịch mới**; mùa cũ vẫn đọc được, tab Admin cảnh báo; không tự migrate dữ liệu cũ |
| Mùa đang có trong production không phải cửa sổ chuẩn → validate mới chặn Admin sửa | Validate áp cho cấu hình mới; mùa cũ vẫn đọc được, Admin có thể sửa nếu chưa có đợt `APPLIED` |
| `POST` route có 8 nhánh 4xx, sửa dễ sót | Test integration liệt kê đủ 8 nhánh, mỗi nhánh 1 assert |
| Viết lại `CKNK.md` làm mất thông tin nghiệp vụ | Mỗi mục §B3 có đích đến ở §B4; đối chiếu 1-1 trước khi xoá |
| Đổi tên `CHAPTER_PRESIDENT` chạm 14 chỗ | Làm thành bước 8 riêng, sau khi các bước 1–7 xanh |

---

## 9. Kết quả bàn giao

1. Mã đã sửa (nhóm A) + danh sách file thay đổi.
2. `docs/CKNK.md` **cập nhật tại chỗ** theo hành vi P0–P4 (không viết lại toàn bộ trong đợt này).
3. 4 tài liệu kỹ thuật đã nhận phần chuyển giao (`operations.md`, `known-issues.md`, `architecture.md`, `business-rules.md`).
4. Báo cáo kiểm thử: typecheck, build, 138/138, test mới, 8 lần bấm thủ công.
5. Trả lời câu hỏi tài liệu non-tech (§4) — hiện chỉ 1, sau kế hoạch là 3.
