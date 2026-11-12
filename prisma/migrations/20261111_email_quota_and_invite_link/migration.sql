-- Chỉ thêm mới: hạn mức email theo ngày UTC và cách giao lời mời (email hoặc link).
BEGIN;

CREATE TABLE "email_daily_usage" (
  "day" DATE NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_daily_usage_pkey" PRIMARY KEY ("day"),
  CONSTRAINT "email_daily_usage_count_nonnegative" CHECK ("count" >= 0)
);

CREATE TYPE "invitation_delivery" AS ENUM ('EMAIL', 'LINK');

ALTER TABLE "invitations" ADD COLUMN "delivery_method" "invitation_delivery" NOT NULL DEFAULT 'EMAIL';

COMMIT;
