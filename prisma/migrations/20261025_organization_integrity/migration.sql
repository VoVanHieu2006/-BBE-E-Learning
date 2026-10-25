BEGIN;
LOCK TABLE users, chapter_members, organization_memberships, position_assignments IN SHARE ROW EXCLUSIVE MODE;

-- No normalization/merging of existing identities or random choice of a Chapter.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM users GROUP BY lower(btrim(email)) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'NormalizedEmailReviewRequired';
  END IF;
END $$;
CREATE UNIQUE INDEX users_email_normalized_key ON users(lower(btrim(email)));
CREATE FUNCTION normalize_organization_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.email := lower(btrim(NEW.email)); RETURN NEW; END $$;
CREATE TRIGGER organization_email BEFORE INSERT OR UPDATE OF email ON users FOR EACH ROW EXECUTE FUNCTION normalize_organization_email();

CREATE TABLE IF NOT EXISTS chapter_lead_bindings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE RESTRICT,
  bound_at timestamptz(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS chapter_lead_bindings_chapter_id_idx ON chapter_lead_bindings(chapter_id);

-- Explicitly approved repairs can identify the valid Chapter without rewriting tenures.
CREATE TEMP TABLE lead_binding_candidates ON COMMIT DROP AS
WITH grants AS (
  SELECT a.user_id,c.id AS chapter_id FROM position_assignments a JOIN positions p ON p.id=a.position_id
  JOIN chapters c ON c.organization_unit_id=a.unit_id WHERE p.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER')
  UNION SELECT m.user_id,m.chapter_id FROM chapter_members m JOIN users u ON u.id=m.user_id WHERE u.role='CHAPTER_LEADER'
), approved AS (
  SELECT DISTINCT ON (entity_id) entity_id AS user_id,(metadata->>'keptChapterId')::uuid AS chapter_id
  FROM audit_logs WHERE action='REPAIR_CHAPTER_LEAD_SCOPE' AND metadata->>'keptChapterId' IS NOT NULL ORDER BY entity_id,created_at DESC
)
SELECT u.id AS user_id,coalesce(a.chapter_id,(array_agg(DISTINCT g.chapter_id))[1]) AS chapter_id,
  count(DISTINCT g.chapter_id) AS choices,a.chapter_id IS NOT NULL AS approved
FROM users u JOIN grants g ON g.user_id=u.id LEFT JOIN approved a ON a.user_id=u.id
WHERE u.role<>'ADMIN' GROUP BY u.id,a.chapter_id;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM lead_binding_candidates WHERE choices>1 AND NOT approved) THEN
    RAISE EXCEPTION 'ChapterLeadDataReviewRequired';
  END IF;
END $$;
INSERT INTO chapter_lead_bindings(user_id,chapter_id) SELECT user_id,chapter_id FROM lead_binding_candidates;

CREATE FUNCTION immutable_chapter_lead_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ChapterLeadPermanentBinding' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_lead_binding BEFORE UPDATE OR DELETE ON chapter_lead_bindings FOR EACH ROW EXECUTE FUNCTION immutable_chapter_lead_binding();

-- A real write conflict also protects REPEATABLE READ import transactions; a mere
-- SELECT FOR UPDATE would leave their old snapshots able to pass a deferred check.
CREATE FUNCTION serialize_organization_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; old_id uuid; new_id uuid; lead_chapter uuid; bound_chapter uuid; code text; actor_role text;
BEGIN
  IF TG_OP<>'INSERT' THEN old_id:=OLD.user_id; END IF;
  IF TG_OP<>'DELETE' THEN new_id:=NEW.user_id; END IF;
  FOR target_id IN SELECT id FROM users WHERE id IN (old_id,new_id) ORDER BY id LOOP
    UPDATE users SET auth_version=auth_version WHERE id=target_id;
  END LOOP;
  IF TG_TABLE_NAME='position_assignments' AND TG_OP<>'DELETE' THEN
    SELECT p.code INTO code FROM positions p WHERE p.id=NEW.position_id;
    SELECT role::text INTO actor_role FROM users WHERE id=NEW.user_id;
    IF code IN ('CHAPTER_LEAD','CHAPTER_MANAGER') AND actor_role<>'ADMIN' THEN
      SELECT id INTO lead_chapter FROM chapters WHERE organization_unit_id=NEW.unit_id;
      IF lead_chapter IS NULL THEN RAISE EXCEPTION 'ChapterLeadScopeInvalid' USING ERRCODE='23514'; END IF;
      INSERT INTO chapter_lead_bindings(user_id,chapter_id) VALUES(NEW.user_id,lead_chapter) ON CONFLICT(user_id) DO NOTHING;
      SELECT chapter_id INTO bound_chapter FROM chapter_lead_bindings WHERE user_id=NEW.user_id;
      IF bound_chapter<>lead_chapter AND (NEW.ends_at IS NULL OR NEW.ends_at>timezone('UTC',clock_timestamp())) THEN
        RAISE EXCEPTION 'ChapterLeadPermanentBinding' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER serialize_organization_membership BEFORE INSERT OR UPDATE OR DELETE ON organization_memberships FOR EACH ROW EXECUTE FUNCTION serialize_organization_writer();
CREATE TRIGGER serialize_chapter_membership BEFORE INSERT OR UPDATE OR DELETE ON chapter_members FOR EACH ROW EXECUTE FUNCTION serialize_organization_writer();
CREATE TRIGGER serialize_position_assignment BEFORE INSERT OR UPDATE OR DELETE ON position_assignments FOR EACH ROW EXECUTE FUNCTION serialize_organization_writer();

CREATE FUNCTION assert_organization_integrity(target_user uuid) RETURNS void LANGUAGE plpgsql AS $$
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
  IF actor_role='CHAPTER_LEADER' AND EXISTS(SELECT 1 FROM chapter_members m JOIN chapter_lead_bindings b ON b.user_id=m.user_id
    WHERE m.user_id=target_user AND m.chapter_id<>b.chapter_id) THEN
    RAISE EXCEPTION 'ChapterLeadPermanentBinding' USING ERRCODE='23514';
  END IF;
  IF actor_role<>'ADMIN' AND EXISTS(
    SELECT 1 FROM position_assignments a JOIN positions p ON p.id=a.position_id
    JOIN position_assignments b ON b.user_id=a.user_id AND b.id>a.id JOIN positions q ON q.id=b.position_id
    WHERE a.user_id=target_user AND p.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER') AND q.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER')
      AND (a.ends_at IS NULL OR a.ends_at>at_time) AND (b.ends_at IS NULL OR b.ends_at>at_time)
      AND a.starts_at<coalesce(a.ends_at,'infinity') AND b.starts_at<coalesce(b.ends_at,'infinity')
      AND a.starts_at<coalesce(b.ends_at,'infinity') AND b.starts_at<coalesce(a.ends_at,'infinity')
  ) THEN RAISE EXCEPTION 'ChapterLeadConflict' USING ERRCODE='23514'; END IF;
  IF actor_role<>'ADMIN' AND EXISTS(SELECT 1 FROM position_assignments a JOIN positions p ON p.id=a.position_id
    JOIN chapters c ON c.organization_unit_id=a.unit_id LEFT JOIN chapter_lead_bindings b ON b.user_id=a.user_id
    WHERE a.user_id=target_user AND p.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER') AND (a.ends_at IS NULL OR a.ends_at>at_time)
      AND a.starts_at<coalesce(a.ends_at,'infinity') AND c.id IS DISTINCT FROM b.chapter_id
  ) THEN RAISE EXCEPTION 'ChapterLeadPermanentBinding' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM organization_memberships a JOIN organization_memberships b ON b.user_id=a.user_id AND b.unit_id=a.unit_id AND b.id>a.id
    WHERE a.user_id=target_user AND a.status='ACTIVE' AND b.status='ACTIVE'
      AND a.starts_at<coalesce(a.ends_at,'infinity') AND b.starts_at<coalesce(b.ends_at,'infinity')
      AND a.starts_at<coalesce(b.ends_at,'infinity') AND b.starts_at<coalesce(a.ends_at,'infinity')
  ) THEN RAISE EXCEPTION 'MembershipExists' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION enforce_organization_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='users' THEN PERFORM assert_organization_integrity(NEW.id);
  ELSE
    IF TG_OP<>'INSERT' THEN PERFORM assert_organization_integrity(OLD.user_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM assert_organization_integrity(NEW.user_id); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER organization_membership_integrity AFTER INSERT OR UPDATE OR DELETE ON organization_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_organization_integrity();
CREATE CONSTRAINT TRIGGER chapter_membership_integrity AFTER INSERT OR UPDATE OR DELETE ON chapter_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_organization_integrity();
CREATE CONSTRAINT TRIGGER position_assignment_integrity AFTER INSERT OR UPDATE OR DELETE ON position_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_organization_integrity();
CREATE CONSTRAINT TRIGGER organization_user_role_integrity AFTER INSERT OR UPDATE OF role ON users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_organization_integrity();

-- Imports must not bypass the guards by retyping a unit or renaming a position.
CREATE FUNCTION enforce_organization_definition_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid;
BEGIN
  FOR target_id IN SELECT DISTINCT user_id FROM (
    SELECT a.user_id FROM position_assignments a WHERE (TG_TABLE_NAME='positions' AND a.position_id=NEW.id) OR (TG_TABLE_NAME='organization_units' AND a.unit_id=NEW.id)
    UNION SELECT m.user_id FROM organization_memberships m WHERE TG_TABLE_NAME='organization_units' AND m.unit_id=NEW.id
  ) affected ORDER BY user_id LOOP
    UPDATE users SET auth_version=auth_version WHERE id=target_id;
    PERFORM assert_organization_integrity(target_id);
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER organization_unit_definition_integrity AFTER UPDATE OF type ON organization_units DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_organization_definition_integrity();
CREATE CONSTRAINT TRIGGER organization_position_definition_integrity AFTER UPDATE OF code,scope ON positions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_organization_definition_integrity();

-- Refuse deployment over inconsistent data. Run the read-only audit and obtain
-- explicit decisions; the migration never closes, deletes or backdates a record.
DO $$ DECLARE target_id uuid; BEGIN
  FOR target_id IN SELECT id FROM users ORDER BY id LOOP PERFORM assert_organization_integrity(target_id); END LOOP;
END $$;
COMMIT;
