# KHBB — Khóa học bắt buộc, hiểu trong 15 phút

> **Dành cho ai:** Admin, quản lý Chapter/DNA và bất kỳ ai cần hiểu luật chơi mà không cần đọc code.
>
> **Ngày cập nhật:** 10/11/2026.
>
> **Tài liệu này là chuẩn.** Một số quy tắc dưới đây đã được chốt nhưng code chưa làm kịp; chúng nằm trong mục 9. Chi tiết kỹ thuật cho lập trình viên (tên bảng, file, dòng code) ở [`KHBB-ky-thuat.md`](KHBB-ky-thuat.md).

---

## 1. Tóm tắt một trang

- **Khóa bắt buộc là gì?** Một khóa học mà Admin đã “tick” cho một nhóm người. Người thuộc nhóm đó **phải học xong trước hạn**.
- **Mỗi người chỉ có MỘT hạn chung** cho tất cả khóa bắt buộc của mình, không phải mỗi khóa một hạn. Số ngày của từng khóa chỉ là “phần đóng góp” vào hạn chung.
- **Quá hạn thì sao?** Hệ thống tự khóa tài khoản người học (trừ Admin và LEAD, họ không bao giờ bị khóa vì quá hạn).
- **Mở khóa:** chỉ Admin, bằng nút **“Mở khóa & Gia hạn”** (nhập số ngày gia hạn).
- **Tiến trình đã học không bị mất.** Khi Admin thêm bài hoặc quiz mới, phần mới hiện nhãn **“Mới”**; người đã xong khóa phải học thêm phần mới thì khóa mới tính xong lại.
- **Sang tháng mới không reset** nghĩa vụ học; chỉ mở kỳ thưởng sao mới.

```
Admin tick ô (khóa × nhóm học)
        │
        ▼
 Quy tắc: "nhóm này phải học khóa này trong N ngày"
        │
        ▼
 Mỗi người thuộc nhóm → có nghĩa vụ học khóa đó
        │
        ▼
 Một HẠN CHUNG cho cả lộ trình của người đó
        │
        ├─► Người học thấy đếm ngược
        └─► Quá hạn → tài khoản bị khóa → Admin "Mở khóa & Gia hạn"
```

---

## 2. Ai là ai?

### 2.1 Ba loại tài khoản (role)

| Role | Là ai | Có phải học khóa bắt buộc? | Có bị khóa vì quá hạn? |
|---|---|---|---|
| **ADMIN** | Quản trị hệ thống | Không | **Không bao giờ** |
| **LEAD** | Người dẫn dắt: Lead Chapter (**CHAPTER_LEAD**) hoặc Lead DNA (**DNA_LEAD**) | Không (họ quản lý, không học) | **Không bao giờ** |
| **MEMBER** | Người học | Có, tùy chức vụ | Có |

Luật cố định:

- **Không có chuyện đổi MEMBER thành LEAD.** LEAD là tài khoản được mời làm LEAD ngay từ đầu.
- Mỗi LEAD chỉ gắn với một vị trí lãnh đạo (một Chapter hoặc DNA).

### 2.2 Bốn chức vụ của MEMBER

| Chức vụ | Nghĩa | Số lượng |
|---|---|---|
| **PRESIDENT** | Chủ tịch Chapter | 1 / Chapter |
| **DEPARTMENT_LEAD** | Trưởng ban | 7 ban |
| **DEPARTMENT_MEMBER** | Thành viên ban | 7 ban |
| **DNA_MEMBER** | Thành viên DNA | 3 nhóm: TT, SGDC, LDC |

Bảy ban: **BTV** (Thành Viên), **BTK** (Thư Ký), **BND** (Nội Dung), **BCL** (Chất Lượng), **BDHU** (Định Hướng), **BKM** (Khách Mời), **BTTSK** (TT&SK).

### 2.3 Quy tắc “một người, một chức vụ”

Tại một thời điểm, một người chỉ có **đúng một** chức vụ:

- Không thể vừa là thành viên ban BND vừa là thành viên ban BTV.
- Không thể vừa ở Chapter vừa ở DNA.

Đổi chức vụ là **thay thế**, không cộng dồn. Ví dụ hợp lệ:

| Từ | Sang |
|---|---|
| Thành viên ban BTV | Trưởng ban BND |
| Thành viên ban BTV | Thành viên ban BKM |
| Thành viên Chapter | Thành viên DNA, khi Lead DNA mời người đó vào một trong ba nhóm TT / SGDC / LDC |

---

## 3. Mười tám nhóm học

Hệ thống chia người học thành **18 nhóm học**. Tên nhóm = tên chức vụ + ban/nhóm. Mỗi người thuộc đúng **một** nhóm (vì chỉ có một chức vụ).

| # | Nhóm | Ai thuộc nhóm này |
|---|---|---|
| 1-7 | **DEPARTMENT_MEMBER_BTV**, …_BTK, …_BND, …_BCL, …_BDHU, …_BKM, …_BTTSK | Thành viên (không phải trưởng) của từng ban |
| 8-14 | **DEPARTMENT_LEAD_BTV**, …_BTK, …_BND, …_BCL, …_BDHU, …_BKM, …_BTTSK | Trưởng ban của từng ban |
| 15 | **PRESIDENT** | Chủ tịch Chapter |
| 16-18 | **DNA_MEMBER_TT**, …_SGDC, …_LDC | Thành viên từng nhóm DNA |

LEAD và ADMIN **không thuộc nhóm nào** nên không có khóa bắt buộc.

---

## 4. Một khóa trở thành “bắt buộc” như thế nào?

Không có công tắc “bắt buộc” trên khóa học. Có ba bước, và chúng độc lập với nhau:

1. **Admin tick** một ô trong bảng (khóa × nhóm học) ở trang **Khóa học bắt buộc**, và nhập số ngày cho khóa đó.
2. **Hệ thống áp dụng** quy tắc cho từng người thuộc nhóm đó. Mỗi người có một “nghĩa vụ” riêng cho khóa này.
3. **Hạn chung** của người đó được tính lại.

Vài điều dễ nhầm:

- Khóa chỉ “đã xuất bản” mà chưa tick → **không** bắt buộc.
- Bỏ tick → nghĩa vụ kết thúc, **tiến độ đã học vẫn giữ**.
- Người thuộc hai nhóm (hiếm, ví dụ chuyển nhóm) mà khóa được tick cho cả hai → vẫn chỉ **một** nghĩa vụ.
- Khóa chưa xuất bản mà bị tick → người học có nghĩa vụ nhưng chưa mở được khóa. Nên tránh (xem mục 9).

**Thế nào là “học xong” một khóa?** Phải đủ cả ba:

1. Xem **100%** video của mọi bài học.
2. **Đạt** mọi quiz của bài học (từ 85% trở lên).
3. **Đạt** bài thi cuối khóa (nếu khóa có).

Xem hết video mà quiz chưa đạt thì **chưa xong**, vẫn có hạn.

---

## 5. Hạn học được tính như thế nào?

### 5.1 Các khái niệm cần nhớ

| Khái niệm | Nghĩa | Ký hiệu |
|---|---|---|
| Ngày bắt đầu | Ngày lộ trình học của người đó bắt đầu | **S** |
| Ngày đổi | Ngày xảy ra thay đổi (thêm khóa, đổi ban…) | **C** |
| Số ngày của khóa | Admin nhập khi tick | ví dụ 10 ngày |
| Khóa chưa xong | Khóa bắt buộc mà người đó chưa học xong | |

Một ngày = đúng 24 giờ. Hạn là **một thời điểm cụ thể**, không phải “cuối ngày”. (Ví dụ bắt đầu 15:30 ngày 1/1 với 20 ngày thì hạn là 15:30 ngày 21/1.)

Trong các ví dụ dưới đây, “ngày 0” là ngày bắt đầu của người học.

### 5.2 Bảng tính hạn theo từng tình huống

| Tình huống | Cách tính | Ví dụ |
|---|---|---|
| **Bắt đầu lộ trình** | Hạn = S + tổng số ngày các khóa bắt buộc | Khóa A 10 ngày + khóa B 10 ngày → hạn ngày 20 |
| **Thêm khóa bắt buộc / đổi ban** | Hạn mới = lớn hơn của **(S + tổng ngày các khóa chưa xong)** và **(C + tổng ngày các khóa mới chưa xong)** | Xem 5.3 |
| **Giảm số ngày của một khóa** | Như dòng trên, nhưng hạn mới **không sớm hơn C + 3 ngày** | Khóa 30 ngày giảm còn 10 vào ngày 20 → hạn ngày 23 |
| **Gỡ một khóa bắt buộc** | Còn khóa chưa xong khác: hạn tính lại, **không sớm hơn C + 3 ngày**. Hết khóa chưa xong: **không còn hạn** | Xem 5.4 |
| **Admin gia hạn tay** (chỉ cho tài khoản đã bị khóa quá hạn) | Hạn mới = hôm nay + N ngày | Xem 5.5 |
| **Thêm bài / quiz / bài thi cuối vào khóa đã xuất bản** | Cộng thêm số ngày bổ sung, **tính từ lúc thêm** | Xem 5.6 |
| **Hoàn thành một khóa** | Hạn **không đổi**. Còn khóa khác thì giữ hạn chung | |
| **Tất cả khóa đã xong** | Không còn hạn, không bị khóa | |

Quy tắc chung: **khóa đã xong không làm hạn dài thêm.** Người học xong sớm là xong, không “để dành” ngày còn lại.

### 5.3 Ví dụ: thêm khóa hoặc đổi ban

Công thức có hai vế, lấy vế lớn hơn:

- **Vế 1 (giữ tổng kế hoạch):** ngày bắt đầu + tổng ngày các khóa **chưa xong** của bộ mới.
- **Vế 2 (bảo đảm khóa mới đủ ngày):** ngày đổi + tổng ngày các khóa **mới thêm** chưa xong.

**Ví dụ chính (đổi khi đã gần hết hạn):** ban đầu người học có khóa A = 10 ngày và B = 5 ngày, hạn là ngày 15. Học đến **ngày 12** (A đã xong, B chưa xong), Admin đổi bộ khóa thành A + C (C = 10 ngày).

- Vế 1: 0 + 10 (chỉ C chưa xong) = 10. Nếu A chưa xong thì vế 1 là 0 + 20 = 20.
- Vế 2: ngày đổi 12 + 10 (C mới thêm) = 22.
- Hạn mới = lớn hơn = **ngày 22**. Người học có đủ 10 ngày kể từ lúc khóa C xuất hiện.

**Ví dụ phụ (đổi khi còn nhiều thời gian):** cùng bộ khóa trên, nhưng Admin đổi từ **ngày 2**, cả A và B đều chưa xong.

- Vế 1: 0 + (10 + 10) = 20.
- Vế 2: 2 + 10 = 12.
- Hạn mới = **ngày 20**. Khi còn nhiều thời gian thì vế 1 thắng, không ai bị thiệt và cũng không được cộng thừa.

**Người đã học xong hết, rồi được thêm khóa mới:** khóa A (100 ngày) học xong ngày 5, sau đó không còn hạn. Cũng ngày 5, Admin thêm khóa C (10 ngày). Chỉ khóa C chưa xong nên hạn = lớn hơn của (0 + 10 = 10) và (5 + 10 = 15) = **ngày 15**. Khóa A đã xong nên không kéo dài hạn.

**Đổi ban:** áp dụng đúng công thức trên. Ban cũ có khóa A (10 ngày) và B (40 ngày), hạn ngày 50. Ngày 20 đổi sang ban mới chỉ có khóa C (11 ngày), cả ba khóa đều chưa xong: hạn mới = lớn hơn của 11 và (20 + 11 = 31) = **ngày 31**. Hạn có thể **ngắn hơn** hạn cũ, vì ban mới là một lộ trình mới. Tiến độ học ở khóa cũ vẫn giữ.


### 5.4 Ví dụ: gỡ khóa

- Còn khóa khác: người học có A (10 ngày) và B (40 ngày), hạn ngày 50. Ngày 20 Admin gỡ B. Hạn mới = lớn hơn của (0 + 10 = 10) và (20 + 3 = 23) = **ngày 23**. Sàn 3 ngày bảo đảm người học không bị khóa ngay lúc Admin lưu.
- Gỡ khóa **cuối cùng** (hoặc các khóa còn lại đều đã xong): **không còn hạn**, người học không bị khóa.

### 5.5 Ví dụ: gia hạn tay (“Mở khóa & Gia hạn”)

Nút này **chỉ dùng cho tài khoản đã bị khóa vì quá hạn**. Người chưa bị khóa thì không cần gia hạn (hạn của họ vẫn còn). Admin chọn người, nhập **N ngày**:

> Hạn mới = **hôm nay + N ngày**

(Vì tài khoản bị khóa thì hạn cũ đã qua, nên luôn tính từ hôm nay.)

| Tình huống | Hạn mới |
|---|---|
| Hạn ngày 5, hôm nay ngày 20 (đã quá hạn, tài khoản bị khóa), gia hạn 7 | Ngày 27 |
| Hạn ngày 10, hôm nay ngày 11 (vừa bị khóa), gia hạn 3 | Ngày 14 |

**Gia hạn tay được bảo vệ:** sau khi gia hạn, nếu Admin đổi cấu hình khóa hoặc người đó đổi ban và công thức tính ra hạn **sớm hơn** hạn đã gia hạn, thì **giữ hạn đã gia hạn**. Ví dụ hạn đã gia hạn là ngày 30, công thức mới ra ngày 25 → vẫn là ngày 30.

Việc gia hạn cũng: gỡ khóa quá hạn, đưa nghĩa vụ chưa xong về trạng thái đang thực hiện, ghi lại ai gia hạn, bao nhiêu ngày, vì sao. Không xóa tiến độ.

### 5.6 Ví dụ: thêm bài, quiz hoặc bài thi cuối vào khóa đã xuất bản

**Mỗi bài học** được một số ngày:

> số ngày của một bài = lớn hơn của (làm tròn lên của [số ngày của khóa ÷ tổng số bài sau khi thêm]) và 3

Ví dụ: khóa 20 ngày, sau khi thêm khóa có 7 bài → làm tròn lên của 20 ÷ 7 là 3, lớn hơn hoặc bằng 3 → **mỗi bài 3 ngày**.

Số ngày này chia **đôi** giữa video và quiz, để thêm riêng từng phần vẫn công bằng:

| Thêm gì | Số ngày cộng | Với ví dụ (mỗi bài 3 ngày) |
|---|---|---|
| Bài mới có đủ video và quiz | Đủ số ngày của một bài | 3 ngày |
| Chỉ thêm **video** vào bài đã có sẵn quiz | Một nửa, làm tròn lên (tối thiểu 1 ngày) | 2 ngày |
| Chỉ thêm **quiz** vào bài đã có sẵn video | Nửa còn lại | 1 ngày |
| Thêm **bài thi cuối khóa** mới (khóa trước đó chưa có) | Cố định 3 ngày | 3 ngày |
| **Đổi đề** thi cuối khóa (đã có sẵn) | Không cộng | 0 |

Video + quiz cộng lại luôn bằng đúng một bài. Nếu một lần cập nhật thêm nhiều thứ thì cộng tất cả lại.

Số ngày này **tính từ lúc thêm**:

- **Người đã học xong khóa:** hạn của Lan là ngày 20, Lan học xong ngày 8. Ngày 30 Admin thêm 2 bài (đủ video và quiz). Khóa quay lại trạng thái **chưa xong**, Lan phải học 2 bài mới, hạn = ngày 30 + 6 = **ngày 36**.
- **Người đang học dở:** hạn hiện tại ngày 30, ngày 20 thêm 2 bài → cộng dồn vào hạn đang có: 30 + 6 = **ngày 36**.

### 5.7 Chống “làm mới hạn” bằng cách gỡ rồi thêm lại

**Lỗ hổng:** nếu Admin bỏ tick một khóa rồi tick lại, hệ thống coi đó là khóa mới và cho đủ số ngày kể từ lúc tick lại. Ví dụ Lan có khóa A (10 ngày) và X (10 ngày), hạn ngày 20. Ngày 18 bỏ tick X rồi tick lại: hạn nhảy lên ngày 28. Lặp lại ngày 27: ngày 37; ngày 36: ngày 46. Lan không học thêm gì mà không bao giờ hết hạn. Đổi ban qua lại hay hủy xuất bản rồi xuất bản lại cũng gây hiệu ứng tương tự.

**Quy tắc (cửa sổ 3 ngày):**

- Một khóa vừa bị gỡ khỏi bộ khóa của người học (bỏ tick, đổi ban, hủy xuất bản) rồi được thêm lại **trong vòng 3 ngày** (đúng bằng khoảng sàn 3 ngày ở mục 5.4) thì **hạn trở về đúng hạn trước khi gỡ**: không tăng, không giảm.
- Thêm lại **sau hơn 3 ngày** thì tính như thêm mới (mục 5.3).
- Gỡ rồi chờ quá 3 ngày thì người học đã hết sàn và bị khóa; muốn mở lại, Admin phải dùng “Mở khóa & Gia hạn” (có ghi nhật ký), nên không còn đường lặng lẽ.

**Ví dụ:** hạn của Lan là ngày 20. Ngày 18 Admin bỏ tick X nhầm, rồi tick lại cùng ngày: hạn vẫn là ngày 20 (không lên ngày 28). Nếu Admin tick lại X ngày 25 (sau hơn 3 ngày): X tính như khóa mới, Lan được 10 ngày kể từ ngày 25.

Quy tắc này **không đổi** bất kỳ công thức nào ở mục 5.2-5.6 cho trường hợp thêm khóa lần đầu, đổi sang ban mới, giảm ngày hay gia hạn tay.

---

## 6. Admin thay đổi thì chuyện gì xảy ra?

| Admin làm gì | Với nghĩa vụ | Với hạn | Với tiến độ học |
|---|---|---|---|
| Tick thêm khóa cho một nhóm | Mỗi người trong nhóm có thêm 1 nghĩa vụ | Tính như 5.3 | Không mất; người đã xong khóa đó thì nghĩa vụ **tự đánh dấu xong** |
| Bỏ tick | Nghĩa vụ kết thúc | Tính như 5.4 | Giữ nguyên |
| Tăng số ngày | Nghĩa vụ giữ | Tính lại; có thể không đổi nếu tổng vẫn nhỏ hơn hạn hiện tại | Giữ |
| Giảm số ngày | Nghĩa vụ giữ | Có sàn C + 3 ngày | Giữ |
| Thêm bài mới vào khóa | Khóa của người đã xong **mở lại** | Tính như 5.6 | Giữ; bài mới có nhãn **Mới** |
| Thêm quiz mới vào bài | Bài vẫn giữ trạng thái xong; quiz có nhãn **Mới** | Cộng nửa số ngày của một bài (5.6) | Giữ |
| Thêm bài thi cuối khóa (khóa chưa có) | Người chưa xong khóa phải thi | Cộng 3 ngày (5.6) | Giữ |
| Đổi đề thi cuối khóa | Không đổi | Không đổi | Điểm đạt cũ **vẫn tính** |
| Người học đổi ban | Nghĩa vụ ban cũ kết thúc, ban mới bắt đầu | Tính như 5.3 | Giữ ở khóa cũ |
| Chuyển giao Chapter / DNA | Bắt đầu lại từ đầu (mục 8) | Hạn mới từ đầu | Reset |
| Hủy xuất bản khóa bắt buộc (khẩn cấp) | Khóa tạm rời khỏi bộ khóa; không ai bị khóa vì nó | Như gỡ khóa (5.4); xuất bản lại thì như thêm lại (5.3) | Giữ |

### 6.1 Thêm bài hoặc quiz vào giữa khóa

Nguyên tắc: **không ai mất tiến trình và không ai bị chặn vì bài chèn thêm.**

- Bài đã xem xong và quiz đã đạt vẫn giữ nguyên.
- Bài sau vị trí chèn mà học viên đã mở thì **vẫn mở**. Học viên tiếp tục học bình thường.
- Bài hoặc quiz mới có nhãn **“Mới”** cho đến khi người học hoàn thành chúng.
- Bài mới **bắt buộc phải xong** trước khi tính hoàn thành khóa.
- **Thi cuối khóa** bị chặn cho đến khi người học xong mọi bài và đạt mọi quiz, kể cả phần mới.
- Người đã đạt thi cuối khóa **không phải thi lại**; sau khi học xong phần mới, khóa tính xong lại.

### 6.2 Cách sửa một khóa đã xuất bản

Khóa học chỉ **xuất bản một lần**. Sau đó mọi chỉnh sửa đi qua **bản nháp thay đổi** và nút **“Cập nhật khóa học”**, không cần hạ khóa về nháp:

1. Admin mở khóa đang chạy và sửa (thêm/sửa bài, quiz, bài thi cuối…). Mọi sửa đổi nằm trong một **bản nháp ẩn**; học viên vẫn học **bản đang chạy**, không thấy nội dung dang dở.
2. Khi sửa xong, Admin bấm **“Cập nhật khóa học”**. Hệ thống áp dụng tất cả **một lần**: cộng ngày theo 5.6, mở lại khóa của người đã xong nếu có bài/quiz mới, gắn nhãn **Mới**, gửi thông báo.
3. Quy tắc **bắt buộc** (ô tick) không bị ảnh hưởng, vì quy tắc gắn với khóa chứ không với trạng thái xuất bản.

### 6.3 Hủy xuất bản chỉ dùng khi khẩn cấp

Hủy xuất bản (đưa khóa về nháp) chỉ dành cho sự cố (nội dung sai nghiêm trọng, cần ngừng ngay). Khi đó:

- Khóa **tạm rời khỏi bộ khóa bắt buộc** của mọi người: không tính vào hạn và không ai bị khóa tài khoản vì khóa này. Tính như “gỡ một khóa” (5.4: còn khóa khác thì có sàn 3 ngày; hết khóa thì không còn hạn).
- **Tiến độ đã học giữ nguyên.** Ô tick bắt buộc vẫn còn.
- Khi xuất bản lại, khóa quay lại như được **thêm lại**: nếu hủy xuất bản chưa quá 3 ngày thì hạn trở về đúng hạn cũ (mục 5.7); nếu quá 3 ngày thì tính như thêm mới (5.3), người chưa xong có ngày mới tính từ lúc xuất bản lại; người đã xong thì không bị tính.

### 6.4 Chỉ tick được khóa đã xuất bản

Trang **Khóa học bắt buộc** chỉ cho tick các khóa đã xuất bản. Khóa đang nháp bị khóa ô tick, kèm lời giải thích, để không ai có nghĩa vụ với một khóa mà họ chưa mở được.

---

## 7. Quá hạn và khóa tài khoản

### 7.1 Khóa vì quá hạn học

Mỗi ngày hệ thống quét một lần. Người có khóa bắt buộc chưa xong và hạn đã qua sẽ:

1. Bị đánh dấu **quá hạn**.
2. Bị **khóa tài khoản** (không đăng nhập được).

Không bị khóa: **ADMIN, LEAD**, tài khoản đã bị vô hiệu hóa, và người không còn khóa chưa xong.

**Cách mở:** chỉ Admin, bằng **“Mở khóa & Gia hạn”** (mục 5.5, hạn mới = hôm nay + N ngày). Nút kích hoạt tài khoản thông thường **không** được dùng để mở khóa quá hạn.

### 7.2 Khóa mật khẩu

Nhập sai mật khẩu **5 lần** thì tài khoản bị khóa. Mỗi lần nhập sai, màn hình đăng nhập báo cho người dùng **còn mấy lần được thử** (ví dụ “Bạn còn 3 lần thử”). Đăng nhập đúng thì đếm lại từ đầu.

**Cách mở:** chỉ bằng **mail đặt lại mật khẩu** (người dùng tự yêu cầu hoặc Admin gửi lại). Tài khoản **không tự mở** theo thời gian và nút kích hoạt thường không mở được khóa này.

### 7.3 Bị cả hai khóa

Mở lần lượt: **gia hạn trước** (mở khóa quá hạn), **rồi gửi mail đặt lại mật khẩu**.

| Loại khóa | Nguyên nhân | Cách mở duy nhất |
|---|---|---|
| Quá hạn học | Hạn học đã qua | Admin: Mở khóa & Gia hạn |
| Mật khẩu | Sai mật khẩu 5 lần | Gửi mail đặt lại mật khẩu |

---

## 8. Chuyển giao nhiệm kỳ và sang tháng mới

- **Chuyển giao Chapter hoặc DNA:** người học bắt đầu một chu kỳ mới. Tiến độ học bị reset, nghĩa vụ cũ kết thúc, hạn mới tính từ đầu theo 5.2 (dòng “Bắt đầu lộ trình”).
- **Đổi ban trong cùng Chapter:** **không** reset. Tiến độ giữ, nghĩa vụ và hạn đổi theo 5.3.
- **Sang tháng mới:** **không** reset nghĩa vụ hay hạn. Chỉ mở kỳ thưởng sao mới.
- **Lịch sử luôn được giữ.** Chuyển giao hay reset nhiệm kỳ giống như chụp một **ảnh (snapshot)** tại thời điểm đó; dữ liệu cũ không bị xóa. Tài khoản bị vô hiệu hóa chỉ không đăng nhập được nữa. Chi tiết quy tắc bảng xếp hạng ở `CKNK.md`, mục 5.10.

---

## 9. Đã chốt nhưng code chưa làm kịp

Danh sách này dùng để lên kế hoạch sửa code. Tài liệu này mô tả đích đến.

| # | Quy tắc đã chốt | Code hiện tại |
|---|---|---|
| 1 | Role là ADMIN / LEAD / MEMBER; DNA lead cũng là LEAD | Role còn tên `CHAPTER_LEADER`; DNA lead đang là MEMBER có chức vụ `DNA_LEAD` |
| 2 | LEAD và ADMIN không có khóa bắt buộc, không bị khóa quá hạn | LEAD vẫn có thể bị gán khóa và bị khóa quá hạn |
| 3 | Tên chức vụ và 18 nhóm học theo mục 2-3 | Còn nhiều tên cũ (`MEMBER_BTV`, `LEADER_BTV`, `CHAPTER_PRESIDENT`, `CHAPTER_MANAGER`, `DEPARTMENT_LEADER`…) |
| 4 | Một người chỉ một chức vụ | Cơ sở dữ liệu mới chặn “vừa Chapter vừa DNA”; **chưa** chặn hai ban hoặc nhiều chức vụ |
| 5 | Khóa quá hạn chỉ mở bằng Mở khóa & Gia hạn | Còn hai đường khác mở được (kích hoạt tài khoản có nhập số ngày, và gỡ hạn chế trực tiếp) |
| 6 | Sai mật khẩu **5** lần thì khóa, có hiển thị số lần còn lại, chỉ mở bằng mail đặt lại mật khẩu | Khóa sau **10** lần, không báo số lần còn lại, tự mở sau 30 phút, Admin mở được bằng nhiều đường |
| 7 | Chỉ tính khóa chưa xong khi thêm khóa / đổi ban | Code tính cả khóa đã xong, nên hạn có thể dài hơn |
| 8 | Gỡ khóa: sàn 3 ngày nếu còn khóa khác; hết khóa thì không hạn | Gỡ khóa có thể làm hạn về đúng lúc gỡ, không có sàn |
| 9 | Gia hạn tay không bao giờ bị tính lại làm ngắn | Đổi cấu hình hoặc đổi ban có thể ghi đè gia hạn tay |
| 10 | Thêm bài: tính hạn từ lúc thêm; khóa đã xong mở lại thành chưa xong | Code cộng vào hạn cũ (có thể vẫn quá hạn) và không mở lại khóa đã xong |
| 11 | Bài/quiz mới có nhãn “Mới”, không chặn bài sau | Chưa có nhãn; bài chèn giữa chặn việc mở các bài kế tiếp |
| 12 | Quiz mới thêm vào bài đã xong: bài vẫn xong, quiz có nhãn Mới | Quiz mới không hiện nhãn và hiển thị “Quiz đạt” sai |
| 13 | Dữ liệu từ trước mô hình hạn chung chỉ để đọc lịch sử | Release1 bỏ phụ thuộc kích hoạt cũ; bảng/model `learning_policy` / `LearningPolicy` chỉ giữ để rollback. Trang Cấu hình học tập vẫn cần tại `/admin/learning-config`, không xóa; drop bảng/bỏ model chỉ khi release2 được duyệt sau (xem `operations.md`). |
| 14 | “Mở khóa & Gia hạn” chỉ cho tài khoản đã bị khóa; hạn mới = hôm nay + N | Code cho gia hạn cả người chưa bị khóa và tính từ hạn hiện tại nếu còn ở tương lai |
| 15 | Sửa khóa đã xuất bản qua bản nháp thay đổi + nút “Cập nhật khóa học” | Giao diện hạ khóa về nháp rồi xuất bản lại; luồng bản nháp có trong API nhưng giao diện không dùng và còn lỗi |
| 16 | Hủy xuất bản khóa bắt buộc: tạm rời khỏi bộ khóa, xuất bản lại như thêm lại | Hạn vẫn chạy và người học có thể bị khóa dù không mở được khóa |
| 17 | Chỉ tick được khóa đã xuất bản | Khóa nháp vẫn tick được |
| 18 | Thêm video/quiz riêng: chia đôi số ngày của một bài; thêm bài thi cuối +3 ngày; đổi đề không cộng | Chỉ bài học mới được cộng ngày; quiz và bài thi cuối không cộng |
| 19 | Bảng xếp hạng giữ lịch sử người đã rời; bảng đang diễn ra ẩn người đã rời (xem `CKNK.md` 5.10) | Đã đối chiếu và test fixture prompt 05: snapshot giữ người INACTIVE; live loại người rời; sửa sao Chapter ngoài cohort và legacy tháng đóng đọc snapshot. Chưa nghiệm thu DB/production và toàn bộ chuyển giao/reset; full unit còn lỗi tiến trình con (HANDOFF.md). |
| 20 | Gỡ khóa rồi thêm lại trong 3 ngày thì hạn về đúng hạn cũ (mục 5.7) | Thêm lại luôn được ngày mới nên có thể làm mới hạn vô hạn |
| 21 | Khóa chỉ có hai trạng thái **xuất bản** / **bản nháp**; “công khai / riêng tư” chỉ là việc khách có được xem hay không | Một số màn hình và mô tả còn dùng lẫn các từ này |

---

## 10. Câu hỏi còn mở

1. **Tài khoản bị ẩn danh hóa** (xóa thông tin cá nhân): bảng xếp hạng cũ hiện tên gì (tên cũ hay “Người dùng đã xóa”)?
2. **Bài mới chỉ có video** (chưa có quiz): tính theo phần video (một nửa) hay đủ một bài? Tạm ghi nhận theo phần video; khi quiz được thêm sau thì cộng nửa còn lại.
3. **Người rời giữa nhiệm kỳ** (không còn trong bảng nhiệm kỳ nhưng đã có điểm các tháng đã chốt): có cần xem lại điểm các tháng đó ở đâu ngoài bảng tháng không?

---

## 11. Từ điển ngắn

| Từ | Nghĩa |
|---|---|
| **Nghĩa vụ** | Việc “người này phải học khóa này” |
| **Hạn chung** | Một hạn duy nhất cho tất cả khóa bắt buộc của một người |
| **Chu kỳ học** | Giai đoạn tính tiến độ của một người; chuyển giao thì bắt đầu chu kỳ mới |
| **Nhóm học** | Một trong 18 nhóm người học (mục 3) |
| **Gia hạn** | Admin cộng thêm ngày vào hạn của một người |
| **LEAD** | Tài khoản lãnh đạo Chapter hoặc DNA; không học, không bị khóa quá hạn |
| **Xuất bản** / **Bản nháp** | Hai trạng thái của khóa học. Khóa đã xuất bản thì người học mở được; khóa ở bản nháp thì chưa |
| **Công khai** / **Riêng tư** | Chỉ nói khách (người chưa đăng nhập) có được xem khóa hay không; không liên quan xuất bản hay bản nháp |
