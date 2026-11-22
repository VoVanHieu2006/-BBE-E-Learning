-- Chỉ thêm mới: bộ đếm đăng nhập sai theo nguồn (IP đã băm) cho từng cửa sổ thời gian cố định.
BEGIN;

CREATE TABLE "auth_rate_limits" (
  "key" VARCHAR(64) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "auth_rate_limits_count_nonnegative" CHECK ("count" >= 0)
);

CREATE INDEX "auth_rate_limits_expires_at_idx" ON "auth_rate_limits" ("expires_at");

COMMIT;
