# BBE E-Learning System — Requirements Traceability Matrix

| Mã yêu cầu | Mô tả | Test Case ID liên quan | Số TC bao phủ |
|---|---|---|---:|
| `BR-01` | Course visibility theo status/visibility | `TC-CRS-04` | 1 |
| `BR-02` | Invitation & account activation | `TC-AUTH-01, TC-AUTH-02, TC-AUTH-03, TC-AUTH-04, TC-AUTH-05, TC-AUTH-06, TC-AUTH-07, TC-CHAP-03` | 8 |
| `BR-03` | Learning completion (85%, không cộng lặp, không tua tới) | `TC-LRN-01, TC-LRN-02, TC-LRN-03, TC-LRN-04` | 4 |
| `BR-04` | Assessment & retake (cooldown, pass/fail, auto-submit) | `TC-ASM-01, TC-ASM-02, TC-ASM-03, TC-ASM-04, TC-ASM-05, TC-ASM-06, TC-ASM-07, TC-ASM-08, TC-ASM-09, TC-ASM-10, TC-ASM-11` | 11 |
| `FR-AUTH-01` | Login, lock sau 10 lần sai, password reset | `TC-AUTH-08, TC-AUTH-09, TC-AUTH-10, TC-AUTH-11, TC-AUTH-12` | 5 |
| `FR-DB-01` | BĐHU dashboard — không truy cập chapter khác | `TC-DASH-01, TC-DASH-02, TC-CHAP-01, TC-CHAP-05` | 4 |
| `NFR-SEC-01` | Không truy cập tài liệu/video qua URL trực tiếp không có quyền | `TC-DOC-02, TC-DOC-03, TC-LRN-06` | 3 |
| `NFR-PERF-02` | Đồng bộ tiến độ đa thiết bị trong ~1s (sau reload) | `TC-LRN-05` | 1 |
| `3.2` | Permission matrix (toàn bộ role) | `TC-CHAP-01, TC-CHAP-02, TC-CHAP-04, TC-CHAP-05, TC-CHAP-06` | 5 |
