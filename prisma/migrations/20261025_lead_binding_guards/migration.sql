BEGIN;
LOCK TABLE users,chapter_members,organization_memberships,position_assignments IN SHARE ROW EXCLUSIVE MODE;

-- Keep the original function OID: existing prepared trigger plans must also see
-- this additional business rule after deployment. Fail if the prerequisite differs.
DO $migration$
DECLARE definition text; anchor text := 'IF dna AND chapter THEN RAISE EXCEPTION ''SingleOrganizationAffiliationRequired'' USING ERRCODE=''23514''; END IF;';
BEGIN
  SELECT pg_get_functiondef('assert_organization_integrity(uuid)'::regprocedure) INTO definition;
  IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'OrganizationGuardPrerequisiteMismatch'; END IF;
  definition := replace(definition,anchor,anchor || $rule$
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
$rule$);
  EXECUTE definition;
END $migration$;

-- Imports cannot manufacture a new historical tenure at another Chapter either.
-- Closing an existing incorrect record remains possible under a reviewed repair.
CREATE OR REPLACE FUNCTION serialize_organization_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; old_id uuid; new_id uuid; lead_chapter uuid; bound_chapter uuid; code text; actor_role text; historical_close boolean:=false;
BEGIN
  IF TG_OP<>'INSERT' THEN old_id:=OLD.user_id; END IF;
  IF TG_OP<>'DELETE' THEN new_id:=NEW.user_id; END IF;
  FOR target_id IN SELECT id FROM users WHERE id IN (old_id,new_id) ORDER BY id LOOP UPDATE users SET auth_version=auth_version WHERE id=target_id; END LOOP;
  IF TG_TABLE_NAME='position_assignments' AND TG_OP<>'DELETE' THEN
    SELECT p.code INTO code FROM positions p WHERE p.id=NEW.position_id;
    SELECT role::text INTO actor_role FROM users WHERE id=NEW.user_id;
    IF code IN ('CHAPTER_LEAD','CHAPTER_MANAGER') AND actor_role<>'ADMIN' THEN
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
DO $$ DECLARE target_id uuid; BEGIN
  FOR target_id IN SELECT id FROM users ORDER BY id LOOP PERFORM assert_organization_integrity(target_id); END LOOP;
END $$;
COMMIT;
