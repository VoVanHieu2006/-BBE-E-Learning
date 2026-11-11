# Prompt 08 — Chạy được và sửa các test tích hợp còn lỗi

Đọc `docs/prompts/00-quy-tac-chung.md`, `docs/prompts/00b-worker-ngoai.md` và `docs/handoff/p06.md` (bảng kết quả suite và lý do bị chặn), `docs/testing.md`. Nhánh `fix/p10-integration-tests`. Được commit lên nhánh (không push). `node_modules` là junction tới bản đã generate đúng schema mới: không `npm install`, không `prisma generate`. **Không chạm DB thật (Supabase)**; không đọc `.env`.

## Mục tiêu
Đưa **mọi** suite tích hợp về trạng thái chạy được và xanh trên PostgreSQL thử, theo yêu cầu nghiệp vụ trong `docs/KHBB.md` (đích đến). Khi một test sai vì nó còn khẳng định hành vi CŨ (tên role cũ, JWT thiếu `authVersion`, thứ tự dọn `chapterLeadBinding`, mỗi người một chức vụ…), **sửa test** cho đúng với KHBB. Khi test chứng minh một lỗi nghiệp vụ thật, **không che**: sửa tối thiểu code nếu rõ ràng và có test, hoặc ghi vào báo cáo.

## Các suite đang bị chặn (xem p06 handoff)
`test-learning-flow-integration.mjs`, `test-chapter-leaderboard-integration.mjs`, `test-organization-integrity.cjs`, `test-organization-repair.mjs`, `test-chapter-transfer-integration.cjs`, `test-completed-lessons-integration.cjs`, `test-star-history-integration.cjs`, `test-fb-fixes.cjs`, và `test-learning-security.mjs` / `chapter-six-month` (lỗi test). Mỗi suite có guard riêng (tên DB, user, cổng, `inet_server_addr()` phải là loopback). **Không nới lỏng guard.** Thay vào đó dựng đúng môi trường mà guard đòi:
- Docker Desktop chuyển tiếp cổng nên server thấy địa chỉ 172.x và không qua guard loopback. Dùng **PostgreSQL 18 đã cài sẵn trên máy** (`C:\Program Files\PostgreSQL\18\bin\initdb.exe`, `pg_ctl.exe`, `psql.exe`): với mỗi suite, `initdb` một instance tạm trong thư mục tạm (ví dụ `%TEMP%\bbe-pg-<cổng>`), `trust` auth trên loopback, đúng cổng/user/tên DB guard yêu cầu (ví dụ cổng 55438 DB `fb_fixes_test`; cổng 55439 user `chapter_fix_test` DB `bbe_test_learning_cycles`; `org_integrity*` cho hai suite organization), chuẩn bị schema bằng `npm run db:baseline-empty` + `prisma migrate deploy` (+ seed nếu suite cần) trên DB đó, chạy suite, rồi **dừng và xóa** instance. Đọc guard ở đầu mỗi suite để lấy đúng tham số.
- Container Docker `bbe-test-pg` (127.0.0.1:54329, user postgres, mật khẩu bbe_local_test_only) vẫn dùng được cho suite không có guard loopback phía server.

## Việc cụ thể
1. Với từng suite: dựng môi trường, chạy, ghi pass/fail thật, sửa test sai hạ tầng/hành vi cũ, chạy lại tới khi xanh hoặc ghi rõ lỗi nghiệp vụ thật.
2. `chapter-six-month` T18/T19 phụ thuộc dữ liệu production (Chapter tên "BBE Chapter 1/2", email thật `vobahoaan@gmail.com` có 19 sao video): viết lại để **tự tạo fixture** (chapter, người dùng, sao) và **bỏ hẳn email thật** khỏi test.
3. `test-learning-flow-integration.mjs`: `issueAccessToken` thiếu `authVersion`, phần dọn xóa `chapterLeadBinding`: sửa.
4. Mọi chuỗi vai trò/chức vụ cũ còn sót trong test (`CHAPTER_LEADER`, `CHAPTER_MANAGER`, `MEMBER_BTV`…) đổi theo tên chuẩn.
5. Cập nhật `docs/testing.md` (cách chạy từng suite, môi trường cần dựng) và có thể thêm một script `scripts/test/run-integration-local.mjs` tự dựng/dừng PG 18 tạm cho từng suite (an toàn: chỉ loopback, thư mục tạm, cổng ngẫu nhiên hoặc đúng cổng guard, luôn dọn).
6. Tạo `HANDOFF.md` ở thư mục gốc worktree, cập nhật sau mỗi suite; báo cáo cuối theo mẫu: bảng từng suite pass/fail thật, test đã sửa và lý do, lỗi nghiệp vụ thật (nếu có).

## Không được đụng tới
DB thật, `.env`, guard của suite, migration cũ, nghiệp vụ ngoài việc sửa lỗi thật có test.
