-- Prompt 03: one release, existing schema only. No learning data is deleted.
BEGIN;
LOCK TABLE users, invitations, positions, position_assignments, position_permissions,
  organization_memberships, organization_units, chapter_members, learning_rules, learning_targets
  IN SHARE ROW EXCLUSIVE MODE;
ALTER TYPE user_role RENAME VALUE 'CHAPTER_LEADER' TO 'LEAD';
ALTER TYPE invitation_role RENAME VALUE 'CHAPTER_LEADER' TO 'LEAD';

-- Replace functions in full (including the permanent-binding patch), retaining OIDs.
CREATE OR REPLACE FUNCTION serialize_organization_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; old_id uuid; new_id uuid; lead_chapter uuid; bound_chapter uuid; code text; actor_role text; historical_close boolean:=false;
BEGIN
  IF TG_OP<>'INSERT' THEN old_id:=OLD.user_id; END IF;
  IF TG_OP<>'DELETE' THEN new_id:=NEW.user_id; END IF;
  FOR target_id IN SELECT id FROM users WHERE id IN (old_id,new_id) ORDER BY id LOOP UPDATE users SET auth_version=auth_version WHERE id=target_id; END LOOP;
  IF TG_TABLE_NAME='position_assignments' AND TG_OP<>'DELETE' THEN
    SELECT p.code INTO code FROM positions p WHERE p.id=NEW.position_id;
    SELECT role::text INTO actor_role FROM users WHERE id=NEW.user_id;
    IF code IN ('CHAPTER_LEAD') AND actor_role<>'ADMIN' THEN
      SELECT id INTO lead_chapter FROM chapters WHERE organization_unit_id=NEW.unit_id;
      IF lead_chapter IS NULL THEN RAISE EXCEPTION 'ChapterLeadScopeInvalid' USING ERRCODE='23514'; END IF;
      INSERT INTO chapter_lead_bindings(user_id,chapter_id) VALUES(NEW.user_id,lead_chapter) ON CONFLICT(user_id) DO NOTHING;
      SELECT chapter_id INTO bound_chapter FROM chapter_lead_bindings WHERE user_id=NEW.user_id;
      IF TG_OP='UPDATE' THEN historical_close := OLD.user_id=NEW.user_id AND OLD.unit_id=NEW.unit_id AND OLD.position_id=NEW.position_id AND OLD.starts_at=NEW.starts_at AND NEW.ends_at IS NOT NULL AND NEW.ends_at<=timezone('UTC',clock_timestamp()) AND (OLD.ends_at IS NULL OR NEW.ends_at<=OLD.ends_at); END IF;
      IF bound_chapter<>lead_chapter AND NOT historical_close THEN RAISE EXCEPTION 'ChapterLeadPermanentBinding' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION assert_organization_integrity(target_user uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE at_time timestamp:=timezone('UTC',clock_timestamp()); dna boolean; chapter boolean; actor_role text;
BEGIN
  SELECT role::text INTO actor_role FROM users WHERE id=target_user;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id
    WHERE m.user_id=target_user AND m.status='ACTIVE' AND m.starts_at<=at_time AND (m.ends_at IS NULL OR m.ends_at>at_time) AND u.type IN ('DNA','DNA_GROUP'))
    OR EXISTS(SELECT 1 FROM position_assignments a JOIN organization_units u ON u.id=a.unit_id WHERE a.user_id=target_user
      AND a.starts_at<=at_time AND (a.ends_at IS NULL OR a.ends_at>at_time) AND u.type IN ('DNA','DNA_GROUP')) INTO dna;
  SELECT EXISTS(SELECT 1 FROM chapter_members WHERE user_id=target_user)
    OR EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id WHERE m.user_id=target_user
      AND m.status='ACTIVE' AND m.starts_at<=at_time AND (m.ends_at IS NULL OR m.ends_at>at_time) AND u.type IN ('CHAPTER','DEPARTMENT'))
    OR EXISTS(SELECT 1 FROM position_assignments a JOIN organization_units u ON u.id=a.unit_id WHERE a.user_id=target_user
      AND a.starts_at<=at_time AND (a.ends_at IS NULL OR a.ends_at>at_time) AND u.type IN ('CHAPTER','DEPARTMENT')) INTO chapter;
  IF dna AND chapter THEN RAISE EXCEPTION 'SingleOrganizationAffiliationRequired' USING ERRCODE='23514'; END IF;
  IF actor_role<>'ADMIN' AND EXISTS(SELECT 1 FROM chapter_lead_bindings WHERE user_id=target_user) THEN
    IF EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id
      WHERE m.user_id=target_user AND m.status='ACTIVE' AND u.type IN ('DNA','DNA_GROUP')
        AND m.starts_at<coalesce(m.ends_at,'infinity') AND (m.ends_at IS NULL OR m.ends_at>at_time))
      OR EXISTS(SELECT 1 FROM position_assignments a JOIN organization_units u ON u.id=a.unit_id
        WHERE a.user_id=target_user AND u.type IN ('DNA','DNA_GROUP') AND a.starts_at<coalesce(a.ends_at,'infinity') AND (a.ends_at IS NULL OR a.ends_at>at_time))
    THEN RAISE EXCEPTION 'LeadChapterCannotJoinDna' USING ERRCODE='23514'; END IF;
    IF EXISTS(SELECT 1 FROM chapter_members m JOIN chapter_lead_bindings b ON b.user_id=m.user_id
      WHERE m.user_id=target_user AND m.chapter_id<>b.chapter_id)
      OR EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id
        JOIN chapters c ON c.organization_unit_id=CASE WHEN u.type='CHAPTER' THEN u.id ELSE u.parent_id END
        JOIN chapter_lead_bindings b ON b.user_id=m.user_id
        WHERE m.user_id=target_user AND m.status='ACTIVE' AND u.type IN ('CHAPTER','DEPARTMENT') AND c.id<>b.chapter_id
          AND m.starts_at<coalesce(m.ends_at,'infinity') AND (m.ends_at IS NULL OR m.ends_at>at_time))
    THEN RAISE EXCEPTION 'ChapterLeadPermanentBinding' USING ERRCODE='23514'; END IF;
  END IF;

  -- Also reject future overlaps: the passage of time does not fire a trigger.
  IF EXISTS(WITH scopes AS (
    SELECT m.starts_at,coalesce(m.ends_at,'infinity') AS ends_at,u.type IN ('DNA','DNA_GROUP') AS dna
    FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id
    WHERE m.user_id=target_user AND m.status='ACTIVE' AND u.type IN ('DNA','DNA_GROUP','CHAPTER','DEPARTMENT')
    UNION ALL SELECT a.starts_at,coalesce(a.ends_at,'infinity'),u.type IN ('DNA','DNA_GROUP')
    FROM position_assignments a JOIN organization_units u ON u.id=a.unit_id
    WHERE a.user_id=target_user AND u.type IN ('DNA','DNA_GROUP','CHAPTER','DEPARTMENT')
    UNION ALL SELECT joined_at,'infinity'::timestamp,false FROM chapter_members WHERE user_id=target_user
  ) SELECT 1 FROM scopes d JOIN scopes c ON d.dna AND NOT c.dna
    WHERE d.starts_at<d.ends_at AND c.starts_at<c.ends_at AND d.starts_at<c.ends_at AND c.starts_at<d.ends_at
      AND d.ends_at>at_time AND c.ends_at>at_time
  ) THEN RAISE EXCEPTION 'SingleOrganizationAffiliationRequired' USING ERRCODE='23514'; END IF;
  IF actor_role='LEAD' AND EXISTS(SELECT 1 FROM chapter_members m JOIN chapter_lead_bindings b ON b.user_id=m.user_id
    WHERE m.user_id=target_user AND m.chapter_id<>b.chapter_id) THEN
    RAISE EXCEPTION 'ChapterLeadPermanentBinding' USING ERRCODE='23514';
  END IF;
  IF actor_role<>'ADMIN' AND EXISTS(
    SELECT 1 FROM position_assignments a JOIN positions p ON p.id=a.position_id
    JOIN position_assignments b ON b.user_id=a.user_id AND b.id>a.id JOIN positions q ON q.id=b.position_id
    WHERE a.user_id=target_user AND p.code IN ('CHAPTER_LEAD') AND q.code IN ('CHAPTER_LEAD')
      AND (a.ends_at IS NULL OR a.ends_at>at_time) AND (b.ends_at IS NULL OR b.ends_at>at_time)
      AND a.starts_at<coalesce(a.ends_at,'infinity') AND b.starts_at<coalesce(b.ends_at,'infinity')
      AND a.starts_at<coalesce(b.ends_at,'infinity') AND b.starts_at<coalesce(a.ends_at,'infinity')
  ) THEN RAISE EXCEPTION 'ChapterLeadConflict' USING ERRCODE='23514'; END IF;
  IF actor_role<>'ADMIN' AND EXISTS(SELECT 1 FROM position_assignments a JOIN positions p ON p.id=a.position_id
    JOIN chapters c ON c.organization_unit_id=a.unit_id LEFT JOIN chapter_lead_bindings b ON b.user_id=a.user_id
    WHERE a.user_id=target_user AND p.code IN ('CHAPTER_LEAD') AND (a.ends_at IS NULL OR a.ends_at>at_time)
      AND a.starts_at<coalesce(a.ends_at,'infinity') AND c.id IS DISTINCT FROM b.chapter_id
  ) THEN RAISE EXCEPTION 'ChapterLeadPermanentBinding' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM organization_memberships a JOIN organization_memberships b ON b.user_id=a.user_id AND b.unit_id=a.unit_id AND b.id>a.id
    WHERE a.user_id=target_user AND a.status='ACTIVE' AND b.status='ACTIVE'
      AND a.starts_at<coalesce(a.ends_at,'infinity') AND b.starts_at<coalesce(b.ends_at,'infinity')
      AND a.starts_at<coalesce(b.ends_at,'infinity') AND b.starts_at<coalesce(a.ends_at,'infinity')
  ) THEN RAISE EXCEPTION 'MembershipExists' USING ERRCODE='23514'; END IF;

  -- Future overlaps are checked as well: reaching a scheduled date fires no trigger.
  IF EXISTS(SELECT 1 FROM position_assignments a JOIN position_assignments b ON b.user_id=a.user_id AND b.id>a.id
    WHERE a.user_id=target_user AND a.starts_at<coalesce(a.ends_at,'infinity') AND b.starts_at<coalesce(b.ends_at,'infinity')
      AND a.starts_at<coalesce(b.ends_at,'infinity') AND b.starts_at<coalesce(a.ends_at,'infinity')
      AND coalesce(a.ends_at,'infinity')>at_time AND coalesce(b.ends_at,'infinity')>at_time)
  THEN RAISE EXCEPTION 'SinglePositionRequired' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM organization_memberships a JOIN organization_memberships b ON b.user_id=a.user_id AND b.id>a.id
    JOIN organization_units ua ON ua.id=a.unit_id JOIN organization_units ub ON ub.id=b.unit_id
    WHERE a.user_id=target_user AND a.status='ACTIVE' AND b.status='ACTIVE'
      AND ua.type IN ('DEPARTMENT','DNA_GROUP') AND ub.type IN ('DEPARTMENT','DNA_GROUP')
      AND a.starts_at<coalesce(a.ends_at,'infinity') AND b.starts_at<coalesce(b.ends_at,'infinity')
      AND a.starts_at<coalesce(b.ends_at,'infinity') AND b.starts_at<coalesce(a.ends_at,'infinity')
      AND coalesce(a.ends_at,'infinity')>at_time AND coalesce(b.ends_at,'infinity')>at_time)
  THEN RAISE EXCEPTION 'SingleDepartmentRequired' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM position_assignments a JOIN positions p ON p.id=a.position_id JOIN organization_units u ON u.id=a.unit_id
    WHERE a.user_id=target_user AND a.starts_at<coalesce(a.ends_at,'infinity') AND coalesce(a.ends_at,'infinity')>at_time
      AND NOT ((actor_role='LEAD' AND ((p.code='CHAPTER_LEAD' AND u.type='CHAPTER') OR (p.code='DNA_LEAD' AND u.type='DNA')))
        OR (actor_role='MEMBER' AND ((p.code='PRESIDENT' AND u.type='CHAPTER') OR (p.code IN ('DEPARTMENT_LEAD','DEPARTMENT_MEMBER') AND u.type='DEPARTMENT') OR (p.code='DNA_MEMBER' AND u.type='DNA_GROUP')))))
  THEN RAISE EXCEPTION 'PositionRoleMismatch' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM position_assignments a JOIN positions p ON p.id=a.position_id
    JOIN organization_memberships m ON m.user_id=a.user_id JOIN organization_units u ON u.id=m.unit_id
    WHERE a.user_id=target_user AND m.status='ACTIVE' AND u.type IN ('DEPARTMENT','DNA_GROUP') AND a.unit_id<>m.unit_id
      AND a.starts_at<coalesce(a.ends_at,'infinity') AND m.starts_at<coalesce(m.ends_at,'infinity')
      AND a.starts_at<coalesce(m.ends_at,'infinity') AND m.starts_at<coalesce(a.ends_at,'infinity')
      AND coalesce(a.ends_at,'infinity')>at_time AND coalesce(m.ends_at,'infinity')>at_time)
  THEN RAISE EXCEPTION 'PositionMembershipMismatch' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM position_assignments a JOIN positions p ON p.id=a.position_id
    JOIN position_assignments b ON b.unit_id=a.unit_id AND b.id<>a.id JOIN positions q ON q.id=b.position_id
    WHERE a.user_id=target_user AND p.code='PRESIDENT' AND q.code='PRESIDENT'
      AND a.starts_at<coalesce(a.ends_at,'infinity') AND b.starts_at<coalesce(b.ends_at,'infinity')
      AND a.starts_at<coalesce(b.ends_at,'infinity') AND b.starts_at<coalesce(a.ends_at,'infinity')
      AND coalesce(a.ends_at,'infinity')>at_time AND coalesce(b.ends_at,'infinity')>at_time)
  THEN RAISE EXCEPTION 'ChapterPresidentConflict' USING ERRCODE='23514'; END IF;
END $$;

-- Rename or merge position definitions without losing grants, tenures or rules.
DO $merge$
DECLARE item record; old_id uuid; new_id uuid;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('CHAPTER_MANAGER','CHAPTER_LEAD'), ('DEPARTMENT_LEADER','DEPARTMENT_LEAD'),
    ('CHAPTER_PRESIDENT','PRESIDENT'), ('MEMBER','DEPARTMENT_MEMBER'), ('DNA_MANAGER','DNA_LEAD'),
    ('TRAINEE','DNA_MEMBER'), ('TT','DNA_MEMBER')
  ) names(old_code,new_code) LOOP
    SELECT id INTO old_id FROM positions WHERE code=item.old_code;
    IF old_id IS NULL THEN CONTINUE; END IF;
    SELECT id INTO new_id FROM positions WHERE code=item.new_code;
    IF new_id IS NULL THEN
      UPDATE positions SET code=item.new_code WHERE id=old_id;
    ELSE
      INSERT INTO position_permissions(position_id,permission_id)
        SELECT new_id,permission_id FROM position_permissions WHERE position_id=old_id ON CONFLICT DO NOTHING;
      UPDATE position_assignments SET position_id=new_id WHERE position_id=old_id;
      UPDATE learning_rules SET position_id=new_id WHERE position_id=old_id;
      UPDATE chapter_reorganization_items SET position_id=new_id WHERE position_id=old_id;
      DELETE FROM position_permissions WHERE position_id=old_id;
      DELETE FROM positions WHERE id=old_id;
    END IF;
  END LOOP;
END $merge$;
INSERT INTO positions(id,code,name,scope,is_manager) VALUES
 (gen_random_uuid(),'CHAPTER_LEAD','Lead Chapter','CHAPTER',true),
 (gen_random_uuid(),'DNA_LEAD','Lead DNA','DNA',true),
 (gen_random_uuid(),'PRESIDENT','Chủ tịch Chapter','CHAPTER',false),
 (gen_random_uuid(),'DEPARTMENT_LEAD','Trưởng ban','DEPARTMENT',false),
 (gen_random_uuid(),'DEPARTMENT_MEMBER','Thành viên ban','DEPARTMENT',false),
 (gen_random_uuid(),'DNA_MEMBER','Thành viên DNA','DNA',false)
ON CONFLICT(code) DO UPDATE SET name=excluded.name,scope=excluded.scope,is_manager=excluded.is_manager;

-- Backfill the former position-only DNA managers before installing the no-promotion guard.
UPDATE users u SET role='LEAD' WHERE u.role='MEMBER' AND EXISTS(
  SELECT 1 FROM position_assignments a JOIN positions p ON p.id=a.position_id
  WHERE a.user_id=u.id AND p.code IN ('DNA_LEAD','CHAPTER_LEAD')
    AND a.starts_at<coalesce(a.ends_at,'infinity') AND coalesce(a.ends_at,'infinity')>timezone('UTC',clock_timestamp()));
UPDATE account_state_intervals SET role='LEAD' WHERE role='CHAPTER_LEADER';
UPDATE users SET auth_version=auth_version+1;
UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;

-- Map catalog keys and every rule, including closed rules, in the same transaction.
CREATE TEMP TABLE p03_target_names(old_code text PRIMARY KEY,new_code text NOT NULL) ON COMMIT DROP;
INSERT INTO p03_target_names SELECT 'MEMBER_'||code,'DEPARTMENT_MEMBER_'||CASE WHEN code='BDH' THEN 'BDHU' ELSE code END
 FROM unnest(ARRAY['BTV','BTK','BND','BCL','BDH','BKM','BTTSK']) code;
INSERT INTO p03_target_names SELECT 'LEADER_'||code,'DEPARTMENT_LEAD_'||CASE WHEN code='BDH' THEN 'BDHU' ELSE code END
 FROM unnest(ARRAY['BTV','BTK','BND','BCL','BDH','BKM','BTTSK']) code;
INSERT INTO p03_target_names VALUES ('CHAPTER_PRESIDENT','PRESIDENT'),('DNA_TT','DNA_MEMBER_TT'),('DNA_SGDC','DNA_MEMBER_SGDC'),('DNA_LDC','DNA_MEMBER_LDC'),
 ('MEMBER_BDHU','DEPARTMENT_MEMBER_BDHU'),('LEADER_BDHU','DEPARTMENT_LEAD_BDHU'),('DEPARTMENT_MEMBER_BDH','DEPARTMENT_MEMBER_BDHU'),('DEPARTMENT_LEAD_BDH','DEPARTMENT_LEAD_BDHU');
UPDATE learning_rules r SET target_code=n.new_code FROM p03_target_names n WHERE r.target_code=n.old_code;
DO $targets$ DECLARE item record; BEGIN
 FOR item IN SELECT * FROM p03_target_names LOOP
  IF EXISTS(SELECT 1 FROM learning_targets WHERE code=item.new_code) THEN
   -- Catalog definitions only; no assignments, progress, rules or user data are deleted.
   DELETE FROM learning_targets WHERE code=item.old_code;
  ELSE
   UPDATE learning_targets SET code=item.new_code WHERE code=item.old_code;
  END IF;
 END LOOP;
END $targets$;
UPDATE learning_targets SET position_code=CASE
 WHEN code LIKE 'DEPARTMENT_MEMBER_%' THEN 'DEPARTMENT_MEMBER'
 WHEN code LIKE 'DEPARTMENT_LEAD_%' THEN 'DEPARTMENT_LEAD'
 WHEN code='PRESIDENT' THEN 'PRESIDENT'
 WHEN code LIKE 'DNA_MEMBER_%' THEN 'DNA_MEMBER' ELSE position_code END,
 department_code=CASE WHEN department_code='BDH' THEN 'BDHU' ELSE department_code END;
UPDATE organization_units SET code='BDHU' WHERE type='DEPARTMENT' AND code='BDH';

-- Give membership-only learners their canonical position, without choosing between conflicting leaves.
INSERT INTO position_assignments(id,user_id,unit_id,position_id,starts_at,ends_at,is_primary)
SELECT gen_random_uuid(),m.user_id,m.unit_id,p.id,m.starts_at,m.ends_at,false
FROM organization_memberships m JOIN organization_units unit ON unit.id=m.unit_id JOIN users u ON u.id=m.user_id
JOIN positions p ON p.code=CASE WHEN unit.type='DEPARTMENT' THEN 'DEPARTMENT_MEMBER' ELSE 'DNA_MEMBER' END
WHERE u.role='MEMBER' AND m.status='ACTIVE' AND unit.type IN ('DEPARTMENT','DNA_GROUP')
 AND m.starts_at<coalesce(m.ends_at,'infinity') AND coalesce(m.ends_at,'infinity')>timezone('UTC',clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM position_assignments a WHERE a.user_id=m.user_id
   AND a.starts_at<coalesce(m.ends_at,'infinity') AND m.starts_at<coalesce(a.ends_at,'infinity')
   AND a.starts_at<coalesce(a.ends_at,'infinity'));

-- Managers retain learning evidence, but no active obligations or overdue locks.
UPDATE user_learning_assignments a SET mandatory=false,ended_at=clock_timestamp(),due_at=NULL,
 status=CASE WHEN a.completed_at IS NULL THEN 'ENDED'::learning_assignment_status ELSE a.status END
 FROM users u WHERE a.user_id=u.id AND u.role IN ('ADMIN','LEAD') AND a.ended_at IS NULL;
UPDATE supplemental_learning_requirements s SET ended_at=clock_timestamp() FROM users u WHERE s.user_id=u.id AND u.role IN ('ADMIN','LEAD') AND s.ended_at IS NULL;
UPDATE learning_paths p SET due_at=NULL,imported_due_at=NULL,budget='[]'::jsonb,budget_fingerprint=''
 FROM users u,learning_cycles c WHERE p.user_id=u.id AND p.learning_cycle_id=c.id AND c.ends_at IS NULL AND u.role IN ('ADMIN','LEAD');
UPDATE access_restrictions r SET lifted_at=clock_timestamp() FROM users u WHERE r.user_id=u.id AND u.role IN ('ADMIN','LEAD') AND r.type='DEADLINE' AND r.lifted_at IS NULL;
-- Conservative unlock: any direct or organization cascade restriction keeps the account locked.
WITH RECURSIVE affiliation AS (
 SELECT user_id,unit_id FROM organization_memberships WHERE status='ACTIVE' AND starts_at<=timezone('UTC',clock_timestamp()) AND (ends_at IS NULL OR ends_at>timezone('UTC',clock_timestamp()))
 UNION SELECT user_id,unit_id FROM position_assignments WHERE starts_at<=timezone('UTC',clock_timestamp()) AND (ends_at IS NULL OR ends_at>timezone('UTC',clock_timestamp()))
 UNION SELECT m.user_id,c.organization_unit_id FROM chapter_members m JOIN chapters c ON c.id=m.chapter_id WHERE c.organization_unit_id IS NOT NULL
), ancestors AS (
 SELECT user_id,unit_id FROM affiliation
 UNION SELECT a.user_id,u.parent_id FROM ancestors a JOIN organization_units u ON u.id=a.unit_id WHERE u.parent_id IS NOT NULL
)
UPDATE users u SET status='ACTIVE',lock_reason=NULL WHERE u.role IN ('ADMIN','LEAD') AND u.status='LOCKED' AND u.lock_reason IN ('OVERDUE_LOCK','DEADLINE')
 AND NOT EXISTS(SELECT 1 FROM access_restrictions r WHERE r.lifted_at IS NULL AND (r.user_id=u.id OR (r.type='CHAPTER_CASCADE' AND r.organization_unit_id IN (SELECT unit_id FROM ancestors WHERE user_id=u.id))));

CREATE FUNCTION prevent_member_lead_promotion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.role='MEMBER' AND NEW.role='LEAD' THEN RAISE EXCEPTION 'LeadInvitationRequiresNewAccount' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER no_member_lead_promotion BEFORE UPDATE OF role ON users FOR EACH ROW EXECUTE FUNCTION prevent_member_lead_promotion();

-- Refuse ambiguous existing affiliations instead of deleting or choosing people's data.
DO $$ DECLARE target_id uuid; BEGIN
 FOR target_id IN SELECT id FROM users ORDER BY id LOOP PERFORM assert_organization_integrity(target_id); END LOOP;
END $$;
COMMIT;
