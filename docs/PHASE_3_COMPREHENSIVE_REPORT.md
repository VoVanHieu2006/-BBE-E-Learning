# BÁO CÁO NGHIỆM THU TỔNG THỂ GIAI ĐOẠN 3/3 — CHUẨN HÓA CÔNG THỨC, NHIỆM KỲ, XẾP HẠNG VÀ SEED KIỂM THỬ

**Repository:** `https://github.com/VoVanHieu2006/-BBE-E-Learning`
**Nhánh:** `main`
**Baseline commit tham chiếu:** `1142234f2e4c3dfb5d0df888153a1b00269b7e0e`
**Thời gian hoàn thành:** 2026-10-24
**Vai trò phụ trách:** Senior Software Architect, Business Analyst, Data Engineer, Backend Engineer, QA Engineer

---

## 1. SHA VÀ PHẠM VI THAY ĐỔI

### 1.1. Baseline & Phiên bản
- **Baseline Git SHA:** `1142234f2e4c3dfb5d0df888153a1b00269b7e0e`
- **Tình trạng:** Tiếp nối hoàn chỉnh toàn bộ nghiệm thu Giai đoạn 1/3 (Video Player, heartbeats, seek prevention, progress) và Giai đoạn 2/3 (Phân quyền 8 bảng xếp hạng, ẩn tab quản trị, loại tài khoản Admin/Lead khỏi thi đua, bảo toàn Ban/Chức vụ).
- **Phạm vi Giai đoạn 3:**
  - Chuẩn hóa công thức Chapter tháng thường $S_m = A_m / N_m$ và tháng chuyển giao $S_m = A_1 / N_1 + A_2 / N_2$.
  - Phân bổ điểm tháng chuyển giao cho hai nhiệm kỳ theo thời gian thực tế (**Phương án B đã chốt**).
  - Chuẩn hóa điều kiện đủ tư cách: $N > 20$, $R \ge 50\%$ (mỗi người $\ge 70\%$ bài học lõi xuất bản từ 3 chương trình Thành viên, LT, DNA), KPI Vàng hoặc Xanh.
  - Xếp hạng điểm Chapter bằng độ chính xác cao (sai số $10^{-12}$), hiển thị đúng 3 chữ số thập phân (`minimumFractionDigits: 3, maximumFractionDigits: 3`).
  - Phá hòa Chapter tháng (theo giây nhận sao cuối) và Chapter nhiệm kỳ (theo số tháng đủ điều kiện `qualifiedMonthCount`).
  - Chapter chuyển giao linh hoạt theo 2 cửa sổ (01/03–30/04 và 01/09–31/10) với timestamp riêng của từng Chapter; DNA chuyển giao cố định nửa mở $[01/04, 01/10)$ theo giờ Việt Nam.
  - Cá nhân chuyển từ Chapter sang DNA giữa tháng: loại toàn bộ sao tháng đó khỏi điểm Chapter, bảng DNA tháng xét tư cách cuối tháng, bảng DNA nhiệm kỳ chỉ tính trong nhiệm kỳ DNA.

---

## 2. NHỮNG MÂU THUẪN CODE CŨ ĐÃ SỬA

| STT | Vấn đề trong Code cũ / Baseline | Phân tích vi phạm | Giải pháp chuẩn hóa Giai đoạn 3 |
|---|---|---|---|
| 1 | **Công thức Chapter tháng thường** trong `competition-ranking-rules.ts` dùng quân số bình quân theo thời gian $(A_1 + A_2) / N_{avg}$ | Vi phạm quy tắc chính thức: Tháng thường không có chuyển giao phải lấy tổng sao chia quân số hợp lệ cuối tháng $S_m = A_m / N_m$. | Chuyển sang $S_m = A_m / N_m$ với $N_m$ là quân số snapshot cuối tháng. |
| 2 | **Công thức Chapter tháng chuyển giao** tính tổng sao chia quân số bình quân $(A_1 + A_2) / N_{avg}$ | Mẫu số $N_1$ và $N_2$ khác nhau dẫn đến sai lệch bản chất đóng góp của từng giai đoạn. | Sửa thành $S_m = A_1 / N_1 + A_2 / N_2$. Giữ $N_{avg} = \frac{\sum N_i T_i}{\sum T_i}$ và $R = \frac{\sum Q_i T_i}{\sum N_i T_i}$ chỉ để xét điều kiện tư cách (>20 người, $\ge 50\%$ đạt tiến độ). |
| 3 | **Phân bổ điểm tháng chuyển giao vào nhiệm kỳ** dồn toàn bộ điểm tháng vào nhiệm kỳ mới | Vi phạm nguyên tắc bảo toàn dữ liệu lịch sử và chu kỳ thực tế. Giai đoạn 1 thuộc nhiệm kỳ cũ, giai đoạn 2 thuộc nhiệm kỳ mới. | Triển khai **Phương án B**: Month board tính cả 2 giai đoạn ($4 + 6 = 10$). Term cũ nhận $A_1/N_1 = 4$, Term mới nhận $A_2/N_2 = 6$. Lưu chi tiết từng stage (`stageResults`) với mốc thời gian để gán điểm chính xác theo giao điểm với nhiệm kỳ. |
| 4 | **Làm tròn điểm trước khi xếp hạng** dùng `toFixed(2)` hoặc `Math.round()` | Dẫn đến sai lệch thứ hạng: ví dụ $10.123456789$ và $10.123456788$ đều bị làm tròn thành $10.123$ và coi là bằng nhau. | Backend so sánh bằng số thực độ chính xác cao với epsilon $10^{-12}$. API trả về giá trị unrounded `score`. Giao diện làm tròn 3 chữ số chỉ ở bước render hiển thị. |
| 5 | **Phá hòa Chapter nhiệm kỳ** chỉ xét theo điểm số, không xét số tháng đạt chuẩn | Nếu 2 Chapter bằng điểm chính xác, hệ thống cũ sort ngẫu nhiên hoặc theo ID. | Quy tắc phá hòa mới: Chapter có nhiều tháng đủ điều kiện hơn (`qualifiedMonthCount`) đứng trên. Nếu bằng cả điểm và số tháng thì đồng hạng. |
| 6 | **Phá hòa Chapter tháng** không xét mốc nhận sao cuối | Không có tiêu chí phân định thứ hạng công bằng khi bằng điểm. | Ghi nhận timestamp `lastStarAwardedAt` của lần nhận sao hợp lệ cuối cùng trong tháng (chính xác đến giây), Chapter nhận sớm hơn đứng trên. Nếu bằng thì đồng hạng. |
| 7 | **Ngày chuyển giao Chapter bị gắn cứng** vào 01/04 và 01/10 | Chapter chuyển giao linh hoạt trong cửa sổ 01/03–30/04 và 01/09–31/10. Gán cứng làm sai chu kỳ tích lũy của từng Chapter. | `ChapterCompetitionTerm` lưu timestamp bắt đầu và kết thúc thực tế theo từng Chapter (`starts_at`, `ends_at`) gắn với sự kiện `ChapterReorganization`. Bảng nhiệm kỳ toàn hệ thống nhóm theo mã season (`2026-OCT`) nhưng tính điểm mỗi cá nhân/Chapter theo timestamp chu kỳ riêng. |
| 8 | **DNA chuyển giao linh hoạt** theo Chapter | DNA có lịch chuyển giao cố định tại 01/04 và 01/10 lúc 00:00 VN time (nửa mở $[start, end)$). | Tách biệt hoàn toàn logic DNA và Chapter. DNA dùng boundary cố định, không phụ thuộc vào `ChapterReorganization`. |
| 9 | **Chuyển Chapter sang DNA giữa tháng** | Sao kiếm được trước ngày chuyển vẫn bị tính vào Chapter hoặc gây trùng lặp. | Khi người học gia nhập DNA trong tháng, toàn bộ sao tháng chuyển của người đó bị loại khỏi điểm thi đua Chapter. Bảng DNA tháng xét tư cách cuối tháng; bảng DNA nhiệm kỳ chỉ tính sao trong nhiệm kỳ DNA. |

---

## 3. CÔNG THỨC VÀ NƠI TRIỂN KHAI

### 3.1. Bảng tóm tắt công thức chính thức

| Hạng mục | Công thức chính thức | Nơi triển khai trong mã nguồn |
|---|---|---|
| **Tháng bình thường** | $S_m = \frac{A_m}{N_m}$ ($A_m$: tổng sao hợp lệ; $N_m$: quân số cuối tháng) | `src/lib/competition-ranking-rules.ts` (`chapterCompetitionScore`) |
| **Tháng chuyển giao** | $S_m = \sum \frac{A_i}{N_i} = \frac{A_1}{N_1} + \frac{A_2}{N_2}$ | `src/lib/competition-ranking-rules.ts` (`chapterCompetitionScore`) |
| **Quân số bình quân** | $N_{avg} = \frac{\sum N_i \cdot T_i}{\sum T_i}$ (chỉ dùng xét điều kiện $N_{avg} > 20$) | `src/lib/competition-ranking-rules.ts` (`chapterCompetitionScore`) |
| **Tỷ lệ đạt tiến độ** | $R = \frac{\sum Q_i \cdot T_i}{\sum N_i \cdot T_i}$ (chỉ dùng xét điều kiện $R \ge 50\%$) | `src/lib/competition-ranking-rules.ts` (`chapterCompetitionScore`) |
| **Điều kiện tư cách Chapter** | - KPI $\in \{\text{YELLOW}, \text{GREEN}\}$<br>- Quân số $> 20$ (20: rớt, 21: đạt)<br>- Tỷ lệ $R \ge 50\%$<br>- Mỗi người đạt khi hoàn thành $\ge 70\%$ bài học lõi đã xuất bản từ 3 chương trình (Thành viên, LT, DNA) | `src/lib/competition-ranking-rules.ts` (`chapterCompetitionScore`) |
| **Chia điểm tháng chuyển giao cho 2 nhiệm kỳ** | - Tháng: $S_m = A_1/N_1 + A_2/N_2$<br>- Nhiệm kỳ cũ: $+A_1/N_1$<br>- Nhiệm kỳ mới: $+A_2/N_2$ | `src/lib/competition-snapshots.ts` (`chapterSeasonRows`, `closeCompetitionTerms`) |
| **Phá hòa Chapter tháng** | 1. Điểm chưa làm tròn cao hơn<br>2. Nhận sao cuối sớm hơn (`lastStarAwardedAt`, so giây)<br>3. Bằng cả hai: Đồng hạng | `src/lib/competition-snapshots.ts` (`rankChapters`, `isTerm: false`) |
| **Phá hòa Chapter nhiệm kỳ** | 1. Tổng điểm nhiệm kỳ chưa làm tròn cao hơn<br>2. Số tháng đủ điều kiện (`qualifiedMonthCount`) nhiều hơn<br>3. Bằng cả hai: Đồng hạng | `src/lib/competition-snapshots.ts` (`rankChapters`, `isTerm: true`) |
| **Phá hòa Cá nhân tháng & nhiệm kỳ** | 1. Tổng sao cao hơn<br>2. Đạt tổng sao sớm hơn tính từ đầu chu kỳ (đến giây)<br>3. Bằng cả hai: Đồng hạng | `src/lib/competition-snapshots.ts` (`rankIndividuals`) |

---

## 4. CHI TIẾT THUẬT TOÁN VÀ KIẾN TRÚC

### 4.1. Thuật toán so sánh độ chính xác cao
- **Tránh sai số số thực IEEE 754:** Sử dụng ngưỡng so sánh sai số tuyệt đối $\epsilon = 10^{-12}$:
  ```typescript
  const scoresEqual = Math.abs((row.score ?? -Infinity) - (prev.score ?? -Infinity)) <= 1e-12
  ```
- Nếu $|S_A - S_B| > 10^{-12}$, Chapter có điểm lớn hơn xếp trên.
- Nếu $|S_A - S_B| \le 10^{-12}$, kích hoạt tiêu chí phá hòa (số tháng đủ điều kiện hoặc timestamp nhận sao).
- Không bao giờ gọi `toFixed()` hay `Math.round()` trước khi so sánh thứ hạng.

### 4.2. Quy tắc gán thứ hạng và đồng hạng (Standard Competition Ranking)
- Sử dụng mô hình xếp hạng chuẩn thể thao 1-2-2-4 (nếu 2 đội hạng 2 thì đội kế tiếp là hạng 4):
  ```typescript
  if (scoresEqual && tieBreakersEqual) {
    return { ...row, rank: currentRank } // Giữ nguyên rank của hàng trước
  }
  currentRank = index + 1
  return { ...row, rank: currentRank }
  ```
- Không bao giờ dùng `id`, `name`, hoặc thời gian tạo tài khoản để phân định thứ tự xếp hạng chính thức.

### 4.3. Phân bổ giai đoạn (Stage Attribution) vào Nhiệm kỳ
- Khi Chapter chuyển giao giữa tháng $M$, `stages` chứa 2 giai đoạn:
  - Giai đoạn 1: $[T_{start}, T_{transfer})$ có điểm $S_1 = A_1 / N_1$.
  - Giai đoạn 2: $[T_{transfer}, T_{end})$ có điểm $S_2 = A_2 / N_2$.
- Khi tính bảng nhiệm kỳ cho một `term` có khoảng $[Term_{start}, Term_{end})$:
  - Điểm giữa của từng giai đoạn $T_{mid} = \frac{Stage_{start} + Stage_{end}}{2}$ được kiểm tra xem có nằm trong $[Term_{start}, Term_{end})$ hay không.
  - Giai đoạn 1 rơi vào Term cũ $\rightarrow$ cộng $S_1$ vào Term cũ.
  - Giai đoạn 2 rơi vào Term mới $\rightarrow$ cộng $S_2$ vào Term mới.
  - Bảo toàn hoàn toàn công thức, không phân bổ ngược theo tỷ lệ ngày.

---

## 5. BỘ SEED DỮ LIỆU VÀ KỊCH BẢN KIỂM THỬ

### 5.1. Danh sách Chapter và Quân số đại diện

| Tên Chapter | Slug | Quân số ($N$) | Đạt 70% lõi ($Q$) | Tỷ lệ $R$ | KPI | Kỳ vọng Tư cách | Lý do (nếu rớt) |
|---|---|---|---|---|---|---|---|
| **BBE Seed Nhỏ Chapter** | `seed-small` | 15 | 0 | 0% | GREEN | **Không đủ điều kiện** | `MEMBER_COUNT_NOT_ABOVE_20`, `CORE_COMPLETION_BELOW_50_PERCENT` |
| **BBE Seed Đúng 20 Chapter** | `seed-exact20` | 20 | 20 | 100% | GREEN | **Không đủ điều kiện** | `MEMBER_COUNT_NOT_ABOVE_20` (ngưỡng nghiêm ngặt $>20$) |
| **BBE Seed Đúng 21 Chapter** | `seed-exact21` | 21 | 16 | 76.2% | GREEN | **ĐỦ ĐIỀU KIỆN** | Quy mô đạt (21 > 20), tiến độ đạt |
| **BBE Seed Đang học Chapter** | `seed-learning` | 22 | 8 | 36.4% | YELLOW | **Không đủ điều kiện** | `CORE_COMPLETION_BELOW_50_PERCENT` (36.4% < 50%) |
| **BBE Seed Đúng 50 Chapter** | `seed-exact50` | 24 | 12 | 50.0% | GREEN | **ĐỦ ĐIỀU KIỆN** | Quy mô đạt, tiến độ đúng 50.0% |
| **BBE Seed KPI Đỏ Chapter** | `seed-red` | 30 | 24 | 80.0% | RED | **Không đủ điều kiện** | `KPI_NOT_ELIGIBLE` |
| **BBE Seed Cân bằng Chapter** | `seed-balanced` | 40 | 28 | 70.0% | YELLOW | **ĐỦ ĐIỀU KIỆN** | Chuyển giao 25/09/2026 |
| **BBE Seed Checkpoint 70** | `seed-checkpoint` | 50 | 35 | 70.0% | YELLOW | **ĐỦ ĐIỀU KIỆN** | Chuyển giao 15/09/2026, chứa tài khoản test tie-break |
| **BBE Seed Xuất sắc Chapter** | `seed-green` | 53 (capped 51) | 46 | 86.8% | GREEN | **ĐỦ ĐIỀU KIỆN** | Chapter dẫn đầu thi đua |

### 5.2. Các Edge Cases đặc biệt đã seed
1. **Phá hòa cá nhân khác giây:** `tie.early@bbe.vn` (đạt 50 sao lúc `10:00:00`) xếp trên `tie.late@bbe.vn` (đạt 50 sao lúc `10:00:15`).
2. **Đồng hạng cá nhân cùng giây:** `tie.exact1@bbe.vn` và `tie.exact2@bbe.vn` cùng đạt 40 sao trong cùng 1 giây $\rightarrow$ cùng hạng (Rank bằng nhau).
3. **Chuyển Chapter sang DNA giữa tháng:** `member.to.dna@demo.bbe.vn` kiếm 25 sao ngày 10/09, chuyển sang DNA ngày 18/09 $\rightarrow$ loại bỏ 25 sao khỏi điểm Chapter tháng 9, không mất sao cá nhân, bảng DNA tháng ghi nhận đúng.
4. **Chapter chuyển giao linh hoạt:**
   - `seed-checkpoint`: chuyển giao **15/09/2026**.
   - `seed-balanced`: chuyển giao **25/09/2026**.
   - `seed-exact20`: chuyển giao **10/10/2026**.
   - Các Chapter khác: chuyển giao **01/10/2026**.
5. **Tiến độ học tập:** Có người 0%, dưới 70%, đúng 70% (40 bài), trên 70% (45 bài), hoàn thành cả 3 chương trình lõi.

---

## 6. KẾT QUẢ KIỂM THỬ ĐỘC LẬP (ORACLE TESTS)

File kiểm thử độc lập: `src/test/phase3-leaderboard-oracle.test.ts`.
Tất cả 13/13 test cases đều được tính toán bằng tay (hand-calculated oracle), không phụ thuộc vào code implementation:

| Test Case | Kịch bản kiểm tra | Kỳ vọng Oracle | Kết quả thực tế | Trạng thái |
|---|---|---|---|---|
| **Oracle 01** | Tháng thường ($A_m / N_m$) | $A=100, N=20 \implies S = 5.0$ | $S = 5.0$ | **PASS** |
| **Oracle 02** | Tháng chuyển giao ($A_1/N_1 + A_2/N_2$) | $A_1=80, N_1=20; A_2=60, N_2=30 \implies S = 4 + 2 = 6.0$ | $S = 6.0$ | **PASS** |
| **Oracle 03** | Quy mô quân số ngưỡng 20 | $N=20 \implies \text{disqualified}$; $N=21 \implies \text{eligible}$ | Đúng lý do `MEMBER_COUNT_NOT_ABOVE_20` | **PASS** |
| **Oracle 04** | Tỷ lệ tiến độ ngưỡng 50% | $R=49.9\% \implies \text{disqualified}$; $R=50.0\% \implies \text{eligible}$ | Đúng lý do `CORE_COMPLETION_BELOW_50_PERCENT` | **PASS** |
| **Oracle 05** | Ngưỡng hoàn thành bài học 70% | $P = 34/50 (68\%) \implies \text{chưa đạt}$; $P = 35/50 (70\%) \implies \text{đạt}$ | Đúng điều kiện | **PASS** |
| **Oracle 06** | Mẫu số bằng 0 hoặc thiếu dữ liệu | $N=0 \implies \text{dataError: 'ZERO_MEMBERS'}$ | Đúng lỗi dữ liệu, không gán 0 | **PASS** |
| **Oracle 07** | Phân bổ điểm tháng chuyển giao 2 kỳ (Phương án B) | Tháng 9 = 10; Term cũ = 4; Term mới = 6 | Đúng 4 điểm cho cũ, 6 điểm cho mới | **PASS** |
| **Oracle 08** | So sánh độ chính xác cao | $10.123456789 > 10.123456788 \implies$ A xếp trên B dù cùng hiện $10.123$ | A Rank 1, B Rank 2 | **PASS** |
| **Oracle 09** | Phá hòa Chapter tháng theo giây | Cùng 10.5 điểm; A nhận sao lúc 14:00, B lúc 14:05 $\implies$ A xếp trên | A Rank 1, B Rank 2 | **PASS** |
| **Oracle 10** | Phá hòa Chapter tháng cùng giây | Cùng 10.5 điểm, cùng giây nhận sao $\implies$ đồng hạng | A Rank 1, B Rank 1 | **PASS** |
| **Oracle 11** | Phá hòa Chapter nhiệm kỳ bằng số tháng | Cùng 50.123456789; A có 5 tháng, B có 4 tháng $\implies$ A xếp trên | A Rank 1, B Rank 2 | **PASS** |
| **Oracle 12** | Điểm số ưu tiên hơn số tháng | C có $50.123456788$ (6 tháng), B có $50.123456789$ (4 tháng) $\implies$ B xếp trên C | B Rank 1, C Rank 2 | **PASS** |
| **Oracle 13** | Phá hòa Chapter nhiệm kỳ đồng hạng | Cùng điểm, cùng 5 tháng đủ điều kiện $\implies$ đồng hạng | A Rank 1, B Rank 1 | **PASS** |

### 6.1. Tổng kết các Suite kiểm thử toàn hệ thống
- `src/test/phase3-leaderboard-oracle.test.ts`: **13/13 PASS**
- `npm run test:business-rules`: **66/66 PASS**
- `npm run test:learning-cycles`: **24/24 PASS**
- `src/test/master-verification.test.ts`: **18/18 PASS**
- **Tổng cộng: 121/121 automated tests PASS 100%.**
- `npx tsc --noEmit -p tsconfig.check.json`: **0 lỗi TypeScript.**
- `npm run build`: **Biên dịch thành công 73/73 routes tĩnh và động, 0 lỗi.**

---

## 7. HƯỚNG DẪN KIỂM THỬ TRÊN GIAO DIỆN (UI VERIFICATION)

1. **Khởi chạy ứng dụng:**
   - Mở trình duyệt tại: `http://localhost:3000/leaderboard`.
2. **Kiểm tra 8 bảng xếp hạng:**
   - Chuyển đổi giữa 4 nhóm đối tượng: **Thành viên**, **Ban Lãnh Đạo (LT)**, **Khối DNA**, **Chapter**.
   - Chuyển đổi giữa 2 phạm vi thời gian: **Theo Tháng** và **Theo Nhiệm kỳ**.
   - Kiểm tra khách chưa đăng nhập: Xem được bảng công khai, không hiển thị các chức năng quản trị.
3. **Kiểm tra độ chính xác và hiển thị điểm Chapter:**
   - Chọn tab **Chapter** $\rightarrow$ **Theo Tháng** hoặc **Theo Nhiệm kỳ**.
   - Quan sát điểm số trên Podium và Bảng danh sách: hiển thị đúng định dạng **3 chữ số thập phân** (ví dụ: `22,642`, `17,500`).
   - Kiểm tra phá hòa: các Chapter có điểm làm tròn giống nhau nhưng điểm thực khác nhau vẫn được xếp thứ hạng chuẩn xác.
4. **Kiểm tra Bảng Chapter Nhiệm kỳ:**
   - Chọn **Theo Nhiệm kỳ**.
   - Bảng hiển thị thêm cột **"Tháng đạt chuẩn"** (`qualifiedMonthCount`).
   - Quan sát số tháng đạt chuẩn được dùng để phá hòa khi các Chapter có cùng tổng điểm nhiệm kỳ.
5. **Kiểm tra Danh sách Chapter Không đủ điều kiện:**
   - Kéo xuống phần *"Chapter chưa đủ điều kiện xếp hạng"*.
   - Kiểm tra các lý do:
     - `BBE Seed Nhỏ Chapter` (15 người): `MEMBER_COUNT_NOT_ABOVE_20`.
     - `BBE Seed Đúng 20 Chapter` (20 người): `MEMBER_COUNT_NOT_ABOVE_20`.
     - `BBE Seed Đang học Chapter`: `CORE_COMPLETION_BELOW_50_PERCENT`.
     - `BBE Seed KPI Đỏ Chapter`: `KPI_NOT_ELIGIBLE`.
6. **Kiểm tra Modal Thể lệ Xếp hạng:**
   - Nhấp vào nút **"Thể lệ xếp hạng"** ở góc phải tiêu đề.
   - Modal hiển thị đầy đủ quy định chính thức của Giai đoạn 3:
     - Công thức tháng thường $S_m = A_m / N_m$.
     - Công thức tháng chuyển giao $S_m = A_1 / N_1 + A_2 / N_2$.
     - Phân bổ điểm tháng chuyển giao vào 2 nhiệm kỳ.
     - Quy tắc phá hòa tháng (giây nhận sao) và nhiệm kỳ (số tháng đạt chuẩn).
     - Quy tắc Chapter linh hoạt và DNA cố định.
