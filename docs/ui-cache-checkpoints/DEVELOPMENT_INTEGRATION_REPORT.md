# Integration Supabase phát triển — 27/10/2026

**Chưa đủ điều kiện rollout.** Organization 22/22 PASS và leaderboard v8 5/5 PASS. Learning-cycles và learning-flow FAIL; không đánh dấu các bước chưa tới là PASS.

Người dùng cho phép tạo/sửa/xóa fixture trong Supabase hiện tại. Mục tiêu được xác minh từ cấu hình ứng dụng và kết nối DIRECT: project `rieqrjxatzoiqubxyhlw`, database `postgres`. Không công bố connection URL, username, password, JWT hoặc nội dung backup.

## Thao tác được kiểm tra trước khi chạy

| Script | Thao tác dữ liệu/schema | Biện pháp trong development mode |
| --- | --- | --- |
| test-chapter-leaderboard-integration.mjs | Tạo users/Chapter/membership/course/progress/Stars; PUT KPI; cleanup bằng ID fixture | Schema đăng ký riêng, bỏ cleanup và giữ fixture; ghi nhận oracle cũ FAIL |
| test-chapter-leaderboard-v8-integration.mjs | Tạo period,28 thành viên, core course/lesson/cycles/progress,126Stars; PUT KPI Yellow/Green/Red | Namespace mới bắt buộc chưa có user; oracle độc lập, không import hàm tính điểm; giữ fixture |
| test-organization-integrity.cjs | Tạo/cập nhật membership, chức vụ, binding, chuyển Chapter/DNA; thử update/delete bị cấm; upsert quyền chuẩn; raw concurrent imports; bản local có auto-install migrations | Không tự chạy migration; kiểm tra guard/trigger đã clone trong namespace; raw PG transaction search_path khóa namespace; giữ fixtures |
| test-learning-cycles-integration.cjs | Đóng các period hết hạn, capture core requirements, reset policy/cutover; quiz/video awards; schedule/apply; snapshots; global outbox/cutover processing | Toàn bộ chỉ trong schema riêng, chưa có dữ liệu ứng dụng; không chạy trên public |
| test-learning-flow-integration.mjs | Users/Chapter/DNA/courses/assignments/question bank; API progress/quiz/rewards/restrictions; timestamp fixture; cleanup ID | Schema/server được attestation; chặn HTTP ra ngoài, không upload/email/media thật; giữ fixture |
| development-db-isolate.cjs | CREATE namespace mới,57 tables/enums/index/constraints,10 functions,16 triggers | Plan đầy đủ có hash; backup/target gate; CREATE không IF EXISTS; transaction, FK guard, function search_path; không DROP/schema hệ thống |
| build-development-pilot.cjs | Full build; prerender learning/periods đọc DB | Source TEMP không .env; datasource schema fixture; route readiness được kiểm tra read-only; không dùng public |

Learning-cycles nguyên bản có cập nhật diện rộng và organization có auto-install migrations: **không chạy nguyên trạng vào public**. Cơ chế cô lập giữ được guards hiện có, không giả môi trường localhost. Hai lần chuẩn bị schema đầu tiên bị lỗi SQL và đã rollback; không tính là schema còn tồn tại.

## Backup và bảo toàn

- Trước test: 60 bảng public,2,711 dòng + metadata functions/triggers/indexes/columns/constraints/policies; repeatable-read read-only.
- Backup gzip mã hóa AES-256-GCM, khóa được bọc Windows DPAPI CurrentUser, ACL current user/SYSTEM. Đã kiểm tra giải mã từ file/key lưu trên disk và checksum, không chỉ thử khóa trong RAM.
- TLS xác minh bằng CA Supabase, rejectUnauthorized=true; không tắt kiểm tra chứng chỉ. Prisma sslaccept=strict và CA file.
- Guard đòi explicit dev mode, đúng project/database/fingerprint, manifest READY và backup mới; kiểm tra actual current_database/current_schema và FK không thoát namespace.
- Các suite thực thi tuần tự; HTTP server fresh PID/nonce/Prisma attestation. Các lần HTTP cuối dùng thư mục source riêng và hash mọi file src đối chiếu workspace. Pilot UI mock có source snapshot riêng,15 runtime hashes đã đối chiếu.
- Sau test/build: **PASS**, hash toàn bộ public rows và metadata bằng trước test; vẫn60 bảng/2,711 dòng. [Bằng chứng read-only](development-public-unchanged.json).
- Không có đường test ghi auth/storage; không đọc row content hai schema đó để tuyên bố hash. Không reset database/migrations hoặc DROP SCHEMA.

## Kết quả và dữ liệu còn giữ

| Schema | Kết quả cuối | Dòng fixture hiện có |
| --- | --- | ---: |
| bbe_ui_it_leaderboard_0a9aac96 | FAIL legacy oracle/fixture | 201 |
| bbe_ui_it_leaderboard_edcd81f8 | PASS5/5 current-v8 oracle | 232 |
| bbe_ui_it_organization_eea3c5d4 | PASS22/22 bounded remote-client rerun | 532 |
| bbe_ui_it_learning_cycles_99abc201 | FAIL backend30s transaction expiry | 58 |
| bbe_ui_it_learning_flow_41239833 | FAIL fractional-vs-rounded video percentage assertion | 148 |
| Tổng | Năm namespace, giữ lại để kiểm tra | **1,171** |

Các schema chứa Chapter, users/memberships/positions/bindings, course/lesson/question/assignment/progress, Stars, periods/cycles/snapshots/policy fixture theo suite. Tên/email test có prefix UUID và example.invalid/org-test.invalid. [Inventory theo từng bảng và các receipt cũ](development-integration-results.json). Không cộng lặp receipt của cùng namespace.

**Cần dọn nếu không muốn giữ fixtures.** Hiện chưa dọn, không xóa dữ liệu public và không DROP SCHEMA. Permanent-binding guards vẫn hoạt động; không vô hiệu hóa guards để ép cleanup. Backup mã hóa vẫn còn trong scratch bị git ignore. Một lần cleanup sau này cần kế hoạch riêng có phạm vi chính xác và tuân theo lệnh cấm DROP SCHEMA của người dùng.

Organization lần đầu có ba transaction-not-found FAIL; được giữ receipt riêng. Rerun default transaction của client test tăng từ5s lên30s (maxWait15s), nguyên isolation/assertions và backend:22PASS. Không khẳng định điều này kiểm chứng default5s trên remote.

Leaderboarding v8 dùng đặc tả `docs/PHASE_3_COMPREHENSIVE_REPORT.md` và phép tính tay126/28=4.5;20/28=71.4% sau làm tròn hiển thị. Yellow/Green không bonus, RED exclusion và KPI invalidation PASS. Suite5ca hẹp hơn suite legacy; không xóa lịch sử FAIL.

Learning-cycles lỗi P2028, transaction30000ms đã qua30193ms tại learning-periods/enqueueAssignmentSync. Learning-flow qua authoring/403/invalid-cover/anti-seek/next-video gate, dừng tại kỳ vọng phần trăm phân số; API hiện Math.round. Đã sửa fixture sai affiliation và thiếu durationMinutes theo validation, **không sửa công thức/backend/assertion để PASS**. Các ca sau vị trí dừng, đặc biệt actual apply/reset/full flow: NOT VERIFIED.

Chapter six-month suite có guard localhost cùng dữ liệu seeded và tài khoản cụ thể, chưa chạy trên Supabase: NOT VERIFIED. Thiết bị thật/media thật, tăng trưởng bộ nhớ dài hạn: NOT VERIFIED. Full build PASS không đóng các gate này.

## Bước còn lại

Chẩn đoán transaction expiry và mâu thuẫn oracle video theo đặc tả nghiệp vụ hiện hành, bổ sung/đóng C09 actual schedule/cancel/apply/reset, rồi chạy lại regression cần thiết. Giữ Pilot ở ba trang Lead Chapter. Sau khi các gate trọng yếu PASS, trình bộ before/after cuối để người dùng duyệt trước Admin → Lead DNA → Member → Guest. Chưa deploy.
