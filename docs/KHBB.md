# KHBB — Toàn bộ nghiệp vụ Khóa học bắt buộc

> **Ngày biên soạn:** 29/10/2026.
>
> **Phạm vi:** cách một khóa học trở thành “bắt buộc”, ai bị ràng buộc, hạn hoàn thành được tính thế nào, mọi trường hợp Admin thay đổi cấu hình/nội dung/thời gian, tác động lên người học, quá hạn/khóa tài khoản, chuyển giao chu kỳ và các điểm còn lệch giữa đặc tả với mã.
>
> **Không nằm trong tài liệu này:** không sửa mã, schema, dữ liệu, quyền hay công thức nghiệp vụ. Mô hình deadline chung là mô hình duy nhất đang chạy; dữ liệu legacy chỉ còn được đọc để giữ lịch sử.
>
> **Cách đọc:** viết bằng ngôn ngữ người dùng trước, thuật ngữ kỹ thuật sau. Mỗi quy tắc quan trọng có ví dụ số và nguồn `file:line`. Luồng **hiện hành** (deadline chung) là luồng chính; khác biệt của **dữ liệu legacy** được giải thích ở mục 3.12.

**Nhãn kiểm chứng dùng trong tài liệu**

| Nhãn | Nghĩa |
|---|---|
| [ĐẶC TẢ] | Quy tắc đã chốt trong `docs/reference/handbook-formulas.md` hoặc `docs/business-rules.md`. |
| [MÃ] | Hành vi đọc trực tiếp từ mã đang chạy. |
| [TEST] | Có test tự động chứng minh hành vi. |
| [LỆCH] | Đặc tả và mã hiện tại khác nhau. |
| [CHƯA XÁC NHẬN] | Chưa kiểm chứng production, hoặc chưa đủ căn cứ để khẳng định ý định nghiệp vụ. |

---

## Bảng tra nhanh

| Câu hỏi | Trả lời ngắn | Chi tiết |
|---|---|---|
| Ai bị ràng buộc? | Không phải “role” trong DB. Hệ thống dùng **18 đối tượng học** suy ra từ đơn vị và chức vụ đang hiệu lực; một người có thể khớp nhiều đối tượng. | Phần 1 |
| “Bắt buộc” được định hình ra sao? | Không có cờ `is_mandatory` trên khóa học. Bắt buộc = **rule đang hiệu lực** khớp người học, sau đó được **materialize** thành assignment cho từng người/chu kỳ. | Phần 2 |
| Mỗi khóa có một hạn riêng không? | **Không**. Mỗi chu kỳ có **một hạn chung**; số ngày của từng khóa chỉ là **ngân sách ngày** đóng góp vào hạn chung. | Phần 3.1 |
| Hạn được tính như thế nào? | Khởi tạo: `D_start + T_new`. Khi đổi tập nghĩa vụ: `max(D_start + T_new, D_change + T_added)`. | Phần 3 |
| Admin thêm khóa bắt buộc? | Tạo/thêm assignment; hạn chung được tính lại; khóa mới góp `T_added` nhưng không được “cộng dồn” vào hạn cũ. Người đang bị khóa **không tự mở khóa**. | Phần 4.1 |
| Admin bỏ khóa? | Assignment kết thúc, tiến độ giữ nguyên; hạn chung tính lại và **có thể tụt về đúng lúc thay đổi**, không có sàn 3 ngày. | Phần 4.2, 5 |
| Admin tăng/giảm số ngày? | Tăng: tính lại toàn bộ kế hoạch từ `D_start`. Giảm: có sàn 3 ngày kể từ lúc Admin đổi. | Phần 4.3, 4.4 |
| Admin gia hạn tay? | `max(now, hạn hiện tại) + N ngày`; cập nhật mọi assignment bắt buộc chưa xong; gỡ restriction `DEADLINE`; mở khóa nếu không còn lý do khác. | Phần 4.6 |
| Khóa đã học xong mà Admin thêm vào? | Assignment được đánh dấu `COMPLETED`, người học không phải học lại. Tuy nhiên khóa đã xong vẫn nằm trong `T_new`, nên hạn chung **có thể vẫn dịch** nếu còn khóa khác chưa xong. | Phần 4.1.3, 6 |
| Chưa học tới mà Admin thêm vào? | Assignment mới, tiến độ cũ không mất; người học nhận ngân sách của khóa mới tính từ lúc thay đổi, nhưng không thấp hơn tổng kế hoạch từ `D_start`. | Phần 4.1.1, 6 |
| Quá hạn thì sao? | Cron đánh `OVERDUE`, khóa tài khoản người không phải Admin và tạo `AccessRestriction` loại `DEADLINE`. Admin không bị khóa tự động. | Phần 4.6, 7.5 |
| Làm sao mở khóa? | Chỉ Admin, qua luồng “Mở khóa & Gia hạn” (hoặc luồng kích hoạt tài khoản có nhập số ngày — hành vi khác, xem Phần 9). | Phần 4.6, 8.6 |
| Chuyển giao thì sao? | Đóng chu kỳ cũ, mở chu kỳ mới, reset tiến độ học, kết thúc assignment cũ; hạn mới được khởi tạo lại từ chu kỳ mới. | Phần 4.9 |
| Có khi nào thời gian giảm? | Có. Giảm ngân sách, bỏ khóa, thu hẹp vai trò, hoặc bất kỳ lần tính lại nào cũng có thể ghi đè một hạn đã được gia hạn tay. | Phần 5 |
| Sang tháng mới có reset không? | Không. Sang tháng chỉ mở cửa sổ thưởng mới; nghĩa vụ và hạn học không reset. | Phần 7.6 |

---

## Phần 0 — Từ điển, mô hình dữ liệu và luồng tổng quát

### 0.1 Từ điển

| Thuật ngữ | Nghĩa trong tài liệu |
|---|---|
| **Đối tượng học** (target) | Một trong 18 nhóm người học do hệ thống suy ra từ đơn vị/chức vụ, ví dụ `MEMBER_BTV`, `LEADER_BTV`, `CHAPTER_PRESIDENT`, `DNA_TT`. |
| **Rule** (`LearningRule`) | Cấu hình “khóa học này áp cho đối tượng/đơn vị/chức vụ nào, bắt buộc hay không, bao nhiêu ngày”. Rule có thời gian hiệu lực. |
| **Assignment** (`UserLearningAssignment`) | Nghĩa vụ cụ thể của **một người** với **một khóa** trong **một chu kỳ học**. Đây là nơi có trạng thái `ASSIGNED`, `COMPLETED`, `OVERDUE`… |
| **Chu kỳ học** (`LearningCycle`) | Đơn vị reset tiến độ của một người. Chuyển giao Chapter/DNA tạo chu kỳ mới. Sang tháng **không** tạo chu kỳ mới. |
| **Lộ trình học** (`LearningPath`) | Bản ghi một-hai với chu kỳ, giữ `starts_at`, `due_at`, ngân sách và fingerprint. |
| **Ngân sách ngày** (budget) | Số ngày cấu hình của một khóa, lấy từ `courses.mandatory_default_due_days`; là “phần đóng góp” vào hạn chung, không phải hạn riêng của khóa. |
| **Hạn chung** (shared deadline) | Một timestamp `learning_paths.due_at` dùng cho toàn bộ assignment bắt buộc chưa hoàn thành trong chu kỳ. |
| **Tập nghĩa vụ** (required set) | Tập các assignment `mandatory = true`, chưa `ended_at`, trong chu kỳ hiện tại. |
| **Materialize** | Quá trình biến rule cấu hình thành assignment cụ thể cho từng người. |
| **Reconcile** | Quá trình đối chiếu lại tập nghĩa vụ khi rule, đơn vị, chức vụ hoặc chu kỳ thay đổi; tạo/kết thúc assignment và tính lại hạn. |
| **Mốc lịch sử** (cutover cũ) | Dấu thời gian trong `learning_policy` dùng để nhận diện dữ liệu legacy và chặn phân bổ ngược về trước mốc. Đây **không còn là cổng kích hoạt** mô hình học. |
| **Quá hạn** (overdue) | Assignment bắt buộc còn hiệu lực, chưa hoàn thành, có `due_at < now`. |
| **Restriction** | Bản ghi chặn tài khoản. Loại `DEADLINE` là do quá hạn học; `DIRECT_ADMIN` và `CHAPTER_CASCADE` là các lý do độc lập. |

### 0.2 Ba lớp khái niệm dễ bị nhầm

1. **Role trong DB** — chỉ có ba giá trị: `ADMIN`, `CHAPTER_LEADER`, `MEMBER` (`prisma/schema.prisma:16-22`). Role quyết định quyền hệ thống và việc có bị khóa tự động hay không.
2. **Chức vụ/đơn vị** — lưu ở `position_assignments`, `organization_memberships`; đây mới là thứ quyết định **đối tượng học**.
3. **18 đối tượng học** — là cách chia để cấu hình khóa bắt buộc, không phải 18 role DB. Ma trận Admin có 18 cột vì lý do này.

Ngoài ra còn **4 chương trình học**: `CORE_MEMBER`, `CORE_LEADER`, `CORE_DNA`, `EXTENDED` (`src/lib/learning-catalog.ts:1-6`). Chương trình chỉ là **phân loại nội dung**; không quyết định bắt buộc. Một khóa `EXTENDED` vẫn có thể bị tick bắt buộc nếu Admin cấu hình.

### 0.3 Bảng dữ liệu chính

| Bảng / model | Giữ gì | Nguồn |
|---|---|---|
| `courses` | Trạng thái `DRAFT`/`PUBLISHED`, chương trình, **`mandatory_default_due_days`** (mặc định 30) | `prisma/schema.prisma:310-337`, đặc biệt `:325` |
| `learning_rules` | Course, target/đơn vị/chức vụ, `mandatory`, các quyền, `due_days`, thời gian hiệu lực | `prisma/schema.prisma:758-782` |
| `user_learning_assignments` | Nghĩa vụ theo người/khóa/chu kỳ; trạng thái, `due_at`, `assigned_at`, `completed_at`, `ended_at` | `prisma/schema.prisma:784-813` |
| `learning_cycles` | Chu kỳ học của từng người; `starts_at`, `ends_at`, `provenance` | `prisma/schema.prisma:983-1000` |
| `learning_paths` | Hạn chung, ngân sách, fingerprint | `prisma/schema.prisma:1048-1059` |
| `learning_path_changes` | Lịch sử tính lại hạn của lộ trình | `prisma/schema.prisma:1061-1071` |
| `course_requirement_versions` | Ảnh chụp bài học/quiz/final tại mỗi lần publish | `prisma/schema.prisma:1116-1127` |
| `course_publication_events` | Lịch sử publish | `prisma/schema.prisma` (model `CoursePublicationEvent`) |
| `learning_notices` | Thông báo nội dung bổ sung | `prisma/schema.prisma:1146-1156` |
| `access_restrictions` | Chặn tài khoản, gồm loại `DEADLINE` | `prisma/schema.prisma:815-836` |
| `learning_outbox` | Hàng đợi reconcile bất đồng bộ | `prisma/schema.prisma:1073-1084` |
| `learning_policy` | Dữ liệu lịch sử của mốc chuyển mô hình; không còn dùng làm cổng kích hoạt | `prisma/schema.prisma:941-947` |

### 0.4 Luồng tổng quát

```text
Admin tick ma trận (18 đối tượng)
        |
        v
LearningRule (course + target/đơn vị/chức vụ + số ngày + hiệu lực)
        |
        v
Reconcile cho từng người: rule nào đang hiệu lực và khớp?
        |
        v
UserLearningAssignment (mỗi người × khóa × chu kỳ)
        |
        v
LearningPath: một hạn chung = f(ngân sách các khóa, mốc bắt đầu, mốc thay đổi)
        |
        +--> Người học thấy badge/countdown
        |
        +--> Cron hằng ngày: quá hạn -> OVERDUE -> khóa tài khoản (trừ Admin)
        |
        +--> Admin “Mở khóa & Gia hạn” -> hạn mới + gỡ restriction DEADLINE
```

### 0.5 Mức kiểm chứng

- Quy tắc công thức lấy từ sổ tay đã chốt (`docs/reference/handbook-formulas.md:292-374`) và `docs/business-rules.md:55-71`.
- Hành vi mã lấy từ các file được ghi nguồn tại từng mục.
- Test công thức: `src/test/shared-learning-path.test.ts:33-101` và `src/test/learning-cycles.test.ts:39-74`.
- Điểm lệch đã biết: `docs/known-issues.md:9-17`.

---

## Phần 1 — Ai bị ràng buộc?

### 1.1 Ba role trong DB

| Role DB | Có tự động bị khóa vì quá hạn? | Có nghĩa vụ bắt buộc? | Ghi chú |
|---|---|---|---|
| `ADMIN` | **Không**. `canDeadlineLockAccount` trả `false` cho Admin (`src/lib/account-restriction-rules.ts:12-14`); cron cũng bỏ qua tài khoản Admin (`src/app/api/internal/learning/deadlines/enforce/route.ts:53-58`). | Có thể có assignment nếu Admin cũng có membership/position khớp rule, nhưng assignment chỉ chuyển `OVERDUE`, không khóa. | Không dùng quyền Admin để suy ra không có nghĩa vụ. |
| `CHAPTER_LEADER` | **Có**, nếu có assignment quá hạn. | Chỉ khi có đơn vị/chức vụ khớp một trong 18 đối tượng, hoặc khớp rule legacy không có `target_code`. | Bản thân role `CHAPTER_LEADER` không tạo ra đối tượng học. |
| `MEMBER` | **Có**. | Tùy đơn vị/chức vụ. | Đây là role phổ biến của người học. |
| Khách chưa đăng nhập | Không có tài khoản, không có assignment. | Không. | Chỉ xem nội dung công khai theo quy tắc hiện hành. |

Điểm quan trọng: **đổi `User.role` từ `MEMBER` sang `CHAPTER_LEADER` không làm thay đổi tập khóa bắt buộc**, vì tập này suy ra từ đơn vị/chức vụ, không từ role. Role chỉ ảnh hưởng quyền và việc có bị khóa tự động hay không.

### 1.2 Mười tám đối tượng học

Bảy ban chuẩn: `BTV`, `BTK`, `BND`, `BCL`, `BDH`, `BKM`, `BTTSK` (`src/lib/learning-catalog.ts:8-11`).

| # | Mã target | Nhãn | Ai khớp |
|---|---|---|---|
| 1 | `MEMBER_BTV` | Thành viên Ban Thành Viên | Membership `ACTIVE` vào đơn vị `DEPARTMENT` mã `BTV`, **không** giữ chức vụ lead trong ban đó. |
| 2 | `MEMBER_BTK` | Thành viên Ban Thư Ký | Tương tự, ban `BTK`. |
| 3 | `MEMBER_BND` | Thành viên Ban Nội Dung | Tương tự, ban `BND`. |
| 4 | `MEMBER_BCL` | Thành viên Ban Chất Lượng | Tương tự, ban `BCL`. |
| 5 | `MEMBER_BDH` | Thành viên Ban Định Hướng | Tương tự, ban `BDH`. |
| 6 | `MEMBER_BKM` | Thành viên Ban Khách Mời | Tương tự, ban `BKM`. |
| 7 | `MEMBER_BTTSK` | Thành viên Ban TT&SK | Tương tự, ban `BTTSK`. |
| 8 | `LEADER_BTV` | LT Ban Thành Viên | Membership vào ban `BTV` **và** chức vụ `DEPARTMENT_LEAD` hoặc `DEPARTMENT_LEADER` đang hiệu lực trong ban đó. |
| 9 | `LEADER_BTK` | LT Ban Thư Ký | Tương tự, ban `BTK`. |
| 10 | `LEADER_BND` | LT Ban Nội Dung | Tương tự, ban `BND`. |
| 11 | `LEADER_BCL` | LT Ban Chất Lượng | Tương tự, ban `BCL`. |
| 12 | `LEADER_BDH` | LT Ban Định Hướng | Tương tự, ban `BDH`. |
| 13 | `LEADER_BKM` | LT Ban Khách Mời | Tương tự, ban `BKM`. |
| 14 | `LEADER_BTTSK` | LT Ban TT&SK | Tương tự, ban `BTTSK`. |
| 15 | `CHAPTER_PRESIDENT` | Chủ tịch Chapter | Có chức vụ `CHAPTER_PRESIDENT` đang hiệu lực; không cần membership ban. |
| 16 | `DNA_TT` | DNA TT | Membership `ACTIVE` vào đơn vị `DNA_GROUP` mã `TT`. |
| 17 | `DNA_SGDC` | DNA SGDC | Membership `ACTIVE` vào đơn vị `DNA_GROUP` mã `SGDC`. |
| 18 | `DNA_LDC` | DNA LDC | Membership `ACTIVE` vào đơn vị `DNA_GROUP` mã `LDC`. |

Nguồn danh mục: `src/lib/learning-catalog.ts:13-18`. Nguồn cách suy ra: `src/lib/learning-targets.ts:3-18`.

### 1.3 Cách suy ra target từ dữ liệu tổ chức

`learningTargetsForUser()` đọc:

1. Các `organization_memberships` có `status = ACTIVE`, `starts_at <= now`, và `ends_at` trống hoặc lớn hơn `now`.
2. Các `position_assignments` có `starts_at <= now`, và `ends_at` trống hoặc lớn hơn `now`.

Sau đó:

- Với mỗi membership vào đơn vị `DEPARTMENT` có `code`:
  - Nếu người đó có chức vụ `DEPARTMENT_LEAD` hoặc `DEPARTMENT_LEADER` **trong cùng đơn vị** → thêm `LEADER_<mã ban>`.
  - Ngược lại → thêm `MEMBER_<mã ban>`.
  - **Chỉ thêm một trong hai**, không thêm đồng thời.
- Với mỗi membership vào đơn vị `DNA_GROUP` có `code` → thêm `DNA_<mã DNA>`.
- Nếu có bất kỳ chức vụ `CHAPTER_PRESIDENT` → thêm `CHAPTER_PRESIDENT`.

Hệ quả thực tế:

- Một người có membership ban A và giữ chức vụ lead ban B sẽ có `MEMBER_A` và `LEADER_B`.
- Một người giữ chức vụ lead ban A nhưng **không có membership** vào ban A sẽ **không** có `LEADER_A`, vì vòng lặp chạy theo membership.
- Membership vào đơn vị loại `DNA` (đơn vị cha) không tự sinh `DNA_<mã>`; mã DNA chỉ sinh từ `DNA_GROUP`.
- Chức vụ hết hiệu lực hoặc membership `ENDED` sẽ không còn sinh target; lần reconcile kế tiếp sẽ kết thúc nghĩa vụ tương ứng.

### 1.4 Phạm vi của rule

Một rule có thể được giới hạn bởi một hoặc nhiều điều kiện (`prisma/schema.prisma:758-782`):

- `target_code`: đối tượng học.
- `organization_unit_id`: đơn vị.
- `position_id`: chức vụ.
- `mandatory`, `can_view`, `can_assess`, `can_earn_stars`.
- `due_days` và thời gian hiệu lực `effective_from` / `effective_until`.

Một rule chỉ được áp dụng khi **tất cả** điều kiện không-null đều khớp (`src/lib/learning-assignments.ts:76-85`):

- Nếu có `target_code`, người học phải có target đó.
- Nếu có `organization_unit_id`, đơn vị của người học (membership hoặc đơn vị cha) phải nằm trong tập đơn vị khớp.
- Nếu có `position_id`, người học phải giữ chức vụ đó; khi rule có cả đơn vị, chức vụ phải nằm trong đơn vị đó hoặc đơn vị con (`src/lib/learning-rule-scope.ts:16-28`).

Rule **legacy không có `target_code`** chỉ dựa vào đơn vị/chức vụ. Nếu rule đó có phạm vi rộng, nó có thể áp cho cả người không thuộc 18 đối tượng dự kiến. Đây là lý do nên ưu tiên ma trận 18 đối tượng thay vì tạo rule tay.

### 1.5 Nhiều target/rule chồng lấn

Một người có thể khớp nhiều target và nhiều rule cho **cùng một khóa**. Hệ thống gộp theo khóa, không tạo nhiều assignment trùng (`src/lib/learning-assignments.ts:86-118`; ràng buộc unique `(user_id, course_id, learning_cycle_id)` ở `prisma/schema.prisma:812`):

- `mandatory` = **một rule bắt buộc là đủ** (`some`).
- `can_view`, `can_assess`, `can_earn_stars` = **tất cả rule phải cho phép** (`every`).

Hệ quả cần lưu ý:

- Một rule cho `can_view = false` sẽ **che quyền xem** của khóa dù rule khác cho `true`.
- Nếu một rule đặt `mandatory = true` nhưng `can_view = false`, người học có nghĩa vụ nhưng không thể mở khóa. Ma trận hiện luôn tạo quyền xem, nhưng API rule legacy có thể tạo tình huống này.

Ví dụ: Chủ tịch Chapter đồng thời là thành viên ban BTV có thể khớp `CHAPTER_PRESIDENT` và `MEMBER_BTV`. Khóa nào được tick cho cả hai target sẽ chỉ có **một** assignment, với `mandatory` và quyền được gộp như trên.

### 1.6 Bốn chương trình học

| Mã | Tên | Vai trò với bắt buộc |
|---|---|---|
| `CORE_MEMBER` | Chương trình học cho Thành viên | Phân loại nội dung; không tự tạo nghĩa vụ. |
| `CORE_LEADER` | Chương trình học cho LT | Phân loại nội dung; không tự tạo nghĩa vụ. |
| `CORE_DNA` | Chương trình học cho DNA | Phân loại nội dung; không tự tạo nghĩa vụ. |
| `EXTENDED` | Chương trình học mở rộng/khuyến khích | Có thể bị tick bắt buộc nếu Admin cấu hình; không có cơ chế tự loại trừ. |

Nguồn: `src/lib/learning-catalog.ts:1-6`. Việc gợi ý chương trình theo tên khóa chỉ là gợi ý, không phải phê duyệt (`src/lib/learning-catalog.ts:20-27`).

---

## Phần 2 — Một khóa trở thành “bắt buộc” như thế nào?

### 2.1 Không có cờ “bắt buộc” trên khóa học

`courses` không có cột `is_mandatory`. Trạng thái `PUBLISHED` chỉ có nghĩa là khóa đã xuất bản, **không** có nghĩa là bắt buộc. Một khóa chỉ trở thành bắt buộc khi:

1. Có **rule đang hiệu lực** trỏ tới khóa và khớp người học.
2. Rule đó có `mandatory = true`.
3. Hệ thống đã **materialize** rule thành assignment cho người học trong chu kỳ hiện tại.

Ba bước này độc lập. Vì vậy có thể có các trạng thái trung gian:

- Khóa đã publish nhưng chưa tick ma trận → không bắt buộc.
- Đã tick ma trận nhưng người học chưa được reconcile → chưa thấy nghĩa vụ.
- Có assignment nhưng `mandatory = false` → có quyền học, không có hạn bắt buộc.
- Có assignment bắt buộc nhưng khóa đang `DRAFT` → nghĩa vụ tồn tại nhưng người học có thể không mở được nội dung.

### 2.2 Vòng đời của rule

1. **Tạo**: Admin tick một ô trong ma trận, hoặc gọi API rule.
2. **Hiệu lực**: rule chỉ được dùng khi `effective_from <= now` và (`effective_until` trống hoặc `> now`) (`src/lib/learning-assignments.ts:38-42`).
3. **Đóng**: ma trận bỏ tick sẽ đặt `effective_until = now`; rule cũ không bị xóa để giữ lịch sử (`src/app/api/v1/admin/mandatory-matrix/route.ts:264-268`, `:319-323`).
4. **Tạo lại**: lần tick sau tạo rule mới; assignment có thể được “hồi sinh” từ assignment cũ đã kết thúc.

Rule tương lai (`effective_from > now`) chưa có tác dụng. Rule đã đóng không còn được dùng, kể cả khi dữ liệu assignment cũ vẫn còn.

### 2.3 Ma trận 18 đối tượng hoạt động thế nào?

Giao diện: `/admin/courses/mandatory`. API: `GET/PUT /api/v1/admin/mandatory-matrix`.

- Mỗi **hàng** là một khóa học. Mỗi hàng có **một số ngày chung** (`rowDefaults`) áp cho mọi ô được tick của khóa đó.
- Mỗi **cột** là một trong 18 target.
- Tick ô → tạo rule cho khóa đó với phạm vi của target.
- Bỏ tick → đóng rule đang hiệu lực của khóa/target đó.
- Lưu → trong một transaction:
  - đóng/tạo/cập nhật rule;
  - cập nhật `courses.mandatory_default_due_days`;
  - cập nhật `due_days` của tất cả rule đang hiệu lực của khóa;
  - ghi audit `UPDATE_MANDATORY_MATRIX`;
  - enqueue `RECONCILE_ASSIGNMENTS` cho **toàn bộ người dùng chưa anonymized** (`src/app/api/v1/admin/mandatory-matrix/route.ts:315-372`, đặc biệt `:346-359`).

Thông tin quan trọng:

- API kiểm tra `dueDays` là số nguyên từ **1 đến 3650** (`src/app/api/v1/admin/mandatory-matrix/route.ts:175`).
- Nếu target chưa có đơn vị/chức vụ tương ứng trong dữ liệu, API trả `409 ScopeNotConfigured` (`:184-196`).
- API **không kiểm tra trạng thái `PUBLISHED`** của khóa. Khóa `DRAFT` vẫn hiện trong ma trận và vẫn có thể được tick (`:126-165`).
- Với target LT, phạm vi ma trận dùng chức vụ mã `DEPARTMENT_LEAD`. Nếu môi trường chỉ có chức vụ `DEPARTMENT_LEADER`, target LT có thể không có scope và lưu sẽ báo `ScopeNotConfigured`; trong khi hàm suy ra target lại chấp nhận cả hai mã. Đây là điểm cần kiểm tra dữ liệu chức vụ thực tế.
- Ma trận không tạo thông báo cho người học khi khóa mới thành bắt buộc hoặc khi hạn đổi. Chỉ có thông báo khi **nội dung khóa được bổ sung** (xem 4.5).

### 2.4 Materialize: từ rule thành assignment

`reconcileAssignments()` (`src/lib/learning-assignments.ts:25-177`) làm các việc sau:

1. Khóa user và lấy ngữ cảnh học (`learningContext`). Nếu policy chưa active, chạy nhánh legacy.
2. Lấy membership, position đang hiệu lực và các rule đang hiệu lực.
3. Lọc rule khớp target/đơn vị/chức vụ.
4. Gộp rule theo `course_id`.
5. Với assignment hiện có trong chu kỳ mà khóa không còn trong tập rule → kết thúc:
   - `mandatory = false`, `ended_at = now`;
   - status `ENDED`, trừ khi đã hoàn thành thì giữ `COMPLETED`.
6. Với mỗi khóa trong tập rule:
   - Nếu đã có assignment → cập nhật cờ, quyền, giữ `completed_at`; status `COMPLETED` nếu đã xong, `OVERDUE` nếu đang quá hạn, ngược lại `ASSIGNED`.
   - Nếu chưa có → tạo assignment mới với `assigned_at = now`.
7. Đồng bộ hoàn thành cho từng khóa (`syncCourseAssignmentCompletion`).
8. Gọi `reconcileSharedPath()` để tính hạn chung.

Ràng buộc unique `(user_id, course_id, learning_cycle_id)` bảo đảm không có hai assignment cho cùng người/khóa/chu kỳ. Rule trùng được gộp, không nhân đôi thời gian.

### 2.5 Bảng trạng thái assignment

`LearningAssignmentStatus` (`prisma/schema.prisma:133-142`):

| Trạng thái | Nghĩa | Có bị tính quá hạn/khóa? |
|---|---|---|
| `ASSIGNED` | Đã giao, chưa hoàn thành. | Có, nếu `due_at < now`. |
| `IN_PROGRESS` | Đang thực hiện. Trong mã hiện tại, trạng thái này chủ yếu được đặt bởi luồng Admin gia hạn/mở khóa, không tự đổi khi người học bắt đầu xem bài. | Có. |
| `COMPLETED` | Đã hoàn thành đủ điều kiện. | Không. |
| `OVERDUE` | Đã quá hạn. | Không bị cron chuyển lại lần nữa, nhưng tài khoản có thể đã bị khóa; deadline API vẫn hiển thị. |
| `WAIVED` | Trạng thái có trong enum nhưng chưa thấy luồng gán trong mã hiện tại. | Không có hành vi xác định. |
| `ENDED` | Nghĩa vụ đã kết thúc do bỏ rule/đổi đơn vị. | Không. |

Lưu ý: bắt đầu học một bài **không** tự chuyển assignment từ `ASSIGNED` sang `IN_PROGRESS`. Việc này không ảnh hưởng đến việc tính hạn hay khóa, vì cả hai trạng thái đều được cron xét.

### 2.6 Thế nào là “hoàn thành khóa”?

`syncCourseAssignmentCompletion()` (`src/lib/learning-assignments.ts:180-228`) coi là hoàn thành khi **đồng thời**:

1. **Tất cả bài học** của khóa đã có tiến độ hoàn thành trong **chu kỳ hiện tại** (`cycle_lesson_progress.completed_at` khác null). Nếu người học chưa có chu kỳ, dùng `lesson_progress` legacy.
2. **Tất cả quiz gắn với bài học** đã pass.
3. **Bài thi cuối khóa** (nếu có) đã pass.

Điều kiện pass quiz: điểm tối thiểu **85%** (`QUIZ_PASS_PERCENT = 85`, `src/lib/config/quiz.ts:19-20`). Attempt phải ở trạng thái `SUBMITTED` hoặc `AUTO_SUBMITTED` và có `passed = true`.

Hệ quả:

- Xem hết video nhưng quiz dưới 85% → **chưa hoàn thành**; khóa vẫn bắt buộc và vẫn có hạn.
- Hoàn thành video + quiz bài nhưng chưa pass final → **chưa hoàn thành**.
- Khóa không có bài học nào → hàm trả `false`; không thể hoàn thành.
- Hoàn thành được ghi nhận bằng `completed_at`; sau đó assignment không còn bị tính quá hạn.
- Hoàn thành **không làm giảm** hạn chung (xem 3.9).

### 2.7 Các quyền đi kèm

| Quyền | Ý nghĩa | Cách gộp khi nhiều rule |
|---|---|---|
| `can_view` | Được xem nội dung khóa. | Tất cả rule phải cho phép. |
| `can_assess` | Được làm bài kiểm tra. | Tất cả rule phải cho phép. |
| `can_earn_stars` | Được nhận sao theo quy tắc hiện hành. | Tất cả rule phải cho phép. |

Các quyền này **không** thay đổi công thức hạn. Một khóa có `can_assess = false` vẫn có thể là bắt buộc; khi đó việc hoàn thành khóa có thể không đạt được nếu yêu cầu quiz/final. Đây là cấu hình cần tránh.

### 2.8 Mô hình “nghĩa vụ bổ sung” hiện có được dùng không?

Có bảng `SupplementalLearningRequirement` (`prisma/schema.prisma:1129-1144`) với `lesson_ids`, `added_days`, `due_at`, nhưng luồng publish bài mới hiện tại **không tạo** bản ghi này; hàm `enforceSupplementalDeadlines()` trả `0` (`src/lib/course-requirements.ts:84-86`). Vì vậy, trong phạm vi tài liệu này, “thêm bài” được xử lý bằng cách cộng ngày vào `learning_paths.due_at` và gửi `LearningNotice`, không bằng supplemental requirement.

---

## Phần 3 — Thời gian bắt buộc được tính như thế nào?

### 3.1 Một hạn chung, nhiều ngân sách ngày

Trong mô hình hiện hành, mỗi chu kỳ học có **một** `LearningPath` và **một** `due_at`. Tất cả assignment bắt buộc chưa hoàn thành trong chu kỳ được gán cùng một `due_at` (`src/lib/shared-learning-path.ts:53-55`). Vì vậy:

- Không có chuyện “khóa A còn 3 ngày, khóa B còn 10 ngày” trong mô hình chung.
- Con số ngày của từng khóa trong ma trận là **ngân sách đóng góp** vào tổng thời gian của cả lộ trình.
- Người học thấy **hạn gần nhất** trong các assignment đang hoạt động; trong mô hình chung, các assignment chưa xong có cùng hạn nên hạn gần nhất = hạn chung.
- Khóa đã hoàn thành không còn trong countdown, nhưng vẫn có thể nằm trong ngân sách tính toán (xem 3.10).

### 3.2 Ký hiệu

| Ký hiệu | Nghĩa | Nguồn dữ liệu |
|---|---|---|
| `D_start` | Mốc bắt đầu lộ trình của chu kỳ. | `learning_paths.starts_at` |
| `D_change` | Mốc Admin/đơn vị thay đổi tập nghĩa vụ (thời điểm reconcile). | `now` trong lần reconcile |
| `D_assigned(course)` | Mốc khóa được giao cho người học. | `user_learning_assignments.assigned_at` |
| `D_adminChange` | Mốc Admin lưu thay đổi. | `now` trong lần reconcile |
| `T_new` | Tổng ngân sách ngày của **toàn bộ** tập nghĩa vụ mới, gồm cả khóa đã hoàn thành. | Tổng `mandatory_default_due_days` |
| `T_added` | Tổng ngày của các khóa **mới xuất hiện trong tập** và **chưa hoàn thành**. | Chênh lệch `previous`/`next` |
| `N` | Số ngày Admin gia hạn tay. | Input |
| `k` | Số bài học mới trong một lần publish. | `addedLessonIds.length` |
| `T_course` | Số ngày cấu hình của khóa. | `mandatory_default_due_days` |
| `L_after` | Tổng số bài của khóa **sau** khi publish. | `version.lesson_ids.length` |

Một ngày = đúng **24 giờ** (`86_400_000 ms`). Hạn là một **timestamp tuyệt đối**, không phải “cuối ngày”. Ví dụ lộ trình bắt đầu lúc 15:30 ngày 1/1 với 20 ngày thì hạn là 15:30 ngày 21/1, không phải 23:59 ngày 21/1. Việt Nam không có DST (`src/lib/learning-cycle-rules.ts:1-2`).

### 3.3 Công thức 1 — Khởi tạo chu kỳ

```text
D = D_start + T_new
```

- Chỉ áp dụng khi lộ trình vừa được tạo trong lần reconcile đầu tiên (trong vòng 5 phút) và trước đó chưa có ngân sách (`CYCLE_INITIALIZED`, `src/lib/learning-cycle-rules.ts:52-53`; điều kiện chọn lý do ở `src/lib/shared-learning-path.ts:24-30`).
- Đây là hạn của toàn bộ kế hoạch, không phải hạn riêng của từng khóa.

**Ví dụ:** chu kỳ bắt đầu ngày 0; bắt buộc A = 10 ngày, B = 10 ngày. `T_new = 20` → hạn ngày 20.

**Trường hợp đặc biệt:** nếu người học đã có lộ trình mở từ trước nhưng **chưa có khóa bắt buộc nào**, và hôm nay Admin thêm khóa đầu tiên, lộ trình không còn “vừa tạo trong 5 phút”. Khi đó hệ thống dùng công thức đổi tập nghĩa vụ (mục 3.4), không dùng `D_start + T_new`; người học nhận đủ ngân sách từ lúc thêm. Điều này được chú thích rõ trong `src/lib/shared-learning-path.ts:24-30` và có test `src/test/shared-learning-path.test.ts:45-49`.

### 3.4 Công thức 2 — Đổi tập nghĩa vụ

```text
D_new = max(D_start + T_new, D_change + T_added)
```

Nguồn đặc tả: `docs/reference/handbook-formulas.md:306-328`; `docs/business-rules.md:59-65`. Nguồn mã: `src/lib/learning-cycle-rules.ts:85-91`.

Cách hiểu:

- **Số hạng thứ nhất** giữ cho lộ trình không ngắn hơn tổng kế hoạch mới tính từ ngày bắt đầu.
- **Số hạng thứ hai** bảo đảm các khóa **mới phát sinh** có đủ ngân sách tính từ lúc thay đổi, kể cả khi người học đã đi được một phần lộ trình.
- Không cộng hạn cũ như một số hạng thứ ba.

**Ví dụ chuẩn (đặc tả):**

- A = 10, B = 10; đổi sang A và C = 11 vào **ngày 5**.
  - `T_new = 21`, `T_added = 11`.
  - `D_new = max(21, 5 + 11) = 21`.
  - Người học còn 16 ngày kể từ lúc đổi để học C.
- Cùng dữ liệu, đổi vào **ngày 20**:
  - `D_new = max(21, 20 + 11) = 31`.
  - Người học có 11 ngày kể từ lúc đổi.

**Ví dụ có test:** `src/test/shared-learning-path.test.ts:33-43` khẳng định ngày 5 → 21, ngày 20 → 31; retry cùng tập không cộng thêm và không tạo thêm lịch sử.

**Lưu ý về “thêm khóa” so với “đổi vị trí”:** công thức không phân biệt hai việc này; cả hai đều làm đổi tập nghĩa vụ. Điểm khác là khi đổi vị trí, khóa cũ không còn bắt buộc sẽ bị kết thúc; khi thêm khóa, khóa cũ vẫn ở lại.

### 3.5 Công thức 3 — Admin giảm ngân sách

```text
D_new = max(
  D_start + T_new,
  max trên các khóa bị giảm (D_assigned(course) + T_new(course)),
  D_adminChange + 3 ngày
)
```

Nguồn: `src/lib/learning-cycle-rules.ts:67-83`; đặc tả `docs/reference/handbook-formulas.md:330-342`.

- Chỉ áp dụng khi phát hiện **có khóa bị giảm số ngày** so với ngân sách trước đó (`reduced` ở `src/lib/shared-learning-path.ts:21-33`).
- Sàn 3 ngày bảo đảm người đang học không bị coi là quá hạn ngay tại thời điểm Admin lưu.
- Với khóa được giao muộn, hệ thống lấy thêm mốc `D_assigned(course) + T_new(course)` để khóa đó vẫn có đủ ngân sách mới kể từ lúc giao.

**Ví dụ 1:** A = 30 ngày, giao ngày 0; đến ngày 20 Admin giảm còn 10 ngày.

- `D_start + T_new = 0 + 10 = 10`.
- `D_assigned + T_new = 0 + 10 = 10`.
- `D_adminChange + 3 = 23`.
- `D_new = 23`.

**Ví dụ 2:** A = 10 (giao ngày 0), B = 30 (giao ngày 25); đến ngày 30 Admin giảm B còn 10.

- `T_new = 20`.
- `D_start + T_new = 20`.
- Với B: `25 + 10 = 35`.
- Sàn: `30 + 3 = 33`.
- `D_new = 35` (khóa B vẫn đủ 10 ngày kể từ lúc được giao).

Test: `src/test/shared-learning-path.test.ts:77-93`.

**Không áp sàn 3 ngày cho việc tăng ngày.** Tăng ngày dùng công thức 2, nên có thể không tăng hạn nếu tổng kế hoạch mới vẫn nhỏ hơn hạn hiện tại.

### 3.6 Công thức 4 — Admin gia hạn tay / mở khóa

```text
base = max(now, D_current)
D_new = base + N ngày
```

Nguồn: `src/app/api/v1/admin/users/[userId]/extend-deadline/route.ts:47-51`; cùng công thức trong `src/lib/learning-cycle-rules.ts:93-99`.

- Nếu hạn hiện tại còn ở tương lai: cộng từ hạn hiện tại.
- Nếu đã quá hạn hoặc chưa có hạn: cộng từ `now`.
- Chỉ Admin được gọi (`:9-11`).
- `N` phải là số nguyên dương (`:18-22`). UI giới hạn 1–365; backend không kiểm tra trần.
- Cập nhật `learning_paths.due_at` và **tất cả assignment bắt buộc chưa hoàn thành** trong chu kỳ, đưa chúng về `IN_PROGRESS` (`:71-83`).
- Gỡ **tất cả** restriction loại `DEADLINE` đang mở (`:86-96`).
- Chỉ mở tài khoản nếu:
  - tài khoản không ở `INACTIVE`;
  - không còn restriction nào khác;
  - không đang bị khóa mật khẩu còn hiệu lực;
  - `lock_reason` là `OVERDUE_LOCK` hoặc `DEADLINE` (`:99-130`).
- Ghi audit `EXTEND_DEADLINE`, giữ lý do, hạn cũ, hạn mới, trạng thái trước/sau (`:132-148`).
- Không xóa tiến độ, không xóa lịch sử quá hạn, không xóa restriction đã gỡ; chỉ đặt `lifted_at`.

**Ví dụ:**

- Hạn ngày 20, hôm nay ngày 5, gia hạn 7 → hạn ngày 27.
- Hạn ngày 5, hôm nay ngày 20 (đã quá hạn), gia hạn 7 → hạn ngày 27.
- Hạn đúng bằng hôm nay, gia hạn 7 → hạn ngày 27.

**Điều kiện tiên quyết:** người học phải có chu kỳ học đang mở và lộ trình. Nếu không, endpoint ném `NoActiveLearningCycle` hoặc `NoActiveLearningPath` (`:32-45`). Người chưa từng phát sinh chu kỳ/lộ trình có thể không có hai bản ghi này; lần học hoặc reconcile đầu tiên sẽ tạo chúng.

### 3.7 Công thức 5 — Thêm bài vào khóa đã publish

```text
T_extra = max(ceil(T_course / L_after), 3)
T_total_extra = k × T_extra
```

Nguồn đặc tả: `docs/reference/handbook-formulas.md:350-374`. Nguồn mã: `src/lib/course-requirements.ts:29-59`.

- `T_course` là số ngày cấu hình của khóa.
- `L_after` là tổng số bài **sau khi publish**, gồm cả bài mới; không dùng số bài trước đó.
- `k` là số bài mới trong cùng một lần publish.
- Mỗi bài mới được ít nhất **3 ngày**, kể cả khi chia trung bình ra thấp hơn.
- Đặc tả nói thời gian bổ sung được tính **từ thời điểm publish** và không cộng trùng khi retry.
- Mã hiện tại cộng `T_total_extra` vào `learning_paths.due_at` hiện có (hoặc `now` nếu chưa có hạn), rồi gán cùng hạn cho mọi assignment bắt buộc còn hiệu lực (`src/lib/course-requirements.ts:38-47`).
- Tạo `LearningNotice` cho từng người với `event_key = content:<version>:<user>`; publish lại cùng version không tạo trùng (`:52-61`).
- Chỉ chạy khi policy học tập đã active (`:31`).
- Không mở lại assignment đã `COMPLETED`.

**Ví dụ đặc tả:** khóa 20 ngày, sau publish có 7 bài, thêm 2 bài.

- `T_extra = max(ceil(20/7), 3) = max(3, 3) = 3`.
- `T_total_extra = 2 × 3 = 6` ngày.

**Ví dụ lệch đã biết:** khóa 20 ngày, 5 bài, đã hoàn thành, hạn cũ ngày 10; publish thêm 2 bài vào ngày 20, tổng 7 bài.

- Đặc tả mong đợi: hạn publish + 6 = ngày **26**.
- Mã hiện tại: hạn cũ + 6 = ngày **16**.
- Đây là `HANDBOOK-DEADLINE-ADDED` (`docs/known-issues.md:11`), chưa sửa.

**Hệ quả cần biết:** phần `+6` chỉ nằm trong `due_at`, **không** được ghi vào `budget`/`budget_fingerprint`. Nếu sau đó tập nghĩa vụ hoặc ngân sách thay đổi, lần tính lại theo công thức 2/3 sẽ không còn phần `+6` này (xem Phần 9).

### 3.8 Công thức 6 — Tập rỗng hoặc tất cả đã hoàn thành

```text
due = null
```

- Nếu tập nghĩa vụ rỗng, hoặc **mọi** khóa trong tập đã hoàn thành, hàm trả `null` (`src/lib/learning-cycle-rules.ts:43`; test `:63-66`).
- Khi đó không có hạn để cron khóa tài khoản.
- Lưu ý dữ liệu: nếu `due_at` cũ vẫn còn trong `learning_paths` do fingerprint không đổi khi hoàn thành, API người học vẫn không hiển thị countdown vì assignment đã `COMPLETED`; không nên đọc `learning_paths.due_at` một cách độc lập để kết luận còn nghĩa vụ.

### 3.9 Fingerprint và lý do tính lại

`budgetFingerprint` chỉ gồm `courseId:days`, **cố ý bỏ trạng thái hoàn thành** (`src/lib/learning-cycle-rules.ts:115-118`). Mục đích:

- Hoàn thành một khóa **không** làm hạn ngắn lại.
- Retry cùng một tập/ngân sách **không** cộng dồn thời gian.
- Chỉ khi tập khóa hoặc số ngày thực sự đổi mới tính lại.

`reconcileSharedPath` chọn lý do như sau (`src/lib/shared-learning-path.ts:21-33`):

| Điều kiện | Lý do truyền vào công thức | Công thức thực tế |
|---|---|---|
| Chưa có ngân sách trước đó và lộ trình vừa tạo trong 5 phút | `CYCLE_INITIALIZED` | `D_start + T_new` |
| Chưa có ngân sách trước đó nhưng lộ trình đã cũ | `ROLE_CHANGED` | `max(D_start + T_new, D_change + T_added)`; vì mọi khóa đều “mới”, thường = `D_change + T_new` |
| Có khóa bị giảm số ngày | `ADMIN_BUDGET_SHORTENED` | Công thức 3 |
| Các trường hợp còn lại | `ROLE_CHANGED` | Công thức 2 |

Các lý do `MANDATORY_COURSE_ADDED`, `MANDATORY_COURSE_REMOVED` có trong enum và hàm thuần, nhưng **không được `reconcileSharedPath` chọn** trong luồng hiện tại. Vì vậy không nên đọc các nhánh đó như hành vi thực tế của coordinator (xem Phần 9).

`learning_path_changes.reason` chỉ ghi `COURSE_BUDGET_REDUCED` hoặc `REQUIRED_SET_CHANGED`; gia hạn tay ghi `ADMIN_MANUAL_EXTENSION`; thêm bài không ghi bản ghi change (xem 8.8).

### 3.10 Khóa đã hoàn thành vẫn nằm trong `T_new`

Đây là điểm dễ gây bất ngờ:

- `T_new` là tổng ngân sách của **toàn bộ** tập nghĩa vụ mới, **không loại** khóa đã hoàn thành.
- `T_added` mới là phần **loại** khóa đã hoàn thành.
- Vì vậy, khi thêm một khóa mới, hạn có thể dịch xa hơn cả phần ngân sách của khóa mới, do các khóa cũ đã hoàn thành vẫn đóng góp vào `T_new`.

**Ví dụ A:** A = 10 ngày đã hoàn thành, C = 10 ngày vừa được thêm và chưa học; thay đổi ở ngày 5.

- `T_new = 20`, `T_added = 10`.
- `D_new = max(20, 5 + 10) = 20`.
- Hạn là ngày 20, dù C chỉ có 10 ngày và thay đổi ở ngày 5.

**Ví dụ B:** A = 100 ngày đã hoàn thành; thêm C = 10 ngày ở ngày 5.

- `T_new = 110`, `T_added = 10`.
- `D_new = max(110, 15) = 110`.
- Người học có 105 ngày kể từ lúc thêm, dù khóa mới chỉ 10 ngày.

Đặc tả công thức không nói loại khóa đã hoàn thành khỏi `T_new`; test `src/test/learning-cycles.test.ts:57-58` chỉ kiểm tra trường hợp nhỏ. Đây là **hệ quả của công thức**, chưa thấy quyết định nghiệp vụ riêng cho trường hợp ngân sách đã hoàn thành lớn. Cần chốt nếu muốn hành vi khác (xem Phần 9).

### 3.11 Thời điểm bắt đầu `D_start` được lấy từ đâu?

- Với người học mới: chu kỳ được tạo ở lần học đầu tiên; lộ trình được tạo trong lần reconcile đầu tiên, `starts_at = now` (`src/lib/shared-learning-path.ts:15-17`).
- Với người học được tạo trước mốc lịch sử: `learningContext` tạo chu kỳ `LEGACY` bắt đầu tại mốc đó, nhập tiến độ cũ và tạo lộ trình với `starts_at` là `assigned_at` sớm nhất của assignment cũ, hoặc `now` nếu không có; `imported_due_at` là hạn cũ muộn nhất (`src/lib/learning-periods.ts:57-79`).
- Với người vừa chuyển giao: chu kỳ mới bắt đầu tại thời điểm apply; lộ trình mới được tạo khi reconcile chạy, nên `D_start` có thể **muộn hơn** thời điểm chuyển giao nếu reconcile bị trễ. Đây là điểm cần lưu ý khi kiểm tra số liệu (xem Phần 9).
- `imported_due_at` chỉ được dùng làm **sàn** trong lần tính lại đầu tiên của lộ trình (`src/lib/shared-learning-path.ts:47-49`). Sau khi đã có ít nhất một lần thay đổi, sàn này không còn áp dụng.

### 3.12 Dữ liệu legacy (trước mốc lịch sử)

Mô hình deadline chung **luôn chạy**; không còn cổng bật/tắt cutover. `learningContext()` luôn trả về tháng và chu kỳ, đồng thời tạo chu kỳ mới khi người học chưa có (`src/lib/learning-periods.ts:38-82`). Người được tạo trước `learning_policy.cutover_at` được đánh dấu `provenance = LEGACY` và nhập tiến độ/hạn cũ; người mới nhận `NATIVE`. `learning_policy` chỉ còn là mốc lịch sử để nhận diện nhóm này và làm sàn phân bổ kỳ/DNA — không phải điều kiện để chạy mô hình.

| Điểm | Dữ liệu legacy được đọc | Hành vi ghi hiện hành |
|---|---|---|
| Hạn | Assignment cũ giữ `due_at` riêng khi đọc lịch sử | Một hạn chung từ `learning_paths` |
| Nguồn số ngày | `learning_rules.due_days` đã lưu trên assignment cũ | `courses.mandatory_default_due_days` |
| Chu kỳ | Attempt cũ có `learning_cycle_id = null` vẫn được tính qua `currentCycleAttemptFilter` (`src/lib/learning-periods.ts:106-112`) | Mọi ghi mới đều gắn chu kỳ |
| Sao | Ledger legacy không có month/cycle vẫn đọc được | Ledger mới gắn month/cycle và `provenance = NATIVE` |
| Snapshot | Snapshot lịch sử đã chốt được giữ nguyên | Không tạo snapshot cho giai đoạn trước mốc lịch sử |

Chi tiết:

- Khi nâng cấp, lần học/reconcile đầu tiên tạo chu kỳ và lộ trình; `imported_due_at` lấy hạn cũ muộn nhất làm sàn cho lần tính đầu.
- Việc bỏ cutover **không** backfill, không đổi sao, không đổi tiến độ và không tạo snapshot ngược về trước mốc.
- Các nhánh ghi “không có chu kỳ” đã bị xóa khỏi writer; chỉ còn đường đọc lịch sử legacy.

### 3.13 Bảng đối chiếu đặc tả và mã

| Nội dung | Đặc tả | Mã hiện tại | Trạng thái |
|---|---|---|---|
| Khởi tạo | `D_start + T_new` | Giống | Khớp |
| Đổi tập nghĩa vụ | `max(D_start+T_new, D_change+T_added)` | Giống | Khớp |
| Giảm ngân sách | Có sàn 3 ngày | Giống, thêm mốc `D_assigned` cho khóa giao muộn | Khớp và chặt hơn |
| Gia hạn tay | Cộng từ `max(now, hạn)` | Giống | Khớp |
| Thêm bài | `k × max(ceil(T/L_after),3)` từ **publish** | Cộng vào **hạn cũ** | [LỆCH] `HANDBOOK-DEADLINE-ADDED` |
| Tập rỗng/hoàn thành | Không hạn | Giống | Khớp |
| Bỏ khóa | Không nêu sàn | Có thể tụt về `now`, không sàn | [CHƯA XÁC NHẬN] |
| Nhiều thay đổi cùng lúc | Không nêu | Giảm ngân sách + thêm khóa có thể bỏ qua `T_added` | [CHƯA XÁC NHẬN] |

---

## Phần 4 — Khi Admin thay đổi thì chuyện gì xảy ra?

Mỗi mục dưới đây trả lời bốn câu: Admin làm gì, dữ liệu nào đổi, hạn đổi ra sao, người học bị ảnh hưởng thế nào.

### 4.1 Thêm khóa bắt buộc cho một target

**Thao tác:** tick ô khóa/target trong ma trận và lưu, hoặc tạo rule qua API.

**Dữ liệu đổi:**

- Tạo `LearningRule` (hoặc nhiều rule nếu target mở ra nhiều đơn vị).
- Enqueue reconcile cho toàn bộ người dùng.
- Khi reconcile chạy cho từng người: tạo assignment mới hoặc cập nhật assignment đang có; sau đó tính lại hạn chung.

**Công thức:** công thức 2 (hoặc công thức 1 nếu lộ trình vừa được tạo).

#### 4.1.1 Người chưa từng học khóa đó

- Assignment mới được tạo với `assigned_at = now`.
- Tiến độ của các khóa khác không đổi.
- Khóa mới góp ngân sách vào `T_new`; nếu là khóa mới phát sinh và chưa hoàn thành, góp vào `T_added`.
- Người học nhận thời gian của khóa mới tính từ lúc thay đổi, nhưng không ít hơn tổng kế hoạch tính từ `D_start`.

**Ví dụ:** A = 10, B = 10, hạn ngày 20. Ngày 5 thêm C = 11.

- `T_new = 31`, `T_added = 11`.
- `D_new = max(31, 16) = 31`.
- Người học có 26 ngày từ lúc thêm, vì tổng kế hoạch 31 ngày lớn hơn mốc “thay đổi + 11 ngày”.

#### 4.1.2 Người đang học dở khóa đó

- Assignment được tạo/cập nhật; tiến độ bài học hiện có được giữ nguyên.
- Khóa không được cộng thêm thời gian riêng chỉ vì đã có tiến độ; nó vẫn là khóa “mới trong tập nghĩa vụ” nếu trước đó chưa bắt buộc.
- Nếu người học đã hoàn thành đủ điều kiện trước khi rule có hiệu lực, assignment có thể được đồng bộ thành `COMPLETED` ngay trong lần reconcile.

#### 4.1.3 Người đã hoàn thành khóa trong chu kỳ hiện tại

Đây là câu hỏi quan trọng nhất và câu trả lời có hai lớp:

1. **Nghĩa vụ học:** assignment được tạo nhưng `syncCourseAssignmentCompletion` thấy đủ điều kiện → đánh `COMPLETED`, `completed_at` được đặt. Người học **không phải học lại**, không bị countdown cho khóa này, không bị khóa vì khóa này.
2. **Hạn chung:** khóa đã hoàn thành **vẫn nằm trong `T_new`**, chỉ không nằm trong `T_added`. Vì vậy:
   - Nếu **tất cả** khóa trong tập mới đã hoàn thành → `due = null`, không còn hạn.
   - Nếu còn khóa khác chưa xong → hạn có thể dịch đến `D_start + T_new` (hoặc mốc thay đổi + `T_added`), kể cả khi khóa vừa thêm không cần học.

**Ví dụ:** A = 10 đang học dở, hạn ngày 10. Ngày 5 Admin thêm C = 10 nhưng C đã được học xong trước đó.

- `T_new = 20`, `T_added = 0`.
- `D_new = max(20, 5) = 20`.
- C có assignment `COMPLETED`; A vẫn phải học, nhưng hạn chung lùi từ ngày 10 sang ngày 20.

Nếu A cũng đã hoàn thành → `due = null`, không còn countdown.

**Nếu khóa được hoàn thành ở chu kỳ trước:** sau chuyển giao, tiến độ chu kỳ mới được reset; khóa **không** được coi là đã hoàn thành trong chu kỳ hiện tại. Người học phải học lại và khóa có đầy đủ nghĩa vụ.

#### 4.1.4 Khóa đã bắt buộc qua target khác

- Rule mới có thể được tạo, nhưng assignment theo khóa đã tồn tại.
- Fingerprint ngân sách không đổi (cùng `courseId:days`) → **không tính lại hạn**, không cộng thêm thời gian.
- Cờ được gộp: `mandatory = any`, các quyền `= all`.
- Đây là trường hợp “thêm trùng” an toàn nhất.

#### 4.1.5 Khóa từng bắt buộc, bị bỏ, nay bật lại

- Assignment cũ đã `ENDED` có thể được dùng lại: `ended_at = null`, `mandatory` theo rule mới.
- Nếu đã hoàn thành trước đó: giữ `COMPLETED` và `completed_at`; không bắt học lại.
- Nếu chưa hoàn thành: trở về `ASSIGNED` (hoặc `OVERDUE` nếu trạng thái cũ là `OVERDUE`), tiến độ bài học được giữ.
- Hạn chung được tính lại theo tập mới.

#### 4.1.6 Người đang bị khóa

- Việc thêm khóa **không** tự mở tài khoản (đặc tả `docs/reference/handbook-formulas.md:344`; mã không có logic mở khóa trong reconcile).
- Nếu tài khoản đang bị khóa vì quá hạn, Admin phải dùng luồng “Mở khóa & Gia hạn” hoặc luồng kích hoạt tài khoản có nhập số ngày.
- Hạn mới có thể được cập nhật, nhưng restriction `DEADLINE` vẫn còn cho đến khi Admin gỡ.

### 4.2 Bỏ khóa khỏi một target

**Thao tác:** bỏ tick ô khóa/target và lưu.

**Dữ liệu đổi:**

- Rule bị đóng (`effective_until = now`).
- Lần reconcile kế tiếp: assignment không còn trong tập rule → `mandatory = false`, `ended_at = now`, status `ENDED` (trừ khi đã `COMPLETED`).
- Tiến độ bài học và `completed_at` được giữ.
- Hạn chung tính lại theo tập còn lại.

**Công thức:** công thức 2, với `T_added = 0` nếu không có khóa mới.

**Hệ quả:** hạn có thể **giảm mạnh**, kể cả về đúng thời điểm thay đổi:

**Ví dụ:** A = 10, B = 40, hạn ngày 50. Ngày 20 bỏ B.

- `T_new = 10`, `T_added = 0`.
- `D_new = max(10, 20) = 20`.
- Hạn tụt từ ngày 50 về ngày 20 (chính là lúc thay đổi). Không có sàn 3 ngày.
- Test coordinator: `src/test/shared-learning-path.test.ts:63-67`.

**Cảnh báo vận hành:**

- Nếu cron chạy sau đó, người học có thể bị đánh `OVERDUE` và khóa ngay, dù trước khi bỏ khóa họ còn 30 ngày.
- Nếu người học đang bị khóa, bỏ khóa **không** tự mở khóa.
- Nếu khóa bị bỏ là khóa duy nhất và người học đã hoàn thành → `due = null`.
- Nếu chỉ còn các khóa đã hoàn thành → `due = null`.

### 4.3 Tăng số ngày của một khóa

**Thao tác:** sửa số ngày của hàng khóa trong ma trận và lưu.

**Dữ liệu đổi:**

- `courses.mandatory_default_due_days` đổi.
- Tất cả rule đang hiệu lực của khóa được cập nhật `due_days`.
- Enqueue reconcile; lần reconcile kế tiếp thấy fingerprint đổi (days tăng) → tính lại hạn.

**Công thức:** công thức 2 (không phải cộng thêm phần chênh vào hạn cũ).

**Ví dụ:** A = 10, B = 10, hạn ngày 20. Ngày 5 tăng A từ 10 lên 12.

- `T_new = 22`, `T_added = 0`.
- `D_new = max(22, 5) = 22`.
- Hạn tăng từ 20 lên 22, không phải 20 + 2 = 22 (trùng trong ví dụ này), nhưng cách tính là tính lại toàn bộ, không cộng dồn.

**Trường hợp hạn đang được gia hạn tay:** nếu hạn hiện tại là ngày 40 (do Admin đã gia hạn), tăng A lên 12 ở ngày 5 sẽ cho `D_new = 22`, làm hạn **giảm** từ 40 về 22. Đây là hệ quả của việc tính lại từ `D_start`, không lấy hạn hiện tại làm mốc. Xem Phần 9.

### 4.4 Giảm số ngày của một khóa

**Thao tác:** sửa số ngày của hàng khóa giảm xuống và lưu.

**Công thức:** công thức 3, có sàn 3 ngày kể từ lúc Admin đổi.

**Ví dụ:** A = 30, giao ngày 0, hạn ngày 30. Ngày 20 giảm còn 10.

- `D_new = max(10, 10, 23) = 23`.
- Người học còn 3 ngày kể từ lúc đổi, không bị quá hạn ngay.

**Trường hợp khóa được giao muộn:** xem ví dụ 2 ở 3.5; khóa vẫn giữ đủ ngân sách mới kể từ `assigned_at`.

**Lưu ý:**

- Sàn 3 ngày chỉ áp cho **giảm**; tăng không có sàn.
- Nếu Admin vừa giảm một khóa vừa thêm khóa mới trong cùng một lần lưu, coordinator chọn nhánh `ADMIN_BUDGET_SHORTENED` và **bỏ qua `T_added`** của khóa mới. Khóa mới có thể chỉ nhận 3 ngày từ mốc thay đổi thay vì đủ ngân sách. Xem Phần 9.
- Nếu người học đang bị khóa, giảm ngày không mở khóa.

### 4.5 Thêm bài mới vào khóa đã publish

**Thao tác:** Admin sửa nội dung khóa và publish lại.

**Dữ liệu đổi:**

- `captureCourseRequirementVersion` tạo version mới nếu fingerprint bài/quiz/final đổi (`src/lib/course-requirements.ts:5-24`).
- Nếu có bài mới, tính `extraDays` và cộng vào lộ trình của từng người đang có assignment bắt buộc còn hiệu lực.
- Gửi `LearningNotice` cho từng người.
- Không tạo supplemental requirement; không mở lại assignment `COMPLETED`.

**Công thức:** công thức 5.

**Ví dụ:** khóa 20 ngày, sau publish 7 bài, thêm 2 bài → `T_extra = 3`, tổng +6 ngày.

**Các trường hợp:**

- **Khóa đang học dở:** cộng hạn; người học phải học thêm bài mới để được coi là hoàn thành.
- **Khóa đã hoàn thành:** vẫn cộng hạn và gửi thông báo, nhưng assignment vẫn `COMPLETED`; người học không bị bắt học lại. Đây là hành vi hiện tại, không phải lỗi mở lại nghĩa vụ.
- **Publish lại không có bài mới:** fingerprint không đổi, không cộng ngày, không tạo notice trùng.
- **Publish nhiều lần, mỗi lần thêm bài:** mỗi version tính `k` của lần đó; `L_after` là tổng bài sau lần publish tương ứng.
- **Không còn cổng policy:** mọi user có assignment gắn chu kỳ đều được cộng ngày; không cần bật cutover.

**Điểm lệch:** xem 3.7 và `HANDBOOK-DEADLINE-ADDED`.

**Điểm chưa có trong đặc tả:** phần `+extraDays` không được lưu vào budget/fingerprint, nên lần đổi tập sau có thể làm mất phần này. Xem Phần 9.

### 4.6 Gia hạn thủ công và mở khóa

**Ai được làm:** chỉ `ADMIN` (`src/app/api/v1/admin/users/[userId]/extend-deadline/route.ts:9-11`).

**Thao tác:** mở modal “Mở khóa & Gia hạn” ở trang Admin người dùng; chọn 3/7/14/30 ngày hoặc nhập số khác; xác nhận.

**Dữ liệu đổi:**

- `learning_paths.due_at = max(now, hạn cũ) + N`.
- Tất cả assignment bắt buộc chưa hoàn thành trong chu kỳ: `due_at = hạn mới`, `status = IN_PROGRESS`.
- Tất cả restriction `DEADLINE` đang mở: `lifted_at = now`.
- Tài khoản có thể được mở nếu không còn lý do khác.
- Ghi `learning_path_changes` với lý do `ADMIN_MANUAL_EXTENSION`.
- Ghi audit `EXTEND_DEADLINE`.

**Công thức:** công thức 4.

**Ví dụ:** hạn ngày 20, hôm nay ngày 5, +7 → ngày 27. Hạn ngày 5, hôm nay ngày 20, +7 → ngày 27.

**Điều kiện mở khóa tài khoản:**

- Nếu `status = INACTIVE` → giữ `INACTIVE` (Admin/Lead đã vô hiệu hóa thủ công).
- Nếu còn restriction khác hoặc đang bị khóa mật khẩu → giữ `LOCKED`.
- Nếu `lock_reason` là `OVERDUE_LOCK` hoặc `DEADLINE` và không còn lý do khác → `ACTIVE`, xóa `lock_reason`.
- Nếu `lock_reason` là lý do khác (ví dụ `PASSWORD_LOCK` còn hiệu lực) → không mở.

**Không làm:** không xóa tiến độ, không xóa lịch sử quá hạn, không xóa restriction đã gỡ, không tự động mở khóa khi Admin thêm khóa mới.

**Điểm cần biết:**

- Modal UI ghi “số ngày kể từ hôm nay”, nhưng backend cộng từ hạn tương lai nếu hạn còn ở tương lai. Đây là điểm lệch giữa chữ và hành vi.
- Nếu người học chưa từng phát sinh chu kỳ/lộ trình, endpoint lỗi; người có dữ liệu legacy nhưng chưa được nhập cũng thuộc trường hợp này.
- Có một luồng khác: đổi trạng thái người dùng sang `ACTIVE` kèm `extensionDays` (`src/app/api/v1/users/[userId]/route.ts:165-176`). Luồng này đặt hạn = `now + days` cho các assignment `OVERDUE`, **không** cập nhật `learning_paths.due_at`, và gỡ **tất cả** restriction. Hành vi không đồng nhất với luồng chuyên dụng; xem Phần 9.

### 4.7 Đổi thời gian hiệu lực của rule / dùng API rule

**Ma trận:**

- Bỏ tick → đóng rule hiện tại bằng `effective_until = now`.
- Tick lại → tạo rule mới, `effective_from` mặc định là thời điểm tạo.
- Không sửa rule cũ; lịch sử được giữ.

**API `POST /api/v1/admin/learning-rules`:**

- Tạo rule trực tiếp (`src/app/api/v1/admin/learning-rules/route.ts:36-74`).
- Không đặt `target_code`; rule chỉ dựa vào đơn vị/chức vụ.
- `due_days` lấy từ `course.mandatory_default_due_days`, không lấy từ input.
- **Không enqueue reconcile và không materialize ngay**. Rule sẽ được áp dụng ở lần reconcile sau (khi có sự kiện outbox, khi người học mở trang học/deadlines, hoặc khi có thay đổi tổ chức).
- Có thể tạo rule với `effective_from` tương lai; khi đó rule chưa có tác dụng cho đến mốc đó.

**API `PATCH /api/v1/admin/learning-rules/[ruleId]`:**

- Chỉ hỗ trợ `DEACTIVATE` (`:8-55`).
- Đặt `effective_until` và reconcile ngay các user đang có assignment gắn rule đó (`:41-49`).
- Không hỗ trợ đổi số ngày qua PATCH.

**API `DELETE`:** nếu có, cần kiểm tra riêng; nguyên tắc chung là không xóa lịch sử.

### 4.8 Đổi đơn vị hoặc chức vụ của người học

**Thao tác:** Admin thêm/kết thúc membership, đổi ban, thêm/kết thúc chức vụ.

**Cơ chế:** các API tổ chức gọi `reconcileLearningAssignmentsForUser` ngay hoặc enqueue outbox (`src/lib/chapter-department-update.ts:59`, `src/app/api/v1/admin/organization/route.ts:245`, `:351`, `:389`, `:456`, `:499`; `src/lib/invitations.ts:228`, `:503`).

**Kết quả:**

- Khóa không còn thuộc tập mới → assignment `ENDED`, tiến độ giữ.
- Khóa mới thuộc tập → assignment mới/cập nhật.
- Hạn chung tính lại theo công thức 2 hoặc 3.
- Nếu chỉ đổi ban trong cùng Chapter: **không** reset chu kỳ, tiến độ bài học được giữ; nghĩa vụ và hạn thay đổi theo tập mới.
- Nếu chuyển giao Chapter/DNA: reset toàn bộ chu kỳ (mục 4.9).

**Ví dụ:** A = 10, B = 40, hạn ngày 50. Ngày 20 đổi vị trí chỉ còn A.

- `D_new = max(10, 20) = 20`.
- Hạn tụt về ngày 20; tiến độ A giữ nguyên; B bị `ENDED` nhưng tiến độ B vẫn còn trong dữ liệu cũ.

**Ví dụ mở rộng:** A = 10, hạn ngày 10. Ngày 20 đổi sang A + C = 11.

- `D_new = max(21, 20 + 11) = 31`.
- Người học có 11 ngày kể từ lúc đổi cho C.

### 4.9 Chuyển giao nhiệm kỳ / reset chu kỳ

**Khi nào:**

- Apply chuyển giao Chapter thành công.
- Reset DNA định kỳ tại mốc tháng 4/tháng 10 theo lịch.

**Dữ liệu đổi (Chapter):**

- Đóng chu kỳ cũ (`ends_at`).
- Tạo chu kỳ mới.
- Hủy attempt đang làm.
- Reset `lesson_progress` (bao gồm `completed`, `completed_at`, vị trí xem).
- Kết thúc tất cả assignment và supplemental requirement đang mở.
- Enqueue reconcile cho từng người.
- Lưu snapshot trước chuyển giao.

Nguồn: `src/lib/chapter-reorganizations.ts:65-82`.

**Rào chắn trùng lặp:** partial unique index `chapter_transfers_one_applied_season` trên `(chapter_id, transfer_season_id)` khi `status = 'APPLIED'` (migration `20261022_learning_guards`) bảo đảm mỗi chapter + mùa chỉ có một lần áp dụng. Vi phạm index được ghi thành thông điệp nghiệp vụ trong `last_error`; batch vẫn `SCHEDULED` để thử lại.

**Thời điểm:** `applied_at` là giờ database thật lúc worker áp dụng (không backdate), nên toàn bộ reset dữ liệu học xảy ra tại `applied_at`. Thời gian **nghiệp vụ** dùng cho lịch sử, phân cửa sổ và mốc mở lại thưởng là `min(effective_at, applied_at)` (`src/lib/transfer-windows.ts:83-86`). Nếu cron trễ, chapter vẫn được tính đã chuyển giao theo giờ hẹn nhưng dữ liệu học chỉ reset khi worker chạy thật. Admin chỉ được xem các đợt chuyển giao; việc đặt lịch/áp dụng/hủy thuộc Chapter Quản lý.

**Dữ liệu đổi (DNA):** tương tự, với trigger `DNA_SEASON_RESET` (`src/lib/dna-cycle-resets.ts:13-39`).

**Hạn mới:**

- Lộ trình mới được tạo khi reconcile; `D_start` là thời điểm reconcile.
- Hạn = `D_start + T_new` cho tập nghĩa vụ của chu kỳ mới.
- Không giữ hạn cũ; không cộng dồn thời gian trước chuyển giao.
- Tiến độ học được reset; khóa đã hoàn thành ở chu kỳ cũ **không** được coi là hoàn thành ở chu kỳ mới.

**Lưu ý:** nếu reconcile bị trễ, `D_start` muộn hơn thời điểm apply, người học có thể được hưởng thêm thời gian ngoài dự kiến. Xem Phần 9.

### 4.10 Publish, unpublish và trạng thái khóa học

**Publish:**

- Publish **không** làm khóa bắt buộc. Bắt buộc chỉ đến từ rule.
- Publish có thể tạo version yêu cầu mới; nếu có bài mới, cộng ngày như mục 4.5.
- Khóa thiếu `program_id` không publish được; publish ném `PublishedCourseProgramRequired` (`src/lib/course-requirements.ts:28`). Ma trận không kiểm tra điều kiện này trước khi tick.

**Unpublish:**

- Đặt khóa về `DRAFT`, `published_at = null` (`src/app/api/v1/courses/[courseId]/unpublish/route.ts:46-49`).
- **Không** đóng rule.
- **Không** kết thúc assignment.
- **Không** tính lại hạn.
- Người học có thể không mở được khóa nhưng nghĩa vụ và hạn vẫn còn; cron vẫn có thể khóa tài khoản.
- Đây là cảnh báo vận hành quan trọng: muốn dừng nghĩa vụ, phải bỏ tick target hoặc đóng rule, không chỉ unpublish.

### 4.11 Thời điểm thay đổi có hiệu lực

1. **Lưu ma trận:** rule/course được cập nhật ngay trong transaction; audit được ghi; outbox được enqueue cho toàn bộ user.
2. **Materialize:** không chạy đồng bộ cho tất cả user trong lúc lưu. Mỗi user được reconcile khi:
   - gọi `/api/v1/learning/me` hoặc `/api/v1/members/me/deadlines` (read-through, `src/lib/learning-outbox.ts:42-70`);
   - có thay đổi tổ chức/rule/invitation;
   - có worker bên ngoài gọi `processLearningOutbox` (trong repo chỉ thấy route apply chuyển giao gọi hàm này, `src/app/api/internal/organization/reorganizations/apply/route.ts:16`).
3. **Cron quá hạn:** chỉ nhìn thấy assignment đã materialize. Nếu user chưa từng mở trang học/deadlines và không có worker, assignment mới có thể chưa tồn tại; khi đó chưa có hạn và chưa bị khóa.
4. **Cron schedule:** Vercel khai báo chạy một lần/ngày lúc `00:00 UTC` = **07:00 giờ Việt Nam** (`vercel.json:5-9`). Script `scripts/learning-scheduler.mjs:7` nếu được triển khai sẽ gọi endpoint này mỗi phút. Cần xác nhận production dùng cách nào.

Hệ quả thực tế:

- Với Vercel cron hằng ngày, một assignment quá hạn lúc 08:00 hôm nay có thể chưa bị khóa cho đến 07:00 hôm sau.
- Với scheduler mỗi phút, khóa có thể xảy ra trong vòng khoảng một phút sau khi quá hạn.
- Việc thêm khóa/gia hạn cấu hình không đẩy nhanh việc materialize cho người chưa mở ứng dụng.

---

## Phần 5 — Có khi nào thời gian giảm không?

### 5.1 Bảng tổng hợp

| Tình huống | Hạn tăng? | Hạn giảm? | Hạn không đổi? | Ghi chú |
|---|---|---|---|---|
| Thêm khóa mới chưa học | Có thể | Có thể | Có thể | Phụ thuộc công thức; nếu hạn đang được gia hạn tay, có thể bị rút ngắn. |
| Thêm khóa đã hoàn thành | Có thể | Có thể | Có thể | Không nằm trong `T_added` nhưng vẫn nằm trong `T_new`. |
| Thêm khóa đã bắt buộc | Không | Không | Có | Fingerprint không đổi. |
| Bỏ khóa | Không | **Có** | Có | Có thể tụt về `now`, không sàn. |
| Tăng số ngày | Có | Có thể | Có thể | Tính lại từ `D_start`; có thể thấp hơn hạn đang được gia hạn tay. |
| Giảm số ngày | Không | **Có** | Có thể | Có sàn 3 ngày. |
| Gia hạn tay | **Có** | Không | Không | Luôn cộng thêm `N` từ `max(now, hạn)`. |
| Thêm bài vào khóa | **Có** | Không (theo mã hiện tại) | Có thể | Đặc tả tính từ publish; mã cộng vào hạn cũ. |
| Đổi vai trò mở rộng | Có thể | Có thể | Có thể | Công thức 2. |
| Đổi vai trò thu hẹp | Không | **Có** | Có thể | Có thể tụt về `now`. |
| Hoàn thành một khóa | Không | Không | **Có** | Completion không nằm trong fingerprint. |
| Tất cả khóa hoàn thành | Không | **Có** | Không | `due = null`, không còn hạn. |
| Sang tháng mới | Không | Không | **Có** | Không reset nghĩa vụ. |
| Chuyển giao | Có thể | Có thể | Không | Hạn mới theo chu kỳ mới. |
| Retry cùng tập/ngân sách | Không | Không | **Có** | Fingerprint chống cộng lặp. |

### 5.2 Các đường giảm quan trọng

1. **Giảm ngân sách:** có sàn 3 ngày, nhưng vẫn có thể giảm so với hạn cũ.
2. **Bỏ khóa / thu hẹp vai trò:** không có sàn; hạn có thể về đúng `now`.
3. **Bất kỳ lần tính lại nào sau khi đã gia hạn tay:** công thức 2/3 dùng `D_start` và `now`, không dùng hạn hiện tại, nên có thể ghi đè mốc gia hạn.
4. **Tất cả khóa hoàn thành:** hạn bị bỏ (`null`), không còn countdown.
5. **Chuyển giao sang tập nhỏ hơn:** hạn mới có thể ngắn hơn hạn cũ, nhưng đây là chu kỳ mới nên không so trực tiếp.

### 5.3 Cảnh báo

- Đừng dùng “tăng số ngày” như một cách gia hạn an toàn. Nếu hạn đang được gia hạn tay hoặc đang dài hơn công thức, tăng ngân sách vẫn có thể làm hạn ngắn lại.
- Đừng bỏ khóa để “giảm nghĩa vụ” mà không kiểm tra hạn còn lại. Hạn có thể về `now` và cron khóa ngay.
- Đừng unpublish để dừng nghĩa vụ. Unpublish không đóng rule/assignment.
- Muốn giữ một hạn đã gia hạn, phải tránh mọi thay đổi làm fingerprint đổi; nếu buộc phải đổi, hãy kiểm tra hạn mới trước khi lưu.

---

## Phần 6 — Bộ tình huống và bảng quyết định

### 6.1 Mười bốn tình huống xuyên suốt

Quy ước: ngày 0 là `D_start`; các mốc là timestamp chính xác; “hạn” là `learning_paths.due_at`.

#### Tình huống 1 — Khởi tạo A10 + B10

| Mốc | Việc xảy ra | Hạn |
|---|---|---|
| Ngày 0 | Chu kỳ mới, tập A = 10, B = 10 | Ngày 20 |

Kết quả: cả A và B có assignment, cùng hạn ngày 20.

#### Tình huống 2 — Thêm C11 vào ngày 5

| Mốc | Việc xảy ra | Hạn |
|---|---|---|
| Ngày 0 | A10 + B10 | Ngày 20 |
| Ngày 5 | Thêm C11 | `max(31, 5+11) = 31` |

Kết quả: hạn ngày 31; C có 26 ngày từ lúc thêm vì tổng kế hoạch 31 ngày chi phối.

#### Tình huống 3 — Thêm C11 vào ngày 20

| Mốc | Việc xảy ra | Hạn |
|---|---|---|
| Ngày 0 | A10 + B10 | Ngày 20 |
| Ngày 20 | Thêm C11 | `max(31, 31) = 31` |

Kết quả: hạn ngày 31; C có 11 ngày.

#### Tình huống 4 — Thêm C11 sau khi đã quá hạn

| Mốc | Việc xảy ra | Hạn |
|---|---|---|
| Ngày 0 | A10 + B10 | Ngày 20 |
| Ngày 25 | Thêm C11 khi A/B đã quá hạn | `max(31, 36) = 36` |

Kết quả: hạn mới ngày 36, nhưng A/B vẫn có thể đang `OVERDUE` và tài khoản vẫn bị khóa. Thêm khóa không tự mở khóa; Admin phải gia hạn/mở khóa.

#### Tình huống 5 — Thêm khóa đã hoàn thành

| Mốc | Việc xảy ra | Hạn |
|---|---|---|
| Ngày 0 | A10, hạn ngày 10 | Ngày 10 |
| Ngày 5 | Thêm C10, C đã hoàn thành | `max(20, 5+0) = 20` |

Kết quả: C `COMPLETED`, không có countdown cho C; A vẫn phải học nhưng hạn chung lùi đến ngày 20. Nếu A cũng đã hoàn thành → `due = null`.

#### Tình huống 6 — Thêm khóa đã bắt buộc qua target khác

| Mốc | Việc xảy ra | Hạn |
|---|---|---|
| Ngày 0 | A10 + B10 | Ngày 20 |
| Ngày 5 | Tick thêm C vốn đã bắt buộc cho người này | Ngày 20 |

Kết quả: không tạo assignment trùng, không đổi hạn. Rule trùng được gộp.

#### Tình huống 7 — Bỏ B40 khỏi A10 + B40

| Mốc | Việc xảy ra | Hạn |
|---|---|---|
| Ngày 0 | A10 + B40 | Ngày 50 |
| Ngày 20 | Bỏ B | `max(10, 20+0) = 20` |

Kết quả: hạn tụt về ngày 20; không có sàn 3 ngày. Nếu cron chạy sau đó, người học có thể bị `OVERDUE` ngay.

#### Tình huống 8 — Giảm A30 xuống A10 vào ngày 20

| Mốc | Việc xảy ra | Hạn |
|---|---|---|
| Ngày 0 | A30, giao ngày 0 | Ngày 30 |
| Ngày 20 | Giảm còn 10 | `max(10, 10, 23) = 23` |

Kết quả: hạn ngày 23; người học có 3 ngày kể từ lúc đổi.

#### Tình huống 9 — Gia hạn tay 7 ngày

| Hoàn cảnh | Công thức | Kết quả |
|---|---|---|
| Hạn ngày 20, hôm nay ngày 5 | `max(20,5)+7` | Ngày 27 |
| Hạn ngày 5, hôm nay ngày 20 | `max(5,20)+7` | Ngày 27 |
| Hạn đúng hôm nay | `now+7` | Ngày 27 |

Kết quả: assignment chưa xong về `IN_PROGRESS`; restriction `DEADLINE` được gỡ; tài khoản mở nếu không còn lý do khác.

#### Tình huống 10 — Thêm 2 bài vào khóa 20 ngày/7 bài

| Bước | Tính | Kết quả |
|---|---|---|
| `T_extra` | `max(ceil(20/7),3)` | 3 ngày/bài |
| `T_total_extra` | `2 × 3` | 6 ngày |
| Đặc tả | Tính từ publish | Publish ngày 20 → hạn ngày 26 |
| Mã hiện tại | Cộng vào hạn cũ | Hạn cũ ngày 10 → hạn ngày 16 |

Kết quả: đây là `HANDBOOK-DEADLINE-ADDED`, chưa sửa. Khóa đã hoàn thành không bị mở lại; chỉ cộng hạn và gửi notice.

#### Tình huống 11 — Đổi vai trò A10 + B10 → A10 + C11

| Mốc đổi | Tính | Hạn |
|---|---|---|
| Ngày 5 | `max(21, 5+11)` | Ngày 21 |
| Ngày 20 | `max(21, 20+11)` | Ngày 31 |

Kết quả: B bị `ENDED`; A giữ tiến độ; C nhận ngân sách từ lúc đổi nhưng không thấp hơn tổng kế hoạch.

#### Tình huống 12 — Tất cả khóa hoàn thành

| Mốc | Việc xảy ra | Hạn |
|---|---|---|
| Ngày 10 | A hoàn thành | Hạn cũ vẫn có thể còn trong DB |
| Ngày 20 | B hoàn thành | `due = null` khi lần tính lại thấy toàn bộ completed |

Kết quả: không còn countdown, không bị khóa. Nếu sau đó thêm khóa mới, xem cảnh báo `T_new` ở 3.10.

#### Tình huống 13 — Quá hạn, bị khóa, Admin mở khóa

| Mốc | Việc xảy ra | Kết quả |
|---|---|---|
| Ngày 20 | Hạn chung | Chưa khóa ngay |
| 07:00 ngày 21 (Vercel cron) | Quét thấy `due_at < now` | Assignment `OVERDUE`, tài khoản `LOCKED`, tạo restriction `DEADLINE` |
| Ngày 25 | Admin gia hạn +7 | Hạn ngày 32; assignment `IN_PROGRESS`; restriction gỡ; tài khoản `ACTIVE` nếu không còn lý do khác |

Nếu Admin chỉ thêm khóa mới ngày 25 mà không gia hạn → tài khoản vẫn khóa.

#### Tình huống 14 — Bỏ rồi bật lại khóa

| Trạng thái | Bỏ khóa | Bật lại |
|---|---|---|
| Đã hoàn thành | Assignment `ENDED`, giữ `completed_at` | Assignment `COMPLETED` trở lại, không bắt học lại |
| Chưa hoàn thành | Assignment `ENDED`, giữ tiến độ | Assignment `ASSIGNED` trở lại, hạn tính lại |
| Đang bị khóa | Không tự mở khóa | Không tự mở khóa; vẫn cần gia hạn/mở |

### 6.2 Bảng quyết định theo hành động

| Hành động Admin | Assignment | Hạn chung | Tài khoản đang khóa | Thông báo |
|---|---|---|---|---|
| Thêm khóa mới | Tạo hoặc hồi sinh; completed nếu đã xong | Tính lại; `T_added` cho khóa mới chưa xong | Không tự mở | Không có notice tự động |
| Bỏ khóa | `ENDED`, giữ tiến độ | Tính lại; có thể về `now` | Không tự mở | Không có notice |
| Tăng số ngày | Không đổi assignment | Tính lại từ `D_start`; có thể giảm nếu đang gia hạn tay | Không tự mở | Không có notice |
| Giảm số ngày | Không đổi assignment | Tính lại; sàn 3 ngày | Không tự mở | Không có notice |
| Thêm bài | Assignment completed không mở lại | Cộng `k × T_extra` vào hạn hiện tại (mã) | Không tự mở | Có `LearningNotice` |
| Gia hạn tay | Chưa xong → `IN_PROGRESS` | `max(now, hạn) + N` | Mở nếu không còn lý do khác | Audit, không notice |
| Đổi đơn vị/chức vụ | Kết thúc/tạo theo tập mới | Tính lại | Không tự mở | Không có notice |
| Chuyển giao | Kết thúc toàn bộ, tạo chu kỳ mới | Hạn mới từ chu kỳ mới | Tùy trạng thái tài khoản | Snapshot, outbox |
| Unpublish | Không đổi | Không đổi | Không tự mở | Không có notice |

### 6.3 Bảng quyết định theo trạng thái người học

| Trạng thái người học | Thêm khóa | Bỏ khóa | Giảm ngày | Gia hạn tay |
|---|---|---|---|---|
| Chưa có assignment, chưa học | Tạo assignment; nhận ngân sách | Không áp dụng | Không áp dụng | Có thể lỗi nếu chưa có chu kỳ/lộ trình |
| Đang học dở | Giữ tiến độ; tính lại hạn | Kết thúc nghĩa vụ; tiến độ giữ | Có sàn 3 ngày | Cập nhật mọi assignment chưa xong |
| Đã hoàn thành khóa | `COMPLETED`; không bắt học lại | Giữ `COMPLETED` | Không mở lại nghĩa vụ | Không cập nhật assignment đã xong |
| Đã hoàn thành tất cả | Có thể làm hạn dịch xa do `T_new` | `due = null` | Không áp dụng | Có thể tạo hạn mới dù không còn việc |
| Đang bắt buộc khóa đó | Không tạo trùng, không đổi hạn | Kết thúc | Có thể tính lại | Cập nhật assignment |
| Đang bị khóa do quá hạn | Không tự mở | Không tự mở | Không tự mở | Mở nếu không còn lý do khác |

### 6.4 Trả lời trực tiếp các câu hỏi thường gặp

**“Nếu khóa học bắt buộc đã học xong mà Admin thêm vào thì sao?”**

- Trong cùng chu kỳ: assignment `COMPLETED`, không phải học lại, không bị countdown cho khóa đó.
- Nếu còn khóa khác chưa xong: hạn chung có thể vẫn dịch do khóa đã xong nằm trong `T_new`.
- Nếu tất cả đều xong: không còn hạn.
- Nếu hoàn thành ở chu kỳ trước: sau chuyển giao, phải học lại.

**“Nếu chưa học tới mà thêm vào thì sao?”**

- Assignment mới, không reset tiến độ khác.
- Khóa mới góp `T_added`; người học có ít nhất ngân sách của khóa mới kể từ lúc thay đổi, nhưng không thấp hơn tổng kế hoạch từ `D_start`.
- Không có hạn riêng cho khóa; mọi khóa chưa xong dùng chung hạn.
- Nếu người học chưa từng mở ứng dụng sau khi lưu ma trận, assignment có thể chưa được materialize; xem 4.11.

**“Admin thay đổi thì người dùng có được tăng thời gian không?”**

- Thêm khóa mới: thường có, theo công thức 2.
- Tăng số ngày: có thể có, nhưng tính lại toàn bộ.
- Gia hạn tay: chắc chắn có, trừ khi không có chu kỳ/lộ trình.
- Giảm số ngày: có thể vẫn tăng nếu sàn 3 ngày lớn hơn hạn cũ, nhưng thường là giảm.
- Bỏ khóa: có thể giảm mạnh.

**“Có khi nào thời gian giảm không?”**

- Có, xem Phần 5. Đặc biệt: bỏ khóa, thu hẹp vai trò, giảm ngân sách, và mọi lần tính lại sau khi đã gia hạn tay.

---

## Phần 7 — Người học thấy gì?

### 7.1 Badge và countdown

- API `GET /api/v1/members/me/deadlines` trả:
  - `summary.earliestDueAt`, `latestDueAt`;
  - `totalMandatoryCourses`, `completedMandatoryCourses`;
  - danh sách `items` gồm các assignment `ASSIGNED`, `IN_PROGRESS`, `OVERDUE` (`src/app/api/v1/members/me/deadlines/route.ts:12-53`).
- Countdown lấy từ `earliestDueAt`; số ngày còn lại = `ceil(ms / 86_400_000)` (`src/app/student/courses/page.tsx:273-291`).
- Trong mô hình chung, các assignment chưa xong có cùng hạn nên `earliestDueAt` = hạn chung. Trong legacy, các assignment có thể có hạn khác nhau, nên `earliestDueAt` là hạn sớm nhất.
- Assignment `COMPLETED` không nằm trong `items`, nhưng vẫn được đếm trong `totalMandatoryCourses` và `completedMandatoryCourses` nếu còn `ended_at = null`.

### 7.2 Các mức cảnh báo

`getUrgencyLevel()` (`src/lib/deadline-urgency.ts:11-129`) trả nhãn theo số ngày còn lại:

| Điều kiện | Nhãn |
|---|---|
| Không có hạn (`null`) | “Khóa học bắt buộc” — không countdown |
| `< 0` | “Quá hạn N ngày” |
| `<= 1` | “Khẩn cấp cực độ! Còn dưới 24h” |
| `<= 3` | “Rất gấp! Còn dưới 3 ngày” |
| `<= 5` | “Khẩn trương! Còn dưới 5 ngày” |
| `<= 10` | “Sắp đến hạn! Còn dưới 10 ngày” |
| `<= 15` | “Cần tăng tốc! Còn dưới 15 ngày” |
| `<= 20` | “Cần chú ý! Còn dưới 20 ngày” |
| `<= 30` | “Tiến độ ổn định! Còn dưới 30 ngày” |
| `> 30` | “Thư thả! Còn trên 30 ngày” |

### 7.3 Khóa đã hoàn thành, quá hạn, không có hạn

- **Đã hoàn thành:** không còn countdown, không bị khóa vì khóa đó; vẫn có thể xuất hiện trong tổng số khóa bắt buộc.
- **Quá hạn:** item vẫn hiển thị với số ngày âm; tài khoản có thể đã bị khóa. Việc hoàn thành sau khi bị khóa **không tự mở khóa**; cron không có logic mở.
- **Không có hạn:** item vẫn có thể nằm trong danh sách active nhưng không có `dueAt`; UI hiển thị nhãn “Khóa học bắt buộc” mà không có countdown.
- **Đã bỏ khóa:** assignment `ENDED` không còn trong danh sách active.

### 7.4 Thông báo nội dung bổ sung

- Khi Admin publish thêm bài, hệ thống tạo `LearningNotice` với tiêu đề “Khóa học có nội dung bổ sung” và nội dung nêu số bài mới, số ngày cộng thêm, hạn mới (`src/lib/course-requirements.ts:48-57`).
- Notice được trả trong `GET /api/v1/learning/me` (`src/app/api/v1/learning/me/route.ts:25-47`).
- Không có notice tự động khi khóa mới trở thành bắt buộc, khi bỏ khóa, khi tăng/giảm ngày, hoặc khi gia hạn tay. Người học chỉ thấy thay đổi khi mở lại trang học/deadlines.

### 7.5 Trải nghiệm khi bị khóa

- Khi quá hạn, cron đặt `users.status = LOCKED`, `lock_reason = OVERDUE_LOCK`, tăng `auth_version`, và tạo `AccessRestriction` loại `DEADLINE` (`src/app/api/internal/learning/deadlines/enforce/route.ts:60-80`).
- Restriction có `source_reference = learning-assignment:<assignmentId>` để phân biệt từng assignment.
- Admin không bị khóa; assignment của Admin vẫn có thể `OVERDUE` nhưng cron bỏ qua việc khóa.
- Admin mở khóa bằng luồng gia hạn; lịch sử restriction được giữ với `lifted_at`.
- Nếu người học hoàn thành đúng lúc cron đang chạy, bước đồng bộ completion có thể đưa assignment về `COMPLETED` trước khi chuyển `OVERDUE`; khi đó cron không khóa. Nếu đã bị khóa từ trước, hoàn thành không tự mở.

### 7.6 Sang tháng mới và chuyển giao khác nhau

- **Sang tháng:** tạo cửa sổ thưởng mới, giữ tiến độ học, **không** reset nghĩa vụ bắt buộc và **không** đổi hạn. Xem `docs/business-rules.md:42-53`.
- **Chuyển giao Chapter/DNA:** reset chu kỳ học, tiến độ, assignment; hạn mới. Xem 4.9.
- Vì vậy, đừng dùng “đầu tháng” để suy đoán hạn mới. Chỉ chuyển giao hoặc thay đổi cấu hình mới làm hạn đổi.

---

## Phần 8 — Vận hành và kiểm tra

### 8.1 Checklist trước khi tick khóa

1. Khóa đã có nội dung và trạng thái mong muốn chưa? Ma trận không chặn `DRAFT`, nhưng người học có thể không mở được.
2. Khóa đã có `program_id` chưa? Publish sẽ lỗi nếu thiếu (`src/lib/course-requirements.ts:28`).
3. Target có scope chưa? Nếu API trả `ScopeNotConfigured`, kiểm tra đơn vị/chức vụ tương ứng.
4. Số ngày có hợp lệ không? Ma trận yêu cầu số nguyên 1–3650.
5. Khóa đã bắt buộc cho target này chưa? Nếu rồi, tick lại không tạo thêm thời gian.
6. Có người đang bị khóa không? Nếu có, chuẩn bị luồng gia hạn riêng; thêm khóa không mở khóa.
7. Có người đã hoàn thành khóa không? Họ sẽ nhận assignment `COMPLETED`; hạn chung vẫn có thể dịch do `T_new`.
8. Có đang giảm số ngày hoặc bỏ khóa không? Kiểm tra sàn 3 ngày và khả năng hạn tụt về `now`.

### 8.2 Checklist sau khi lưu

1. Kiểm tra rule đang hiệu lực của khóa:
   - `learning_rules` có bản ghi `effective_from <= now < effective_until` (hoặc `effective_until` null).
   - `target_code`, `organization_unit_id`, `position_id` đúng.
2. Kiểm tra một user mẫu:
   - `user_learning_assignments` có assignment `mandatory = true`, `ended_at` null.
   - `due_at` khớp hạn chung.
   - `status` là `ASSIGNED`/`IN_PROGRESS`/`COMPLETED`/`OVERDUE` hợp lý.
3. Kiểm tra `learning_paths`:
   - `starts_at`, `due_at`, `budget`, `budget_fingerprint`.
   - `learning_path_changes` có bản ghi mới nếu tập/ngân sách đổi.
4. Kiểm tra `learning_outbox`:
   - Có event `RECONCILE_ASSIGNMENTS` cho user chưa xử lý.
   - Nếu production không có worker, mở thử trang học/deadlines của user mẫu để kích hoạt read-through.
5. Kiểm tra `audit_logs`:
   - `UPDATE_MANDATORY_MATRIX` với metadata changes/rowDefaults.
6. Kiểm tra người đang bị khóa:
   - Có bị ảnh hưởng bởi hạn mới không.
   - Có cần gia hạn/mở khóa riêng không.

### 8.3 Quy trình thêm khóa đã hoàn thành hoặc đang học dở

1. Xác định khóa đã được học trong **chu kỳ hiện tại** hay chỉ ở chu kỳ cũ.
2. Nếu đã hoàn thành trong chu kỳ hiện tại:
   - Tick bình thường.
   - Kiểm tra assignment mẫu phải là `COMPLETED`, không có countdown.
   - Kiểm tra hạn chung: nếu còn khóa khác chưa xong, hạn có thể dịch do `T_new`; nếu tất cả xong, `due = null`.
3. Nếu đang học dở:
   - Tick bình thường; tiến độ được giữ.
   - Nhắc người học rằng khóa dùng chung hạn, không có hạn riêng.
4. Nếu hoàn thành ở chu kỳ trước:
   - Sau chuyển giao, coi như chưa hoàn thành; người học phải học lại.
5. Nếu khóa đã bắt buộc qua target khác:
   - Không cần tick thêm nếu chỉ muốn giữ nguyên thời gian; tick thêm không đổi hạn.

### 8.4 Quy trình giảm số ngày

1. Xác định khóa bị giảm và số ngày mới.
2. Kiểm tra hạn hiện tại và số ngày còn lại.
3. Lưu; hệ thống áp công thức 3 với sàn 3 ngày.
4. Kiểm tra người đang học dở: hạn mới có thể sát 3 ngày kể từ lúc lưu.
5. Thông báo cho người học nếu hạn thay đổi đáng kể (hiện không có notice tự động).
6. Nếu có người đang bị khóa, xử lý gia hạn riêng.

### 8.5 Quy trình thêm bài vào khóa

1. Không cần kiểm tra cutover/policy; việc cộng ngày áp cho mọi assignment gắn chu kỳ.
2. Publish cập nhật; hệ thống tính `k × max(ceil(T_course / L_after), 3)`.
3. Kiểm tra `course_requirement_versions` có version mới.
4. Kiểm tra `learning_notices` cho user mẫu.
5. Kiểm tra `learning_paths.due_at` và assignment due.
6. Biết rằng mã hiện tại cộng từ hạn cũ, không phải từ publish; đối chiếu `HANDBOOK-DEADLINE-ADDED` trước khi hứa hạn cụ thể với người học.
7. Nếu sau đó có thay đổi tập/ngân sách, phần cộng thêm có thể bị mất khi tính lại; kiểm tra lại hạn.

### 8.6 Quy trình mở khóa

1. Xác nhận người học đang bị khóa vì `DEADLINE`/`OVERDUE_LOCK`, không phải `INACTIVE` hay `PASSWORD_LOCK`.
2. Mở modal “Mở khóa & Gia hạn”.
3. Chọn số ngày; xem trước hạn mới nếu UI hỗ trợ; hiểu rằng backend cộng từ `max(now, hạn cũ)`.
4. Xác nhận; kiểm tra:
   - `learning_paths.due_at` mới;
   - assignment chưa xong chuyển `IN_PROGRESS`;
   - restriction `DEADLINE` có `lifted_at`;
   - `users.status = ACTIVE` nếu không còn lý do khác;
   - audit `EXTEND_DEADLINE`.
5. Nếu tài khoản vẫn `LOCKED`, kiểm tra restriction khác hoặc `lock_reason`.
6. Không dùng luồng đổi trạng thái `ACTIVE` tùy tiện: luồng đó gỡ tất cả restriction và không cập nhật lộ trình (xem Phần 9).

### 8.7 Quy trình bỏ khóa hoặc unpublish

**Bỏ khóa khỏi target:**

1. Kiểm tra hạn hiện tại và số ngày còn lại của người học.
2. Bỏ tick; assignment sẽ `ENDED` ở lần reconcile.
3. Kiểm tra hạn mới; nó có thể về `now` nếu tập còn lại đã hết hạn hoặc không còn khóa.
4. Nếu người học bị khóa, xử lý mở khóa riêng.

**Unpublish:**

1. Hiểu rằng unpublish **không** kết thúc nghĩa vụ.
2. Nếu muốn dừng nghĩa vụ, bỏ tick target hoặc đóng rule.
3. Nếu chỉ muốn tạm ẩn nội dung, chấp nhận người học vẫn có thể bị tính hạn/khóa.
4. Kiểm tra các assignment đang mở trước khi unpublish.

### 8.8 Audit và lịch sử

| Nguồn | Ghi gì | Khi nào |
|---|---|---|
| `audit_logs` | `UPDATE_MANDATORY_MATRIX`, `EXTEND_DEADLINE`, `DEACTIVATE_LEARNING_RULE`, `UPDATE_STATUS` | Lưu ma trận, gia hạn, đóng rule, đổi trạng thái |
| `learning_path_changes` | Budget trước/sau, hạn mới, lý do | Khi tập/ngân sách đổi; gia hạn tay |
| `course_publication_events` | Lần publish | Mỗi lần publish |
| `course_requirement_versions` | Ảnh chụp bài/quiz/final | Mỗi lần nội dung đổi |
| `learning_notices` | Thông báo nội dung bổ sung | Khi publish thêm bài |
| `access_restrictions` | Restriction và lần gỡ | Khi khóa/mở khóa |
| `learning_outbox` | Event reconcile, lỗi, số lần thử | Khi enqueue/xử lý |
| `learning_snapshots` | Ảnh chụp trước chuyển giao/reset DNA | Khi apply chuyển giao/reset |

Lưu ý: thêm bài **không** ghi `learning_path_changes`; đây là lỗ hổng audit cần biết khi tra lịch sử hạn.

### 8.9 Câu lệnh kiểm tra read-only

```sql
-- Rule đang hiệu lực của một khóa
SELECT id, target_code, organization_unit_id, position_id,
       mandatory, due_days, effective_from, effective_until
FROM learning_rules
WHERE course_id = :course_id
  AND effective_from <= now()
  AND (effective_until IS NULL OR effective_until > now());

-- Assignment đang mở của một người
SELECT u.email, a.course_id, a.status, a.mandatory,
       a.due_at, a.assigned_at, a.completed_at, a.ended_at
FROM user_learning_assignments a
JOIN users u ON u.id = a.user_id
WHERE a.user_id = :user_id
  AND a.ended_at IS NULL
ORDER BY a.due_at NULLS LAST;

-- Lộ trình đang mở
SELECT p.starts_at, p.due_at, p.budget, p.budget_fingerprint
FROM learning_paths p
JOIN learning_cycles c ON c.id = p.learning_cycle_id
WHERE p.user_id = :user_id
  AND c.ends_at IS NULL;

-- Lịch sử tính lại hạn
SELECT changed_at, reason, previous_budget, next_budget, due_at
FROM learning_path_changes
WHERE path_id = :path_id
ORDER BY changed_at DESC;

-- Outbox còn chờ
SELECT id, event_key, kind, user_id, attempts, available_at, last_error
FROM learning_outbox
WHERE processed_at IS NULL
ORDER BY available_at
LIMIT 50;

-- Restriction đang mở
SELECT id, user_id, type, reason, source_reference, created_at
FROM access_restrictions
WHERE user_id = :user_id
  AND lifted_at IS NULL;
```

### 8.10 Kiểm tra tự động

- `npm run test:shared-deadline` — test coordinator tính hạn chung.
- `npm run test:learning-cycles` — test công thức thuần, fingerprint, các mốc.
- `npm run audit:mandatory-learning` — audit dữ liệu học bắt buộc.
- `npm run audit:handbook-formulas` — đối chiếu công thức sổ tay; có thể còn FAIL do các điểm lệch đã biết, không phải cứ FAIL là mã sai toàn bộ.

---

## Phần 9 — Điểm lệch, giới hạn và chưa xác nhận

### 9.1 Nhóm A — Công thức hạn

| ID | Nội dung | Ảnh hưởng | Trạng thái |
|---|---|---|---|
| KHBB-A1 | `HANDBOOK-DEADLINE-ADDED`: thêm bài tính từ publish theo đặc tả, mã cộng vào hạn cũ. | Ví dụ 20 ngày/7 bài: đặc tả ngày 26, mã ngày 16. | [LỆCH] đã ghi nhận tại `docs/known-issues.md:11`. |
| KHBB-A2 | Gia hạn tay bị ghi đè khi tập/ngân sách đổi. | Mọi lần tính lại dùng `D_start + T_new`, không dùng hạn hiện tại; hạn có thể giảm dù Admin vừa gia hạn. | [MÃ] + [CHƯA XÁC NHẬN] ý định. |
| KHBB-A3 | Bỏ khóa/thu hẹp vai trò không có sàn 3 ngày. | Hạn có thể về đúng `now`, gây quá hạn ngay. | [MÃ], test `src/test/shared-learning-path.test.ts:63-67`. |
| KHBB-A4 | Thêm bài vào khóa đã hoàn thành không mở lại assignment. | Người học không phải học bài mới; chỉ cộng hạn và gửi notice. | [MÃ]; cần chốt nếu muốn bắt học lại. |
| KHBB-A5 | Phần `+extraDays` của bài mới không nằm trong budget/fingerprint. | Lần đổi tập/ngân sách sau có thể làm mất phần cộng thêm. | [MÃ] + [CHƯA XÁC NHẬN]. |
| KHBB-A6 | Khóa đã hoàn thành vẫn nằm trong `T_new`. | Thêm một khóa nhỏ sau một kế hoạch lớn đã xong có thể đẩy hạn rất xa. | [MÃ], hệ quả công thức; cần chốt. |
| KHBB-A7 | Giảm ngân sách đồng thời thêm khóa: nhánh `ADMIN_BUDGET_SHORTENED` bỏ qua `T_added`. | Khóa mới có thể chỉ nhận 3 ngày thay vì đủ ngân sách. | [MÃ] + [CHƯA XÁC NHẬN]. |
| KHBB-A8 | Các nhánh `MANDATORY_COURSE_ADDED`/`REMOVED` có trong hàm thuần nhưng coordinator không chọn. | Không nên đọc các nhánh đó như hành vi thực tế; coordinator dùng `ROLE_CHANGED`/`ADMIN_BUDGET_SHORTENED`. | [MÃ]. |
| KHBB-A9 | Đặc tả “tính từ publish” có thể rút ngắn hạn nếu hạn cũ đang xa hơn publish + extra. | Cần chốt quy tắc khi hạn cũ đã được gia hạn. | [CHƯA XÁC NHẬN]. |

### 9.2 Nhóm B — Cấu hình và materialize

| ID | Nội dung | Ảnh hưởng | Trạng thái |
|---|---|---|---|
| KHBB-B1 | Unpublish không đóng rule/assignment. | Người học không mở được khóa nhưng vẫn bị hạn/khóa. | [MÃ], `src/app/api/v1/courses/[courseId]/unpublish/route.ts:46-49`. |
| KHBB-B2 | Ma trận hiển thị và cho tick khóa `DRAFT`; API không chặn trạng thái. | Nghĩa vụ có thể tồn tại trước khi khóa học được mở. | [MÃ], `src/app/api/v1/admin/mandatory-matrix/route.ts:126-165`. |
| KHBB-B3 | `POST /admin/learning-rules` không enqueue/materialize và không đặt `target_code`. | Rule có thể chưa áp dụng ngay; phạm vi rộng hơn dự kiến. | [MÃ], `src/app/api/v1/admin/learning-rules/route.ts:36-74`. |
| KHBB-B4 | Outbox không có worker định kỳ trong repo. | Assignment mới có thể chỉ xuất hiện khi user mở trang học/deadlines; cron không thấy user chưa materialize. | [MÃ] + [CHƯA XÁC NHẬN] vận hành production. |
| KHBB-B5 | Rule bắt buộc + `can_view = false` có thể tạo nghĩa vụ không thể học. | Người học bị hạn nhưng không mở được khóa. | [MÃ], cần tránh khi cấu hình. |
| KHBB-B6 | Target LT nhận cả `DEPARTMENT_LEAD` và `DEPARTMENT_LEADER`, nhưng ma trận chỉ tạo scope cho `DEPARTMENT_LEAD`. | Môi trường chỉ có `DEPARTMENT_LEADER` có thể không cấu hình được target LT. | [MÃ] + [CHƯA XÁC NHẬN] dữ liệu thực tế. |
| KHBB-B7 | Legacy: đổi `rule.due_days` không cập nhật hạn của assignment đã có. | Người học cũ giữ hạn cũ; chỉ người mới nhận số ngày mới. | [MÃ], `src/lib/learning-assignments.ts:137-138`. |
| KHBB-B8 | Không có notice khi khóa mới thành bắt buộc, bỏ khóa, tăng/giảm ngày. | Người học chỉ biết khi mở lại ứng dụng. | [MÃ]. |

### 9.3 Nhóm C — Mở khóa và UX

| ID | Nội dung | Ảnh hưởng | Trạng thái |
|---|---|---|---|
| KHBB-C1 | Hai luồng mở khóa không đồng nhất: endpoint chuyên dụng cập nhật lộ trình; luồng đổi trạng thái `ACTIVE` chỉ cập nhật assignment `OVERDUE`, không cập nhật path, và gỡ tất cả restriction. | Hạn có thể lệch giữa path và assignment; restriction khác có thể bị gỡ ngoài ý muốn. | [MÃ], `src/app/api/v1/users/[userId]/route.ts:165-176`. |
| KHBB-C2 | UI gia hạn ghi “từ hôm nay”, backend cộng từ `max(now, hạn)`. | Admin có thể hiểu sai hạn mới khi hạn còn ở tương lai. | [MÃ] + UI. |
| KHBB-C3 | Endpoint gia hạn lỗi nếu user không có chu kỳ/lộ trình. | Không dùng được cho người chưa từng phát sinh chu kỳ/lộ trình. | [MÃ], `src/app/api/v1/admin/users/[userId]/extend-deadline/route.ts:32-45`. |
| KHBB-C4 | Việc bắt đầu học không tự đổi assignment sang `IN_PROGRESS`. | Báo cáo trạng thái có thể trông “chưa bắt đầu” dù đã học. | [MÃ]. |

### 9.4 Nhóm D — Dữ liệu và thời điểm

| ID | Nội dung | Ảnh hưởng | Trạng thái |
|---|---|---|---|
| KHBB-D1 | `D_start` của lộ trình là lúc reconcile tạo path, không nhất thiết là lúc chu kỳ bắt đầu. | Sau chuyển giao, nếu reconcile trễ, người học có thêm thời gian ngoài dự kiến. | [MÃ] + [CHƯA XÁC NHẬN]. |
| KHBB-D2 | Assignment có `due_at = null` không bị quá hạn và không có countdown. | Legacy/rule thiếu số ngày có thể không bao giờ bị khóa. | [MÃ], cần kiểm tra dữ liệu. |
| KHBB-D3 | `learning_paths.due_at` có thể còn hạn cũ khi tất cả đã hoàn thành (do fingerprint không đổi). | Đọc path đơn lẻ dễ kết luận sai còn nghĩa vụ; nên đọc assignment. | [MÃ]. |
| KHBB-D4 | `enforce` chạy theo lịch Vercel 07:00 VN hoặc mỗi phút nếu dùng scheduler. | Thời điểm khóa thực tế phụ thuộc cách triển khai; có thể trễ tới gần một ngày. | [MÃ] + [CHƯA XÁC NHẬN] production. |
| KHBB-D5 | `learning_path_changes` không ghi khi thêm bài. | Thiếu dấu vết audit cho phần cộng ngày do nội dung. | [MÃ]. |
| KHBB-D6 | `WAIVED` có trong enum nhưng chưa thấy luồng gán. | Không nên dùng như trạng thái nghiệp vụ đã hoàn chỉnh. | [MÃ]. |

### 9.5 Phạm vi chưa kiểm chứng production

- Tài liệu **không** khẳng định `learning_policy` đang active, mapping đã duyệt, hoặc production đang dùng mô hình deadline chung.
- Không khẳng định dữ liệu chức vụ thực tế dùng `DEPARTMENT_LEAD` hay `DEPARTMENT_LEADER`.
- Không khẳng định có worker ngoài repo xử lý `learning_outbox`.
- Không khẳng định cron production là Vercel hằng ngày hay scheduler mỗi phút.
- Không khẳng định mọi người dùng đã có chu kỳ/lộ trình; người legacy có thể chưa có.
- Muốn kết luận production, cần đối chiếu read-only policy, rule, assignment, path, outbox và audit.

---

## Phần 10 — Phụ lục

### 10.1 Bảng công thức tóm tắt

| Mã | Tình huống | Công thức | Nguồn |
|---|---|---|---|
| F1 | Khởi tạo chu kỳ | `D = D_start + T_new` | `src/lib/learning-cycle-rules.ts:52-53` |
| F2 | Đổi tập nghĩa vụ | `D = max(D_start+T_new, D_change+T_added)` | `src/lib/learning-cycle-rules.ts:85-91` |
| F3 | Giảm ngân sách | `D = max(D_start+T_new, max(D_assigned+T_new_course), D_adminChange+3d)` | `src/lib/learning-cycle-rules.ts:67-83` |
| F4 | Gia hạn tay | `D = max(now, D_current) + N` | `src/app/api/v1/admin/users/[userId]/extend-deadline/route.ts:47-51` |
| F5 | Thêm bài | `T_extra = max(ceil(T_course/L_after),3)`, tổng `k×T_extra` | `src/lib/course-requirements.ts:31` |
| F6 | Rỗng/hoàn thành | `D = null` | `src/lib/learning-cycle-rules.ts:43` |

### 10.2 Bảng trạng thái và restriction

| Giá trị | Nhóm | Ý nghĩa |
|---|---|---|
| `ASSIGNED` | Assignment | Đã giao, chưa xong. |
| `IN_PROGRESS` | Assignment | Đang thực hiện; thường do Admin gia hạn/mở khóa đặt. |
| `COMPLETED` | Assignment | Đã hoàn thành đủ điều kiện. |
| `OVERDUE` | Assignment | Đã quá hạn. |
| `WAIVED` | Assignment | Có trong enum, chưa thấy luồng gán. |
| `ENDED` | Assignment | Nghĩa vụ kết thúc do bỏ rule/đổi đơn vị/chuyển giao. |
| `DIRECT_ADMIN` | Restriction | Chặn bởi Admin. |
| `DEADLINE` | Restriction | Chặn do quá hạn học. |
| `CHAPTER_CASCADE` | Restriction | Chặn theo cascade tổ chức. |

### 10.3 Bảng nguồn

| Chủ đề | Nguồn chính |
|---|---|
| 3 role DB | `prisma/schema.prisma:16-22` |
| 18 target | `src/lib/learning-catalog.ts:13-18` |
| Suy ra target | `src/lib/learning-targets.ts:3-18` |
| Rule | `prisma/schema.prisma:758-782` |
| Assignment | `prisma/schema.prisma:784-813` |
| Reconcile | `src/lib/learning-assignments.ts:25-177` |
| Gộp rule | `src/lib/learning-assignments.ts:86-118` |
| Hoàn thành khóa | `src/lib/learning-assignments.ts:180-228` |
| Hạn chung | `src/lib/shared-learning-path.ts:5-57` |
| Công thức | `src/lib/learning-cycle-rules.ts:38-118` |
| Ma trận | `src/app/api/v1/admin/mandatory-matrix/route.ts:126-378` |
| Gia hạn | `src/app/api/v1/admin/users/[userId]/extend-deadline/route.ts:6-169` |
| Cron quá hạn | `src/app/api/internal/learning/deadlines/enforce/route.ts:8-97` |
| Deadline API | `src/app/api/v1/members/me/deadlines/route.ts:6-54` |
| Countdown | `src/app/student/courses/page.tsx:273-291` |
| Cảnh báo thời gian | `src/lib/deadline-urgency.ts:11-129` |
| Thêm bài | `src/lib/course-requirements.ts:26-82` |
| Outbox | `src/lib/learning-outbox.ts:5-70` |
| Chuyển giao Chapter | `src/lib/chapter-reorganizations.ts:65-82` |
| Reset DNA | `src/lib/dna-cycle-resets.ts:13-39` |
| Unpublish | `src/app/api/v1/courses/[courseId]/unpublish/route.ts:6-63` |
| Cron config | `vercel.json:5-14` |
| Scheduler | `scripts/learning-scheduler.mjs:7` |
| Đặc tả công thức | `docs/reference/handbook-formulas.md:292-374` |
| Quy tắc nghiệp vụ | `docs/business-rules.md:55-71` |
| Điểm lệch đã biết | `docs/known-issues.md:9-17` |
| Test hạn chung | `src/test/shared-learning-path.test.ts:33-101` |
| Test công thức | `src/test/learning-cycles.test.ts:39-74` |

### 10.4 Endpoint và giao diện liên quan

| Thành phần | Đường dẫn |
|---|---|
| Ma trận bắt buộc | `/admin/courses/mandatory` |
| API ma trận | `GET/PUT /api/v1/admin/mandatory-matrix` |
| API rule | `GET/POST /api/v1/admin/learning-rules`, `PATCH /api/v1/admin/learning-rules/[ruleId]` |
| Trang Admin người dùng | `/admin/users` |
| API gia hạn/mở khóa | `POST /api/v1/admin/users/[userId]/extend-deadline` |
| API đổi trạng thái người dùng | `PATCH /api/v1/users/[userId]` |
| API hạn của tôi | `GET /api/v1/members/me/deadlines` |
| API ngữ cảnh học | `GET /api/v1/learning/me` |
| Cron quá hạn | `GET/POST /api/internal/learning/deadlines/enforce` |
| Cron chuyển giao | `GET/POST /api/internal/organization/reorganizations/apply` |
| Trang học của người học | `/student/courses` |

### 10.5 Ghi chú biên soạn

- Tài liệu chỉ mô tả nghiệp vụ và hành vi hiện tại; **không sửa mã**, schema, dữ liệu hoặc công thức.
- Các ví dụ dùng ngày 0 làm mốc tương đối; khi áp dụng thực tế, thay bằng timestamp thực.
- Khi có thay đổi mã, cần cập nhật lại các mục có gắn `file:line` và chạy lại các test/audit ở 8.10.
- Các điểm [LỆCH] và [CHƯA XÁC NHẬN] không phải là cam kết đã được sửa; chúng là danh sách cần chốt với nghiệp vụ hoặc xử lý ở đợt riêng.
