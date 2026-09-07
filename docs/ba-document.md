
E-LEARNING CLUB — BA WORKING DOCUMENT

1. PRODUCT OVERVIEW

1.1 Business problem

Hiện hoạt động đào tạo của câu lạc bộ diễn ra định kỳ, tuy nhiên một số thành viên không thể tham gia đúng thời điểm hoặc không có cách xem lại nội dung. Điều này làm mất sự đồng đều giữa năng lực và cách làm việc của các bạn thành viên trong chapter. Hiện tại cũng chưa có một khung năng lực, hay cách thức nào để đảm bảo các bạn thành viên hiểu được cách hoạt động của BBE.

1.2 Objectives & success metrics

Mã

Objective

Success metrics

OBJ-01

Thành viên mới được tiếp cận với các video đào tạo một cách dễ dàng

90% Thành viên tạo tài khoản trong tuần đầu tiên kể từ khi phát hành sản phẩm

OBJ-02

Thành viên hiểu được cách hoạt động của BBE thông qua các video đào tạo

90% Thành viên hoàn thành ít nhất 1 khóa học trong 1 tháng đầu tiên kể từ khi phát hành

OBJ-03

BĐHU quản lý được tiến độ của thành viên chapter mình

100% thành viên đã có tài khoản trong chapter được theo dõi bởi BĐHU

Admin quản lý được các nguồn và đưa tất cả tài liệu BBE lên một nguồn duy nhất

100% tài liệu được lưu trữ trên dự án thành công

1.3 Stakeholders (dự án cá nhân nên chỉ có mình tôi :)))

- Sponsor/Người ra quyết định: [điền tên/vai trò]
- Người phê duyệt requirement: [điền]
- Admin vận hành: [điền]
- BĐHU sử dụng dashboard: [điền]
- Thành viên học nội dung: [điền]
- Developer/Designer: [điền]

2. SCOPE

2.1 MVP scope

MVP-1:

Invitation/đăng nhập

Phân quyền

Quản lý khóa học, bài học, video và tài liệu

Thành viên xem nội dung và tự theo dõi tiến độ

Làm bài kiểm tra cuối khóa học

BĐHU xem được tiến độ của từng thành viên

MVP-2:

Dashboard cho Admin

Streak cho thành viên

Leaderboard cho chapter và tất cả thành viên BBE

Chatbot hỏi đáp về BBE

2.2 Out of scope — phiên bản đầu

Phiên bản ban đầu không hỗ trợ: Ứng dụng moblie, lớp học livestream, các chapter tự tạo bài học đào tạo nội bộ, chấm tự luận bằng AI, tạo chứng chỉ, tích hợp hệ thống bên ngoài.

2.3 Assumptions, risks & open questions

Assumption = Tôi đang tạm tin điều này đúng.

Risk = Nếu điều gì đó xảy ra, dự án có thể gặp vấn đề.

Open Question = Tôi chưa biết câu trả lời và cần xác nhận.

ID

Assumption

A-01

Mỗi Member thuộc một Chapter tại một thời điểm.

A-02

Admin là người quản lý danh sách BĐH.

A-03

BĐH chịu trách nhiệm quản lý Member thuộc Chapter của mình.

A-04

Người dùng có thể nhận email để kích hoạt tài khoản.

A-05

Admin, BĐHU, Thành viên dùng chung trang web, Admin và BĐHU sẽ có vài điểm thêm

ID

Risk

Impact

Mitigation

R-01

Email invitation không được nhận bởi người dùng.

Người dùng không thể kích hoạt tài khoản.

Cho phép gửi lại invitation.

R-02

Invitation bị chia sẻ cho người khác.

Người không đúng có thể kích hoạt tài khoản.

Cảnh báo người dùng + có thời hạn.

R-03

BĐH nhập sai email Member.

Invitation được gửi nhầm người.

Xác nhận thông tin trước khi gửi, cho phép hủy invitation

ID

Open Question

Giải pháp hiện có

OQ-01

OQ-02

OQ-03

Nếu Member không nhận được email thì xử lý thế nào?

OQ-04

Khi Member rời Chapter thì tài khoản được xử lý thế nào?

OQ-05

BĐH có được mời Member ngoài Chapter của mình không?

OQ-06

Làm sao lưu trữ/phân phối video ổn định với 500 người dùng đồng thời?

OQ-07

Làm sao đồng bộ tiến độ giữa máy tính và điện thoại?

OQ-08

3. USERS, ROLES & PERMISSIONS

3.1 Role definitions

- Admin: tạo/sửa/ẩn/xóa khóa học, bài học, video, tài liệu; gửi/ hủy/ gửi lại mã mời tham gia đến email BĐHU; Xem danh sách BĐHU, thành viên của chapter tương ứng và trạng thái/ tiến độ của mỗi tài khoản
- BĐHU: chỉ xem dữ liệu thành viên thuộc chapter được phân công; xem tiến độ; gửi/ hủy/ gửi lại mã mời thành viên tham gia đến email thành viên. Xem danh sách thành viên của chapter và trạng thái/ tiến độ của mỗi tài khoản
- Thành viên: xem các nội dung Published; xem tiến độ cá nhân; làm bài kiểm tra khi xem hết các video trong bài học
- Khách: Chỉ xem được các Published + Public

3.2 Permission matrix

Chức năng

Admin

BĐHU

Thành viên

Khách

Xem các Course

Draft/Published Course

Published Course

Published Course

Published + Public Course

Tải, sửa, xóa, chỉnh quyền cho video, tài liệu

Có

Không

Không

Không

Tạo bài kiểm tra cuối khóa

Có

Không

Không

Không

Biết đáp án của bài kiểm tra và giải thích

Có

Có

Có, nếu điểm đạt trên 85 điểm trong bài kiểm tra

Không

Làm bài kiểm tra

Không

Không

Có

Không

Xem danh sách tài khoản

Có, xem được BĐHU và Thành viên ở mỗi chapter

Có, xem được Thành viên chapter mình

Không

Không

Gửi invitation

Có, gửi cho BĐHU

Có, gửi có các thành viên

Không

Không

Chỉnh tài khoản từ active thành inactive và ngược lại

Có, cả BĐHU và Thành viên ở các chapter

Có, gồmThành viên

Không

Không

4. BUSINESS RULES

BR-01. Course visibility

Published + Public Course xem không cần đăng nhập. Private Course chỉ hiển thị cho tài khoản thành viên đã Active hoặc tài khoản của BĐHU đã Active, và Admin

BR-02. Invitation and account activation

Lời mời chỉ được gửi đến email chưa được dùng cho tài khoản khác.

Lời mời hết hạn sau 24 giờ kể từ lúc gửi.

Người gửi có thể hủy lời mời chưa được chấp nhận

Lời mời chỉ được sử dụng một lần.

Người nhận tạo mật khẩu thành công thì tạo tài khoản Active, lời mời chuyển từ Pending sang Accepted

Khi gửi link mới cho tài khoản đang Pending, link cũ sẽ bị vô hiệu hóa

Admin được tạo từ trước trong dữ liệu với email nhất định. Admin gửi lời mời tương tự với cách hoạt động của BĐHU gửi cho thành viên

Thành viên khi rời chapter thì vẫn sẽ được giữ tài khoản

BR-03. Learning completion

Một lesson video được đánh dấu Completed khi người học đã xem tối thiểu 85% thời lượng video đó.

Thời lượng xem được tính duy nhất theo các đoạn video đã xem, không cộng lặp khi xem lại cùng một đoạn.

Thành viên không thể tua video lên những phần mình chưa coi, chỉ có thể tua lại những phần mình đã coi

Được tăng tốc độ x1.5, x2 tốc độ video

Mất mạng được lưu tiến trình ở video đó

BR-04. Assessment & retake

Mỗi course có tối đa một final kiểm tra

Thành viên chỉ bắt đầu bài kiểm tra cuối cùng khi tất cả lesson trong course đó ở trạng thái Completed.

Bài kiểm tra được đánh dấu Pass khi người học đạt lớn hơn bằng 85/100

Câu hỏi và đáp án được xáo trộn trong mỗi attempt

Thời gian bài kiểm tra bằng số câu x 2 phút, sau khi hết giờ hệ thống sẽ tự động nộp toàn bộ bài

Nếu điểm dưới 85, chỉ hiển thị trạng thái đúng/sai của từng câu; không hiển thị đáp án đúng hay giải thích.

Nếu điểm từ 85 trở lên, hiển thị đáp án đúng và giải thích của tất cả câu.

Attempt mới được mở sau 24 giờ tính từ thời điểm nộp attempt trước, trừ khi lần làm trước được điểm tuyệt đối

Khi hủy giữa chừng khi làm Attempt, không tính vào lịch sử điểm; và sau 24h mới được làm lại

Hệ thống vẫn tính giờ theo thời gian trên Server đối với trường hợp mất mạng; Nhưng người dùng sẽ không được phép làm bài tiếp vì sẽ không load được câu hỏi. Thành viên có thể vào sau đó để tiếp tục làm nếu còn thời gian làm bài; Các câu được chọn sẽ được lưu trên máy người dùng

BR-06. Leaderboard (chưa đưa vào MVP, phát triển sau)

BR-07. Chatbot (chưa đưa vào MVP, phát triển sau)

BR-08. Streak

Mỗi ngày phải xem ít nhất 1 video hoặc làm ít nhất 1 bài kiểm tra để tính streak;

5. FUNCTIONAL REQUIREMENTS

Quy tắc viết: Actor + hành động + dữ liệu/điều kiện + kết quả. Tránh các từ “tốt”, “mượt”, “dễ”.

5.1 Authentication & account management

Đối tượng

Trạng thái đề xuất

Invitation

Pending, Accepted, Expired, Cancelled

Account

Active, Inactive, Lock

Password reset request

Requested, Used, Expired, Cancelled

Course

status: Draft/Published

visibility: Public/Private

Attempt

SUBMITTED, AUTO_SUBMITTED, CANCELLED

Invitation & activation

FR-AUTH-01

Admin có thể gửi lời mời đăng ký BĐHU tới một email hợp lệ; Khi mời ban định hướng đồng thời cũng phải tạo luôn một chapter mới;

BĐHU có thể gửi lời mời đăng ký thành viên tới một email hợp lệ trong chapter do mình quản lý

Hệ thống không cho tạo lời mời mới nếu email đã gắn với tài khoản Active

Lời mời hết hạn sau 24 giờ; khi hết hạn, trạng thái lời mời chuyển thành Expired

Không thể gửi invitation cho các tài khoản có trạng thái Inactive hoặc Active

Người gửi có thể hủy lời mời đã được gửi và ở trạng thái Pending; lời mời sau đó không còn sử dụng được.

Người nhận có thể tạo mật khẩu với email được gửi thông qua link mời hợp lệ; sau khi thành công, lời mời chuyển Accepted và tài khoản chuyển Active.

Login

Người dùng có tài khoản Active có thể đăng nhập bằng email và mật khẩu

Hệ thống từ chối đăng nhập nếu email/mật khẩu không hợp lệ hoặc tài khoản Inactive

Hệ thống cho phép người dùng đăng xuất

Password reset

Người dùng có thể yêu cầu đặt lại mật khẩu bằng email đã đăng ký;

Hệ thống gửi link đặt lại mật khẩu dùng một lần đến email đó.

Link đặt lại mật khẩu hết hạn sau 15 phút và bị vô hiệu sau khi sử dụng.

Người dùng đặt mật khẩu mới thành công thì có thể đăng nhập bằng mật khẩu mới; Tài khoản đặt lại trạng thái Active nếu đang ở Lock

Tài khoản sẽ chuyển thành trạng thái Lock nếu như đăng nhập liên tiếp 10 lần

Invitation management

Admin/BĐHU có thể xem lời mời do mình gửi, gồm email, chapter, người gửi, thời điểm gửi và trạng thái lời mời, và trạng thái tài khoản

Admin/BĐHU có thể gửi lại lời mời Expired hoặc Cancelled; Với một lời mời Pending hệ thống vô hiệu link cũ và gửi lại một link mới.

5.2 Course, lesson & content management

Admin có thể tạo Course bao gồm tiêu đề, mô tả, trạng thái Draft/ Published

Admin có thể tạo Session, Lesson nhỏ hơn trong khóa học và tải lên video lên cho Lesson, tạo tiêu đề, tài liệu

Admin không được Publish mỗi Course hay Session không chứa bất kỳ Lesson nào

Hệ thống chỉ hiển thị các nội dung Published

Tài liệu bài học được đính kèm bên cạnh của Lesson

Một Lesson bắt buộc chứa đúng 1 video và 0..n tài liệu đính kèm

5.3 Learning progress

FR-LRN-01

Thành viên có tài khoản Active được xem danh sách Published Course

Thành viên có thể xem video và mở tài liệu thuộc Lesson nhất định

Hệ thống lưu trạng thái hoàn thành theo BR-03

Hệ thống hiển thị tiến độ hoàn thành Course đó theo số lượng Lesson đã học được

Tiến độ được làm tròn thành số %

Thành viên không thể tua video lên những phần mình chưa coi, chỉ có thể tua lại những phần mình đã coi

5.4 Assessment

FR-ASM-01

Admin có thể tạo bài kiểm tra và gán cho một khóa học.

Thành viên làm bài kiểm tra tuân theo BR-04

Sau khi nộp bài, hệ thống hiển thị điểm và lưu attempt.

Hệ thống lưu lại lịch sử làm bài

Hệ thống tự động nộp bài khi hết giờ và tính điểm những câu đã làm

Course khi đã status: PUBLIC thì không thể chỉnh sửa gì nữa; nếu muốn chỉnh sửa thì kiểm tra có ai đang học và làm bài kiểm tra không mới được chuyển về status: DRAFT

5.5 BĐHU dashboard

FR-DB-01

BĐHU xem danh sách thành viên thuộc chapter được gán.

BĐHU có thể tìm kiếm và xem được mỗi thành viên đã hoàn thành bao nhiêu % khóa học

BĐHU có thể tìm kiếm và xem được mỗi khóa học đã có bao nhiêu thành viên hoàn thành

BĐHU không truy cập dữ liệu thành viên ở chapter khác.

5.6 Chatbot BBE [ĐỂ SAU MVP, TRỪ KHI CÓ BUSINESS NEED RÕ]

Nội dung đã có: chatbot hỏi đáp BBE.

Requirement mẫu sau khi làm rõ:

“Người dùng có thể gửi câu hỏi về tài liệu BBE được Admin phê duyệt. Câu trả lời phải nêu tài liệu/bài học nguồn khi có nguồn phù hợp.”

Không ghi “train AI thế nào” ở đây; đó là giải pháp kỹ thuật.

6. NON-FUNCTIONAL REQUIREMENTS

Nội dung đã có cần viết lại để đo được:

NFR-PERF-01:

Với tối đa 500 người dùng đồng thời, 95% lần tải trang danh sách khóa học hoàn tất trong ≤ 3 giây, đo trong điều kiện mạng mục tiêu ổn định

NFR-PERF-02

Sau khi người dùng hoàn thành bài học, trạng thái phải xuất hiện trên thiết bị khác trong 1 giây khi cả hai thiết bị có Internet với điều kiện thiết bị khác phải tải lại trang nếu đang ở trang vừa được cập nhật

NFR-VID-01

95% thao tác seek trong video chất lượng [720p/1080p] bắt đầu phát lại trong ≤ 1 giây” hoặc điều chỉnh sau proof-of-concept (bản thử nghiệm).

NFR-SEC-01

User không được truy cập video/tài liệu nội bộ bằng URL trực tiếp nếu không có quyền.

Hệ thống hỗ trợ 2 phiên bản gần nhất của Chrome, Edge và Safari

Mọi API yêu cầu xác thực, trừ các endpoint công khai; backend kiểm tra role, chapter và quyền truy cập course trước khi trả dữ liệu
