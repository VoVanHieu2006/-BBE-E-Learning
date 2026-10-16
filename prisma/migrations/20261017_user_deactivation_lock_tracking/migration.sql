-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivated_by_user_id" UUID;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivated_by_role" VARCHAR(50);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivated_at" TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivated_reason" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cascade_lead_id" UUID;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lock_reason" VARCHAR(50);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_cascade_lead_id_idx" ON "users"("cascade_lead_id");
CREATE INDEX IF NOT EXISTS "users_deactivated_by_user_id_idx" ON "users"("deactivated_by_user_id");
