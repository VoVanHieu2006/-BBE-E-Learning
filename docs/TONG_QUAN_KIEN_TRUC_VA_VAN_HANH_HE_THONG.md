# 📘 TỔNG QUAN KIẾN TRÚC & VẬN HÀNH HỆ THỐNG E-LEARNING BBE
> **Hệ thống Quản lý & Đào tạo Nội bộ Câu lạc bộ Doanh nhân BBE (BBE Learning Hub)**  
> *Tài liệu kỹ thuật và nghiệp vụ tổng quan dành cho Ban Quản trị, Lập trình viên, Stakeholders và Thành viên mới.*

---

## 📑 MỤC LỤC
1. [Giới thiệu & Bài toán Nghiệp vụ](#1-giới-thiệu--bài-toán-nghiệp-vụ)
2. [Sơ đồ Kiến trúc Tổng thể Hệ thống (System Architecture)](#2-sơ-đồ-kiến-trúc-tổng-thể-hệ-thống)
3. [Mô hình Phân quyền & Quản trị Theo Cấp bậc (RBAC & Chapter Scope)](#3-mô-hình-phân-quyền--quản-trị-theo-cấp-bậc)
4. [Sơ đồ Thực thể Dữ liệu (Database ERD Diagram)](#4-sơ-đồ-thực-thể-dữ-liệu-database-erd)
5. [Các Luồng Vận hành Nghiệp vụ Cốt lõi (Core Business Flows)](#5-các-luồng-vận-hành-nghiệp-vụ-cốt-lõi)
   - [5.1 Luồng Mời & Kích hoạt Tài khoản (Invitation Flow)](#51-luồng-mời--kích-hoạt-tài-khoản)
   - [5.2 Luồng Vòng đời Khóa học & Xuất bản (Course Lifecycle)](#52-luồng-vòng-đời-khóa-học--xuất-bản)
   - [5.3 Luồng Học tập & Cơ chế Chống Tua Video (Anti-Seek Progress Flow)](#53-luồng-học-tập--cơ-chế-chống-tua-video)
   - [5.4 Luồng Làm Bài Kiểm tra & Đánh giá Năng lực (Assessment & Retake Flow)](#54-luồng-làm-bài-kiểm-tra--đánh-giá-năng-lực)
   - [5.5 Luồng Giám sát & Báo cáo Tiến độ Chapter (Dashboard & Analytics)](#55-luồng-giám-sát--báo-cáo-tiến-độ-chapter)
6. [Chiến lược Hiệu năng & Bảo mật (Performance & Security)](#6-chiến-lược-hiệu-năng--bảo-mật)
7. [Bản đồ Cấu trúc Thư mục Codebase](#7-bản-đồ-cấu-trúc-thư-mục-codebase)

---

## 1. Giới thiệu & Bài toán Nghiệp vụ

### 1.1 Bối cảnh
Trước khi có hệ thống, hoạt động đào tạo của **Câu lạc bộ Doanh nhân BBE** diễn ra phân tán hoặc offline. Thành viên mới tham gia vào các Chapter (Chi hội) khác nhau bị thiếu hụt kiến thức nền tảng, không có tài liệu chuẩn hóa, và **Ban Điều Hành Chapter (BĐHU)** không thể theo dõi ai đã hoàn thành chương trình đào tạo.

### 1.2 Giải pháp của Hệ thống (BBE E-Learning Hub)
- **Tập trung hóa tri thức:** Lưu trữ toàn bộ video đào tạo (tích hợp YouTube CDN không tốn băng thông) và tài liệu đính kèm (lưu trữ Cloud Object Storage an toàn).
- **Phân cấp quản trị linh hoạt:** Admin quản lý toàn hệ thống, Chapter Leader chỉ quản lý và theo dõi tiến độ của thành viên thuộc Chapter mình.
- **Học thật - Thi thật:**
  - **Chống tua video (Anti-Seek):** Người học không thể tua trước đoạn chưa xem; hệ thống giám sát tiến trình xem video (yêu cầu xem $\ge 85\%$ mới được tính hoàn thành bài học).
  - **Đánh giá chuẩn xác (Assessment):** Đề thi trắc nghiệm ngẫu nhiên, tự động nộp bài khi hết giờ, yêu cầu đạt $\ge 85/100$ điểm, giới hạn làm lại (cooldown 24h) để tránh học vẹt.
- **Thúc đẩy động lực:** Hệ thống Streak hàng ngày và Bảng xếp hạng (Leaderboard) toàn quốc và nội bộ từng Chapter.

---

## 2. Sơ đồ Kiến trúc Tổng thể Hệ thống

Hệ thống được xây dựng theo kiến trúc **Monolithic hiện đại** dựa trên **Next.js 14 App Router** (Full-stack TypeScript), kết hợp Edge Middleware, Prisma ORM và các dịch vụ đám mây chuyên dụng.

```mermaid
flowchart TB
    subgraph CLIENT_TIER["1. Client Tier (Trình duyệt Người dùng)"]
        direction TB
        Browser["Desktop & Mobile Web Browser"]
        CacheClient["Client Cache Layer\n• In-Memory Map (30s)\n• SessionStorage (2m)\n• SWR Pattern & In-Flight Dedupe"]
        YTPlayer["YouTube Player Controller\n• 500ms Watcher Guard\n• 8s Progress Heartbeat"]
        Browser --> CacheClient
        Browser --> YTPlayer
    end

    subgraph EDGE_TIER["2. Edge & Middleware Layer"]
        Middleware["Next.js Edge Middleware (src/middleware.ts)\n• Bearer & Cookie JWT Verification (jose)\n• Silent Token Refresh at Edge\n• Role & Route Protection (/admin, /chapter-manager, /student)"]
    end

    subgraph APP_TIER["3. Application Tier (Next.js 14 App Router Server)"]
        direction TB
        API_Gateway["API Handlers (/api/v1/**)\n• Request Validation & Rate Guard\n• User Status Cache (30s TTL)"]
        
        subgraph MODULES["Core Modules"]
            AuthMod["Auth & Session\n(JWT, Refresh Token, Invalidate Cache)"]
            CourseMod["Course & Lesson Manager\n(Draft/Publish, Anti-Seek Progress Engine)"]
            QuizMod["Assessment & Exam Engine\n(Random Shuffling, Server Timer, Auto Submit)"]
            ChapterMod["Chapter & Member Scoping\n(assertChapterAccess, BĐHU Scoping)"]
            InviteMod["Invitation System\n(24h Token Hash, Activation Mail)"]
        end
        
        API_Gateway --> AuthMod
        API_Gateway --> CourseMod
        API_Gateway --> QuizMod
        API_Gateway --> ChapterMod
        API_Gateway --> InviteMod
    end

    subgraph DATA_TIER["4. Data Tier"]
        PrismaORM["Prisma ORM v6\n(Type-safe Query Engine & Transactions)"]
        PostgreSQL[("PostgreSQL Database\n• Neon / Managed Postgres\n• Connection Pooling\n• Full-text Search")]
        PrismaORM --> PostgreSQL
    end

    subgraph EXTERNAL_SERVICES["5. External Cloud Services"]
        YouTubeCDN["YouTube CDN\n(Streaming Video không tốn băng thông)"]
        StorageS3["AWS S3 / Cloudflare R2\n(Tài liệu bài giảng qua Presigned URL có thời hạn)"]
        ResendMail["Resend Email Service\n(Gửi mã mời & Link Reset Password)"]
    end

    CLIENT_TIER -- "HTTP / REST API (JSON)" --> Middleware
    Middleware --> APP_TIER
    APP_TIER --> PrismaORM
    YTPlayer -. "IFrame API" .- YouTubeCDN
    InviteMod -. "API Key (Resend)" .-> ResendMail
    CourseMod -. "AWS SDK (Presigned URL)" .-> StorageS3
```

---

## 3. Mô hình Phân quyền & Quản trị Theo Cấp bậc

Hệ thống triển khai mô hình **RBAC (Role-Based Access Control)** kết hợp **Chapter Scoping (Phân lập dữ liệu theo Chi hội)** nghiêm ngặt.

```mermaid
graph TD
    classDef admin fill:#f97316,stroke:#ea580c,stroke-width:2px,color:#fff;
    classDef leader fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff;
    classDef member fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;
    classDef guest fill:#6b7280,stroke:#374151,stroke-width:2px,color:#fff;

    Admin["👑 ADMIN (Quản trị viên toàn quốc)"]:::admin
    LeaderA["🎖️ CHAPTER LEADER A (BĐHU Hà Nội)"]:::leader
    LeaderB["🎖️ CHAPTER LEADER B (BĐHU TP.HCM)"]:::leader
    MemberA1["👤 Member A1"]:::member
    MemberA2["👤 Member A2"]:::member
    MemberB1["👤 Member B1"]:::member
    Guest["🌐 GUEST (Khách vãng lai)"]:::guest

    Admin -->|"Quản lý toàn bộ Khóa học, Toàn bộ Chapter & Phân quyền BĐHU"| LeaderA
    Admin -->|"Quản lý toàn bộ Khóa học, Toàn bộ Chapter & Phân quyền BĐHU"| LeaderB
    LeaderA -->|"Chỉ xem & quản lý thành viên Chapter A"| MemberA1
    LeaderA -->|"Chỉ xem & quản lý thành viên Chapter A"| MemberA2
    LeaderB -->|"Chỉ xem & quản lý thành viên Chapter B"| MemberB1

    subgraph PERMISSIONS["Ma trận Quyền hạn Cốt lõi"]
        direction TB
        P_Guest["Khách: Chỉ xem Khóa học PUBLISHED + PUBLIC, không làm bài test, không lưu tiến độ."]
        P_Member["Member: Xem Khóa PUBLISHED (Public & Private), xem video, lưu tiến độ, làm bài test, xem Streak & Leaderboard."]
        P_Leader["Chapter Leader: Quyền của Member + Mời Member vào Chapter, Xem Dashboard tiến độ Chapter, Khóa/Mở tài khoản Member Chapter mình."]
        P_Admin["Admin: Toàn quyền tạo/sửa/xóa Khóa học, Soạn bài thi, Tạo Chapter, Mời Leader, Xem báo cáo toàn hệ thống."]
    end
```

> [!IMPORTANT]
> **Nguyên tắc Bảo mật Scoping (FR-DB-01):**
> Backend luôn thực thi hàm `assertChapterAccess(request, targetChapterId)`. Một Chapter Leader thuộc Chapter Hà Nội **tuyệt đối không thể** xem hoặc sửa đổi dữ liệu thành viên Chapter TP.HCM dù cố tình thay đổi `chapterId` trên URL hay API.

---

## 4. Sơ đồ Thực thể Dữ liệu (Database ERD)

Cơ sở dữ liệu PostgreSQL gồm 15 bảng quan hệ được chuẩn hóa cao độ, phục vụ trọn vẹn từ Tài khoản, Khóa học, Tiến độ, Đề thi đến Nhật ký kiểm toán.

```mermaid
erDiagram
    users ||--o{ chapter_members : "thuộc về"
    chapters ||--o{ chapter_members : "chứa"
    chapters ||--o{ invitations : "mời vào"
    users ||--o{ invitations : "được mời / người mời"
    users ||--o{ courses : "tạo bởi"
    courses ||--o{ sessions : "gồm các chương"
    sessions ||--o{ lessons : "gồm các bài học"
    lessons ||--o| videos : "có đúng 1 video"
    lessons ||--o{ documents : "tài liệu đính kèm"
    lessons ||--o| assessments : "có tối đa 1 bài kiểm tra"
    assessments ||--o{ questions : "chứa các câu hỏi"
    questions ||--o{ question_options : "các lựa chọn đáp án"
    users ||--o{ lesson_progress : "tiến độ học"
    lessons ||--o{ lesson_progress : "được theo dõi bởi"
    assessments ||--o{ attempts : "lần thi"
    users ||--o{ attempts : "người thi"
    attempts ||--o{ attempt_questions : "đề thi xáo trộn"
    questions ||--o{ attempt_questions : "câu hỏi trong lần thi"
    attempts ||--o{ attempt_answers : "câu trả lời"
    questions ||--o{ attempt_answers : "trả lời câu hỏi"
    question_options ||--o{ attempt_answers : "chọn đáp án"
    users ||--o{ audit_logs : "thực hiện hành động"
    users ||--o{ refresh_tokens : "quản lý phiên"

    users {
        uuid id PK
        varchar email UK
        varchar password_hash
        user_role role "ADMIN | CHAPTER_LEADER | MEMBER"
        user_status status "ACTIVE | INACTIVE | LOCKED"
        int failed_login_count
        timestamp locked_until
        timestamp created_at
    }

    chapters {
        uuid id PK
        varchar name UK
        text description
        chapter_status status "ACTIVE | INACTIVE"
        timestamp created_at
    }

    chapter_members {
        uuid id PK
        uuid chapter_id FK
        uuid user_id FK
        timestamp joined_at
    }

    invitations {
        uuid id PK
        varchar email
        invitation_role role
        uuid chapter_id FK
        uuid invited_by FK
        varchar token_hash UK
        invitation_status status "PENDING | ACCEPTED | EXPIRED | CANCELLED"
        timestamp expires_at
    }

    courses {
        uuid id PK
        varchar title
        text description
        course_status status "DRAFT | PUBLISHED"
        course_visibility visibility "PUBLIC | PRIVATE"
        uuid created_by FK
        timestamp published_at
    }

    sessions {
        uuid id PK
        uuid course_id FK
        varchar title
        int sort_order
    }

    lessons {
        uuid id PK
        uuid session_id FK
        varchar title
        text description
        int sort_order
    }

    videos {
        uuid id PK
        uuid lesson_id FK,UK
        video_provider provider "YOUTUBE"
        varchar youtube_video_id
        int duration_seconds
    }

    documents {
        uuid id PK
        uuid lesson_id FK
        varchar file_name
        varchar storage_key
        varchar mime_type
        bigint file_size
    }

    lesson_progress {
        uuid id PK
        uuid user_id FK
        uuid lesson_id FK
        boolean completed
        int last_position_seconds
        int furthest_watched_position_seconds
        timestamp last_watched_at
        timestamp completed_at
    }

    assessments {
        uuid id PK
        uuid lesson_id FK,UK
        varchar title
        uuid created_by FK
    }

    questions {
        uuid id PK
        uuid assessment_id FK
        text question_text
        question_type question_type "SINGLE | MULTIPLE | TRUE_FALSE"
        int points
        int duration_seconds
        int sort_order
        text explanation
    }

    question_options {
        uuid id PK
        uuid question_id FK
        text option_text
        boolean is_correct
        int sort_order
    }

    attempts {
        uuid id PK
        uuid assessment_id FK
        uuid user_id FK
        int attempt_number
        attempt_status status "IN_PROGRESS | SUBMITTED | AUTO_SUBMITTED | CANCELLED"
        decimal score
        boolean passed
        timestamp started_at
        timestamp expires_at
        timestamp submitted_at
    }
```

---

## 5. Các Luồng Vận hành Nghiệp vụ Cốt lõi

### 5.1 Luồng Mời & Kích hoạt Tài khoản
Quy trình onboard thành viên an toàn, loại bỏ việc đăng ký tự do để đảm bảo 100% người dùng là thành viên BBE thực thụ.

```mermaid
sequenceDiagram
    autonumber
    actor AdminOrLeader as Admin / BĐHU
    participant Server as Next.js API (/invitations)
    participant DB as PostgreSQL DB
    participant Mail as Resend Mail Service
    actor Member as Thành viên Mới

    AdminOrLeader->>Server: Gửi lời mời (Email, Role, ChapterId)
    Server->>DB: Kiểm tra: Email đã Active chưa? Đang có lời mời Pending không?
    alt Email đã tồn tại & Active
        Server-->>AdminOrLeader: Báo lỗi: Email đã có tài khoản
    else Email hợp lệ
        Server->>DB: Lưu Invitation (token_hash, status: PENDING, expires_at: now + 24h)
        Server->>Mail: Gửi email chứa link kích hoạt (/accept-invitation?token=...)
        Mail-->>Member: Nhận email kích hoạt
        Server-->>AdminOrLeader: Thông báo gửi lời mời thành công
    end

    Member->>Server: Truy cập link kích hoạt & Thiết lập mật khẩu mới
    Server->>DB: Xác thực token_hash & kiểm tra hạn 24h
    alt Hết hạn (Expired) hoặc Đã dùng (Accepted)
        Server-->>Member: Báo lỗi link không hợp lệ hoặc đã hết hạn
    else Hợp lệ
        Server->>DB: 1. Tạo User (email, password_hash, status: ACTIVE)<br/>2. Gắn ChapterMember(chapter_id, user_id)<br/>3. Cập nhật Invitation -> ACCEPTED
        Server-->>Member: Đăng ký thành công -> Tự động đăng nhập & chuyển tới Trang học
    end
```

---

### 5.2 Luồng Vòng đời Khóa học & Xuất bản

Khóa học được bảo vệ nghiêm ngặt để tránh ảnh hưởng đến học viên đang theo học.

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Admin tạo Khóa học mới
    
    state DRAFT {
        [*] --> SoanThao : Thêm Session & Lesson
        SoanThao --> UploadContent : Gắn Video YouTube & Tài liệu S3
        UploadContent --> SoanBaiTest : Tạo bài kiểm tra trắc nghiệm
    }

    DRAFT --> PUBLISHED : Admin bấm Xuất bản (Publish)
    note right of PUBLISHED
        Điều kiện tiên quyết:
        1. Phải có ít nhất 1 Session
        2. Mỗi Session phải có ít nhất 1 Lesson
        3. Khóa học công khai (Public) hoặc nội bộ (Private)
    end note

    PUBLISHED --> CanhBaoUnpublish : Admin muốn Sửa hoặc Gỡ
    state CanhBaoUnpublish {
        [*] --> KiemTraHocVien : API quét số người đang học / thi
        KiemTraHocVien --> XacNhanAdmin : Cảnh báo danh sách người bị ảnh hưởng
    }

    CanhBaoUnpublish --> DRAFT : Admin xác nhận rút về Draft để sửa
    PUBLISHED --> [*] : Lưu trữ / Đóng khóa học
```

---

### 5.3 Luồng Học tập & Cơ chế Chống Tua Video (BR-03)
Đây là tính năng kỹ thuật nổi bật nhất của hệ thống, bảo vệ tính trung thực trong đào tạo qua **2 lớp phòng vệ (Client + Server)**.

```mermaid
sequenceDiagram
    autonumber
    actor Learner as Học viên (MEMBER)
    participant Player as YouTube Player (Client Guard)
    participant Server as Progress API (/lessons/[id]/progress)
    participant DB as PostgreSQL (lesson_progress)

    Learner->>Player: Bấm xem video bài học
    Player->>Server: GET /progress (Lấy tiến độ cũ: furthestWatchedPosition)
    Server-->>Player: Trả về: { furthest: 120s, completed: false }
    Player->>Player: Khởi chạy video từ vị trí 120s

    rect rgb(240, 248, 255)
        note over Learner, Player: Lớp Phòng vệ 1: Trình phát (Client 500ms Timer)
        Learner->>Player: Cố ý kéo thanh tua lên 300s (vượt quá 120s)
        Player->>Player: Phát hiện currentTime > furthest + 6s
        Player->>Player: Tự động tua ngược lại vị trí furthest (120s)!
    end

    rect rgb(255, 250, 240)
        note over Player, DB: Lớp Phòng vệ 2: Máy chủ (Server Anti-Cheat Clamp)
        Player->>Server: Heartbeat mỗi 8s gửi PATCH { positionSeconds, furthest }
        Server->>DB: Đọc vị trí furthest cũ & thời điểm lưu trước (last_watched_at)
        Server->>Server: Tính ngưỡng cho phép: cap = currentFurthest + 25s + 2 × elapsedRealTime
        Server->>Server: Kẹp giá trị: newFurthest = min(requestedFurthest, cap)
        alt newFurthest / duration >= 85%
            Server->>DB: Đánh dấu: completed = true (Sticky - không bị đảo ngược)
        else Chưa đủ 85%
            Server->>DB: Cập nhật last_position & newFurthest
        end
        Server-->>Player: Trả về trạng thái tiến độ mới nhất
    end
```

---

### 5.4 Luồng Làm Bài Kiểm tra & Đánh giá Năng lực (BR-04)

```mermaid
flowchart TD
    StartCheck["Học viên bấm vào Bài kiểm tra cuối khóa"] --> CheckProgress{"Đã hoàn thành 100%\ncác bài học chưa?"}
    
    CheckProgress -- "Chưa xong" --> DenyLesson["❌ Chặn truy cập: Yêu cầu học xong toàn bộ bài học"]
    CheckProgress -- "Đã hoàn thành" --> CheckCooldown{"Kiểm tra lịch sử thi\n(Lần thi trước < 24h?)"}
    
    CheckCooldown -- "Còn trong thời gian phạt (< 24h)" --> DenyCooldown["⏳ Chặn truy cập: Thông báo thời gian còn lại được thi lại"]
    CheckCooldown -- "Hợp lệ (Lần đầu hoặc đã qua 24h)" --> GenAttempt["Tạo Attempt mới:\n1. Server tính hạn chót: expiresAt = now + (số câu × 2 phút)\n2. Xáo trộn ngẫu nhiên câu hỏi & đáp án (AttemptQuestion)"]
    
    GenAttempt --> DoingQuiz["Học viên làm bài & chọn đáp án\n(Client đếm ngược theo giờ Server)"]
    
    DoingQuiz --> SubmitDecision{"Hành động kết thúc"}
    SubmitDecision -- "Bấm Nộp bài" --> GradeServer["Máy chủ tính điểm"]
    SubmitDecision -- "Hết thời gian đếm ngược" --> AutoSubmit["Hệ thống Auto-Submit bài làm"]
    
    GradeServer --> CalcScore["Tính điểm tổng kết (Thang 100)"]
    AutoSubmit --> CalcScore
    
    CalcScore --> ScoreCheck{"Điểm số đạt bao nhiêu?"}
    
    ScoreCheck -- "Điểm < 85 (FAILED)" --> ResultFail["• Thông báo: Không đạt\n• Chỉ hiển thị: Đúng/Sai từng câu\n• ẨN HOÀN TOÀN đáp án đúng & giải thích\n• Bắt đầu tính cooldown 24h để thi lại"]
    ScoreCheck -- "Điểm >= 85 (PASSED)" --> ResultPass["• Thông báo: CHÚC MỪNG ĐÃ PASS!\n• Hiển thị: Điểm số, Đáp án đúng & Lời giải thích chi tiết\n• Cập nhật hoàn thành Khóa học"]
```

---

### 5.5 Luồng Giám sát & Báo cáo Tiến độ Chapter

Dành riêng cho **Ban Điều Hành (BĐHU)** để quản lý thành viên thực tế tại địa phương.

```mermaid
graph LR
    subgraph DATA_SOURCE["Dữ liệu Nguồn"]
        LP[("Bảng lesson_progress")]
        ATT[("Bảng attempts")]
        MEM[("Bảng chapter_members")]
    end

    subgraph BACKEND_AGGREGATION["Backend Scoping & Aggregator"]
        ScopeCheck["Kiểm tra Scope: ChapterLeader chỉ truy vấn Member cùng ChapterId"]
        Aggregator["Tính toán Metrics tổng hợp:\n• Tỉ lệ hoàn thành Khóa = Số lesson hoàn thành / Tổng lesson\n• Điểm trung bình bài test\n• Số thành viên Active / Inactive"]
        ScopeCheck --> Aggregator
    end

    subgraph DASHBOARD_UI["BĐHU Dashboard (/chapter-manager)"]
        CardStats["Thống kê tổng quan:\nTổng học viên, Khóa học đã hoàn thành"]
        MemberTable["Bảng thành viên:\nEmail, Trạng thái, % Tiến độ, Điểm số"]
        CourseChart["Tiến độ từng Khóa học:\nSố lượng member đã pass / đang học"]
    end

    DATA_SOURCE --> ScopeCheck
    Aggregator --> CardStats
    Aggregator --> MemberTable
    Aggregator --> CourseChart
```

---

## 6. Chiến lược Hiệu năng & Bảo mật

### 6.1 Cơ chế Caching Đa tầng (Multi-Tier Caching)
Nhằm đáp ứng yêu cầu **NFR-PERF-01** (tải trang danh sách khóa học $\le 3$ giây với 500 người dùng đồng thời):

```mermaid
flowchart TD
    Req["Học viên yêu cầu dữ liệu (apiFetch)"] --> InMem{"1. In-Memory Map Cache\n(TTL: 30s)?"}
    InMem -- "HIT" --> ReturnInMem["Trả về dữ liệu tức thì (0ms)"]
    InMem -- "MISS" --> SessionStore{"2. SessionStorage Cache\n(TTL: 2 phút)?"}
    SessionStore -- "HIT" --> ReturnSession["Phục hồi In-Memory & Trả về (<5ms)"]
    SessionStore -- "MISS" --> InFlight{"3. Request đang gửi\n(Deduplication)?"}
    InFlight -- "YES" --> ReusePromise["Gộp chung Promise (Không gọi trùng)"]
    InFlight -- "NO" --> ServerReq["4. Gửi Request lên Máy chủ"]
    
    ServerReq --> ServerCache{"5. Server Route Cache\n(Prisma Cache: 15s)?"}
    ServerCache -- "HIT" --> ReturnServerCache["Trả JSON từ Server Cache"]
    ServerCache -- "MISS" --> DBQuery["Truy vấn PostgreSQL qua Prisma"]
    DBQuery --> SetCaches["Ghi đè Server Cache, In-Memory & SessionStorage"]
    SetCaches --> ReturnFinal["Trả về dữ liệu cho Client"]
```

### 6.2 Bảo vệ Tài nguyên & Media
- **Video:** Nhúng qua **YouTube IFrame API**. Video ở chế độ Unlisted (Không công khai), trình phát ẩn tiêu đề và đường link trực tiếp, loại bỏ việc thành viên tải lậu video hoặc rò rỉ băng thông máy chủ.
- **Tài liệu (Document):** Lưu trữ tại **AWS S3 / Cloudflare R2**. Khi học viên bấm tải hoặc xem, hệ thống tạo **Presigned URL** với thời hạn chỉ 5 - 15 phút. Người không có tài khoản hoặc truy cập URL trực tiếp quá hạn sẽ bị từ chối truy cập (**NFR-SEC-01**).

### 6.3 Quản lý Phiên & Token Tự động (Silent Refresh)
- **Access Token:** Hạn ngắn (15 phút), lưu dạng HTTP-only Cookie / Bearer.
- **Refresh Token:** Lưu an toàn trong Database (`refresh_tokens`), thời hạn 7 ngày.
- **Edge Silent Refresh:** Khi Access Token hết hạn, Next.js Edge Middleware tự động phát hiện Refresh Token hợp lệ và cấp ngay Access Token mới trước khi request tới API, người dùng không hề bị ngắt quãng trải nghiệm.
- **Tức thời vô hiệu hóa (Instant Invalidation):** Khi Admin/BĐHU khóa tài khoản một thành viên (`status: LOCKED`), bộ nhớ đệm `userStatusCache` bị xóa lập tức, chặn ngay request tiếp theo của người đó.

---

## 7. Bản đồ Cấu trúc Thư mục Codebase

```
c:\Users\Acer\Desktop\E-learning\
├── prisma/
│   ├── schema.prisma              # Định nghĩa toàn bộ 15 Data Models & Enums
│   ├── seed.ts                    # Script tạo tài khoản Admin & Dữ liệu mẫu ban đầu
│   └── migrations/                # Lịch sử di chuyển cấu trúc CSDL PostgreSQL
│
├── src/
│   ├── middleware.ts              # Edge Middleware (Bảo vệ Route, Silent Refresh, Role Guard)
│   │
│   ├── app/                       # Next.js 14 App Router
│   │   ├── page.tsx               # Landing Page công khai
│   │   ├── login/                 # Trang Đăng nhập (Email + Password)
│   │   ├── accept-invitation/     # Trang Kích hoạt tài khoản & Tạo mật khẩu từ link mời
│   │   ├── forgot-password/       # Quên mật khẩu & Reset password
│   │   ├── leaderboard/           # Bảng xếp hạng thành viên & Chi hội
│   │   │
│   │   ├── admin/                 # Không gian làm việc của ADMIN
│   │   │   ├── dashboard/         # Thống kê tổng thể toàn hệ thống
│   │   │   ├── courses/           # Quản lý khóa học, bài học, video, tài liệu, đề thi
│   │   │   ├── chapters/          # Quản lý danh sách các Chi hội
│   │   │   ├── users/             # Quản lý toàn bộ tài khoản người dùng
│   │   │   └── invitations/       # Quản lý mã mời đã phát hành
│   │   │
│   │   ├── chapter-manager/       # Không gian làm việc của BĐHU (CHAPTER_LEADER)
│   │   │   ├── dashboard/         # Tổng quan tiến độ đào tạo của Chapter mình
│   │   │   ├── members/           # Danh sách & chi tiết tiến độ từng thành viên
│   │   │   ├── courses/           # Báo cáo tỉ lệ hoàn thành theo khóa học
│   │   │   └── invitations/       # Mời thành viên mới vào Chapter
│   │   │
│   │   ├── student/               # Không gian học tập của HỌC VIÊN (MEMBER)
│   │   │   ├── dashboard/         # Khóa học đang học, bài học gần nhất
│   │   │   ├── courses/           # Danh mục khóa học & chi tiết lộ trình
│   │   │   │   └── [id]/quiz/     # Giao diện làm bài kiểm tra trắc nghiệm
│   │   │   ├── learning/[id]/     # Giao diện học video + tải tài liệu
│   │   │   └── progress/          # Nhật ký tiến độ & điểm số cá nhân
│   │   │
│   │   └── api/v1/                # Toàn bộ REST API Handlers
│   │       ├── auth/              # /login, /refresh, /logout
│   │       ├── courses/           # CRUD khóa học, publish/unpublish
│   │       ├── lessons/           # Tiến độ bài học (/progress), heartbeat chống tua
│   │       ├── assessments/       # Quản trị câu hỏi đề thi
│   │       ├── attempts/          # Tạo lần thi, nộp bài, chấm điểm tự động
│   │       ├── chapters/          # API dữ liệu chapter & dashboard scoping
│   │       ├── invitations/       # Tạo, hủy, gửi lại lời mời
│   │       ├── leaderboard/       # Bảng xếp hạng điểm số & streak
│   │       └── documents/         # Tạo Presigned URL xem tài liệu S3
│   │
│   ├── components/                # React UI Components
│   │   ├── YouTubePlayer.tsx      # Video Player có logic chống tua 500ms + heartbeat 8s
│   │   └── layout/                # Sidebar, Header theo từng Role
│   │
│   └── lib/                       # Các thư viện & Helper dùng chung
│       ├── prisma.ts              # Singleton Prisma Client Instance
│       ├── auth.ts                # Xác thực JWT, User Status Cache & Scope Resolver
│       ├── email.ts               # Tích hợp gửi mail Resend
│       └── api/client.ts          # Bộ Fetch Client hiệu năng cao (In-Memory + Session Cache)
│
└── docs/                          # Toàn bộ tài liệu phân tích nghiệp vụ & kiến trúc
    ├── ba-document.md             # Tài liệu Business Analysis chi tiết
    ├── codebase-context.md        # Ghi chú kiến trúc & các quyết định kỹ thuật
    └── TONG_QUAN_KIEN_TRUC_VA_VAN_HANH_HE_THONG.md # File tài liệu này
```

---

## 8. Hướng dẫn Dành cho Người mới Tiếp cận Dự án

1. **Khởi chạy Hệ thống ở Môi trường Local:**
   ```bash
   # 1. Cài đặt các gói phụ thuộc
   npm install

   # 2. Đồng bộ CSDL và tạo Prisma Client
   npm run db:push
   npm run db:generate

   # 3. Nạp dữ liệu mẫu (Tạo Admin mặc định, Khóa học mẫu & Câu hỏi thi)
   npm run db:seed

   # 4. Khởi chạy máy chủ phát triển
   npm run dev
   ```

2. **Tài khoản Trải nghiệm Mặc định (Seed Data):**
   - **Admin:** `admin@bbe.com` / Mật khẩu: `admin123`
   - **Chapter Leader (BĐHU):** `leader@bbe.com` / Mật khẩu: `leader123`
   - **Thành viên (Member):** `member@bbe.com` / Mật khẩu: `member123`

---
*Tài liệu được biên soạn và bảo trì bởi Đội ngũ Phát triển BBE E-Learning.*
