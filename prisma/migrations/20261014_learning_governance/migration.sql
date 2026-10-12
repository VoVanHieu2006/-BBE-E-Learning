ALTER TYPE "kpi_status" ADD VALUE IF NOT EXISTS 'BLACK';

ALTER TABLE "question_pools"
  ADD COLUMN IF NOT EXISTS "draw_count" INTEGER NOT NULL DEFAULT 3;

CREATE TYPE "chapter_reorganization_status" AS ENUM ('DRAFT', 'SCHEDULED', 'APPLIED', 'CANCELLED');

CREATE TABLE "chapter_reorganizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chapter_id" UUID NOT NULL,
  "effective_at" TIMESTAMP NOT NULL,
  "status" "chapter_reorganization_status" NOT NULL DEFAULT 'DRAFT',
  "source_url" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMP,
  "applied_at" TIMESTAMP,
  "cancelled_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chapter_reorganizations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "chapter_reorganizations_chapter_id_status_effective_at_idx" ON "chapter_reorganizations"("chapter_id", "status", "effective_at");

CREATE TABLE "chapter_reorganization_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reorganization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "department_unit_id" UUID NOT NULL,
  "position_id" UUID,
  "is_primary" BOOLEAN NOT NULL DEFAULT true,
  "validation_error" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chapter_reorganization_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chapter_reorganization_items_reorganization_id_fkey" FOREIGN KEY ("reorganization_id") REFERENCES "chapter_reorganizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "chapter_reorganization_items_reorganization_id_user_id_key" ON "chapter_reorganization_items"("reorganization_id", "user_id");
CREATE INDEX "chapter_reorganization_items_reorganization_id_idx" ON "chapter_reorganization_items"("reorganization_id");
