-- A Lead invitation for a new Chapter carries only chapter_name until it is accepted
-- (20261017_defer_invited_chapter); every other invitation still has exactly one target.
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_exactly_one_scope_check";

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_exactly_one_scope_check"
  CHECK (
    (("chapter_id" IS NOT NULL) <> ("organization_unit_id" IS NOT NULL))
    OR (
      "chapter_id" IS NULL AND "organization_unit_id" IS NULL
      AND "role" = 'LEAD' AND "chapter_name" IS NOT NULL
    )
  );
