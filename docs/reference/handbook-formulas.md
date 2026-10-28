# SỔ TAY QUY TẮC NGHIỆP VỤ BBE E-LEARNING

> Tài liệu gốc: 22/10/2026. Chuyển định dạng từ Word sang Markdown.

## I. CÔNG THỨC THI ĐUA CHAPTER

### 1. Điểm Chapter trong tháng bình thường — ĐÃ CHỐT

$$
S_{m} = \frac{A_{m}}{N_{m}}
$$

**Ký hiệu:** $S_{m}$ là điểm Chapter của tháng $m$; $A_{m}$ là tổng sao hợp lệ của Chapter trong tháng; $N_{m}$ là quân số hợp lệ tại thời điểm kết thúc tháng.

**Ví dụ:** Chapter có 30 người và nhận 300 sao trong tháng, vậy $S_{m} = \frac{300}{30} = 10$ điểm.

### 2. Điểm tháng có chuyển giao — ĐÃ CHỐT

Khi Chapter **thực sự chuyển giao giữa tháng**, tách sao và quân số theo mốc chuyển giao:

$$
S_{m} = \frac{A_{1}}{N_{1}} + \frac{A_{2}}{N_{2}}
$$

Ở đây, chỉ số 1 là *trước chuyển giao*, chỉ số 2 là *sau chuyển giao*. $N_{1},N_{2}$ là quân số snapshot của từng giai đoạn; $A_{1},A_{2}$ là sao tương ứng.

| **Thông tin**  | **Trước chuyển giao** | **Sau chuyển giao** |
|----------------|-----------------------|---------------------|
| Tổng sao       | 100                   | 40                  |
| Quân số        | 30                    | 15                  |
| Điểm giai đoạn | $100/30$              | $40/15$             |

$$
S_{m} = \frac{100}{30} + \frac{40}{15} = 6
$$

**Edge cases:** Chia đúng theo timestamp thực tế (ví dụ 15/9 lúc 14:30); không làm tròn về đầu ngày. Không làm tròn sớm các kết quả trung gian. Không được dùng công thức này cho tháng **không có chuyển giao**. Với giai đoạn có quân số bằng 0, không được thực hiện phép chia;

### 3. Quân số trung bình theo thời gian — ĐÃ CHỐT

Trong tháng có chuyển giao, điều kiện quy mô **không** chỉ xét số người cuối tháng:

$$
N_{avg} = \frac{N_{1}T_{1} + N_{2}T_{2}}{T_{1} + T_{2}}
$$

$T_{1}$ là thời gian từ đầu tháng đến timestamp chuyển giao; $T_{2}$ là thời gian từ timestamp chuyển giao đến đầu tháng kế tiếp. Hai khoảng thời gian cùng đơn vị (giờ hoặc giây).

**Ví dụ xuyên suốt:** Tháng 9 có 720 giờ; chuyển giao ngày 15/9 lúc 14:30. Khi đó $T_{1} = 350,5$ giờ, $T_{2} = 369,5$ giờ, $N_{1} = 30$, $N_{2} = 15$.

$$
N_{avg} = \frac{30 \times 350.5 + 15 \times 369.5}{720} \approx 22.30
$$

Vì $22,30 > 20$, Chapter đạt điều kiện quy mô. **Không làm tròn lên/xuống trước khi so với 20.**

### 4. Tỷ lệ thành viên đạt tiến độ khi chuyển giao — ĐÃ CHỐT

Đặt $Q_{1}$ và $Q_{2}$ lần lượt là số người đạt ngưỡng tiến độ ở snapshot trước và sau chuyển giao:

$$
R = \frac{Q_{1}T_{1} + Q_{2}T_{2}}{N_{1}T_{1} + N_{2}T_{2}}
$$

Dùng tiếp ví dụ: $Q_{1} = 20$, $Q_{2} = 3$.

$$
R = \frac{20 \times 350.5 + 3 \times 369.5}{30 \times 350.5 + 15 \times 369.5} \approx 50.56\%
$$

**Ý nghĩa:** Mặc dù cuối tháng chỉ 3/15 người đạt (20%), kết quả xét cả hai giai đoạn theo thời gian vẫn khoảng 50,56%, **đạt ngưỡng 50%**.

**Cần lưu snapshot:** Nếu chỉ lưu danh sách thành viên cuối tháng, không thể tính lại chính xác tỷ lệ này.

### 5. Điều kiện được xếp hạng Chapter — ĐÃ CHỐT

Chapter chỉ được tính điểm tháng vào thi đua khi **đồng thời** đạt các điều kiện:

| **Điều kiện**                         | **Chuẩn xét**  | **Ca biên cần nhớ**                               |
|---------------------------------------|----------------|---------------------------------------------------|
| KPI                                   | Vàng hoặc Xanh | Đỏ không đạt; Vàng/Xanh không tự thêm thưởng điểm |
| Quân số                               | Lớn hơn 20     | Đúng 20 không đạt; đúng 21 đạt                    |
| Tỷ lệ người đạt tiến độ               | Tối thiểu 50%  | Đúng 50% đạt                                      |
| Tiến độ để một người được tính là đạt | Tối thiểu 70%  | Đúng 70% đạt                                      |

Tiến độ một người được tính như sau:

$$
P_{u} = \frac{L_{done,u}}{L_{core,published}} \times 100\%
$$

- **Mẫu số:** Tổng bài học đã xuất bản thuộc **ba chương trình lõi (chương trình I, II, III)**: Thành viên, LT, DNA; không gồm chương trình mở rộng/khuyến khích.

- **Tử số:** Số bài trong mẫu số mà người học đã hoàn thành trong chu kỳ đào tạo hiện hành.

- Một bài đạt khi đã xem đủ video và đạt quiz $\geq 85\%$ nếu bài có quiz; nếu không có quiz thì chỉ cần hoàn thành video.

- Người học được học mọi khóa đã xuất bản; việc khóa học **không bắt buộc** không loại nó khỏi phạm vi ba chương trình lõi.

**Tháng bình thường:** Dùng quân số và tỷ lệ theo quy tắc cuối tháng. **Tháng chuyển giao:** Dùng $N_{avg}$ và $R$ có trọng số thời gian ở mục 3–4. Trường hợp mẫu số bài học bằng 0 là ca biên cần được xử lý rõ, không được tính $0/0$.

### 6. Điểm Chapter theo nhiệm kỳ thi đua — ĐÃ CHỐT

$$
S_{term} = \sum_{m \in M_{eligible}}^{}S_{m}
$$

Tức là cộng **chỉ những tháng đã chốt và đủ điều kiện**.

| **Tháng** | **Điểm tháng** | **Đủ điều kiện** | **Điểm góp vào nhiệm kỳ** |
|-----------|----------------|------------------|---------------------------|
| 10        | 10             | Có               | 10                        |
| 11        | 15             | Không            | 0                         |
| 12        | 12             | Có               | 12                        |

**Kết quả:** $S_{term} = 10 + 0 + 12 = 22$ điểm. Không được lấy tháng không đủ điều kiện để cộng vào nhiệm kỳ dù số sao của tháng ấy lớn.

## II. BẢNG XẾP HẠNG CÁ NHÂN

### 7. Có đúng tám bảng xếp hạng — ĐÃ CHỐT

| **Nhóm**   | **Theo tháng** | **Theo nhiệm kỳ** |
|------------|----------------|-------------------|
| Thành viên | Có             | Có                |
| LT         | Có             | Có                |
| DNA        | Có             | Có                |
| Chapter    | Có             | Có                |

Mỗi bảng phải thống nhất logic backend và UI giữa các vai trò được phép xem; khác nhau chủ yếu ở nhóm dự thi và loại kỳ.

### 8. Hai người bằng sao nhiệm kỳ: ai được ưu tiên? — ĐÃ CHỐT

Nếu tổng sao nhiệm kỳ bằng nhau, ưu tiên **người đạt mức sao đó nhanh hơn tính từ lúc bắt đầu chu kỳ đào tạo của họ**:

$$
\Delta t_{u} = t_{reach,u} - t_{start,u}
$$

Người có $\Delta t_{u}$ **nhỏ hơn** xếp trên.

**Ví dụ:** A bắt đầu 01/10, đạt 100 sao ngày 21/10 (20 ngày). B bắt đầu 10/10, đạt 100 sao ngày 25/10 (15 ngày). B xếp trên A dù bắt đầu muộn hơn.

**Lưu ý:** Đối với Chapter, mốc bắt đầu là timestamp chuyển giao thực tế; đối với DNA là chu kỳ cố định 01/04 hoặc 01/10.

Khi hai người bằng tổng sao, so sánh thời gian thực tế từ đầu kỳ đến thời điểm đạt mức sao hiện tại, chính xác đến giây. Người có thời gian ngắn hơn được xếp trên.

Nếu tổng sao và thời gian đạt sao chính xác đến giây vẫn bằng nhau, hai người được đồng hạng. Không sử dụng tên, email hoặc ID để tạo ra thứ hạng hơn kém giả.

Quy tắc tương tự áp dụng cho BXH tháng, với mốc bắt đầu là đầu tháng và mốc kết thúc đo thời gian là lúc đạt số sao hiện tại, không phải mặc định cuối tháng.

### 9. Đổi vai trò giữa tháng — ĐÃ CHỐT

Bảng xếp hạng **cá nhân theo tháng** dùng vai trò tại lúc chốt tháng, đồng thời tính **tổng sao cá nhân trong tháng**.

**Ví dụ:** A đầu tháng là Thành viên nhận 20 sao; ngày 15 trở thành LT và kiếm thêm 15 sao. Cuối tháng vẫn là LT thì A ở BXH **LT tháng** với $20 + 15 = 35$ sao (không chia thành hai dòng).

Khi người học chuyển từ Chapter sang DNA giữa tháng, họ chấm dứt hoàn toàn tư cách Chapter. Trong tháng chuyển, Chapter không tính người đó vào quân số và không tính những sao họ đã kiếm trong tháng vào tổng sao thi đua Chapter. Các tháng đã chốt trước đó không bị thay đổi.

Sao cá nhân đã kiếm vẫn được bảo toàn. Bảng xếp hạng cá nhân DNA ghi nhận sao của người đó theo kỳ tháng/nhiệm kỳ tương ứng, bao gồm sao kiếm trước và sau thời điểm gia nhập DNA nếu thuộc cùng kỳ được tính. Tổng sao tích lũy toàn thời gian vẫn được giữ nguyên.

Không xóa lịch sử và không tạo giao dịch sao giả để chuyển điểm. Chỉ thay đổi quy tắc quy thuộc sao khi tính xếp hạng

## III. HỌC LẠI VÀ SAO THƯỞNG

### 10. Video: thưởng một lần cho mỗi tháng và chu kỳ — ĐÃ CHỐT

Một cửa sổ thưởng video được định danh bởi:

$$
K_{v} = (User,Video,Month,LearningCycle)
$$

| **Tình huống**                                              | **Có sao video mới?** |
|-------------------------------------------------------------|-----------------------|
| Xem đủ lần đầu trong tháng và chu kỳ                        | Có                    |
| Xem lại lần thứ hai cùng tháng, cùng chu kỳ                 | Không                 |
| Sang tháng mới, xem đủ lại                                  | Có                    |
| Chuyển giao Chapter giữa tháng, sang chu kỳ mới rồi xem lại | Có                    |

**Phân biệt hai thứ:** Hoàn thành bài học là tiến độ đào tạo; video được thưởng lại hay chưa là trạng thái thưởng. **Sang tháng chỉ reset cửa sổ thưởng, không xóa tiến độ học hoặc khóa lại bài đã mở.**

### 11. Quiz: chỉ thưởng phần cải thiện điểm cao nhất — ĐÃ CHỐT

Cửa sổ thưởng quiz:

$$
K_{q} = (User,Quiz,Month,LearningCycle)
$$

Công thức số sao mới nhận sau lần thi:

$$
\mathrm{Star}_{add} =
\begin{cases}
  0, & \text{khi } \mathrm{Score} < 85\%, \\
  \max(0, C_{new} - C_{best}), & \text{khi } \mathrm{Score} \ge 85\%.
\end{cases}
$$

$C_{new}$ là số câu đúng lần này; $C_{best}$ là mốc **số câu đúng đã được thưởng** trong cùng cửa sổ tháng và chu kỳ.

| **Lần thi (quiz 100 câu)** | **Câu đúng** | **Sao thêm** | **Tổng sao quiz trong cửa sổ** |
|----------------------------|--------------|--------------|--------------------------------|
| 1                          | 80           | 0            | 0                              |
| 2                          | 90           | +90          | 90                             |
| 3                          | 85           | +0           | 90                             |
| 4                          | 91           | +1           | 91                             |
| 5                          | 100          | +9           | 100                            |
| 6                          | 100          | +0           | 100                            |

**Các ca biên:** Dưới 85% không được thưởng; bằng hoặc thấp hơn mốc đã thưởng thì không cộng; đạt cao hơn thì chỉ cộng chênh lệch. Sang tháng hoặc sang chu kỳ đào tạo mới, mốc thưởng khởi tạo lại. Quiz cuối khóa cũng cần áp dụng đúng chính sách làm lại và nhận thưởng.

### 12. Hai dạng reset khác nhau — ĐÃ CHỐT

| **Sự kiện**                                | **Tiến độ bài học hiện hành**                  | **Cửa sổ nhận sao**    |
|--------------------------------------------|------------------------------------------------|------------------------|
| Sang tháng                                 | Giữ nguyên                                     | Mới                    |
| Chuyển giao nhiệm kỳ đào tạo               | Bắt đầu chu kỳ mới, học lại từ đầu             | Mới                    |
| Xem lại bài đã hoàn thành trong cùng tháng | Vẫn hoàn thành                                 | Không lặp thưởng video |
| Admin thêm bài mới                         | Đánh giá lại hoàn thành khóa, không xóa bài cũ | Theo quy tắc hiện hành |

**Lưu ý:** Khi bước sang tháng mới, tiến độ hoàn thành và các bài đã mở được giữ nguyên. Tuy nhiên, mỗi bài đã hoàn thành ở tháng trước phải được xem đủ video một lượt mới trong tháng hiện tại trước khi người học được tua tự do và làm lại quiz của bài đó để kiếm sao.

Sau khi đã xem đủ video trong tháng, người học được tua tự do và thi lại quiz nhiều lần theo cơ chế high-water mark. Không yêu cầu xem lại video sau mỗi lần thi không đạt.

Quy định này chỉ đặt lại quyền tua và làm quiz theo tháng, không làm khóa lại những bài học đã mở hợp lệ.

**Điểm mấu chốt:** Lịch sử tiến độ cũ phải được bảo lưu; trạng thái *đang hoàn thành hay chưa* phải được xét trong đúng chu kỳ đào tạo hiện hành

## IV. NHIỆM KỲ VÀ CHUYỂN GIAO

### 13. Tách nhiệm kỳ thi đua khỏi chu kỳ đào tạo — ĐÃ CHỐT

| **Tiêu chí**      | **Nhiệm kỳ thi đua Chapter** | **Chu kỳ đào tạo Chapter**    |
|-------------------|------------------------------|-------------------------------|
| Thời điểm bắt đầu | 01/04 hoặc 01/10             | Timestamp chuyển giao thực tế |
| Kết thúc          | 30/09 hoặc 31/03             | Chuyển giao tiếp theo         |
| Dùng để           | Xếp hạng Chapter nhiệm kỳ    | Tiến độ, sao và thưởng lại    |

**Ví dụ chuyển giao sớm:** Chapter chuyển giao ngày 15/9. Người học có chu kỳ học mới từ 15/9, nhưng **toàn bộ điểm Chapter tháng 9**, kể cả sao phát sinh sau 15/9, vẫn thuộc **nhiệm kỳ thi đua kết thúc 30/9**.

DNA có chu kỳ riêng, tự chuyển sang kỳ mới đúng 01/04 và 01/10 (theo giờ Việt Nam), không cần thao tác chuyển giao Chapter.

### 14. Chuyển giao trễ: tạm dừng nhận sao — ĐÃ CHỐT

Mốc kiểm tra là **01/04 lúc 00:00** và **01/10 lúc 00:00** theo Asia/Ho_Chi_Minh.

Nếu Chapter đến mốc mà **chưa hoàn thành chuyển giao hợp lệ cho mùa tương ứng**, thành viên vẫn có thể học nhưng **không nhận sao mới** cho đến timestamp chuyển giao thực sự có hiệu lực.

**Ví dụ:** Chuyển giao muộn lúc 10/10 14:30.

| **Khoảng thời gian**            | **Học tập** | **Nhận sao**         |
|---------------------------------|-------------|----------------------|
| Đến trước 01/10 00:00           | Có          | Có                   |
| 01/10 00:00 – trước 10/10 14:30 | Có          | Không                |
| Từ 10/10 14:30                  | Có          | Có, trong chu kỳ mới |

**Edge cases:** Sao bị bỏ lỡ trong thời gian tạm dừng **không được cộng bù (mất luốn)**. Chapter đã chuyển giao hợp lệ sớm thì không bị tạm dừng. DNA không bị ảnh hưởng bởi việc Chapter chuyển giao trễ.

### 15. Chuyển giao thực tế làm gì? — ĐÃ CHỐT

Khi chuyển giao Chapter có hiệu lực:

1.  Đóng chu kỳ đào tạo cũ và giữ bản ghi lịch sử.

2.  Mở chu kỳ đào tạo mới, đưa trạng thái học hiện hành của **mọi khóa học** (kể cả mở rộng) về chưa hoàn thành theo chu kỳ mới.

3.  Cho phép học lại bài và nhận sao theo cửa sổ thưởng mới.

4.  Thiết lập lại danh sách nghĩa vụ và deadline bắt buộc cho chu kỳ mới.

5.  Ghi audit, giữ lịch sử, video và quiz;

### 16. Tháng kích hoạt hệ thống mới giữa tháng — ĐÃ CHỐT

**Tính chính thức ngay trong tháng kích hoạt**, không có kỳ chạy thử bắt buộc.

- Nếu có đủ snapshot và sao lịch sử đáng tin cậy: có thể tính toàn bộ tháng.

- Nếu không đủ chứng cứ: tính từ timestamp kích hoạt đến hết tháng, ghi rõ **kỳ chính thức rút ngắn**.

- Tháng đủ điều kiện vẫn được tính vào nhiệm kỳ thi đua Chapter.

(Cái này dùng khi bắt đầu lở dở thì tính từ đó luôn chứ không để 1 tháng nháp hay gì hết)

## V. DEADLINE KHÓA HỌC BẮT BUỘC

### 17. Đổi chức vụ: giữ nghĩa vụ cũ, thêm nghĩa vụ mới — ĐÃ THỐNG NHẤT Ở MÔ HÌNH DEADLINE RIÊNG

Người học ban đầu bắt buộc A, B; sau đổi vị trí bắt buộc A, B, C, D:

- A và B **giữ deadline** và tiến độ đã có.

- C và D là các nghĩa vụ **mới phát sinh**, nhận thời hạn mới.

- Khóa không còn bắt buộc ở vai trò mới thì chấm dứt nghĩa vụ bắt buộc tương ứng.

- Chuyển giao nhiệm kỳ đào tạo thực sự mới khởi tạo lại toàn bộ nghĩa vụ.

### 18. Deadline chung, công thức đã đề xuất 

$$
D_{new} = \max\left( D_{start} + T_{new},\, D_{change} + T_{added} \right)
$$

- $D_{start}$: Timestamp bắt đầu lộ trình.

- $D_{change}$: Timestamp đổi chức vụ.

- $T_{new}$: Tổng số ngày được cấu hình cho các khóa bắt buộc theo vị trí mới.

- $T_{added}$: Tổng ngày dành cho những khóa **mới phát sinh**.

**Ví dụ:** A = 10 ngày, B = 10 ngày. Đến cuối ngày thứ 20 đổi sang A và C, với C = 11 ngày. Nếu lấy tổng mới (A + C) 21 ngày trừ 20 ngày đã qua thì chỉ còn **1 ngày**, không hợp lý.

Theo công thức đề xuất: $D_{new} = max(21,20 + 11) = 31$ (ngày thứ 31 kể từ ngày bắt đầu). Tức người học có **11 ngày** kể từ lúc đổi chức vụ để học C.

Tương tự như vậy:

**Ví dụ:** A = 10 ngày, B = 10 ngày. Đến cuối ngày thứ 5 đổi sang A và C, với C = 11 ngày.

$D_{new} = max(10 + 11,5 + 11) = 21$ (ngày thứ 21 kể từ ngày bắt đầu) tức người học có **16 ngày** kể từ ngày đổi chức vụ để học C.

### 19. Admin rút ngắn thời hạn khóa học — ĐÃ CHỐT

Để tránh người đang học bị quá hạn ngay khi Admin rút ngắn số ngày:

$$
D_{new} = \max\left( D_{assigned} + T_{new},\, D_{adminChange} + 3d \right)
$$

$d$ là đơn vị ngày; $D_{assigned}$ là thời điểm giao khóa bắt buộc; $D_{adminChange}$ là lúc Admin lưu thay đổi; $T_{new}$ là số ngày hạn mới.

**Ví dụ:** Giao khóa 30 ngày; đã qua 20 ngày, Admin giảm còn 10 ngày. Không thể đột ngột coi học viên đã trễ hạn từ ngày thứ 10; hạn mới phải **ít nhất 3 ngày sau thời điểm Admin đổi**.

Công thức này áp dụng cho **Admin giảm hạn (tăng hạn không áp dụng)**, không thay thế quy tắc khi người học đổi chức vụ hoặc bắt đầu chu kỳ mới.

Lưu ý: Nếu người học đã bị khóa tài khoản vì quá hạn lộ trình bắt buộc, việc thêm khóa học mới không được tự động mở tài khoản. Chỉ Admin có quyền mở lại.

Giao diện Admin phải có chức năng “Gia hạn thời gian” khi xử lý loại tài khoản này. Admin được nhập thời gian gia hạn, xem deadline mới trước khi xác nhận, ghi lý do và lưu lịch sử thao tác.

Khi Admin mở lại tài khoản và gia hạn, deadline mới phải được cập nhật ở backend và đồng bộ tới đồng hồ đếm ngược của người học. Việc gia hạn không được xóa tiến độ hoặc lịch sử quá hạn trước đó.

### 20. Admin thêm 1 bài mới vào khóa đã hoàn thành (đối với khóa học bắt buộc)

$$
T_{extra} = \max\left( \lceil\frac{T_{course}}{L_{course}}\rceil,\, 3 \right)\quad(ngày)
$$

$T_{course}$ là số ngày cấu hình của khóa; $L_{course}$ là tổng số bài học của khóa sau khi Admin công bố cập nhật, bao gồm cả các bài mới thêm. Không dùng số bài trước khi cập nhật.

Nếu thêm (k) bài trong cùng một lần cập nhật:

$$
T_{\mathrm{total\_extra}} = k \times T_{extra}
$$

**Ví dụ:** Khóa học có thời hạn 20 ngày, ban đầu gồm 5 bài. Admin bổ sung 2 bài, tổng cộng thành 7 bài.

Thời gian mỗi bài mới:

$T_{extra} = \max(\lceil 20/7 \rceil, 3) = 3$ ngày.

Vậy tổng thời gian bổ sung:

$T_{\mathrm{total\_extra}} = k \times T_{extra} = 2 \times 3 = 6$ ngày.

Thời gian bổ sung được tính từ thời điểm nội dung mới được công bố và không được cộng trùng khi hệ thống xử lý lại cùng một lần cập nhật.

## VI. CÁC QUY TẮC KHÔNG CÓ CÔNG THỨC

| **Tình huống**                                     | **Cách xử lý đã chốt**                                                                 |
|----------------------------------------------------|----------------------------------------------------------------------------------------|
| Người vào DNA                                      | Rời Chapter hiện hành; không có hai tư cách đang hoạt động                             |
| DNA học khóa thuộc chương trình Thành viên         | Được học nếu đã xuất bản; không vì thế trở thành thành viên Chapter                    |
| DNA TT                                             | Được học/nhận sao theo quy tắc, nhưng không lên BXH thi đua DNA                        |
| Tài khoản Admin / Lead Chapter / Lead DNA quản trị | Không nhận sao hoặc tham gia BXH                                                       |
| Khách chưa đăng nhập                               | Xem/tua/tải nội dung **công khai** theo thứ tự tự do; không làm quiz/nhận sao          |
| Người đã đăng nhập                                 | Bài tiếp theo chỉ mở sau khi hoàn thành video và quiz bài trước (nếu có)               |
| Đã xem video nhưng quiz dưới 85%                   | Bài sau vẫn khóa                                                                       |
| Bài đã hoàn thành, sang tháng mới                  | Vẫn mở; được xem lại để kiếm sao theo cửa sổ tháng mới. Có đánh dấu đã xem ở tháng này |
| Lead vô hiệu hóa tài khoản                         | Chỉ Admin được kích hoạt lại tài khoản đó                                              |
| Người dùng đổi tên                                 | Tên hiển thị BXH cập nhật, không đổi ID/sao                                            |
| Chuyển giao Chapter giữa tháng                     | Lưu snapshot để tính đúng hai giai đoạn                                                |

## VII. KHÁC

| **Mã** | **Tình huống**                                          | **Quyết định**                                                                                            |
|--------|---------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| M1     | Rời Chapter để vào DNA giữa tháng                       | Coi như chapter mất luôn thành viên đó, không tính vào sao, số lượng thành viên cũng như là bảng xếp hạng |
| M2     | Hai người bằng sao và bằng thời gian đạt sao ở nhiệm kỳ | Tính chi tiết ở giờ phút, giây, chắc chắn rất hi hữu để trùng                                             |
| M3     | Hai người bằng sao ở bảng xếp hạng **tháng**            | Tương tự như nhiệm kỳ nhưng thời gian được tính bằng đầu tháng đến cuối tháng                             |
| M4     | Admin thêm nhiều bài cùng lúc                           | Cộng thời gian bổ sung từng bài theo đúng công thức                                                       |
| M5     | Chủ tịch Chapter                                        | Chính thức xếp trong bảng LT                                                                              |

**Đặc biệt quan trọng với M1:** Nếu một người rời Chapter giữa tháng mà sao quá khứ vẫn được giữ trong tử số, trong khi quân số cuối tháng đã trừ người ấy, điểm trung bình có thể tăng. Cần chốt chính sách trước khi triển khai migration và kiểm thử BXH.

## VIII. BẢNG TRA CỨU 13 CÔNG THỨC

| **STT** | **Mục đích**                    | **Công thức / quy tắc**                                                             |
|---------|---------------------------------|-------------------------------------------------------------------------------------|
| 1       | Chapter tháng thường            | $S_{m} = A_{m}/N_{m}$                                                               |
| 2       | Chapter tháng chuyển giao       | $S_{m} = A_{1}/N_{1} + A_{2}/N_{2}$                                                 |
| 3       | Quân số có trọng số thời gian   | $N_{avg} = \left( N_{1}T_{1} + N_{2}T_{2} \right)/\left( T_{1} + T_{2} \right)$     |
| 4       | Tỷ lệ đạt có trọng số thời gian | $R = \left( Q_{1}T_{1} + Q_{2}T_{2} \right)/\left( N_{1}T_{1} + N_{2}T_{2} \right)$ |
| 5       | Tiến độ học của một người       | $P_{u} = 100\% \times L_{done,u}/L_{core,published}$                                |
| 6       | Chapter nhiệm kỳ                | $S_{term} = \sum_{m \in M_{eligible}}^{}S_{m}$                                      |
| 7       | Phá hòa nhiệm kỳ cá nhân        | $\Delta t = t_{reach} - t_{start}$                                                  |
| 8       | Sao quiz nhận thêm              | $\\max\left( 0,C_{new} - C_{best} \right)$ khi đạt 85%                               |
| 9       | Cửa sổ thưởng video             | (User, Video, Month, LearningCycle)                                                 |
| 10      | Cửa sổ thưởng quiz              | (User, Quiz, Month, LearningCycle)                                                  |
| 11      | Deadline chung đổi chức vụ      | $\\max\left( D_{start} + T_{new},D_{change} + T_{added} \right)$ — **chưa chốt**     |
| 12      | Admin giảm hạn                  | $\\max\left( D_{assigned} + T_{new},D_{adminChange} + 3d \right)$                    |
| 13      | Thêm một bài vào khóa           | $\\max\left( \lceil T_{course}/L_{course}\rceil,3d \right)$                          |
