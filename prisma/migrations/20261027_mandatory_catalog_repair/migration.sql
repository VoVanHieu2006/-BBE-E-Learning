BEGIN;

-- Repair the mandatory-learning catalog in databases whose migration history
-- says the catalog migration ran while the catalog rows are absent. This is
-- additive: no user, assignment, progress or history row is deleted.

INSERT INTO learning_programs (id, code, name, is_core, sort_order) VALUES
  (gen_random_uuid(), 'CORE_MEMBER', 'Chương trình học cho Thành viên', true, 0),
  (gen_random_uuid(), 'CORE_LEADER', 'Chương trình học cho LT', true, 1),
  (gen_random_uuid(), 'CORE_DNA', 'Chương trình học cho DNA', true, 2),
  (gen_random_uuid(), 'EXTENDED', 'Chương trình học mở rộng/khuyến khích', false, 3)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  is_core = EXCLUDED.is_core,
  sort_order = EXCLUDED.sort_order;

INSERT INTO learning_targets (code, label, department_code, position_code, dna_unit_code, sort_order) VALUES
  ('MEMBER_BTV',   'Thành viên Ban Thành Viên', 'BTV',   'MEMBER',           NULL, 0),
  ('MEMBER_BTK',   'Thành viên Ban Thư Ký',     'BTK',   'MEMBER',           NULL, 1),
  ('MEMBER_BND',   'Thành viên Ban Nội Dung',   'BND',   'MEMBER',           NULL, 2),
  ('MEMBER_BCL',   'Thành viên Ban Chất Lượng', 'BCL',   'MEMBER',           NULL, 3),
  ('MEMBER_BDH',   'Thành viên Ban Định Hướng', 'BDH',   'MEMBER',           NULL, 4),
  ('MEMBER_BKM',   'Thành viên Ban Khách Mời',  'BKM',   'MEMBER',           NULL, 5),
  ('MEMBER_BTTSK', 'Thành viên Ban TT&SK',      'BTTSK', 'MEMBER',           NULL, 6),
  ('LEADER_BTV',   'LT Ban Thành Viên',         'BTV',   'DEPARTMENT_LEAD',  NULL, 7),
  ('LEADER_BTK',   'LT Ban Thư Ký',             'BTK',   'DEPARTMENT_LEAD',  NULL, 8),
  ('LEADER_BND',   'LT Ban Nội Dung',           'BND',   'DEPARTMENT_LEAD',  NULL, 9),
  ('LEADER_BCL',   'LT Ban Chất Lượng',         'BCL',   'DEPARTMENT_LEAD',  NULL, 10),
  ('LEADER_BDH',   'LT Ban Định Hướng',         'BDH',   'DEPARTMENT_LEAD',  NULL, 11),
  ('LEADER_BKM',   'LT Ban Khách Mời',          'BKM',   'DEPARTMENT_LEAD',  NULL, 12),
  ('LEADER_BTTSK', 'LT Ban TT&SK',              'BTTSK', 'DEPARTMENT_LEAD',  NULL, 13),
  ('CHAPTER_PRESIDENT', 'Chủ tịch Chapter',     NULL,    'CHAPTER_PRESIDENT', NULL, 14),
  ('DNA_TT',   'DNA TT',   NULL, NULL, 'TT',   15),
  ('DNA_SGDC', 'DNA SGDC', NULL, NULL, 'SGDC', 16),
  ('DNA_LDC',  'DNA LDC',  NULL, NULL, 'LDC',  17)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  department_code = EXCLUDED.department_code,
  position_code = EXCLUDED.position_code,
  dna_unit_code = EXCLUDED.dna_unit_code,
  sort_order = EXCLUDED.sort_order;

-- The current database may have Chapters/departments but no DNA tree. Create
-- exactly one DNA unit under the first ROOT, then ensure the three groups exist.
INSERT INTO organization_units (id, name, type, parent_id, status, code, created_at, updated_at)
SELECT gen_random_uuid(), 'DNA Điều hành', 'DNA', root.id, 'ACTIVE', NULL, now(), now()
FROM (SELECT id FROM organization_units WHERE type = 'ROOT' ORDER BY created_at ASC LIMIT 1) AS root
WHERE NOT EXISTS (
  SELECT 1 FROM organization_units existing
  WHERE existing.type = 'DNA' AND existing.parent_id = root.id
);

INSERT INTO organization_units (id, name, type, parent_id, status, code, created_at, updated_at)
SELECT gen_random_uuid(), group_name, 'DNA_GROUP', dna.id, 'ACTIVE', group_name, now(), now()
FROM (SELECT id FROM organization_units WHERE type = 'DNA' ORDER BY created_at ASC LIMIT 1) AS dna
CROSS JOIN (VALUES ('SGDC'), ('LDC'), ('TT')) AS desired(group_name)
ON CONFLICT (parent_id, name) DO UPDATE SET
  code = EXCLUDED.code,
  status = 'ACTIVE',
  updated_at = now();

-- Map unambiguous legacy department rules to the canonical target codes.
-- A rule whose scope cannot be resolved to one target is closed below instead
-- of silently remaining active but never matching a learner.
UPDATE learning_rules AS rule
SET target_code = 'MEMBER_' || unit.code
FROM organization_units AS unit
WHERE rule.effective_until IS NULL
  AND rule.position_id IS NULL
  AND rule.organization_unit_id = unit.id
  AND unit.type = 'DEPARTMENT'
  AND unit.code IN ('BTV', 'BTK', 'BND', 'BCL', 'BDH', 'BKM', 'BTTSK')
  AND rule.target_code IN ('CONTENT', 'GUEST', 'MEMBER', 'QUALITY', 'MEDIA_EVENT', 'SECRETARY');

UPDATE learning_rules AS rule
SET target_code = 'LEADER_' || unit.code
FROM organization_units AS unit
WHERE rule.effective_until IS NULL
  AND rule.position_id IS NOT NULL
  AND rule.organization_unit_id = unit.id
  AND unit.type = 'DEPARTMENT'
  AND unit.code IN ('BTV', 'BTK', 'BND', 'BCL', 'BDH', 'BKM', 'BTTSK')
  AND rule.target_code = 'LEAD';

UPDATE learning_rules AS rule
SET target_code = 'DNA_' || unit.code
FROM organization_units AS unit
WHERE rule.effective_until IS NULL
  AND rule.organization_unit_id = unit.id
  AND unit.type = 'DNA_GROUP'
  AND unit.code IN ('TT', 'SGDC', 'LDC')
  AND rule.target_code = 'DNA';

-- Any remaining active rule with a non-canonical target code cannot match a
-- learner target. Preserve it as history and leave it for Admin review.
UPDATE learning_rules
SET effective_until = now()
WHERE effective_until IS NULL
  AND target_code IS NOT NULL
  AND target_code NOT IN (
    'MEMBER_BTV', 'MEMBER_BTK', 'MEMBER_BND', 'MEMBER_BCL', 'MEMBER_BDH', 'MEMBER_BKM', 'MEMBER_BTTSK',
    'LEADER_BTV', 'LEADER_BTK', 'LEADER_BND', 'LEADER_BCL', 'LEADER_BDH', 'LEADER_BKM', 'LEADER_BTTSK',
    'CHAPTER_PRESIDENT', 'DNA_TT', 'DNA_SGDC', 'DNA_LDC'
  );

COMMIT;
