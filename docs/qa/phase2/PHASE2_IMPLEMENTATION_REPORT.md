# BÁO CÁO NGHIỆM THU GIAI ĐOẠN 2/3: CHUẨN HÓA PHÂN QUYỀN, API VÀ GIAO DIỆN BẢNG XẾP HẠNG
**Dự án**: BBE E-Learning (`https://github.com/VoVanHieu2006/-BBE-E-Learning`)
**Ngày thực hiện**: 24/10/2026
**Trạng thái**: **HOÀN THÀNH TOÀN DIỆN & SẴN SÀNG NGHIỆM THU** (Dừng theo yêu cầu, không triển khai Giai đoạn 3)

---

## 1. TỔNG QUAN KẾT QUẢ & ROOT CAUSES ĐÃ XỬ LÝ

### 1.1. Root Causes phân tích từ baseline
1. **API `/api/v1/learning/periods` bị khóa cứng `authenticate()`**:
   - *Nguyên nhân*: API yêu cầu session token hợp lệ, nếu không đăng nhập sẽ trả về `401 Unauthorized`. Khách truy cập trang `/leaderboard` không thể tải danh mục tháng và đợt chuyển giao nhiệm kỳ.
   - *Khắc phục*: Tách luồng xác thực mềm (`getAuthUserFromRequest`). Nếu không có token, hệ thống gán role `GUEST`, scope `isGlobal: true`, cấp quyền xem đủ 8 nhóm bảng công khai (`MEMBER`, `LT`, `DNA`, `CHAPTER`).
2. **Hiện tượng tự động tiêm ngầm `chapterId` vào bảng tổng toàn hệ thống**:
   - *Nguyên nhân*: Trong `UnifiedLeaderboard.tsx`, component tự đọc `localStorage.getItem('user')` và gán mặc định `selectedChapterId = currentUser.chapterId`. Đồng thời, logic fetch tự fallback `activeChapId = selectedChapterId || currentUser?.chapterId`, khiến Admin và Khách xem bảng toàn quốc lại bị giới hạn trong 1 Chapter duy nhất.
   - *Khắc phục*: Tách biệt hoàn toàn `isGlobal`. Khi đang ở chế độ toàn hệ thống (`isGlobal === true`), mặc định `selectedChapterId = ""` ("Tất cả Chapter"), không tự tiêm Chapter của user vào request URL.
3. **Lộ tab và rò rỉ dữ liệu qua API (Insecure Direct Object References - IDOR)**:
   - *Nguyên nhân*: Baseline hiển thị cố định 4 tab UI (`MEMBER`, `LT`, `DNA`, `CHAPTER`) cho tất cả mọi người; người dùng đổi query param hoặc tab bị lỗi 403 hoặc đọc được dữ liệu do Backend thiếu kiểm tra chéo `chapterId` và `group` đối với role `CHAPTER_LEADER`, `LEAD_CHAPTER`, `LEAD_DNA`.
   - *Khắc phục*:
     - **UI**: Backend trả về mảng `allowedGroups` từ API periods dựa trên vai trò thực tế. Component `UnifiedLeaderboard` chỉ render các tab nằm trong `allowedGroups`.
     - **Backend API**: Enforce phân quyền trực tiếp tại `src/lib/period-leaderboard.ts`: Lead Chapter và Member Chapter chỉ được truy vấn `MEMBER`/`LT` và đúng `chapterId` thuộc quyền quản lý; Lead DNA và Member DNA chỉ được truy vấn `DNA` và đúng `dnaUnitId`. Mọi hành vi cố tình đổi `chapterId`, `group`, hoặc truy vấn kỳ chuyển giao của Chapter khác đều bị từ chối bằng `403 AccessDenied`.
4. **Rò rỉ dữ liệu nhạy cảm cho khách chưa đăng nhập (Public DTO)**:
   - *Nguyên nhân*: Dữ liệu xếp hạng trả về chứa nguyên `email`, và UI cho phép click vào tên học viên để mở `LearnerProfileView` (gây lỗi 401 hoặc lộ thông tin cá nhân).
   - *Khắc phục*: `hydrateRanking(payload, isGuest)` tự động xóa sạch `email`, số điện thoại và thông tin quản trị nhạy cảm khi `isGuest === true`. UI chuyển tên học viên thành dạng text tĩnh, vô hiệu hóa modal xem hồ sơ cá nhân đối với khách vãng lai.
5. **Mất thông tin Ban (`departmentName`), Chức vụ (`positionName`) và số sao lịch sử**:
   - *Nguyên nhân*: `competitionCohortAt()` chỉ lấy thông tin quan hệ hiện tại, không join lịch sử chức vụ và ban tại thời điểm Snapshot của kỳ (`at: Date`).
   - *Khắc phục*: Truy vấn lịch sử `DEPARTMENT` membership và `position` hợp lệ tại thời điểm Snapshot (`started_at <= at && (ended_at == null || ended_at >= at)`), bảo toàn tên Ban và Chức vụ chính xác theo từng kỳ lịch sử.
6. **Lọt tài khoản Quản lý (`CHAPTER_MANAGER`, `DNA_MANAGER`, `ADMIN`) và `DNA TT` vào bảng xếp hạng**:
   - *Nguyên nhân*: Danh sách loại trừ chỉ có `CHAPTER_LEAD`, thiếu mã chức vụ `CHAPTER_MANAGER`. Nhóm `DNA TT` (`TT(DNA_GROUP)`) chưa được lọc ra khỏi cohort thi đua DNA.
   - *Khắc phục*: Đưa `CHAPTER_MANAGER`, `DNA_MANAGER`, `DNA_LEAD`, `CHAPTER_LEAD`, `TT` vào danh sách loại trừ trong `competitionGroup()` và loại bỏ unit code `TT` trong cohort thi đua DNA.
7. **Lỗi Race Condition khi chuyển đổi tab / tháng liên tục**:
   - *Nguyên nhân*: Khi người dùng click nhanh giữa các tháng/tab, request cũ trả về muộn ghi đè lên dữ liệu của tab mới.
   - *Khắc phục*: Bổ sung `requestSeqRef` trong `UnifiedLeaderboard.tsx`. Mỗi khi trigger fetch mới, số thứ tự sequence tăng lên, chỉ response trùng khớp với sequence hiện tại mới được cập nhật vào state.

---

## 2. DANH SÁCH CÁC FILE ĐÃ CHỈNH SỬA

| File | Thay đổi chính |
| :--- | :--- |
| `src/app/api/v1/learning/periods/route.ts` | Hỗ trợ đọc công khai cho Guest (`role: GUEST`, `allowedGroups: ['MEMBER', 'LT', 'DNA', 'CHAPTER']`, `isGlobal: true`). Xác định cờ `hasData: true` cho các tháng có snapshot hoặc đang mở kỳ. Trả về metadata phân quyền chính thức. |
| `src/lib/period-leaderboard.ts` | Enforce xác thực & phân quyền nghiêm ngặt theo Ma trận phân quyền. Chặn 403 các request đổi `chapterId`, `dnaUnitId`, đổi `group` sai quyền. Xóa `email` và thông tin nhạy cảm đối với Guest trong `hydrateRanking`. Phân biệt cache key `guest` vs `auth`. |
| `src/lib/competition-ranking-rules.ts` | Bổ sung `CHAPTER_MANAGER` và `DNA_MANAGER` vào danh sách loại trừ quản lý. Đảm bảo chỉ học viên đủ tư cách mới được xếp hạng. |
| `src/lib/competition-snapshots.ts` | Nâng cấp `competitionCohortAt()` truy vấn chính xác lịch sử Ban (`departmentName`), Chức vụ (`positionName`) và Chapter tại mốc thời gian snapshot. Loại trừ nhóm DNA `TT`. |
| `src/lib/manager-learning-access.ts` | Nhận diện mã vị trí `CHAPTER_MANAGER` thuộc nhóm quản lý `LEAD_CHAPTER`. |
| `src/components/learning/UnifiedLeaderboard.tsx` | - Chỉ hiển thị các tab được phép dựa trên `allowedGroups`.<br>- Loại bỏ cơ chế tự động tiêm `currentUser.chapterId` vào bảng toàn quốc.<br>- Bổ sung bộ chọn nhanh các tháng có dữ liệu (`hasData: true` hiển thị xanh nổi bật).<br>- Hiển thị đầy đủ Chức vụ, Ban, Chapter và số sao.<br>- Bảo vệ quyền riêng tư của Guest (ẩn email, vô hiệu hóa xem hồ sơ).<br>- Bộ xử lý chống race condition `requestSeqRef`.<br>- Phân biệt rõ ràng các trạng thái: Đang tải, Chưa có dữ liệu, Đang chờ chuyển giao (`AWAITING_CUTOVER`), Kỳ chưa mở (`PERIOD_UNAVAILABLE`), Chờ snapshot (`AWAITING_SNAPSHOT`), Chờ cấu hình KPI (`WAITING_KPI`), Không có quyền (`accessError`). |

---

## 3. KẾT QUẢ KIỂM THỬ (TEST RESULTS)

### 3.1. Tổng hợp các test suites
| STT | Bộ Test Suite | Số Test | Trạng thái | Ghi chú |
| :---: | :--- | :---: | :---: | :--- |
| 1 | `npm run test:business-rules` | 66/66 | **PASS (100%)** | Toàn bộ quy tắc tính điểm, dung sai video, quiz, sao |
| 2 | `npm run test:learning-cycles` | 24/24 | **PASS (100%)** | Chu kỳ học tập, snapshot thi đua, chuyển giao |
| 3 | `scripts/test-phase2-leaderboard-permissions.mjs` | 17/17 | **PASS (100%)** | Test tích hợp trực tiếp API, phân quyền ma trận 8 vai trò |
| 4 | TypeScript Static Check (`tsc --noEmit`) | - | **0 lỗi (PASS)** | Type an toàn tuyệt đối, không có lỗi linter/compiler |
| 5 | Next.js Production Build (`npm run build`) | 73 trang | **PASS (100%)** | Build production thành công hoàn hảo |
| 6 | Browser E2E Test (Chrome Subagent) | Kịch bản Guest | **PASS (100%)** | UI mượt mà, đúng tab, đúng bộ lọc, không rò rỉ dữ liệu |

### 3.2. Chi tiết 17 kịch bản API Permissions (`test-phase2-leaderboard-permissions.mjs`)
1. **[PASS] Guest /periods endpoint**: Trả về `role: GUEST`, `allowedGroups` gồm cả 4 nhóm, `isGlobal: true`, đánh dấu chính xác tháng có snapshot (`hasData: true`).
2. **[PASS] Guest xem 8 bảng xếp hạng công khai**: Truy cập thành công không cần token/session (MEMBER, LT, DNA, CHAPTER cả Tháng và Nhiệm kỳ).
3. **[PASS] Guest Public DTO Security**: Không rò rỉ bất kỳ email, số điện thoại hay thông tin tài khoản nào.
4. **[PASS] Admin Access & Global Leaderboard**: Xem đủ 8 bảng, phạm vi toàn hệ thống (`isGlobal: true`), không bị ép Chapter ngầm.
5. **[PASS] Lead Chapter A Scope**: Chỉ được phép xem `allowedGroups: ['MEMBER', 'LT']`, `isGlobal: false`, giới hạn trong Chapter A.
6. **[PASS] Lead Chapter A Xem MEMBER & LT**: Trả về 200 OK với dữ liệu học viên thuộc Chapter A.
7. **[PASS] Lead Chapter A IDOR Prevention (Group)**: Cố tình yêu cầu `group=DNA` hoặc `group=CHAPTER` bị chặn **403 AccessDenied**.
8. **[PASS] Lead Chapter A IDOR Prevention (Chapter)**: Cố tình truyền `chapterId` của Chapter B bị chặn **403 AccessDenied**.
9. **[PASS] Member Chapter A Scope**: Chỉ được phép xem `allowedGroups: ['MEMBER', 'LT']`, `isGlobal: false`.
10. **[PASS] Member Chapter A Truy cập**: Xem MEMBER & LT thành công (200), yêu cầu DNA/CHAPTER bị chặn **403 AccessDenied**.
11. **[PASS] Member Chapter A IDOR Prevention**: Cố tình truy vấn `chapterId` của Chapter B bị chặn **403 AccessDenied**.
12. **[PASS] Lead DNA Scope**: Chỉ được phép xem `allowedGroups: ['DNA']`, `isGlobal: false`.
13. **[PASS] Lead DNA Truy cập & IDOR Prevention**: Xem bảng DNA thành công (200), yêu cầu MEMBER/LT/CHAPTER bị chặn **403 AccessDenied**.
14. **[PASS] Member DNA Truy cập & IDOR Prevention**: Xem bảng DNA thành công (200), yêu cầu MEMBER/LT/CHAPTER bị chặn **403 AccessDenied**.
15. **[PASS] Tư cách xếp hạng DNA**: DNA TT (`dna.tt@bbe.vn`) và Lead DNA bị loại trừ khỏi bảng xếp hạng thi đua DNA; thành viên SGDC/LDC được xếp hạng đầy đủ.
16. **[PASS] Tư cách xếp hạng Quản trị**: Admin, Lead Chapter không xuất hiện trong bảng thi đua với tư cách tài khoản quản lý.
17. **[PASS] Dữ liệu Ban, Chức vụ & Số sao**: Dữ liệu lịch sử chứa đầy đủ Ban (`departmentName`), Chức vụ (`positionName`) và số sao số học hợp lệ.

---

## 4. TÀI KHOẢN & KỊCH BẢN DEMO THỰC TẾ

Tất cả các tài khoản thử nghiệm sử dụng mật khẩu chung: `Bbe@123456`

| Vai trò | Email đăng nhập | Số bảng được xem | Phạm vi được phép | URL kiểm tra |
| :--- | :--- | :---: | :--- | :--- |
| **Khách (Guest)** | *(Không đăng nhập)* | 8 | Toàn hệ thống (Dữ liệu công khai, ẩn email) | `http://localhost:3000/leaderboard` |
| **Admin** | `admin@bbe.vn` | 8 | Toàn hệ thống (Có bộ lọc chọn Chapter tùy chọn) | `http://localhost:3000/leaderboard` |
| **Lead Chapter A** | `hieu.lead@bbe.vn` | 4 | Chỉ xem Thành viên & LT thuộc Chapter Alpha | `http://localhost:3000/chapter-manager/leaderboard` |
| **Thành viên Chapter A**| `student1@bbe.vn` | 4 | Chỉ xem Thành viên & LT thuộc Chapter Alpha | `http://localhost:3000/student/leaderboard` |
| **Lead Chapter B** | `hang.lead@bbe.vn` | 4 | Chỉ xem Thành viên & LT thuộc Chapter Beta | `http://localhost:3000/chapter-manager/leaderboard` |
| **Lead DNA** | `dna.lead@bbe.vn` | 2 | Chỉ xem DNA thuộc đơn vị DNA mình quản lý | `http://localhost:3000/student/leaderboard` |
| **Thành viên DNA SGDC** | `dna.sgdc1@bbe.vn` | 2 | Chỉ xem bảng thi đua DNA | `http://localhost:3000/student/leaderboard` |
| **Thành viên DNA LDC** | `dna.ldc1@bbe.vn` | 2 | Chỉ xem bảng thi đua DNA | `http://localhost:3000/student/leaderboard` |
| **Thành viên DNA TT** | `dna.tt@bbe.vn` | 2 | Xem bảng DNA nhưng bản thân không được xếp hạng | `http://localhost:3000/student/leaderboard` |

---

## 5. CÁC HÀNH VI / NỘI DUNG CHUYỂN TIẾP VÀO GIAI ĐOẠN 3 (BACKLOG)

Tuân thủ nghiêm ngặt chỉ đạo: **Không tự ý triển khai Giai đoạn 3**. Các nội dung sau được bảo lưu nguyên vẹn để xử lý trong Giai đoạn 3:
1. **Công thức tính điểm & trọng số nhiệm kỳ chuyên sâu**:
   - Tinh chỉnh công thức tích lũy điểm chuyển giao giữa 2 cửa sổ chuyển giao Chapter (01/03–30/04 và 01/09–31/10).
   - Công thức chu kỳ cố định 6 tháng của DNA (01/04 và 01/10).
2. **Snapshot tự động định kỳ**:
   - Triển khai Worker / Cron job tự động chốt snapshot thi đua vào thời điểm kết thúc tháng và kết thúc nhiệm kỳ.
3. **Cơ chế tái tính toán lịch sử (Historical Recalculation Engine)**:
   - Cho phép Quản trị viên kích hoạt tính toán lại dữ liệu kỳ quá khứ khi có thay đổi cấu hình KPI nhiệm kỳ đã qua.
