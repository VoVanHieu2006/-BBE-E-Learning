# CKNK — Toàn bộ nghiệp vụ Chuyển giao Nhiệm kỳ

> Tài liệu này ghi lại **quy tắc nghiệp vụ chuẩn đã chốt** cho chuyển giao nhiệm kỳ Chapter, rồi đối chiếu với **hành vi mã sau đợt P0–P4**.
>
> **Cách đọc:** tài liệu viết **ngôn ngữ người dùng trước, thuật ngữ kỹ thuật sau** — mỗi quy tắc mở bằng câu hỏi đời thường ("chuyển giao vào ngày nào?", "hệ thống kiểm tra bao lâu một lần?"), rồi mới tới tên bảng/tên hàm, và luôn có **ví dụ thật**. Mỗi quy tắc đều kèm `file:line` của mã đang thực thi để tự kiểm chứng. Chỗ nào **còn ngoài phạm vi P0–P4** được đánh dấu 🔧 và gom về [Phần 7.2](#72-các-chỗ-cần-sửa-mã-để-khớp-quy-tắc-chuẩn). Chỗ nào mã và tài liệu cũ **nói khác nhau** được đánh dấu ⚠️. Tài liệu **chưa** xác nhận dữ liệu production (xem [Phần 7.6](#76-phạm-vi-chưa-kiểm-chứng)).
>
> **Phạm vi đợt P0–P4:** đã sửa mã và cập nhật tài liệu tại chỗ. Các hạng mục P5 (đổi mã vị trí, xoá `TRAINEE`, alias `CHAPTER_MANAGER`), khung nhiệm kỳ cố định và viết lại toàn bộ tài liệu **không nằm trong đợt này**.

## Bảng tra nhanh

| Câu hỏi                       | Trả lời ngắn                                                                                                                                                                                                                                                                                                                  | Chi tiết                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Chuyển giao vào ngày nào?   | Mốc chuẩn hóa **00:00 ngày 1/4** và **00:00 ngày 1/10** giờ Việt Nam (UTC+7); quy về **mốc gần nhất**: `1/1–30/6` → `1/4`, `1/7–31/12` → `1/10`                                                                                                                                        | [Phần 1](#phần-1--chuyển-giao-vào-ngày-tháng-nào)                  |
| Chapter mới thì sao?          | **Không phải chờ** — thành lập hôm nay vẫn lên lịch chuyển giao được ngay; nhưng chapter **chưa từng** chuyển giao thì **không bao giờ bị ngừng cộng sao**, kể cả khi đã qua mốc                                                                                                  | [Phần 2](#phần-2--chapter-mới-nhiệm-kỳ-đầu)                        |
| Chuyển giao thì sao?          | Trong 1 giao dịch: chốt sổ cũ, **reset chu kỳ học của toàn bộ thành viên**, viết lại Ban/chức vụ theo sheet                                                                                                                                                                                                 | [Phần 3](#phần-3--khi-chuyển-giao-xảy-ra-apply)                       |
| Không chuyển giao thì sao?   | Chapter **đã từng** chuyển giao: **ngừng cộng sao từ mốc** (`1/4` hoặc `1/10`) và **ngừng liên tục cho tới khi chuyển giao xong** — kể cả khi đã sang cửa sổ sau hay sang năm sau; vẫn học, **không cộng bù**. Chapter **chưa từng** chuyển giao: không ngừng | [Phần 4](#phần-4--khi-không-chuyển-giao)                              |
| Điểm BXH tháng chuyển giao? | Tháng bị **chia stage theo giờ chuyển giao**, điểm = `A₁/N₁ + A₂/N₂ + …`, số người và tỷ lệ 70% bình quân **gia quyền theo thời lượng**                                                                                                                                                     | [Phần 5](#phần-5--điểm-bảng-xếp-hạng-trong-thời-kỳ-chuyển-giao) |
| Được chuyển giao mấy lần? | **1 lần mỗi cửa sổ** (`1/1–30/6` và `1/7–31/12`) → tối đa **2 lần/năm**; cửa sổ sau **không** bị chặn bởi cửa sổ trước                                                                                                                                                               | [Phần 1.4](#14-chặn-trùng-một-lần-mỗi-cửa-sổ)                     |

---

## Phần 0 — Từ điển và mức độ kiểm chứng

| Thuật ngữ                                      | Nghĩa                                                                                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mốc chuẩn hóa** (Anchor)              | `00:00 ngày 1/4` hoặc `00:00 ngày 1/10` giờ VN (UTC+7). Mọi chuyển giao đều quy về **mốc gần nhất**                                                                                                    |
| **Trung điểm** (Midpoint)                | `1/1` và `1/7` — ranh giới chia năm để chọn mốc gần nhất                                                                                                                                                       |
| **Cửa sổ chuyển giao** (Window)         | Khoảng mà mọi thời điểm trong đó cùng quy về một mốc. Là **đơn vị chặn trùng** và **đơn vị xét ngừng cộng sao**                                                                         |
| **Mùa chuyển giao** (Transfer Season)    | Bản ghi Admin cấu hình trong bảng `transfer_seasons` (`prisma/schema.prisma:962-969`)                                                                                                                                |
| **Mốc thưởng** (`reward_boundary_at`) | Khoá **duy nhất** (unique) của mùa, chính là **mốc chuẩn hóa** 1/4 hoặc 1/10 00:00 giờ VN. Hàm `chapterRewardBoundary(at)` thì trả **mốc đã qua** gần nhất, không phải mốc gần nhất dùng khi đặt lịch (`src/lib/transfer-season-lookup.ts`, `src/lib/transfer-windows.ts`) |
| **Nhiệm kỳ** (Term)                      | Khung thi đua 6 tháng tính **từ mốc**: `1/4 → 1/10` và `1/10 → 1/4` năm sau, lưu ở `chapter_competition_terms`. **Khác cửa sổ chuyển giao** (xem [Phần 1.5](#15-nhiệm-kỳ-khác-cửa-sổ)) |
| **Nhiệm kỳ thực tế** (Actual term)     | Khoảng từ lúc thành lập/chuyển giao gần nhất tới lần chuyển giao kế tiếp. **Chỉ để thống kê, không xếp hạng chính thức**                                                                        |
| **Chu kỳ học** (Learning cycle)          | Đơn vị reset tiến độ học của từng người. Mỗi lần chuyển giao đóng chu kỳ cũ, mở chu kỳ mới                                                                                                              |
| `SCHEDULED` / `APPLIED` / `CANCELLED`      | Trạng thái một đợt chuyển giao (`prisma/schema.prisma:167`, `:899-920`)                                                                                                                                            |

### 0.1 Ba cấp vai trò

Hệ thống chỉ có **ba cấp vai trò** khi nói về quyền và về việc nhận sao:

| Cấp                 | Gồm những vị trí nào                                                                                                                                                    | Số lượng                      | Nhận sao? | Vào bảng xếp hạng?                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------- | --------------------------------------------- |
| **`ADMIN`**  | Quản trị hệ thống                                                                                                                                                        | **đúng 1 tài khoản**   | ❌ Không  | ❌ Không                                     |
| **`LEAD`**   | `CHAPTER_LEAD` (Lead Chapter), `DNA_LEAD` (Lead DNA)                                                                                                                     | 1 người/Chapter, 1 người/DNA | ❌ Không  | ❌ Không                                     |
| **`MEMBER`** | `PRESIDENT` (Chủ tịch Chapter), `DEPARTMENT_LEAD` (LT — 7 ban), `MEMBER_CHAPTER` (thành viên ban — 7 ban), `DNA_MEMBER` (3 vị trí `TT`, `SGDC`, `LDC`) | nhiều                           | ✅ Có     | ✅ Có — **trừ** `DNA_MEMBER -> TT` |

Ba điều cần nhớ để không nhầm:

1. **`LEAD` và `MEMBER` là cách gọi nghiệp vụ, không phải cột trong DB.** Cột `role` trong DB chỉ có ba giá trị `ADMIN`, `CHAPTER_LEADER`, `MEMBER` (`prisma/schema.prisma:16-22`). `LEAD_CHAPTER` / `LEAD_DNA` **được suy ra** từ vị trí đang giữ, qua `getLearningManagerKind()` (`src/lib/manager-learning-access.ts:5-19`): có vị trí `CHAPTER_LEAD`/`CHAPTER_MANAGER` → `LEAD_CHAPTER`; có `DNA_LEAD`/`DNA_MANAGER` → `LEAD_DNA`. Người giữ vị trí `DNA_LEAD` vẫn mang `role = 'MEMBER'` trong DB (`src/lib/invitations.ts:379`).
2. **`MEMBER_CHAPTER` là tên gọi trong tài liệu** cho vị trí thành viên ban; mã vẫn dùng `position.code = 'MEMBER'`. Đây chỉ là **đổi tên cách gọi**, không phải đổi dữ liệu.
3. **`PRESIDENT` là vị trí cấp Chapter, thuộc nhóm LT và vẫn nhận sao.** Trong mã hiện tại vị trí này vẫn mang mã `CHAPTER_PRESIDENT`; việc thống nhất về `PRESIDENT` nằm ngoài phạm vi P0–P4 (xem [Phần 7.2](#72-các-chỗ-cần-sửa-mã-để-khớp-quy-tắc-chuẩn), dòng 15).

### 0.2 Vị trí và các ban được lưu ở đâu

Câu hỏi: *"một người thuộc ban nào, giữ chức vụ gì — lưu ở đâu?"* Câu trả lời: **không** lưu ở cột `role` của người dùng, mà lưu ở **6 bảng tổ chức**:

| Bảng thật                                | Lưu gì                                                                                                                                                                                     | Định nghĩa                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `organization_units`                     | **Cây đơn vị**: `type` ∈ `ROOT` / `DNA` / `DNA_GROUP` / `CHAPTER` / `DEPARTMENT`; `code`, `name`, `parent_id`, `status`; duy nhất theo `(parent_id, name)` | ✅ `prisma/schema.prisma:107-115`, `:657-680` |
| `organization_memberships`               | **Người ↔ đơn vị**: `user_id`, `unit_id`, `status`, `starts_at`, `ends_at`                                                                                             | ✅ `:682-699`                                   |
| `positions`                              | **Danh mục vị trí**: `code` (unique), `name`, `scope` ∈ `PLATFORM` / `DNA` / `CHAPTER` / `DEPARTMENT`, `is_manager`                                                | ✅ `:124-131`, `:701-714`                     |
| `position_assignments`                   | **Ai đang giữ vị trí gì, ở đơn vị nào**: `user_id` + `position_id` + `unit_id` + `is_primary` + `starts_at` / `ends_at` + `appointed_by`                       | ✅ `:738-756`                                   |
| `position_permissions` + `permissions` | **Quyền** gắn theo vị trí                                                                                                                                                          | ✅ `:716-736`                                   |
| `chapter_members`                        | **Danh sách thành viên Chapter** — roster dùng khi chuyển giao                                                                                                                   | ✅ `:255`                                       |

Nói cách khác: **muốn biết một người thuộc ban nào thì hỏi `position_assignments` (vị trí) và `organization_memberships` (đơn vị), đừng hỏi `UserRole`.**

**7 ban chuẩn** — `BTV`, `BTK`, `BND`, `BCL`, `BDHU`, `BKM`, `BTTSK` — là các dòng `organization_units` với `type = DEPARTMENT`, được tạo/chuẩn hoá bởi `normalize-learning-organization.ts:14-27` từ danh sách `STANDARD_DEPARTMENTS` (`src/lib/learning-catalog.ts:8-11`). Ba nhóm DNA `TT`, `SGDC`, `LDC` là `organization_units` với `type = DNA_GROUP`, chuẩn hoá ở `:41-45`.

**Phiếu chuyển giao** lưu **`department_unit_id` + `position_id`** trong `chapter_reorganization_items` (`prisma/schema.prisma:922-939`) — tức là sheet chuyển giao chỉ ghi **mã ban** và **mã vị trí**, không ghi tên tự do.

**Mức độ kiểm chứng dùng trong tài liệu:**

- ✅ **Đã đọc mã** — đọc trực tiếp hàm/logic tương ứng.
- 🧪 **Test chứng minh** — có test tự động khẳng định hành vi này.
- 📄 **Tài liệu mô tả** — chỉ có trong tài liệu, chưa đối chiếu được với mã.
- ⚠️ **Mâu thuẫn / cần chốt** — mã và tài liệu (hoặc giữa các nguồn) nói khác nhau.
- 🔧 **Còn phải sửa / ngoài phạm vi** — quy tắc đã chốt nhưng mã chưa khớp, hoặc hạng mục được chủ động để lại cho đợt sau. Danh sách gom ở [Phần 7.2](#72-các-chỗ-cần-sửa-mã-để-khớp-quy-tắc-chuẩn).

---

## Phần 1 — Chuyển giao vào ngày tháng nào

### 1.1 Hai mốc chuẩn hóa

Mốc chuẩn hóa luôn là **00:00 ngày 1 tháng 4** hoặc **00:00 ngày 1 tháng 10**, giờ Việt Nam (UTC+7). Mọi chuyển giao được **quy về mốc gần nhất**; ranh giới là hai **trung điểm** `1/1` và `1/7`:

```
1/1 00:00 – 30/6 23:59:59   → 1/4 cùng năm
1/7 00:00 – 31/12 23:59:59  → 1/10 cùng năm
```

Ví dụ: `20/03/2026` cách `1/4/2026` **12 ngày** nhưng cách `1/10/2025` **170 ngày** → lấy **`1/4/2026`**. Còn `15/01/2026` cách `1/4/2026` **76 ngày**, cách `1/10/2025` **106 ngày** → vẫn lấy **`1/4/2026`**.

| Thời điểm bấm | Mốc chuẩn hóa (mốc gần nhất)              |
| ----------------- | ----------------------------------------------- |
| 15/01/2026        | **1/4/2026 00:00** (cửa sổ 1/1–30/6)   |
| 20/03/2026        | **1/4/2026 00:00** (cửa sổ 1/1–30/6)   |
| 15/04/2026        | **1/4/2026 00:00** (cửa sổ 1/1–30/6)   |
| 15/08/2026        | **1/10/2026 00:00** (cửa sổ 1/7–31/12) |
| 28/10/2026        | **1/10/2026 00:00** (cửa sổ 1/7–31/12) |
| 31/12/2026        | **1/10/2026 00:00** (cửa sổ 1/7–31/12) |

Như vậy khoảng `1/1 – 30/6` **luôn** quy về `1/4` cùng năm, và khoảng `1/7 – 31/12` **luôn** quy về `1/10` cùng năm. Hệ quả cần nhớ: một chuyển giao ngày `20/03/2026` **không** còn bị tính vào mùa `1/10/2025` như mô hình cũ.

✅ **Đã tách hai khái niệm mốc:** `anchorNearest` / `windowOf` trả **mốc gần nhất** cho việc đặt lịch và chặn trùng; `anchorElapsed` / `chapterRewardBoundary` vẫn trả **mốc đã qua gần nhất** cho việc ngừng cộng sao và reset DNA. Việc tách này tránh cho DNA reset nhận một mốc ở tương lai trong nửa đầu mỗi cửa sổ. Xem [1.3](#13-ngừng-cộng-sao-từ-mốc-liên-tục-cho-tới-khi-chuyển-giao) và [1.10](#110-dna-reset-độc-lập).

### 1.2 Cửa sổ chuyển giao

Vì quy đổi theo mốc gần nhất, mỗi mốc có **đúng một cửa sổ** gồm mọi thời điểm quy về nó:

| Cửa sổ                            | Mốc chuẩn hóa    | Tên gọi                    |
| ----------------------------------- | ------------------- | ---------------------------- |
| `00:00 1/1` – `23:59:59 30/6`  | `1/4` cùng năm  | **Cửa sổ tháng 4**  |
| `00:00 1/7` – `23:59:59 31/12` | `1/10` cùng năm | **Cửa sổ tháng 10** |

Hai cửa sổ **liền kề, nửa mở** (`[1/1, 1/7)` và `[1/7, 1/1 năm sau)`) nên **mọi thời điểm rơi vào đúng 1 cửa sổ**.

> ⚠️ **Không có** cửa sổ con `1/3–1/5` / `1/9–1/11`, và **không có** mốc `30/4` / `31/9`. Đó là tàn dư mô hình cũ: `1/3–1/5` nằm trọn trong cửa sổ `1/1–30/6` và cùng quy về `1/4`, nên không thêm thông tin gì.

### 1.3 Ngừng cộng sao từ mốc, liên tục cho tới khi chuyển giao

Trong mỗi cửa sổ, chapter phải chuyển giao **đúng một lần**.

| Tình huống trong cửa sổ                          | Hệ quả với sao                                                                                                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chuyển giao **trước mốc** (nửa đầu)     | **Không mất sao**                                                                                                                                                                                                              |
| Chuyển giao **sau mốc** (nửa sau)           | Mất sao từ `00:00 ngày mốc` tới **đúng thời điểm apply**; sau đó cộng lại                                                                                                                                        |
| **Không chuyển giao**                        | Mất sao từ `00:00 ngày mốc`, **liên tục** cho tới khi chuyển giao xong — kể cả khi đã sang cửa sổ sau hoặc sang năm sau                                                                                       |
| **Chapter chưa từng chuyển giao lần nào** | **Không mất sao** — dù đã qua mốc bao lâu. Cơ chế ngừng sao chỉ bật sau **lần chuyển giao đầu tiên thành công** (xem [2.2](#22-chapter-chưa-từng-chuyển-giao-thì-không-bao-giờ-ngừng-cộng-sao)) |

Công thức kiểm tra mà mã cần khớp:

```
A_last(t) = mốc đã qua gần nhất ≤ t     (1/4 hoặc 1/10)
S(t)      = đầu cửa sổ của A_last(t)     (1/1 nếu A_last = 1/4; 1/7 nếu A_last = 1/10)
T_thực(t) = min(effective_at, applied_at) của từng đợt đã APPLIED
paused(t) = chapter ĐÃ TỪNG chuyển giao
            VÀ không tồn tại đợt APPLIED nào đã áp dụng (applied_at ≤ t) mà
            T_thực ∈ [S(t), t], hoặc effective_at thuộc cửa sổ, hoặc applied_at ∈ [S(t), t]
```

> `applied_at` vẫn là **giờ database thật**, không backdate. `T_thực` chỉ dùng cho nghiệp vụ, hiển thị và xếp hạng; việc reset chu kỳ học vẫn xảy ra tại `applied_at`.

> **Vì sao cần cả `effective_at`?** Đợt chuyển giao được quy vào cửa sổ theo `effective_at` (dùng cho chặn trùng). Nếu đợt đó được áp dụng **sớm trước khi cửa sổ bắt đầu**, chỉ xét `T_thực` sẽ không thấy bằng chứng trong cửa sổ, trong khi chặn trùng vẫn nói "đã chuyển giao". Xét thêm `effective_at` giữ hai quy tắc nhất quán và tránh chapter bị ngừng thưởng vô hạn.

> Điều kiện đầu tiên — **"chapter đã từng chuyển giao"** — là bắt buộc. Thiếu nó thì một chapter mới thành lập sẽ bị coi là "đã bỏ lỡ cửa sổ" ngay từ ngày đầu, trái với quy tắc nhiệm kỳ đầu. Xem [2.2](#22-chapter-chưa-từng-chuyển-giao-thì-không-bao-giờ-ngừng-cộng-sao).

Bảng kiểm chứng (mô hình hiện hành):

| Thời điểm xét `t` | Lần apply gần nhất | `A_last(t)` | `S(t)`     | Có apply trong `[S(t), t]`? | Kết quả                                                               |
| ----------------------- | --------------------- | ------------- | ------------ | ------------------------------ | ----------------------------------------------------------------------- |
| `15/02/2026`          | `20/12/2025`        | `1/10/2025` | `1/7/2025` | Có (`20/12`)                | Không ngừng                                                           |
| `15/02/2026`          | chưa từng           | `1/10/2025` | `1/7/2025` | Không                         | **Không ngừng** — nhiệm kỳ đầu, cơ chế ngừng chưa bật |
| `01/05/2026`          | `10/02/2026`        | `1/4/2026`  | `1/1/2026` | Có (`10/02`)                | Không ngừng                                                           |
| `01/05/2026`          | `20/12/2025`        | `1/4/2026`  | `1/1/2026` | Không                         | **Ngừng** từ `1/4` cho tới khi chuyển giao                  |
| `10/05/2026`          | vừa apply `10/05`  | `1/4/2026`  | `1/1/2026` | Có (`10/05`)                | Cộng sao lại từ `10/05`                                            |
| `15/08/2026`          | `20/12/2025`        | `1/4/2026`  | `1/1/2026` | Không                         | **Ngừng liên tục** dù đã sang cửa sổ tháng 10            |
| `15/08/2026`          | `20/07/2026`        | `1/4/2026`  | `1/1/2026` | Có (`20/07`)                | Không ngừng                                                           |

Sao trong khoảng bị ngừng **mất vĩnh viễn**, **không cộng bù**.

### 1.4 Chặn trùng một lần mỗi cửa sổ

- Tối đa **1 lần** chuyển giao trong `00:00 1/1 – 23:59:59 30/6`.
- Tối đa **1 lần** chuyển giao trong `00:00 1/7 – 23:59:59 31/12`.
- Tối đa **2 lần/năm**. Cửa sổ sau là cửa sổ **mới**, không bị chặn bởi cửa sổ trước.

Đơn vị chặn là **cửa sổ**, **không** phải nhiệm kỳ (xem [1.5](#15-nhiệm-kỳ-khác-cửa-sổ)).

✅ **Đã dùng cửa sổ làm đơn vị chặn trùng.** Mã kiểm tra `effective_at` của đợt `APPLIED` có nằm trong cùng cửa sổ hay không; không còn phụ thuộc vào `transfer_season_id`, nên Admin sửa mùa không làm bắn nhầm lỗi trùng.

### 1.5 Nhiệm kỳ khác cửa sổ

**Nhiệm kỳ thi đua** là khung 6 tháng tính **từ mốc**: `1/4 → 1/10` và `1/10 → 1/4` năm sau. Đây là khung dùng để **cộng dồn điểm và xếp hạng chapter**.

> ⚠️ **Đã chốt lại định nghĩa nhiệm kỳ.** Bản trước của tài liệu này ghi nhiệm kỳ là `1/3 → 1/9` / `1/9 → 1/3`, **không khớp** với hai nguồn còn lại: `docs/reference/handbook-formulas.md:232-242` (mục 13, ghi rõ "ĐÃ CHỐT") nói nhiệm kỳ bắt đầu `01/04` hoặc `01/10`; còn mã thì suy ra kết thúc bằng `addCalendarMonthsVietnam(reward_boundary_at, 6)` = **mốc + 6 tháng** (`src/lib/chapter-reward-gate.ts:15-18`, dùng ở `competition-snapshots.ts:480`, `period-leaderboard.ts:146`). **Chuẩn của tài liệu này là "mốc + 6 tháng"** — khớp cả sổ tay và mã. Khung `1/3 → 1/9` bị bỏ. Ngày 29/10/2026 sổ tay cũng đã được sửa: khung `30/09` / `31/03` được thay bằng `01/10` / `01/04` cho khớp mốc chuẩn hóa.

Nhiệm kỳ **không trùng** cửa sổ chuyển giao — hai khung vắt qua nhau:

```
Tháng:     1   2   3   4   5   6   7   8   9  10  11  12
Cửa sổ:   [-------- 1/1 – 30/6 --------)[------- 1/7 – 31/12 -------)
Mốc:                    ▲1/4                            ▲1/10
Nhiệm kỳ:               [-------- 1/4 – 1/10 --------)[------ 1/10 – 1/4 --------)
```

Nhìn sơ đồ là thấy ngay: **mỗi nhiệm kỳ cắt qua đúng 2 cửa sổ chuyển giao** — nhiệm kỳ `1/4 → 1/10` nằm trong cửa sổ `1/1–30/6` (nửa sau) và cửa sổ `1/7–31/12` (nửa đầu).

Hệ quả: **trong cùng một nhiệm kỳ có thể có 2 lần chuyển giao**, và điều đó là **đúng, không phải lỗi**. Ví dụ nhiệm kỳ `1/4 → 1/10/2026` có thể có lần chuyển giao `15/5` (thuộc cửa sổ tháng 4) và lần `15/8` (thuộc cửa sổ tháng 10).

Cách hiểu cho đúng — **"1 nhiệm kỳ chuyển giao 2 lần" là đúng theo nghĩa thời gian**:

- Mỗi lần chuyển giao trong một cửa sổ đều **chuẩn hoá về mốc của cửa sổ đó** — `1/4` hoặc `1/10` ([1.1](#11-hai-mốc-chuẩn-hóa)).
- Thời gian **sau** một lần chuyển giao **đã tính cho nhiệm kỳ kế tiếp**, không tính lại cho nhiệm kỳ cũ.
- Việc chặn trùng chỉ theo **cửa sổ** (tối đa 1 lần/cửa sổ), **không** chặn theo nhiệm kỳ ([1.4](#14-chặn-trùng-một-lần-mỗi-cửa-sổ)).

🔧 **Ngoài phạm vi đợt P0–P4:** `chapter_competition_terms` hiện vẫn **mở tại thời điểm apply** (`starts_at = appliedAt`, `ends_at` để trống) và chỉ **đóng ở lần apply kế tiếp**. Việc chuyển sang nhiệm kỳ cố định `1/4→1/10` / `1/10→1/4` cần một thay đổi riêng vì chạm dữ liệu nhiệm kỳ đã có.

### 1.6 Mùa do Admin cấu hình

Admin cấu hình mùa qua `PUT /api/v1/admin/learning-policy`. Ràng buộc hiện tại:

- `reward_boundary_at` phải **đúng** `1/4` hoặc `1/10`, **đúng `00:00:00.000`** giờ VN.
- `starts_at` / `ends_at` phải **trùng đúng một cửa sổ chuẩn**: `1/1–30/6` hoặc `1/7–31/12` tương ứng với mốc.
- Các mùa **không được chồng lấn** (`OverlappingTransferSeason`).
- Mùa đã có chapter chuyển giao (`APPLIED` gắn với mùa hoặc nằm trong cửa sổ của mùa) **hoặc đang được một đợt `SCHEDULED` tham chiếu** thì **không sửa được** (`TransferSeasonAlreadyUsed`).
- Mùa **chưa được dùng** (không có `APPLIED` và không bị đợt `SCHEDULED` nào tham chiếu) vẫn sửa được, kể cả mùa của cửa sổ hiện tại — đây là cách Admin sửa cấu hình sai mà không phải xoá dữ liệu.

✅ `src/app/api/v1/admin/learning-policy/route.ts`

**Một đường tra mùa duy nhất.** Cả đặt lịch, worker, cổng kiểm tra thưởng và trang Admin đều dùng `resolveSeasonForWindow(...)`:

| Tình huống | Lý do trả về | Thông điệp cho người dùng |
| --- | --- | --- |
| Không có mùa nào giao với cửa sổ | `SEASON_NOT_CONFIGURED` | Chưa có mùa chuyển giao cho giai đoạn này; Admin cần tạo mùa. |
| Có từ hai mùa giao với cùng cửa sổ | `SEASON_OVERLAP` | Có nhiều mùa cùng áp dụng; Admin cần giữ lại đúng một mùa. |
| Mùa không phủ hết cửa sổ | `SEASON_NOT_COVERING_DATE` | Mùa hiện có chưa phủ hết giai đoạn; Admin cần điều chỉnh ngày. |
| Mùa dùng khung 6 tháng cũ | `SEASON_LEGACY_WINDOW` | Mùa đang dùng khung 6 tháng cũ nên không khớp giai đoạn; cần sửa trước khi đặt lịch. |
| Ngày bắt đầu/kết thúc không đúng cửa sổ | `SEASON_WINDOW_MISMATCH` | Mùa không trùng đúng giai đoạn; Admin cần sửa ngày bắt đầu và kết thúc. |
| Mốc thưởng không đúng | `SEASON_BOUNDARY_MISMATCH` | Mốc thưởng phải đúng `1/4` hoặc `1/10` lúc `00:00`. |

Mùa 6 tháng cũ **vẫn đọc được** cho dữ liệu lịch sử và cho các đợt đã gắn sẵn mùa đó, nhưng **không được dùng để đặt lịch mới**. Hệ thống báo rõ là mùa dùng khung cũ thay vì tự quy đổi im lặng.

### 1.7 Hai hàm mốc và phạm vi sử dụng

Sau đợt sửa P0–P4, mã **không còn** dùng một hàm mốc cho mọi việc:

| Hàm | Ý nghĩa | Dùng ở đâu |
| --- | --- | --- |
| `anchorNearest(at)` / `windowOf(at)` | Mốc **gần nhất** và cửa sổ chứa `at` | Đặt lịch, chặn trùng, tra mùa, hiển thị giai đoạn |
| `anchorElapsed(at)` / `chapterRewardBoundary(at)` | Mốc **đã qua gần nhất** | Ngừng cộng sao, reset DNA, tính khoảng ngừng |

Việc tách này là **bắt buộc**: nếu dùng mốc gần nhất cho DNA reset thì trong tháng `1–3` và `7–9`, hệ thống sẽ nhận một mốc ở **tương lai** và reset sai thời điểm. Ngược lại, nếu dùng mốc đã qua để đặt lịch thì chuyển giao tháng `3` sẽ bị gán vào cửa sổ tháng `10` năm trước.

### 1.8 Dữ liệu mẫu và các định nghĩa mùa

Seed demo tạo hai mùa **liền kề, đúng cửa sổ**, mốc thưởng nằm ở giữa cửa sổ:

| Nguồn | Cửa sổ mùa | Mốc thưởng | Đánh giá |
| --- | --- | --- | --- |
| **Tài liệu này** (chuẩn) | `1/1–30/6` và `1/7–31/12` | 1/4, 1/10 00:00 | ✅ Chuẩn |
| `docs/business-rules.md` | `01/01–30/06` và `01/07–31/12` | 1/4, 1/10 00:00 | ✅ Khớp |
| `docs/reference/handbook-formulas.md` | nhiệm kỳ `01/04→01/10` / `01/10→01/04` | 1/4, 1/10 00:00 | ✅ Khớp |
| Seed demo | `1/1–30/6` và `1/7–31/12` | 1/4, 1/10 00:00 | ✅ Đã sửa |
| Test đơn vị | cửa sổ chuẩn, không còn mốc `31/10 23:59:59` | 1/4, 1/10 00:00 | ✅ Đã sửa |

> **Ghi chú:** dữ liệu mùa cũ trong DB (khối 6 tháng hoặc mốc lệch một giây) **không tự động bị sửa**. Hệ thống nhận diện và báo `SEASON_LEGACY_WINDOW` / `SEASON_BOUNDARY_MISMATCH`; Admin sửa mùa chưa dùng trong màn hình cấu hình học tập.

### 1.9 Ai chạy khi tới hạn — worker, cron và lịch chuyển giao

Mục này trả lời 6 câu hỏi đời thường về việc "hệ thống tự chuyển giao lúc nào". Mỗi câu mở bằng cách nói thường ngày, rồi mới tới thuật ngữ.

#### 1.9.1 Hệ thống kiểm tra bao lâu một lần?

**Mỗi 60 giây, một lần.** Có một tiến trình nhỏ (gọi là **worker**) chạy bên ngoài ứng dụng; nó gọi vào một đường dẫn nội bộ của hệ thống **60 giây một lần**, không nghỉ.

**Vì sao lại là 60 giây?**

- Đây là **nhịp quét**, không phải nhịp nghiệp vụ. Nghiệp vụ chỉ có 2 mốc mỗi năm (`1/4`, `1/10`), nên quét mỗi phút là **quá đủ dày**.
- Hệ quả trực tiếp: nếu bạn đặt lịch chuyển giao lúc `20:00:00`, nó sẽ được áp dụng trong khoảng `20:00:00 → 20:00:59`. **Sai số tối đa là 1 phút** — không đáng kể so với một nhiệm kỳ 6 tháng.
- 60 giây cũng là con số **đủ thưa** để không tốn tài nguyên: mỗi lượt quét chỉ là vài truy vấn nhỏ.

Worker có 3 cơ chế an toàn:

| Cơ chế                                            | Tác dụng                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Cờ `busy`                                        | Nếu lượt trước **chưa chạy xong** thì lượt này **bỏ qua**, không chồng lấn |
| `AbortSignal.timeout(55_000)`                     | Mỗi lượt tự huỷ sau **55 giây**, chừa 5 giây trước nhịp kế tiếp                    |
| Ghi log `{scheduledAt, actualAt, lagMs, results}` | Biết được lượt này **trễ bao nhiêu** so với nhịp                                     |

✅ `scripts/learning-scheduler.mjs:8-24` (`setInterval(..., 60_000)`, chạy lượt đầu **ngay lập tức** chứ không chờ 60 giây)

#### 1.9.2 Mỗi lượt chạy thì làm những gì?

Worker gọi **3 đường dẫn nội bộ**, song song, mỗi đường bảo vệ bằng header `Authorization: Bearer <CRON_SECRET>`:

| Đường dẫn                                        | Việc đời thường                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/api/internal/organization/reorganizations/apply` | **Chuyển giao nhiệm kỳ** đã tới giờ + các việc định kỳ khác (xem dưới) |
| `/api/internal/attempts/auto-submit`               | **Tự nộp bài kiểm tra** đã hết giờ                                            |
| `/api/internal/learning/deadlines/enforce`         | **Xử lý hạn học**                                                                 |

✅ `scripts/learning-scheduler.mjs:7`

Riêng đường dẫn đầu tiên chạy **8 việc theo thứ tự cố định**:

1. **Áp dụng các đợt chuyển giao đã tới giờ** ← phần chính của mục này
2. Áp dụng reset chu kỳ DNA đã tới mốc
3. Đẩy các sự kiện đồng bộ lộ trình đang chờ (outbox)
4. Nghỉ hưu các tài khoản không còn hoạt động
5. Đóng các tháng thi đua đã hết
6. Hoàn tất KPI còn treo của các tháng đã đóng
7. Đóng các nhiệm kỳ đã hết
8. Trả về kết quả của cả 8 việc

✅ `src/app/api/internal/organization/reorganizations/apply/route.ts:12-21`

#### 1.9.3 Nó "kiểm tra nhiệm kỳ" như thế nào?

Mỗi 60 giây, hệ thống làm đúng một việc đơn giản:

> **Tìm tất cả các đợt chuyển giao đang ở trạng thái `SCHEDULED` (đã lên lịch) mà thời điểm hiệu lực `effective_at` đã ≤ bây giờ. Sắp xếp đợt nào tới hạn sớm nhất lên đầu, rồi xử lý từng đợt một.**

```
SELECT ... FROM chapter_reorganizations
WHERE status = 'SCHEDULED' AND effective_at <= now
ORDER BY effective_at ASC
```

✅ `src/lib/chapter-reorganizations.ts:7-12`

Với **mỗi đợt** lấy được, hệ thống khoá dòng đó lại (`FOR UPDATE`) rồi **kiểm tra lại** điều kiện — phòng trường hợp một lượt quét khác vừa xử lý xong.

#### 1.9.4 Làm sao biết "đã quá thời gian"? — hai lớp khác nhau

Đây là chỗ dễ hiểu nhầm nhất, nên nói rõ: **có hai nghĩa của "quá thời gian", và chúng do hai cơ chế khác nhau xử lý.**

| Nghĩa                                            | Ai phát hiện                                                 | Khi nào                                                           |
| ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| **(a) Đã lên lịch, và đã tới giờ** | **Worker** (mỗi 60 giây)                               | `effective_at <= now` → áp dụng ngay                          |
| **(b) Quá hạn mà chưa hề lên lịch**  | **Cổng kiểm tra thưởng**, tính lại mỗi lần đọc | Mỗi khi người học xem bài, làm quiz, hoặc được cộng sao |

**(b) không cần cron.** Trạng thái "quá hạn" **không phải** một cờ được ghi vào DB; nó là **một hàm của thời điểm hiện tại**. Mỗi lần ai đó mở bài học, hệ thống gọi `chapterRewardState(tx, userId, at)` và tự tính `paused(t)` theo công thức ở [1.3](#13-ngừng-cộng-sao-từ-mốc-liên-tục-cho-tới-khi-chuyển-giao). Vì vậy:

- Không có "job đánh dấu chapter quá hạn" nào cả.
- Chỉ cần sửa dữ liệu mùa, trạng thái quá hạn **tự đúng lại** ở lần đọc kế tiếp.
- Không có chuyện "quên chạy cron nên chapter không bị ngừng sao".

✅ `src/lib/chapter-reward-gate.ts:21-100`

#### 1.9.5 Đặt lịch chuyển giao thì đặt như thế nào, và chạy lúc nào?

**Đặt như thế nào:** Lead Chapter vào trang chuyển giao nhiệm kỳ, chọn **ngày + giờ hiệu lực** trong ô `datetime-local`, điền sheet phân ban/vị trí mới, rồi gửi. Hệ thống kiểm tra rồi lưu một đợt ở trạng thái `SCHEDULED`. Admin chỉ được xem; ba thao tác đặt lịch, áp dụng ngay và hủy lịch đều trả `403 AdminReadOnly` nếu người gọi là Admin (`src/app/api/v1/chapters/[chapterId]/reorganizations/route.ts`, `[batchId]/route.ts`).

**Chạy lúc nào — có hai trường hợp:**

| Bạn chọn thời điểm                                       | Hệ thống làm gì                                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **≤ 60 giây** kể từ bây giờ (kể cả "bây giờ") | **Áp dụng ngay trong chính lần gửi đó** — không chờ worker. Đây là biến `isImmediate`                 |
| **Xa hơn 60 giây**                                    | Lưu `SCHEDULED`; **worker áp dụng ở lượt quét đầu tiên sau thời điểm đó** — trễ tối đa ~60 giây |

✅ `src/app/api/v1/chapters/[chapterId]/reorganizations/route.ts:216`, `:273-275`

**Vì sao có ngưỡng 60 giây?** Để người dùng bấm "chuyển giao ngay" thấy kết quả **ngay trên màn hình**, không phải chờ tới lượt quét kế tiếp. Ngưỡng này khớp đúng nhịp quét.

**Ràng buộc khi đặt lịch:**

- Mỗi chapter chỉ được có **1 đợt `SCHEDULED`** tại một thời điểm. Muốn đặt đợt mới phải **áp dụng hoặc huỷ** đợt cũ — nếu không sẽ nhận `409 ScheduledReorganizationExists`: *"Đã có đợt chuyển giao nhiệm kỳ đang được lên lịch. Vui lòng áp dụng hoặc hủy đợt hiện tại trước khi lên lịch đợt mới."*
- Thời điểm chọn phải nằm trong **một cửa sổ chuẩn** và cửa sổ đó phải có **đúng một mùa** hợp lệ. Nếu chưa có, trùng mùa, mùa cũ 6 tháng hoặc mốc lệch, hệ thống trả `409` kèm **đúng lý do** theo bảng ở [1.6](#16-mùa-do-admin-cấu-hình), không còn câu chung "Admin cần cấu hình mùa".
- Mỗi cửa sổ chỉ có **một lần chuyển giao `APPLIED`**. Nếu đã có, hệ thống trả `409 WINDOW_ALREADY_APPLIED` và nêu cửa sổ kế tiếp.
- Tầng DB có partial unique index `chapter_transfers_one_applied_season` trên `(chapter_id, transfer_season_id)` khi `status = 'APPLIED'` (migration `prisma/migrations/20261022_learning_guards/migration.sql`). Vì mỗi mùa hợp lệ ứng với đúng một cửa sổ, index chặn lần `APPLIED` thứ hai ở tầng dữ liệu; kiểm tra cửa sổ trong transaction vẫn là lớp chính. Bản ghi `APPLIED` cũ chưa có `transfer_season_id` không nằm trong index (NULL không tham gia unique index), nhưng không có đường API nào tạo mới trạng thái đó. Vi phạm index được ghi thành thông điệp nghiệp vụ trong `last_error` và batch vẫn `SCHEDULED` để thử lại.

✅ `src/app/api/v1/chapters/[chapterId]/reorganizations/route.ts`

#### 1.9.6 Thời điểm áp dụng thực tế lấy theo đâu?

**`applied_at` vẫn là đồng hồ thật của database** (`clock_timestamp()`), **không backdate**. Nhưng thời gian **nghiệp vụ** của một lần chuyển giao là:

```
T_thực = min(effective_at, applied_at)
```

Hệ quả cần nhớ:

- Nếu worker chạy **trễ 2 ngày**, `applied_at` là **ngày chạy thật**, nhưng `T_thực` vẫn là **giờ đã hẹn**. Lịch sử, thống kê và mốc mở lại thưởng dùng `T_thực`.
- Việc reset chu kỳ học, đóng nhiệm kỳ và tạo tiến độ mới vẫn xảy ra tại **`applied_at`** — không backdate dữ liệu.
- Nếu đợt được áp dụng **sớm hơn giờ hẹn**, `T_thực` là **giờ áp dụng thật**; không có chuyện ghi nhận một thời điểm ở tương lai.
- Đợt đã gắn sẵn một mùa (kể cả mùa 6 tháng cũ) **giữ nguyên liên kết** khi worker áp dụng, để dữ liệu lịch sử vẫn đọc được. Đợt mới không có liên kết sẽ được tra theo **cửa sổ của `effective_at`**.
- Không còn lỗi `TransferOutsideSeasonWindow` chỉ vì worker chạy sau `ends_at`. Lỗi bất kỳ → giữ `SCHEDULED` + `last_error` (cắt 2000 ký tự) + tăng `apply_attempts`; **không có đợt nào bị "mất" im lặng.**
- Trang Admin `/admin/transfer-seasons` đọc `GET /api/v1/admin/transfer-seasons/progress` và hiển thị `pendingOverdue`/`overdueMinutes` cho đợt `SCHEDULED` đã quá hạn, `appliedDelayMinutes` cho đợt áp dụng trễ, cùng `applyAttempts`/`lastError`. Quá 60 giây so với `effective_at` bị coi là trễ.
- Tab Admin chỉ tải **một giai đoạn** mỗi lần (`window`), lọc theo tên chapter (`q`), trạng thái (`status=APPLIED|SCHEDULED|NONE|OVERDUE`) và phân trang (`page`, `pageSize` tối đa 100). API trả tối đa 36 bản tóm tắt giai đoạn trong `windows` (`windowsTruncated` báo khi cắt bớt), nên không còn tải toàn bộ chapter của mọi giai đoạn trong một response.
- Mỗi dòng chapter có `totalAppliedCount` (tổng số lần đã chuyển giao trong toàn bộ lịch sử) và `lastAppliedAt`. Nút "Xem lịch sử" gọi `GET /api/v1/admin/transfer-seasons/chapters/[chapterId]` để xem tối đa 50 bản ghi gần nhất kèm tổng số lần theo trạng thái. Cả hai endpoint chỉ đọc, không có thao tác ghi.

✅ `src/lib/chapter-reorganizations.ts`, `src/lib/transfer-windows.ts`

#### 1.9.7 Đã tối ưu chưa?

Trả lời thẳng, gồm cả điểm chưa tối ưu:

| Điểm                | Hiện trạng                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Truy vấn quét       | Có index `@@index([chapter_id, status, effective_at])` — nhưng lượt quét **không lọc theo chapter**, nên mỗi phút vẫn là một truy vấn theo `status + effective_at` trên toàn bộ bảng                                |
| Chống chồng lấn    | Có cờ `busy` phía worker + `FOR UPDATE` phía DB                                                                                                                                                                                          |
| Giới hạn thời gian | Có timeout 55 giây phía worker; transaction apply có `timeout: 30_000`                                                                                                                                                                     |
| Chi phí mỗi đợt   | Mỗi đợt mở **một transaction `Serializable`** khoá chapter + toàn bộ roster, rồi reset chu kỳ học **từng thành viên** — nặng, nhưng số đợt đến hạn mỗi phút rất nhỏ (thực tế gần như luôn bằng 0) |
| Kết luận            | **Chấp nhận được** ở quy mô hiện tại. Nếu số chapter tăng mạnh, chỗ cần tối ưu đầu tiên là **lượt quét** (lọc thêm theo khoảng thời gian), không phải phần apply                                      |

✅ `prisma/schema.prisma:899-920`, `scripts/learning-scheduler.mjs:8-20`, `src/lib/chapter-reorganizations.ts:119`

#### 1.9.8 Vercel cron chỉ là lưới an toàn

Ngoài worker 60 giây, `vercel.json` có một cron **mỗi ngày một lần**:

```
5 17 * * *   →   00:05 giờ Việt Nam mỗi ngày
```

Cron này gọi **cùng** đường dẫn `/api/internal/organization/reorganizations/apply`.

**Nó KHÔNG thay thế nhịp 60 giây.** Nếu worker chết, chuyển giao vẫn được áp dụng, nhưng có thể **trễ tới ~1 ngày** — đủ để mất sao oan cho chapter. Vì vậy worker 60 giây mới là cơ chế chính.

✅ `vercel.json:11-12`, 📄 `docs/operations.md:49-53`

#### 1.9.9 Ba đường có thể ghi dữ liệu khi tới hạn

| Đường                           | Cơ chế                                                                                                      | Nguồn                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Worker** (chính)          | Gọi `GET /api/internal/organization/reorganizations/apply` mỗi 60 giây                                   | ✅ `scripts/learning-scheduler.mjs:7`                                          |
| **Nút "⚡ Áp dụng ngay"** | `POST /reorganizations/[batchId]` → `applyDueChapterReorganizations(now, batchId, true)`; Admin bị từ chối `403 AdminReadOnly` | ✅ `src/app/api/v1/chapters/[chapterId]/reorganizations/[batchId]/route.ts:38` |
| **Tác dụng phụ của GET** | `GET /reorganizations`, `/current-roster`, `dashboard/members` **tự áp dụng** đợt đến hạn | ⚠️ `reorganizations/route.ts:21`, `docs/known-issues.md:21`                |

#### 1.9.10 Ví dụ thật, xuyên suốt

Lead Chapter đặt lịch chuyển giao **15/10/2026 lúc 20:00**.

**Trường hợp 1 — chọn "bây giờ" (≤ 60 giây):**

| Giờ         | Việc gì xảy ra                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `20:00:00` | Gửi form. `effectiveAt = 20:00:00`, cách hiện tại 0 giây ⇒ `isImmediate = true`                                  |
| `20:00:00` | Hệ thống lưu đợt `SCHEDULED`, rồi **áp dụng ngay trong cùng request**                                     |
| `20:00:01` | Trả `201` kèm `appliedImmediately = true`. Nhiệm kỳ cũ đóng, nhiệm kỳ mới mở tại `applied_at = 20:00:01` |

**Trường hợp 2 — đặt trước (xa hơn 60 giây):**

| Giờ               | Việc gì xảy ra                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `15/10 09:00`    | Gửi form. `effectiveAt = 20:00` ⇒ lưu `SCHEDULED`, **chưa áp dụng**                                                                         |
| `15/10 20:00:00` | Lượt quét gần nhất vừa chạy xong lúc `19:59:58` ⇒ chưa thấy gì                                                                                |
| `15/10 20:00:37` | Lượt quét kế tiếp: `effective_at (20:00:00) <= now (20:00:37)` ⇒ **áp dụng**, `applied_at = 20:00:37`                                     |
| `15/10 20:00:37` | Nhiệm kỳ cũ đóng tại `20:00:37`; nhiệm kỳ mới mở tại đó; attempt đang làm dở bị huỷ; tiến độ bài học của từng thành viên về 0 |

**Sao trong tháng 10 được tính thế nào ở trường hợp 2** (giả sử chapter **đã từng** chuyển giao trước đó):

- Cửa sổ `1/7–31/12` có mốc `1/10`. Chapter chưa chuyển giao trong cửa sổ này ⇒ đang bị **ngừng cộng sao từ `1/10`**.
- Vậy sao phát sinh từ `1/10` tới **`20:00` ngày 15/10** (giờ hiệu lực) **không được cộng**.
- Sao **bắt đầu cộng lại từ `20:00`**. Không có cộng bù cho khoảng đã mất. Dữ liệu học vẫn được reset tại `20:00:37` — thời điểm worker chạy thật.

Nếu chapter **chưa từng** chuyển giao lần nào thì ngược lại: `1/10 → 15/10` **vẫn có sao** bình thường, vì cơ chế ngừng sao chưa bật ([2.2](#22-chapter-chưa-từng-chuyển-giao-thì-không-bao-giờ-ngừng-cộng-sao)).

### 1.10 DNA reset độc lập

DNA reset chạy ở **mốc đã qua gần nhất** do `chapterRewardBoundary(now)` trả về — hiện là `1/4` và `1/10` — và **hoàn toàn độc lập** với việc chapter có chuyển giao hay không: reset tiến độ bài học, hủy attempt `IN_PROGRESS` (lý do `DNA_SEASON_RESET`), kết thúc assignment. Hàm này **không đọc** bảng `transfer_seasons`; nó tự dựng `season = { id, starts_at }` từ mốc. DNA reset dùng advisory lock `dna-reset:{mốc}` và chỉ áp dụng nếu `context.cycle.starts_at < mốc`; không cần policy/cutover.

✅ `src/lib/dna-cycle-resets.ts:10-11`, `:24`

✅ **Đã tách helper:** `anchorElapsed(at)` / `chapterRewardBoundary(at)` giữ nghĩa **mốc đã qua** cho DNA reset và ngừng cộng sao; `anchorNearest(at)` / `windowOf(at)` dùng nghĩa **mốc gần nhất** cho đặt lịch và tra mùa. DNA reset không bị ảnh hưởng bởi việc đổi cách tính cửa sổ.

---

## Phần 2 — Chapter mới (nhiệm kỳ đầu)

### 2.1 Chapter mới chuyển giao được ngay, không phải chờ

**Không có thời gian chờ nào.** Chapter thành lập hôm nay vẫn lên lịch chuyển giao được ngay hôm nay, thậm chí ngay trong ngày đầu tiên.

> ⚠️ **Đã bỏ quy tắc "đủ 6 tháng lịch".** Bản trước của tài liệu này yêu cầu chapter phải tồn tại đủ **6 tháng lịch** (tính bằng `addCalendarMonthsVietnam(chapterCreatedAt, 6)`) mới được chuyển giao, và xét điều kiện đó **tại lúc cửa sổ mở**. Quy tắc này **đã bị xoá hẳn** — cùng với nó là hai trạng thái `INITIAL_SEASON_SKIPPED` và trường `firstEligibleAt`.
>
> **Hệ quả nghiệp vụ cần biết trước:** một chapter mới thành lập 1 ngày vẫn có thể chuyển giao và **reset tiến độ học của toàn bộ thành viên**. Đây là hành vi được chấp nhận, không phải lỗi.

✅ Hành vi hiện tại của mã đã đúng phần "không chặn theo tuổi chapter": `src/lib/chapter-term-rules.ts:114-235` chỉ chặn theo **mùa** và theo **mốc**, không chặn theo tuổi.

✅ **Đã xoá quy tắc 6 tháng trong mã.** `evaluateChapterTransferEligibility(...)` chỉ xét cửa sổ hiện tại và lịch sử chuyển giao; không còn `firstEligibleAt`, `INITIAL_SEASON_SKIPPED` hay phép so tuổi chapter.

### 2.2 Chapter chưa từng chuyển giao thì không bao giờ ngừng cộng sao

Đây là quy tắc quan trọng nhất của Phần 2:

> **Cơ chế ngừng cộng sao chỉ bật sau lần chuyển giao ĐẦU TIÊN thành công.** Trước đó, chapter **luôn** nhận sao bình thường — kể cả khi đã qua mốc `1/4` hay `1/10` rất lâu.

Nói cách khác, một chapter chỉ có hai trạng thái trong đời:

| Giai đoạn                        | Nhận sao?                   | Trạng thái                                                                       |
| ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| **Chưa từng** chuyển giao | ✅ **Luôn nhận sao** | `INITIAL_NOT_DUE` (chưa tới lượt) hoặc `FIRST_TRANSFER_DUE` (tới lượt) |
| **Đã từng** chuyển giao  | Phụ thuộc `paused(t)`    | `TRANSFER_APPLIED` / `TRANSFER_SCHEDULED` / `TRANSFER_OVERDUE`               |

Điểm cần nhấn mạnh — **ba điều hệ thống KHÔNG làm**:

1. **Không** có "mốc đủ điều kiện" nào phải vượt qua.
2. **Không** ép chuyển giao khi vượt mốc cửa sổ.
3. **Không** ngừng cộng sao cho chapter chưa từng chuyển giao, dù đã qua mốc bao lâu.

Khi mốc đã qua mà chapter nhiệm kỳ đầu chưa chuyển giao, trạng thái là `TRANSFER_OVERDUE` nhưng:

```ts
status: 'TRANSFER_OVERDUE',
paused: false,   // ← nhiệm kỳ đầu vẫn nhận sao
reason: null,
```

✅ `src/lib/chapter-term-rules.ts:210-234`

Ghi chú trong mã: *"The first transfer is due, but its initial learning/reward term continues until application succeeds. Only subsequent terms may pause awards."*

🧪 `scripts/test/test-completed-lessons-integration.cjs:63` — *"first actual term remains reward eligible after age six months"*
🧪 `src/test/chapter-initial-rewards.test.ts:33`

✅ **Đã dùng đúng công thức `paused(t)`:** điều kiện "đã từng chuyển giao" nằm trong `evaluateChapterTransferEligibility`, còn `chapterRewardState` chỉ truyền lịch sử `APPLIED` và cửa sổ ngừng thưởng. Không còn nhánh `at >= boundary` tách rời.

### 2.3 Bảng quyết định đầy đủ

Hàm `evaluateChapterTransferEligibility(...)` duyệt theo thứ tự sau (dừng ở điều kiện đầu tiên đúng):
✅ `src/lib/chapter-term-rules.ts:114-235`

| # | Điều kiện | Trạng thái | Ngừng thưởng? | Lý do |
| - | --- | --- | --- | --- |
| 1 | Có đợt `APPLIED` với `T_thực ∈ [đầu cửa sổ hiện tại, at]` | `TRANSFER_APPLIED` | ❌ Không | — |
| 2 | **Chưa từng** chuyển giao, **không có** mùa ứng viên | `INITIAL_NOT_DUE` | ❌ Không | — |
| 3 | **Chưa từng** chuyển giao, đã qua mốc | `TRANSFER_OVERDUE` | ❌ **Không** | — |
| 4 | **Chưa từng** chuyển giao, chưa qua mốc | `TRANSFER_SCHEDULED` nếu có lịch, ngược lại `FIRST_TRANSFER_DUE` | ❌ Không | — |
| 5 | **Đã từng** chuyển giao, `paused(at) = true` | `TRANSFER_OVERDUE` | ✅ **Có** | `CHAPTER_TRANSFER_OVERDUE` |
| 6 | **Đã từng** chuyển giao, chưa bị ngừng, chưa có apply trong cửa sổ hiện tại | `TRANSFER_SCHEDULED` nếu có lịch, ngược lại `INITIAL_NOT_DUE` | ❌ Không | — |

> Dòng 3 và dòng 5 **cùng nhãn `TRANSFER_OVERDUE` nhưng khác hẳn hệ quả**. Đây là chỗ dễ hiểu nhầm nhất: dòng 3 là chapter **mới**, chỉ "tới lượt" chứ không bị phạt; dòng 5 là chapter **đã từng chuyển giao** và thực sự bị ngừng cộng sao.
>
> Trong bảng này, **"mùa ứng viên"** = mùa của cửa sổ chứa `at`; mỗi mùa phải trùng **đúng một cửa sổ** `1/1–30/6` hoặc `1/7–31/12` ([1.2](#12-cửa-sổ-chuyển-giao)). Mùa thiếu **không** làm chapter chưa từng chuyển giao bị ngừng thưởng.

### 2.4 Ví dụ số

**Ví dụ 1 — chapter mới, bỏ qua mốc, vẫn nhận sao.**

Chapter thành lập **10/1/2026**. Cửa sổ `1/1–30/6` có mốc `1/4/2026`.

| Thời điểm xét                            | Đã từng chuyển giao? | Kết quả                                                                                    |
| -------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `1/5/2026` (mốc `1/4` đã qua)         | ❌ Chưa                 | `TRANSFER_OVERDUE` nhưng **`paused = false`** → **vẫn nhận sao**         |
| `15/8/2026` (đã sang cửa sổ tháng 10) | ❌ Chưa                 | Vẫn **nhận sao** — chapter chưa từng chuyển giao thì cơ chế ngừng chưa bật |
| `20/3/2027` (đã qua 3 mốc)              | ❌ Chưa                 | Vẫn **nhận sao**                                                                     |

**Ví dụ 2 — sau lần chuyển giao đầu tiên, cơ chế ngừng bật.**

Cũng chapter đó, chuyển giao **20/3/2026** (cửa sổ `1/1–30/6`, mốc `1/4`).

| Thời điểm xét                            | Đã từng chuyển giao? | Kết quả                                                                    |
| -------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `20/3/2026`                                | ✅ Vừa xong             | `TRANSFER_APPLIED` — không ngừng                                        |
| `1/5/2026`                                 | ✅ Có (`20/3`)        | Có apply trong `[1/1, 1/5]` → **không ngừng**                    |
| `15/8/2026`                                | ✅ Có (`20/3`)        | Cửa sổ `1/7–31/12` chưa có lần nào → **NGỪNG từ `1/10`** |
| `15/10/2026` (vừa chuyển giao `15/10`) | ✅ Có                   | Có apply trong `[1/7, 15/10]` → **cộng sao lại từ `15/10`**   |

Đây chính là "lần chuyển giao đầu tiên khoá chapter vào cơ chế ngừng sao".

✅ Test `src/test/chapter-six-month-transfer.test.ts` đã được viết lại theo cửa sổ chuẩn; các ca cũ dùng mùa `1/9–31/10` và `INITIAL_SEASON_SKIPPED` đã bị xoá.

### 2.5 Chapter nhiệm kỳ đầu vẫn đóng kết quả thi đua cuối nhiệm kỳ

Chapter chưa chuyển giao **vẫn đóng kết quả thi đua** ở cuối mỗi nhiệm kỳ (`1/4 → 1/10` và `1/10 → 1/4`, xem [1.5](#15-nhiệm-kỳ-khác-cửa-sổ)), **nhưng không reset học/sao**.
📄 `docs/business-rules.md` (dòng 103)

🔧 **Ngoài phạm vi P0–P4:** hành vi "đóng kết quả cuối nhiệm kỳ" chỉ đúng nếu `chapter_competition_terms` là **khung cố định theo mốc**. Hiện mã vẫn mở nhiệm kỳ tại thời điểm apply ([1.5](#15-nhiệm-kỳ-khác-cửa-sổ)); việc chuyển sang khung cố định cần một thay đổi riêng.

---

## Phần 3 — Khi chuyển giao xảy ra (apply)

### 3.1 Hai đường vào

1. **Tới hạn**: worker gọi `applyDueChapterReorganizations()` **mỗi 60 giây** ([1.9](#19-ai-chạy-khi-tới-hạn--worker-cron-và-lịch-chuyển-giao)), chọn các đợt `SCHEDULED` có `effective_at <= now`, sắp xếp sớm nhất trước.
2. **Áp dụng ngay**: bấm "⚡ Áp dụng ngay bây giờ" → `applyDueChapterReorganizations(new Date(), batchId, true)` — bỏ qua điều kiện `effective_at <= now`.

✅ `src/lib/chapter-reorganizations.ts:9-15`, `src/app/api/v1/chapters/[chapterId]/reorganizations/[batchId]/route.ts:34-43`

Nếu batch đã `APPLIED`, API trả thành công ngay (idempotent). Nếu batch không phải `SCHEDULED` → `409 TransferNotScheduled`.

### 3.2 Diễn biến trong **một giao dịch** (Serializable, timeout 30s)

✅ `src/lib/chapter-reorganizations.ts:16-131`

| Bước | Việc làm                                                                                                                                                                                                                                                              | Dòng        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1      | Khoá hàng chapter (`FOR UPDATE`) và hàng batch                                                                                                                                                                                                                    | `:17-18`   |
| 2      | Đọc lại batch; nếu trạng thái đã đổi → bỏ qua an toàn                                                                                                                                                                                                      | `:19-20`   |
| 3      | Đọc roster hiện tại của chapter                                                                                                                                                                                                                                    | `:21-22`   |
| 4      | Khoá từng người trong roster                                                                                                                                                                                                                                        | `:24`      |
| 5      | Lấy **giờ đồng hồ DB thật** (`clock_timestamp()`), **không backdate**                                                                                                                                                                              | `:26-31`   |
| 6      | Nếu có người trong sheet **đã rời chapter** → `TransferMemberNoLongerInChapter`                                                                                                                                                                         | `:34`      |
| 7      | Mỗi cửa sổ chuyển giao chỉ có **một** batch `APPLIED`; batch chưa gắn mùa phải khớp **duy nhất** một mùa đang phủ `effective_at`; DB có partial unique index `chapter_transfers_one_applied_season` làm lớp chặn thứ hai                                                       | `:36-55`   |
| 8      | Ghi snapshot `BEFORE_TRANSFER` (khoá `transfer:{batchId}`): roster, chức vụ đang mở, tiến độ bài học                                                                                                                                                      | `:56-62`   |
| 9      | Batch → `APPLIED`, gán `applied_at`, `transfer_season_id`, xoá `last_error`, tăng `apply_attempts`                                                                                                                                                        | `:63`      |
| 10     | Chốt thống kê nhiệm kỳ thực tế (`captureChapterActualTerm`)                                                                                                                                                                                                    | `:64`      |
| 11     | Đóng nhiệm kỳ thi đua đang mở (`ends_at = appliedAt`), mở nhiệm kỳ mới bắt đầu `appliedAt` (`ends_at` để trống) 🔧 xem [1.5](#15-nhiệm-kỳ-khác-cửa-sổ)                                                                                       | `:65-66`   |
| 12     | **Với từng thành viên**: đóng chu kỳ học cũ → mở chu kỳ mới (khoá `transfer:{batchId}:{userId}`) → hủy attempt `IN_PROGRESS` (`LEARNING_CYCLE_RESET`) → xoá tiến độ bài học hiển thị → kết thúc assignment + yêu cầu bổ trợ | `:67-76`   |
| 13     | Đẩy sự kiện đồng bộ lộ trình qua outbox cho từng người                                                                                                                                                                                                      | `:77`      |
| 14     | Lấy `now = appliedAt` để **không backdate** phần còn lại                                                                                                                                                                                                 | `:78-79`   |
| 15     | Cập nhật `current_term_number` của chapter theo `term_number` của batch                                                                                                                                                                                         | `:80-85`   |
| 16     | Kiểm tra Ban/vị trí còn hợp lệ; tối đa **1 `PRESIDENT`**/chapter; `PRESIDENT` phải đúng vị trí `PRESIDENT` 🔧                                                                                                                                  | `:86-102`  |
| 17     | Cập nhật `display_name` nếu sheet có tên mới                                                                                                                                                                                                                    | `:104-112` |
| 18     | Kết thúc **toàn bộ** Ban và chức vụ cũ trong các Ban của chapter                                                                                                                                                                                        | `:114-125` |
| 19     | Kết thúc vị trí `PRESIDENT` cũ của chapter                                                                                                                                                                                                                      | `:126`     |
| 20     | Tạo membership Ban mới + position assignment mới theo sheet                                                                                                                                                                                                          | `:127-129` |
| 21     | Lỗi bất kỳ → ghi `last_error` (cắt 2000 ký tự; riêng vi phạm unique index đổi thành thông điệp nghiệp vụ) + tăng `apply_attempts`; batch **vẫn `SCHEDULED`** để thử lại                                                                                                                                   | `:133-135` |

### 3.3 Hệ quả với người học

| Điều gì                      | Kết quả                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Sao đã nhận                  | **Giữ nguyên** — không xoá sổ                                                        |
| Lịch sử học / tiến độ cũ | **Giữ nguyên** (chu kỳ cũ chỉ bị đóng `ends_at`, không xoá)                    |
| Tiến độ bài học hiển thị | **Về 0** — `lesson_progress` là bản chiếu tương thích, bị xoá cờ hoàn thành |
| Bài kiểm tra đang làm       | **Bị hủy** với lý do `LEARNING_CYCLE_RESET`                                          |
| Video đã xem                  | Phải **xem lại từ đầu** trong chu kỳ mới mới nhận sao tháng mới                 |
| Cộng bù (backpay)             | **Không có**                                                                             |

✅ `src/lib/chapter-reorganizations.ts:65-76`, 📄 `docs/business-rules.md` (dòng 101-102)

### 3.4 Chống trùng lặp và an toàn khi lỗi

- 🔒 **Rào chắn DB**: partial unique index `chapter_transfers_one_applied_season` trên `(chapter_id, transfer_season_id)` khi `status = 'APPLIED'` (migration `prisma/migrations/20261022_learning_guards/migration.sql`). Index bảo vệ thêm sau kiểm tra cửa sổ trong transaction; batch cũ `APPLIED` chưa gắn mùa không nằm trong index nhưng không có đường API tạo mới trạng thái đó.
- 🧪 `scripts/test/test-transfer-guard.cjs` — P2002 từ index được đổi thành thông điệp "Giai đoạn này đã có một lần chuyển giao..." trong `last_error`, không lộ chuỗi Prisma thô; lỗi khác giữ nguyên nội dung.
- 🧪 `scripts/test/test-transfer-admin-view.cjs` — progress chỉ trả một giai đoạn đã chọn kèm phân trang/lọc, lịch sử chapter trả tổng số lần và tối đa 50 bản ghi; non-ADMIN nhận `403 AccessDenied` ở cả hai endpoint.
- 🧪 `scripts/test/test-chapter-transfer-integration.cjs:30` — lịch ở tương lai **không** reset (`= 0`).
- 🧪 `:33` — hai lời gọi "áp dụng ngay" **song song** chỉ cho 1 lần thành công.
- 🧪 `:37` — gọi lại lần ba trả `0`, **không reset lần hai**.
- 🧪 `scripts/test/test-learning-cycles-integration.cjs:199-200` — gọi hai lần liên tiếp cũng chỉ reset một lần.
- 🧪 `scripts/test/test-reward-pause-integration.cjs:84` — DNA reset retry không chạy lại.

### 3.5 Ví dụ số

Chuyển giao **15/10/2026 20:00** — thuộc cửa sổ `1/7–31/12`, mốc chuẩn hóa `1/10/2026 00:00`:

- Nhiệm kỳ thi đua cũ đóng `ends_at = 15/10/2026 20:00`; nhiệm kỳ mới mở từ đúng thời điểm đó.
- Nếu worker chạy trễ 2 ngày (17/10 09:00), `applied_at = 17/10 09:00` — **không** backdate về 15/10.
- Attempt đang làm dở ngày 15/10 → hủy.
- **Sao của khoảng `1/10 → 15/10` KHÔNG được cộng** — với điều kiện chapter **đã từng** chuyển giao. Lý do: cửa sổ `1/7–31/12` chưa có lần chuyển giao nào trước `15/10`, nên chapter đang bị **ngừng cộng sao từ mốc `1/10`** ([1.3](#13-ngừng-cộng-sao-từ-mốc-liên-tục-cho-tới-khi-chuyển-giao)). Sao chỉ **bắt đầu cộng lại từ `15/10 20:00`**.
  - Ngoại lệ: nếu chapter **chưa từng** chuyển giao lần nào thì `1/10 → 15/10` **vẫn có sao** bình thường ([2.2](#22-chapter-chưa-từng-chuyển-giao-thì-không-bao-giờ-ngừng-cộng-sao)).
- **Không cộng bù** khoảng đã mất. Vẫn học bình thường trong khoảng đó, chỉ là không sinh sao.
- Thành viên không có tên trong sheet → mất Ban, về "chưa phân Ban" (không bị xoá khỏi Chapter).
  📄 `docs/business-rules.md` (dòng 102)

---

## Phần 4 — Khi KHÔNG chuyển giao

### 4.1 Nguyên tắc gốc

Cổng kiểm tra thưởng là `chapterRewardState(tx, userId, at)`.
✅ `src/lib/chapter-reward-gate.ts:21-100`

Nó thoát sớm **không ngừng thưởng** (`paused: false`) trong các trường hợp:

| Trường hợp                                                     | Dòng      |
| ----------------------------------------------------------------- | ---------- |
| Người dùng có tư cách DNA đang hoạt động                | `:37-38` |
| Người dùng không có dòng `chapter_members`                | `:39-40` |
| Không tìm thấy chapter                                         | `:41-42` |

Nghĩa là: **thành viên DNA không bao giờ bị ngừng thưởng**; và cơ chế ngừng thưởng chỉ áp cho người đang thuộc một chapter. Không còn điều kiện policy/cutover.

### 4.2 Chưa từng chuyển giao → **vẫn nhận sao**

Nếu không tìm thấy mùa ứng viên và chapter **chưa từng** apply, hệ thống gọi `evaluateChapterTransferEligibility` với `candidateSeason: null` → luôn trả `paused: false`.
✅ `src/lib/chapter-reward-gate.ts:67-81`

⚠️ **Hệ quả rất cụ thể:** mùa thiếu **không còn** là lý do ngừng thưởng. Cổng kiểm tra thưởng chỉ ngừng khi chapter **đã từng** chuyển giao và **không có** bằng chứng chuyển giao trong khoảng đang xét. Chapter mới thành lập **không bao giờ** bị ngừng chỉ vì chưa cấu hình mùa.

### 4.3 Chuyển giao sớm hợp lệ không bị reset lại ở mốc

Nếu đã có lần apply `APPLIED` với **thời gian chuyển giao thực tế** `T_thực = min(effective_at, applied_at)` nằm trong khoảng `[đầu cửa sổ của mốc đã qua, at]`, hệ thống trả `TRANSFER_APPLIED`, **không ngừng thưởng** — bảo vệ trường hợp chuyển giao sớm rồi tới mốc vẫn không bị coi là quá hạn.
✅ `src/lib/chapter-term-rules.ts`, `src/lib/chapter-reward-gate.ts`

✅ **Đã sửa:** mã không còn so `applied_at >= boundary`; khoảng xét bắt đầu từ **đầu cửa sổ** và dùng `T_thực`, nên đúng cả nửa đầu lẫn nửa sau của cửa sổ.

### 4.4 Đã từng chuyển giao và quá hạn → **ngừng cộng sao**

| Điều gì                     | Kết quả                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Cộng sao video                | **Dừng** — `chapterRewardState` là cổng chặn ở `video-heartbeat.ts:238`                   |
| Cộng sao quiz                 | **Dừng** — `quiz-submission.ts:119`                                                             |
| Ghi nhận tiến độ học      | **Vẫn ghi** — người học không bị chặn học                                                  |
| Cộng bù sau khi chuyển giao | **Không** — sao trong khoảng bị ngừng **mất vĩnh viễn**                               |
| Thông điệp hiển thị       | `CHAPTER_TRANSFER_OVERDUE`: *"Chapter chưa hoàn tất chuyển giao nên thưởng đang tạm dừng."* |

✅ `src/lib/learning-readiness-rules.ts:10`, `src/lib/learning-periods.ts:94`, `src/app/api/v1/lessons/[lessonId]/progress/route.ts:202`, `src/app/api/v1/learning/me/route.ts:17`

### 4.5 Lỗi / phi cấu hình mùa

| Mã lý do                         | Thông điệp hiển thị                                                |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `TRANSFER_SEASON_NOT_CONFIGURED` | "Chưa cấu hình mùa chuyển giao cho giai đoạn này." (không còn dùng để ngừng thưởng) |
| `CHAPTER_TRANSFER_OVERDUE`       | "Chapter chưa hoàn tất chuyển giao nên thưởng đang tạm dừng." |
| `TERM_NOT_CONFIGURED`            | "Chưa khởi tạo nhiệm kỳ Chapter phù hợp."                        |
| `SEASON_NOT_CONFIGURED`          | "Chưa khởi tạo mùa chuyển giao phù hợp."                         |
| `CYCLE_NOT_STARTED`              | "Chưa có chu kỳ học; tiến độ lịch sử được giữ riêng."       |
| `MONTH_NOT_CONFIGURED`           | "Chưa khởi tạo tháng thi đua phù hợp."                             |

✅ `src/lib/learning-readiness-rules.ts:1-15`

### 4.6 Có lịch nhưng chưa tới giờ / bị hủy

| Tình huống                                              | Hệ quả                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Batch `SCHEDULED`, chưa tới `effective_at`          | Chưa reset gì; UI hiện đếm ngược. 🧪 `test-chapter-transfer-integration.cjs:30`                                       |
| Mỗi chapter chỉ được **1** lịch `SCHEDULED` | Tạo lịch thứ hai → `409 ScheduledReorganizationExists` ✅ `reorganizations/route.ts`                                   |
| Hủy lịch (`DELETE /reorganizations/[batchId]`)        | Batch → `CANCELLED` + `cancelled_at`; **không reset gì** ✅ `[batchId]/route.ts:76-79`                          |
| Apply thất bại                                          | Batch **vẫn `SCHEDULED`**, ghi `last_error`, UI hiện lỗi để thử lại ✅ `chapter-reorganizations.ts:121-123` |

### 4.7 Ví dụ số

Chapter A đã chuyển giao ngày **15/4/2026** (thuộc cửa sổ `1/1–30/6`, mốc `1/4/2026`). Sang cửa sổ `1/7–31/12` chapter **không** chuyển giao, nên tới mốc **1/10/2026** thì ngừng cộng sao:

- Từ 1/10/2026: mọi sao video/quiz **không được cộng**; người học vẫn xem bài, vẫn ghi tiến độ.
- Ngày 20/10/2026 chuyển giao thành công: sao **chỉ được cộng lại từ 20/10**.
- Sao của khoảng **1/10 → 20/10 mất vĩnh viễn**, không cộng bù.
- Đây là chapter **đã từng** chuyển giao (ngày `15/4`). Nếu là chapter **chưa từng** chuyển giao thì `1/10 → 20/10` **vẫn có sao** — xem [2.2](#22-chapter-chưa-từng-chuyển-giao-thì-không-bao-giờ-ngừng-cộng-sao).
- 📄 `docs/business-rules.md` (dòng 101): *"vẫn học, không backpay"*

---

## Phần 5 — Điểm bảng xếp hạng trong thời kỳ chuyển giao

### 5.1 Công thức chính thức

✅ `src/lib/competition-ranking-rules.ts:31-44` (chú thích gốc trong mã), `:45-141`

| Loại tháng                         | Điểm chapter                   |
| ------------------------------------ | -------------------------------- |
| Tháng thường (1 stage)            | `S_m = A_m / N_m`              |
| Tháng có chuyển giao (≥ 2 stage) | `S_m = A₁/N₁ + A₂/N₂ + …` |

Trong đó `A_i` = tổng sao hợp lệ trong stage `i`, `N_i` = số thành viên snapshot của stage `i`.

### 5.2 Tháng chuyển giao bị **chia stage** tại thời điểm apply

Một tháng bị tách thành nhiều stage tại mỗi lần chuyển giao `APPLIED` rơi vào giữa tháng (`applied_at > month.starts_at && applied_at < month.ends_at`).
✅ `src/lib/competition-snapshots.ts` (`historicalChapterMonthRows`)

Nghĩa là: **chuyển giao giữa tháng không "trộn" hai bộ người khác nhau vào một phép chia**.

### 5.3 Số người và tỷ lệ 70% là bình quân **gia quyền theo thời lượng**

```ts
elapsed    = Σ (endsAt - startsAt)
personTime = Σ (duration × memberCount)
qualifiedTime = Σ (duration × qualifiedCount)

averageMemberCount = personTime / elapsed
at70Rate = qualifiedTime / personTime
```

✅ `src/lib/competition-ranking-rules.ts:64-96`, `:108`

**Không** dùng trung bình cộng `(N₁+N₂)/2`.

#### "70% bài core" là 70% của cái gì?

Đây là chỗ dễ hiểu sai nhất, nên nói rõ: **70% chỉ tính trên 3 chương trình học chính thức**, không tính chương trình khuyến khích.

| Chương trình                                              | Mã             | Có tính vào 70%? |
| ------------------------------------------------------------ | --------------- | ------------------- |
| Chương trình học cho **Thành viên** (hội viên) | `CORE_MEMBER` | ✅ Có              |
| Chương trình học cho **LT**                        | `CORE_LEADER` | ✅ Có              |
| Chương trình học cho **DNA**                       | `CORE_DNA`    | ✅ Có              |
| Chương trình học **mở rộng / khuyến khích**    | `EXTENDED`    | ❌ **Không** |

Công thức:

```
tỷ lệ đạt = số bài core đã hoàn thành / tổng số bài core phải học
```

- Tử số và mẫu số **chỉ** lấy bài thuộc 3 chương trình `CORE_MEMBER`, `CORE_LEADER`, `CORE_DNA`.
- Học thêm bao nhiêu bài khuyến khích (`EXTENDED`) cũng **không** kéo tỷ lệ này lên.
- Nếu chapter **không có** bài core nào → ghi lý do `CORE_LESSONS_ZERO`, không tính là 0%.

✅ `src/lib/learning-catalog.ts:1-6` (định nghĩa `is_core`), `src/lib/competition-snapshots.ts:85` (chỉ lấy 3 chương trình core), `:265-272` (`completed / coreIds >= 0.7`)

### 5.4 Ba điều kiện dự xếp hạng

| Điều kiện                   | Ngưỡng                                   | Mã lý do khi không đạt                                       |
| ------------------------------ | ------------------------------------------ | ----------------------------------------------------------------- |
| Số người bình quân        | **> 20** (`GT`)                    | `MEMBER_COUNT_NOT_ABOVE_20` (nếu 0 người → `ROSTER_ZERO`) |
| Tỷ lệ đạt ≥ 70% bài core | **≥ 50%** (`GTE`)                 | `CORE_COMPLETION_BELOW_50_PERCENT`                              |
| KPI                            | thuộc `YELLOW` hoặc `GREEN` (`IN`) | `WAITING_KPI` (chưa có) / `KPI_NOT_ELIGIBLE`                |
| (dữ liệu)                    | còn phải có bài core                   | `CORE_LESSONS_ZERO`                                             |

✅ `src/lib/competition-ranking-rules.ts:23-28`, `:113-123`

Thiếu dữ liệu → ghi **lý do loại**, **không** tính thành điểm 0.

### 5.5 Điểm cá nhân và xử hòa

- Điểm cá nhân = **tổng sao trong kỳ**.
- Hòa điểm xử theo **giây** thời điểm đạt tổng sao cuối (`firstReachedFinalBalance`, chỉ tính ledger `provenance: 'NATIVE'`).
- Bằng nhau hoàn toàn → **cùng hạng** (ví dụ 1–2–2–4).
- Dung sai so sánh số thực: `1e-12`.
- Xếp hạng chapter còn xử hòa theo term rồi theo `chapterId.localeCompare`.

✅ `src/lib/competition-snapshots.ts` (hằng `CHAPTER_FORMULA`, `INDIVIDUAL_FORMULA`, logic tie-break)

### 5.6 Ai được vào bảng xếp hạng

```ts
if (role !== 'MEMBER' || positionCodes.some(c => ['DNA_LEAD','DNA_MANAGER','CHAPTER_LEAD','CHAPTER_MANAGER','TT','TRAINEE'].includes(c))) return null
if (dna) return 'DNA'
return positionCodes.some(c => ['PRESIDENT','CHAPTER_PRESIDENT','DEPARTMENT_LEAD','DEPARTMENT_LEADER'].includes(c)) ? 'LT' : 'MEMBER'
```

✅ `src/lib/competition-ranking-rules.ts:143-147`

| Nhóm                          | Ai                                                                                                 | Nhận sao? |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ---------- |
| **Bị loại** (`null`) | `ADMIN`; `LEAD` (`CHAPTER_LEAD`, `DNA_LEAD`); và `DNA_MEMBER` đang ở vị trí `TT`  | ❌ Không  |
| **DNA**                  | Người có tư cách DNA (thuộc đơn vị `DNA` / `DNA_GROUP`), trừ `DNA_LEAD` và `TT` | ✅ Có     |
| **LT**                   | `PRESIDENT`, `DEPARTMENT_LEAD` (7 ban)                                                         | ✅ Có     |
| **MEMBER**               | `MEMBER_CHAPTER` (thành viên ban, 7 ban)                                                       | ✅ Có     |

Ba cấp vai trò `ADMIN` / `LEAD` / `MEMBER` đã định nghĩa ở [0.1](#01-ba-cấp-vai-trò); bảng trên chỉ là **cách chia nhỏ cấp `MEMBER`** trên bảng xếp hạng.

**Vì sao `TT` bị loại khỏi bảng xếp hạng nhưng vẫn nhận sao?** `TT` là thành viên DNA, vẫn học và vẫn tích sao bình thường; chỉ là không xuất hiện trên bảng xếp hạng hệ thống. Đây là chủ đích, **không phải lỗi**.

**Vì sao `PRESIDENT` nằm ở nhóm LT?** `PRESIDENT` là vị trí cấp Chapter, thuộc nhóm LT và **vẫn nhận sao** như LT.

**Bảng ánh xạ nhãn nghiệp vụ ↔ mã trong dữ liệu** — dùng khi đọc mã hoặc tra DB:

| Nhãn nghiệp vụ        | `position.code` trong DB                      | Ghi chú                                                                                                       |
| ------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PRESIDENT`            | `CHAPTER_PRESIDENT`                           | 🔧 sẽ thống nhất về `PRESIDENT` — [7.2](#72-các-chỗ-cần-sửa-mã-để-khớp-quy-tắc-chuẩn) dòng 15 |
| `DEPARTMENT_LEAD` (LT) | `DEPARTMENT_LEAD` hoặc `DEPARTMENT_LEADER` | Hai mã cùng nghĩa                                                                                           |
| `MEMBER_CHAPTER`       | `MEMBER`                                      | Chỉ đổi **cách gọi**, dữ liệu giữ nguyên                                                        |
| `DNA_MEMBER`           | `TT`, `SGDC`, `LDC`                       | 3 vị trí DNA                                                                                                 |
| `CHAPTER_LEAD`         | `CHAPTER_LEAD` hoặc `CHAPTER_MANAGER`      | `CHAPTER_MANAGER` là alias — xem [7.4](#74-alias-chaptermanager-vẫn-được-nhận-sao)                     |
| `DNA_LEAD`             | `DNA_LEAD` hoặc `DNA_MANAGER`              |                                                                                                                |

**Cách xác định một người đang giữ vai trò nào** (trả lời cho câu "làm sao biết ai là LEAD, ai là MEMBER"):

1. Đọc các dòng `position_assignments` **còn hiệu lực** của người đó (`ends_at IS NULL`).
2. Nếu có `DNA_LEAD` / `DNA_MANAGER` → **`LEAD`** (cụ thể `LEAD_DNA`).
3. Nếu có `CHAPTER_LEAD` / `CHAPTER_MANAGER` → **`LEAD`** (cụ thể `LEAD_CHAPTER`).
4. Còn lại → **`MEMBER`**, rồi chia nhóm theo bảng ánh xạ ở trên.

Không dùng cột `role` để trả lời câu này: `role` chỉ phân biệt `ADMIN` / `CHAPTER_LEADER` / `MEMBER`, và người giữ vị trí `DNA_LEAD` vẫn mang `role = 'MEMBER'`. Xem thêm [0.2](#02-vị-trí-và-các-ban-được-lưu-ở-đâu).

Admin/Lead quản trị **không** nhận sao/BXH.
⚠️ Riêng alias `CHAPTER_MANAGER` đã bị loại khỏi BXH nhưng **vẫn được nhận sao** — lỗi predicate đã ghi nhận ([Phần 7.4](#74-alias-chaptermanager-vẫn-được-nhận-sao)).
⚠️ Mã `TRAINEE` trong danh sách loại trừ là **mã thừa** — nó chính là `DNA_MEMBER -> TT`, và `TT` đã có sẵn trong cùng danh sách. **Không xoá vội**: phải kiểm tra dữ liệu `positions` trước ([7.2](#72-các-chỗ-cần-sửa-mã-để-khớp-quy-tắc-chuẩn) dòng 16).

### 5.7 Ảnh hưởng của việc dịch chuyển người giữa tháng

| Tình huống                                      | Hệ quả                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Người rời chapter giữa tháng                 | Bị loại khỏi `memberCount` của stage tương ứng; sao của người đó không còn tính cho chapter |
| Người vào DNA                                  | Bị loại khỏi BXH Chapter                                                                                  |
| Người vào DNA **giữa kỳ tính điểm** | Sao kiếm được **trước khi vào** vẫn được tính cho DNA trong kỳ đó                       |
| Người chuyển Chapter → DNA                    | Chấm dứt Ban/chức vụ/quyền Chapter, **giữ sao, tiến độ, lịch sử**                           |
| Tháng **đã đóng**                      | **Không tính lại** — phục vụ từ snapshot bất biến                                             |

📄 `docs/business-rules.md` (dòng 23) ✅ `src/lib/competition-snapshots.ts` (`captureDueRankingSnapshots` từ chối dựng lại snapshot đã `FINALIZED`)

### 5.8 Nhiệm kỳ thực tế (ACTUAL_TERM) **không** xếp hạng

- `ACTUAL_TERM` chỉ cho phép ở nhóm `CHAPTER` và **chỉ để thống kê**.
- Không gộp các khoảng thi đua rời nhau thành một bảng xếp hạng.
- Key thống kê: `statistics:CHAPTER:{termId}`, kind `CHAPTER_ACTUAL_TERM`, bỏ qua nếu đã tồn tại.

✅ `src/lib/chapter-actual-terms.ts`, `src/lib/period-leaderboard.ts` (ràng buộc nhóm `CHAPTER`)

### 5.9 Ví dụ số đầy đủ

Chapter **đã từng** chuyển giao (lần gần nhất `15/4/2026`), nay chuyển giao tiếp **15/10/2026 20:00**. Tháng 10 tách 2 stage tại đúng thời điểm apply:

| Stage | Khoảng                 | Số ngày | Số người `N_i` | Sao `A_i` | Đạt 70% core `Q_i` |
| ----- | ----------------------- | --------- | ------------------- | ----------- | ---------------------- |
| 1     | `1/10 → 15/10 20:00` | 14        | 25                  | **0** | 15                     |
| 2     | `15/10 20:00 → 1/11` | 17        | 20                  | 30          | 10                     |

**Vì sao `A₁ = 0`?** Đây là chỗ dễ sai nhất. Cửa sổ `1/7–31/12` có mốc `1/10`; chapter **chưa** chuyển giao trong cửa sổ này trước `15/10`, nên **đang bị ngừng cộng sao từ `1/10`** ([1.3](#13-ngừng-cộng-sao-từ-mốc-liên-tục-cho-tới-khi-chuyển-giao)). Vậy khoảng `1/10 → 15/10 20:00` **không sinh ra sao nào**. Sao chỉ bắt đầu cộng lại từ `15/10 20:00`.

> Nếu chapter **chưa từng** chuyển giao lần nào thì ngược lại: khoảng `1/10 → 15/10` **vẫn có sao** bình thường ([2.2](#22-chapter-chưa-từng-chuyển-giao-thì-không-bao-giờ-ngừng-cộng-sao)). Ví dụ dưới đây áp dụng cho chapter **đã từng** chuyển giao.

**Điểm chapter:**

```
S₁₀ = A₁/N₁ + A₂/N₂ = 0/25 + 30/20 = 0 + 1,5 = 1,5
```

❌ Nếu tính gộp (sai): `(0+30)/(25+20) = 0,667` → chênh lệch rất lớn. **Đây là điểm khác biệt cốt lõi của tháng chuyển giao**: mỗi stage chia cho số người **của chính stage đó**, không gộp mẫu số.

**Số người bình quân** — vẫn tính trên **cả tháng**, kể cả stage không có sao:

```
personTime = 25×14 + 20×17 = 350 + 340 = 690
elapsed    = 14 + 17 = 31
N_avg      = 690/31 ≈ 22,26  →  > 20  ✅ đạt
```

**Tỷ lệ đạt 70% core** — chỉ tính trên 3 chương trình `CORE_MEMBER`, `CORE_LEADER`, `CORE_DNA` ([5.3](#53-số-người-và-tỷ-lệ-70-là-bình-quân-gia-quyền-theo-thời-lượng)):

```
qualifiedTime = 15×14 + 10×17 = 210 + 170 = 380
at70Rate      = 380/690 ≈ 0,5507  →  55,07%  ≥ 50%  ✅ đạt
```

**Kết luận:** nếu KPI tháng 10 là `YELLOW` hoặc `GREEN` → chapter **đủ điều kiện xếp hạng** với điểm **1,5**.

**Phản ví dụ — khi stage 1 kéo tỷ lệ xuống:** giữ nguyên số người và số ngày, nhưng `Q₁ = 0` (không ai đạt 70% core trong nửa đầu tháng):

```
qualifiedTime = 0×14 + 10×17 = 170
at70Rate      = 170/690 ≈ 0,2464  →  24,64%  < 50%  ❌ KHÔNG đạt
```

Chapter bị loại với lý do `CORE_COMPLETION_BELOW_50_PERCENT`, **dù stage 2 có tỷ lệ đạt 50%**. Đây là lý do phải gia quyền theo **thời lượng**: stage nào chiếm nhiều thời gian hơn thì ảnh hưởng nhiều hơn.

---

## Phần 6 — Bảng quyết định tổng hợp

```
Chapter có tư cách DNA?  ── Có ──►  Không bao giờ ngừng thưởng; vào BXH nhóm DNA
        │ Không
        ▼
Người dùng thuộc Chapter?  ── Không ──►  Không ngừng thưởng
        │ Có
        ▼
Đã có chuyển giao thực tế trong khoảng [S(t), t]?  ── Có ──►  TRANSFER_APPLIED — không ngừng
        │ Không
        ▼
Chapter đã từng chuyển giao?  ── Không ──►  Không ngừng (nhiệm kỳ đầu)
        │ Có
        ▼
paused(t)?  ── Có ──►  NGỪNG THƯỞNG (CHAPTER_TRANSFER_OVERDUE)
        │ Không
        ▼
Có lịch trong cửa sổ hiện tại?  ── Có ──►  TRANSFER_SCHEDULED — không ngừng
        │ Không
        ▼
INITIAL_NOT_DUE — không ngừng
```

✅ Sơ đồ trên khớp `evaluateChapterTransferEligibility(...)` sau đợt P0–P4. Mùa chỉ dùng để xác định cửa sổ và trạng thái đặt lịch; **mùa thiếu không tự động ngừng thưởng**.

---

## Phần 7 — Điểm cần chốt

### 7.1 Lỗi nút "Chuyển giao nhiệm kỳ" ở role Lead Chapter

> ✅ **Trạng thái sau đợt P0–P4:** nút đặt lịch đã dùng chung một đường tra mùa theo cửa sổ và trả **đúng lý do** (thiếu mùa, trùng mùa, mùa chưa phủ hết, mùa 6 tháng cũ, mốc lệch). Phần dưới giữ lại để đối chiếu lịch sử chẩn đoán; các câu "hiện tại" mô tả mã **trước** khi sửa.

**Hiện tượng bạn báo:** bấm nút chuyển giao nhiệm kỳ ở role Lead Chapter thì báo lỗi *"phải cấu hình thời gian"* trong khi đã cấu hình rồi.

**Có 2 thông điệp khác nhau có thể gây ra cảm giác này — cần phân biệt trước tiên:**

| # | Thông điệp                                                          | Nguồn                                                                   | Điều kiện kích hoạt chính xác                                                                                                                                                                                                                                                                                                    |
| - | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A | "Admin cần cấu hình mùa chuyển giao cho thời điểm đã chọn." | Trước P0–P4: `TransferSeasonNotConfigured` tại `reorganizations/route.ts` | Policy đã kích hoạt **và** số mùa phủ `effectiveAt` **≠ 1**                                                                                                                                                                                                                                                      |
| B | "Chưa cấu hình mùa chuyển giao…" (nay chỉ là thông tin, **không** ngừng thưởng) | `TRANSFER_SEASON_NOT_CONFIGURED`, ✅ `src/lib/chapter-reward-gate.ts` | Trước P0–P4: policy đã kích hoạt + chapter **đã từng** chuyển giao + không có mùa khớp đúng mốc. Sau P0–P4: mùa thiếu **không** làm chapter chưa từng chuyển giao bị ngừng thưởng |

**Nguyên nhân chắc chắn đã xác định (cả A và B):** điều kiện kiểm tra **gộp nhiều tình huống khác nhau vào một thông điệp "chưa cấu hình"**, nên khi mùa *đã có* nhưng không khớp điều kiện, người dùng vẫn bị báo là "chưa cấu hình". Cụ thể:

- **A**: `seasons.length !== 1` gộp chung *0 mùa*, *nhiều mùa chồng lấn*, và *chọn giờ nằm ngoài mọi mùa* → cùng một câu thông báo. Trước P0–P4: `chapter-reorganizations.ts`, `reorganizations/route.ts`.
- **B**: tra mùa bằng **so khớp bằng đúng** `reward_boundary_at`, nên lệch dù chỉ 1 giây là "không thấy mùa". Trước P0–P4: `chapter-reward-gate.ts`.

**Đính chính so với nhận định trước của tôi:** giả thuyết *"`effectiveAt` bị lệch 7 giờ do trừ offset rồi parse lại"* là **SAI**. Luồng thực tế là:

1. `now.setMinutes(now.getMinutes() - now.getTimezoneOffset())` → đẩy sang **giờ tường địa phương**.
2. `.toISOString().slice(0,16)` → chuỗi `"YYYY-MM-DDTHH:mm"` **không kèm múi giờ**.
3. Khi submit, `new Date("YYYY-MM-DDTHH:mm")` được **parse theo giờ địa phương**, rồi `.toISOString()` gửi **mốc tuyệt đối đúng**.

✅ `src/app/chapter-manager/term-transition/useTermTransition.ts:46-50`, `:613-669`

→ Với trình duyệt ở `Asia/Bangkok`, giá trị gửi lên **đúng**, không lệch 7 giờ. Không nên đi theo hướng này.

**Nghi vấn chính còn lại:** **mùa đã cấu hình không phủ khoảng thời gian của `effectiveAt`** — đúng như mâu thuẫn các định nghĩa mùa ở [1.8](#18-dữ-liệu-mẫu-và-các-định-nghĩa-mùa). Ví dụ nếu mùa được cấu hình theo mô hình 2 tháng cũ (`1/3–30/4`, `1/9–31/10`), thì mọi thao tác chuyển giao ngoài 2 cửa sổ đó đều báo lỗi A. Mô hình 2 tháng đã bị bỏ khỏi tài liệu ngày 29/10/2026, nhưng **dữ liệu mùa trong DB có thể vẫn còn theo mô hình cũ** — cần kiểm tra bằng 2 câu SQL read-only bên dưới.

**Cách kiểm tra nhanh (chạy read-only trên DB):**

```sql
-- Kiểm tra A: mùa phủ thời điểm đã chọn ($1 = effectiveAt người dùng chọn)
-- Kỳ vọng: ĐÚNG 1 dòng
SELECT code, starts_at, ends_at, reward_boundary_at
FROM transfer_seasons
WHERE starts_at <= $1 AND ends_at > $1;

-- Kiểm tra B: mốc thưởng có khớp đúng mốc 1/4 hoặc 1/10 00:00 giờ VN **đã qua** gần nhất không
-- ($2 = mốc thưởng đúng của mùa: 1/4 hoặc 1/10 lúc 00:00 giờ VN)
SELECT code, reward_boundary_at
FROM transfer_seasons
WHERE reward_boundary_at = $2;
```

Kết quả mong đợi khi mọi thứ đúng: **mỗi truy vấn trả đúng 1 dòng**.
Nếu truy vấn 1 trả 0 dòng → lỗi **A** (mùa không phủ thời điểm).
Nếu truy vấn 2 trả 0 dòng trong khi truy vấn 1 trả 1 dòng → lỗi **B** (mốc thưởng lệch, thường do cấu hình `31/10 23:59:59` thay vì `1/10 00:00`).

> Để chốt được nguyên nhân, cần thêm: **thời điểm bạn bấm nút** và **kết quả 2 truy vấn trên** với dữ liệu mùa thật. Không có 2 thông tin này thì chỉ xác định được cơ chế, không xác định được nguyên nhân cuối cùng.

### 7.2 Các chỗ cần sửa mã để khớp quy tắc chuẩn

Tổng hợp mọi điểm đã đánh dấu 🔧 trong tài liệu. **Đợt P0–P4 đã xử lý các dòng 1–6, 8, 9, 11–14.** Các dòng 7, 15–17 vẫn nằm ngoài phạm vi và cần một thay đổi riêng.

| #  | Chỗ cần sửa                                                                                                                                                                          | Hiện tại                                                                                                                                                        | Phải thành                                                                                                                                                                                  | Mức độ |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1  | `src/lib/chapter-reward-gate.ts` (`chapterRewardBoundary`) | ✅ **Đã tách helper:** giữ mốc **đã qua** cho ngừng thưởng/DNA; thêm `anchorNearest`/`windowOf` cho đặt lịch | Hai nghĩa mốc dùng đúng nơi — [1.7](#17-hai-hàm-mốc-và-phạm-vi-sử-dụng) | ✅ Xong |
| 2  | `src/lib/chapter-reward-gate.ts` | ✅ Dùng `T_thực = min(effective_at, applied_at)` và khoảng `[S(t), t]` | công thức `paused(t)` — [1.3](#13-ngừng-cộng-sao-từ-mốc-liên-tục-cho-tới-khi-chuyển-giao) | ✅ Xong |
| 3  | `src/lib/chapter-reward-gate.ts` | ✅ `resolveSeasonForWindow(...)` tra theo cửa sổ chứa `t` | tra mùa theo cửa sổ — [1.6](#16-mùa-do-admin-cấu-hình) | ✅ Xong |
| 4  | `src/lib/chapter-term-rules.ts` | ✅ `evaluateChapterTransferEligibility` dùng `paused(t)` và lịch sử `APPLIED` | cùng công thức — [2.3](#23-bảng-quyết-định-đầy-đủ) | ✅ Xong |
| 5  | Chặn trùng | ✅ Chặn theo **cửa sổ** của `effective_at` | tối đa 1 lần mỗi cửa sổ — [1.4](#14-chặn-trùng-một-lần-mỗi-cửa-sổ) | ✅ Xong |
| 6  | `src/app/api/v1/admin/learning-policy/route.ts` | ✅ Buộc `starts_at`/`ends_at` trùng đúng cửa sổ chuẩn | như mô tả — [1.6](#16-mùa-do-admin-cấu-hình) | ✅ Xong |
| 7  | `chapter_competition_terms` (`chapter-reorganizations.ts`; đọc ở `competition-snapshots.ts`, `period-leaderboard.ts`) | vẫn mở tại thời điểm apply | mở/đóng theo nhiệm kỳ cố định — [1.5](#15-nhiệm-kỳ-khác-cửa-sổ) | 🔧 Ngoài P0–P4 |
| 8  | `scripts/db/seed-rich-demo.ts` | ✅ Seed dùng `1/1–30/6` / `1/7–31/12` | như mô tả — [1.8](#18-dữ-liệu-mẫu-và-các-định-nghĩa-mùa) | ✅ Xong |
| 9  | `src/test/chapter-six-month-transfer.test.ts` | ✅ Đã viết lại theo cửa sổ chuẩn | mốc `1/4`/`1/10` 00:00 — [2.4](#24-ví-dụ-số) | ✅ Xong |
| 10 | `docs/business-rules.md` | ✅ Đã sửa 29/10/2026 | `1/1–30/6`, `1/7–31/12` — [1.2](#12-cửa-sổ-chuyển-giao) | ✅ Xong |
| 11 | `src/lib/dna-cycle-resets.ts` | ✅ Dùng helper `anchorElapsed` / `chapterRewardBoundary` | tách helper mốc đã qua — [1.10](#110-dna-reset-độc-lập) | ✅ Xong |
| 12 | `src/app/api/v1/admin/learning-policy/route.ts` | ✅ Đã bỏ nhánh cutover; chỉ còn cấu hình season/mapping | như mô tả — [1.6](#16-mùa-do-admin-cấu-hình) | ✅ Xong |
| 13 | `src/test/learning-cycles.test.ts` + `src/test/transfer-windows.test.ts` | ✅ Giữ test mốc đã qua; thêm test riêng cho mốc gần nhất | như mô tả | ✅ Xong |
| 14 | `src/lib/chapter-term-rules.ts` | ✅ Đã xoá `firstEligibleAt` + `INITIAL_SEASON_SKIPPED` | chapter mới chuyển giao ngay — [2.1](#21-chapter-mới-chuyển-giao-được-ngay-không-phải-chờ) | ✅ Xong |
| 15 | `CHAPTER_PRESIDENT` → `PRESIDENT` (7 file mã + 2 migration + 3 test + 1 component + 1 trang admin)                                                                                | hai mã cho cùng một vị trí: `CHAPTER_PRESIDENT` trong dữ liệu, `PRESIDENT` ở vài danh sách                                                          | **một mã duy nhất `PRESIDENT`** — [5.6](#56-ai-được-vào-bảng-xếp-hạng)                                                                                                      | 🟠 Vừa   |
| 16 | `TRAINEE` trong 4 danh sách loại trừ (`competition-ranking-rules.ts:144`, `leaderboard/route.ts:35-43`, `chapters/[chapterId]/route.ts:69`, `dna-leaderboard/route.ts:23`) | mã **thừa** — chính là `DNA_MEMBER -> TT`, mà `TT` đã có trong cùng danh sách                                                                | xoá `TRAINEE` **sau khi** kiểm tra `SELECT code FROM positions WHERE code = 'TRAINEE'` trả về 0 dòng — [5.6](#56-ai-được-vào-bảng-xếp-hạng)                             | 🟡 Thấp  |
| 17 | `src/lib/learning-periods.ts:88-92`                                                                                                                                                   | danh sách chặn sao thiếu `CHAPTER_MANAGER` (trong khi `manager-learning-access.ts:12` có)                                                                 | thêm `CHAPTER_MANAGER` để alias không còn nhận sao — [7.4](#74-alias-chaptermanager-vẫn-được-nhận-sao)                                                                           | 🟠 Vừa   |

> **Kết quả đợt P0–P4:** các dòng 1–6, 8, 9, 11–14 đã xong. Dòng 7 (`chapter_competition_terms` cố định), 15–17 (đổi mã vị trí, xoá `TRAINEE`, alias `CHAPTER_MANAGER`) **không nằm trong phạm vi** và vẫn cần xử lý riêng.

✅ **Kiểm tra hồi quy:** `chapter-initial-rewards`, `learning-cycles` và `transfer-windows` (mới) đã chạy qua; `chapter-six-month-transfer` và các script integration đã được cập nhật nhưng chưa chạy trong môi trường hiện tại vì thiếu `TEST_DATABASE_URL` trỏ tới `bbe_test_learning_cycles`.

> **Lưu ý về tương thích:** `chapterRewardBoundary` **vẫn giữ nghĩa mốc đã qua**; không đổi hàm này sang mốc gần nhất. Việc đặt lịch dùng `anchorNearest` / `windowOf`. Nhờ vậy DNA reset và cổng ngừng thưởng không bị dịch mốc trong nửa đầu mỗi cửa sổ.

### 7.3 Phân điểm nhiệm kỳ: code ra **4**, sổ tay muốn **10**

Chuyển giao `15/9`, stage chia điểm `4` + `6`. Sổ tay (bản cũ) muốn **10** điểm thuộc nhiệm kỳ kết thúc `30/9`; mã hiện trả **4**. Hàm phân theo actual-term/stage.

✅ **Đã chốt ngày 29/10/2026: mã trả `4` là ĐÚNG, sổ tay sai.** Chuyển giao `15/9` chuẩn hóa về mốc `1/10`, nên nhiệm kỳ vừa kết thúc là `1/4 → 1/10` và nhiệm kỳ mới là `1/10 → 1/4`. Khung `30/9` không tồn tại trong mô hình chuẩn ([1.5](#15-nhiệm-kỳ-khác-cửa-sổ)); sổ tay đã được sửa theo khung này. 📄 `docs/known-issues.md:13` đã cập nhật kết luận tương ứng.

### 7.4 Alias CHAPTER_MANAGER vẫn được nhận sao

Người có `role = 'MEMBER'` nhưng giữ vị trí `CHAPTER_MANAGER`: `competitionGroup` **đã loại** khỏi BXH, nhưng `rewardEligibility` **vẫn cho nhận sao** do thiếu alias trong danh sách loại trừ.

Cụ thể hai danh sách lệch nhau:

| Nơi kiểm tra                            | Danh sách chặn                                                     | Có `CHAPTER_MANAGER`? |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------ |
| `src/lib/manager-learning-access.ts:12` | `DNA_LEAD`, `DNA_MANAGER`, `CHAPTER_LEAD`, `CHAPTER_MANAGER` | ✅ Có                   |
| `src/lib/learning-periods.ts:88-92`     | `DNA_LEAD`, `DNA_MANAGER`, `CHAPTER_LEAD`                      | ❌ **Thiếu**      |

Hệ quả: người giữ `CHAPTER_MANAGER` **không** được coi là learning manager ở đường cộng sao ⇒ **vẫn nhận sao**, trái với quy tắc "Lead không nhận sao".

🔧 **Cần sửa mã:** thêm `CHAPTER_MANAGER` vào `learning-periods.ts:88-92` ([7.2](#72-các-chỗ-cần-sửa-mã-để-khớp-quy-tắc-chuẩn) dòng 17).
⚠️ `docs/known-issues.md:12`

### 7.5 GET có tác dụng phụ ghi dữ liệu

`GET /reorganizations`, `/current-roster`, `dashboard/members` **tự áp dụng** batch đến hạn. Fixture có batch `SCHEDULED` đã chuyển thành `APPLIED` sau các GET Admin. Đây là hành vi hiện hữu, cần xác nhận có giữ hay không.
⚠️ `docs/known-issues.md:21`

### 7.6 Phạm vi chưa kiểm chứng

- Toàn bộ nội dung tài liệu này dựa trên **đọc mã + test tự động**, **chưa** đối chiếu dữ liệu production.
- Supabase không truy cập được từ môi trường soạn tài liệu (lỗi TLS), nên không xác minh được cấu hình policy/mùa thật.
- Cutover đã bỏ khỏi runtime; chưa đối chiếu dữ liệu legacy thật với mốc `learning_policy.cutover_at` trên production.
  ⚠️ `docs/known-issues.md:32-33`

---

## Phần 8 — Truy vết nguồn

| Quy tắc                                                                        | Nguồn                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mốc chuẩn hóa 1/4, 1/10 00:00 giờ VN                                        | `src/lib/transfer-windows.ts` (`anchorNearest`, `anchorElapsed`)                                                                                                                                                                                                  |
| Cửa sổ chuẩn hóa `1/1–30/6` / `1/7–31/12`                             | ✅ `src/lib/transfer-windows.ts` (`windowOf`, `windowOfAnchor`)                                                                                                                                                                                                   |
| Nhiệm kỳ thi đua = **mốc + 6 tháng** (`1/4→1/10` / `1/10→1/4`) | **Ngoài phạm vi P0–P4** — nhiệm kỳ vẫn mở tại thời điểm apply; xem [1.5](#15-nhiệm-kỳ-khác-cửa-sổ)                                                                                                                              |
| Cổng ngừng thưởng, thoát sớm, tra mùa                                    | `src/lib/chapter-reward-gate.ts:21-100`                                                                                                                                                                                                                           |
| Kết thúc mùa DNA (+6 tháng)                                                 | `src/lib/chapter-reward-gate.ts:15-18`                                                                                                                                                                                                                            |
| Ba cấp vai trò `ADMIN` / `LEAD` / `MEMBER`                              | **Quy tắc nghiệp vụ**; suy ra từ `position.code` qua `src/lib/manager-learning-access.ts:5-19` — xem [0.1](#01-ba-cấp-vai-trò)                                                                                                                      |
| Vị trí và Ban lưu ở đâu                                                  | `prisma/schema.prisma:657-756` (`OrganizationUnit`, `OrganizationMembership`, `Position`, `PositionAssignment`) — xem [0.2](#02-vị-trí-và-các-ban-được-lưu-ở-đâu)                                                                              |
| 7 Ban chuẩn + nhóm DNA `TT`/`SGDC`/`LDC`                                | `src/lib/learning-catalog.ts:8-11`, `src/lib/normalize-learning-organization.ts:14-45`                                                                                                                                                                          |
| Danh mục chương trình học + `is_core`                                    | `src/lib/learning-catalog.ts:1-6`                                                                                                                                                                                                                                 |
| Phạm vi 70%: chỉ `CORE_MEMBER`/`CORE_LEADER`/`CORE_DNA`                 | `src/lib/competition-snapshots.ts:85`, `:265-272` — xem [5.3](#53-số-người-và-tỷ-lệ-70-là-bình-quân-gia-quyền-theo-thời-lượng)                                                                                                                     |
| Quy tắc 6 tháng lịch (❌ đã bỏ)                                           | ✅ Đã xoá khỏi `src/lib/chapter-term-rules.ts`; không còn `firstEligibleAt` / `INITIAL_SEASON_SKIPPED`                                                                                                                 |
| Bảng quyết định trạng thái chuyển giao                                   | `src/lib/chapter-term-rules.ts:114-235`                                                                                                                                                                                                                           |
| Nhiệm kỳ đầu không ngừng thưởng khi quá hạn                           | `src/lib/chapter-term-rules.ts:210-234`                                                                                                                                                                                                                           |
| Quy trình apply nguyên tử                                                    | `src/lib/chapter-reorganizations.ts:7-126`                                                                                                                                                                                                                        |
| Reset chu kỳ học từng thành viên                                           | `src/lib/chapter-reorganizations.ts:54-63`                                                                                                                                                                                                                        |
| Ràng buộc mùa khi apply                                                      | ✅ `src/lib/chapter-reorganizations.ts` — tra theo cửa sổ của `effective_at`, giữ liên kết mùa cũ nếu đã có                                                                                                                    |
| Ghi lỗi + tăng `apply_attempts`                                             | `src/lib/chapter-reorganizations.ts:121-123`                                                                                                                                                                                                                      |
| Công thức điểm chapter (1 stage / nhiều stage)                             | `src/lib/competition-ranking-rules.ts:31-141`                                                                                                                                                                                                                     |
| Điều kiện dự xếp hạng                                                     | `src/lib/competition-ranking-rules.ts:23-28`, `:113-123`                                                                                                                                                                                                        |
| Nhóm thi đấu                                                                 | `src/lib/competition-ranking-rules.ts:143-147`                                                                                                                                                                                                                    |
| Tách stage theo chuyển giao trong tháng                                      | `src/lib/competition-snapshots.ts` (`historicalChapterMonthRows`)                                                                                                                                                                                               |
| Bất biến snapshot                                                             | `src/lib/competition-snapshots.ts` (`captureDueRankingSnapshots`)                                                                                                                                                                                               |
| Nhiệm kỳ thực tế chỉ thống kê                                            | `src/lib/chapter-actual-terms.ts`                                                                                                                                                                                                                                 |
| DNA reset độc lập                                                            | ✅ `src/lib/dna-cycle-resets.ts` dùng `chapterRewardBoundary` (mốc **đã qua**) — xem [1.10](#110-dna-reset-độc-lập)                                                                                                                                       |
| Thông điệp lý do hiển thị                                                 | `src/lib/learning-readiness-rules.ts:1-12`                                                                                                                                                                                                                        |
| Cổng chặn ở video/quiz/tiến độ                                            | `src/lib/video-heartbeat.ts:238`, `src/lib/quiz-submission.ts:119`, `src/app/api/v1/lessons/[lessonId]/progress/route.ts:202`, `src/lib/learning-periods.ts:94`                                                                                             |
| Validate cấu hình mùa của Admin                                             | ✅ `src/lib/transfer-season-lookup.ts` (`checkSeasonConfiguration`), `src/app/api/v1/admin/learning-policy/route.ts`                                                                                                                                   |
| Tạo lịch chuyển giao (validate)                                              | `src/app/api/v1/chapters/[chapterId]/reorganizations/route.ts:64-216`                                                                                                                                                                                             |
| Áp dụng ngay / hủy lịch                                                     | `src/app/api/v1/chapters/[chapterId]/reorganizations/[batchId]/route.ts`                                                                                                                                                                                          |
| Cron apply                                                                      | `vercel.json:11`, `src/app/api/internal/organization/reorganizations/apply/route.ts`                                                                                                                                                                            |
| Worker 60 giây, chống chồng lấn, timeout 55s                                | `scripts/learning-scheduler.mjs:7-24` — xem [1.9](#19-ai-chạy-khi-tới-hạn--worker-cron-và-lịch-chuyển-giao)                                                                                                                                                 |
| Chọn đợt đến hạn (`effective_at <= now`, sớm nhất trước)            | `src/lib/chapter-reorganizations.ts:7-12`                                                                                                                                                                                                                         |
| "Áp dụng ngay" khi lịch ≤ 60 giây                                          | `src/app/api/v1/chapters/[chapterId]/reorganizations/route.ts:216`, `:273-275`                                                                                                                                                                                  |
| Không backdate `applied_at`                                                  | `src/lib/chapter-reorganizations.ts`; thời gian nghiệp vụ = `min(effective_at, applied_at)` trong `src/lib/transfer-windows.ts`                                                                                                                      |
| Chỉ 1 đợt `SCHEDULED` mỗi chapter                                         | `src/app/api/v1/chapters/[chapterId]/reorganizations/route.ts:162-179`                                                                                                                                                                                            |
| Seed mùa (đã dùng cửa sổ chuẩn)                                           | ✅ `scripts/db/seed-rich-demo.ts`                                                                                                                                                                                                                                |
| Test 6 tháng / nhiệm kỳ đầu (đã viết lại)                                | ✅ `src/test/chapter-six-month-transfer.test.ts`, `src/test/chapter-initial-rewards.test.ts`, `src/test/transfer-windows.test.ts`                                                                                                                          |
| Test apply nguyên tử                                                          | `scripts/test/test-chapter-transfer-integration.cjs`                                                                                                                                                                                                              |
| Test chu kỳ học                                                               | `scripts/test/test-learning-cycles-integration.cjs`                                                                                                                                                                                                               |
| Test ngừng thưởng                                                            | `scripts/test/test-reward-pause-integration.cjs`                                                                                                                                                                                                                  |
| Lỗi đã ghi nhận                                                             | `docs/known-issues.md:11-13`, `:21`                                                                                                                                                                                                                             |

---

*Tài liệu này mô tả hành vi sau đợt P0–P4 trên nhánh `chore/consolidate-docs-refactor`. Các mục đã sửa được đánh dấu ✅; các mục còn lại ngoài phạm vi (P5, khung nhiệm kỳ cố định) được đánh dấu 🔧 và gom ở [Phần 7.2](#72-các-chỗ-cần-sửa-mã-để-khớp-quy-tắc-chuẩn).*
