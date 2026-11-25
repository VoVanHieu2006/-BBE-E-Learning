-- A member invitation may name the position the invitee gets on acceptance:
-- NULL keeps the old behaviour (DEPARTMENT_MEMBER / DNA_MEMBER of the target unit),
-- 'DEPARTMENT_LEAD' targets a Department, 'PRESIDENT' targets the Chapter unit itself.
-- Additive and nullable: existing rows are unchanged.
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "position_code" VARCHAR(40);

ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_position_code_check";
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_position_code_check"
  CHECK (
    "position_code" IS NULL
    OR ("role" = 'MEMBER' AND "position_code" IN ('DEPARTMENT_LEAD', 'PRESIDENT') AND "organization_unit_id" IS NOT NULL)
  );
