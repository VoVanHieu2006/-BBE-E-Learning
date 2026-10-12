-- Preserve existing Chapter invitations while allowing DNA and Department scopes.
ALTER TABLE "invitations"
  ALTER COLUMN "chapter_id" DROP NOT NULL,
  ADD COLUMN "organization_unit_id" UUID;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_organization_unit_id_fkey"
  FOREIGN KEY ("organization_unit_id")
  REFERENCES "organization_units"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "invitations_organization_unit_id_status_idx"
  ON "invitations"("organization_unit_id", "status");

-- Every invitation has exactly one target. Existing Chapter rows remain unchanged.
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_exactly_one_scope_check"
  CHECK (("chapter_id" IS NOT NULL) <> ("organization_unit_id" IS NOT NULL));
