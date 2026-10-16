-- Close duplicate active assignments before adding the idempotency guard.
WITH ranked_assignments AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "rule_id"
      ORDER BY
        CASE WHEN "status" = 'COMPLETED' OR "completed_at" IS NOT NULL THEN 0 ELSE 1 END,
        "assigned_at" ASC,
        "id" ASC
    ) AS row_number
  FROM "user_learning_assignments"
  WHERE "ended_at" IS NULL AND "rule_id" IS NOT NULL
)
UPDATE "user_learning_assignments" AS assignment
SET
  "mandatory" = false,
  "due_at" = NULL,
  "ended_at" = CURRENT_TIMESTAMP,
  "status" = CASE
    WHEN assignment."status" IN ('ASSIGNED', 'IN_PROGRESS', 'OVERDUE')
      THEN 'ENDED'::"learning_assignment_status"
    ELSE assignment."status"
  END
FROM ranked_assignments AS ranked
WHERE assignment."id" = ranked."id" AND ranked.row_number > 1;

-- Preserve one canonical active rule per matrix cell and retain the others as history.
WITH ranked_rules AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY
        "course_id",
        COALESCE("organization_unit_id", '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE("position_id", '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY "created_at" ASC, "id" ASC
    ) AS row_number
  FROM "learning_rules"
  WHERE "effective_until" IS NULL
), duplicate_rules AS (
  SELECT "id" FROM ranked_rules WHERE row_number > 1
)
UPDATE "user_learning_assignments" AS assignment
SET
  "mandatory" = false,
  "due_at" = NULL,
  "ended_at" = COALESCE(assignment."ended_at", CURRENT_TIMESTAMP),
  "status" = CASE
    WHEN assignment."status" IN ('ASSIGNED', 'IN_PROGRESS', 'OVERDUE')
      THEN 'ENDED'::"learning_assignment_status"
    ELSE assignment."status"
  END
FROM duplicate_rules
WHERE assignment."rule_id" = duplicate_rules."id";

WITH ranked_rules AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY
        "course_id",
        COALESCE("organization_unit_id", '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE("position_id", '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY "created_at" ASC, "id" ASC
    ) AS row_number
  FROM "learning_rules"
  WHERE "effective_until" IS NULL
)
UPDATE "learning_rules" AS rule
SET "effective_until" = CURRENT_TIMESTAMP
FROM ranked_rules AS ranked
WHERE rule."id" = ranked."id" AND ranked.row_number > 1;

CREATE UNIQUE INDEX "learning_rules_active_scope_key"
ON "learning_rules" (
  "course_id",
  COALESCE("organization_unit_id", '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE("position_id", '00000000-0000-0000-0000-000000000000'::uuid)
)
WHERE "effective_until" IS NULL;

CREATE UNIQUE INDEX "user_learning_assignments_active_rule_key"
ON "user_learning_assignments"("user_id", "rule_id")
WHERE "ended_at" IS NULL AND "rule_id" IS NOT NULL;

CREATE INDEX "learning_rules_course_id_organization_unit_id_position_id_effective_until_idx"
ON "learning_rules"("course_id", "organization_unit_id", "position_id", "effective_until");

CREATE INDEX "user_learning_assignments_rule_id_status_idx"
ON "user_learning_assignments"("rule_id", "status");

CREATE INDEX "organization_memberships_unit_id_status_starts_at_ends_at_idx"
ON "organization_memberships"("unit_id", "status", "starts_at", "ends_at");
