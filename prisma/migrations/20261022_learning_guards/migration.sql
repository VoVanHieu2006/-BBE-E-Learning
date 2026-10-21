BEGIN;

-- Additive catalog only. No course is automatically classified.
-- Legacy timestamp columns and historical links are preserved.
INSERT INTO learning_programs (id,code,name,is_core,sort_order) VALUES (gen_random_uuid(),'CORE_MEMBER','Chương trình học cho Thành viên',true,0) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_programs (id,code,name,is_core,sort_order) VALUES (gen_random_uuid(),'CORE_LEADER','Chương trình học cho LT',true,1) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_programs (id,code,name,is_core,sort_order) VALUES (gen_random_uuid(),'CORE_DNA','Chương trình học cho DNA',true,2) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_programs (id,code,name,is_core,sort_order) VALUES (gen_random_uuid(),'EXTENDED','Chương trình học mở rộng/khuyến khích',false,3) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('MEMBER_BTV','Thành viên Ban Thành Viên','BTV','MEMBER',NULL,0) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('MEMBER_BTK','Thành viên Ban Thư Ký','BTK','MEMBER',NULL,1) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('MEMBER_BND','Thành viên Ban Nội Dung','BND','MEMBER',NULL,2) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('MEMBER_BCL','Thành viên Ban Chất Lượng','BCL','MEMBER',NULL,3) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('MEMBER_BDH','Thành viên Ban Định Hướng','BDH','MEMBER',NULL,4) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('MEMBER_BKM','Thành viên Ban Khách Mời','BKM','MEMBER',NULL,5) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('MEMBER_BTTSK','Thành viên Ban TT&SK','BTTSK','MEMBER',NULL,6) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('LEADER_BTV','LT Ban Thành Viên','BTV','DEPARTMENT_LEAD',NULL,7) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('LEADER_BTK','LT Ban Thư Ký','BTK','DEPARTMENT_LEAD',NULL,8) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('LEADER_BND','LT Ban Nội Dung','BND','DEPARTMENT_LEAD',NULL,9) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('LEADER_BCL','LT Ban Chất Lượng','BCL','DEPARTMENT_LEAD',NULL,10) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('LEADER_BDH','LT Ban Định Hướng','BDH','DEPARTMENT_LEAD',NULL,11) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('LEADER_BKM','LT Ban Khách Mời','BKM','DEPARTMENT_LEAD',NULL,12) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('LEADER_BTTSK','LT Ban TT&SK','BTTSK','DEPARTMENT_LEAD',NULL,13) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('CHAPTER_PRESIDENT','Chủ tịch Chapter',NULL,'CHAPTER_PRESIDENT',NULL,14) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('DNA_TT','DNA TT',NULL,NULL,'TT',15) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('DNA_SGDC','DNA SGDC',NULL,NULL,'SGDC',16) ON CONFLICT (code) DO NOTHING;
INSERT INTO learning_targets (code,label,department_code,position_code,dna_unit_code,sort_order) VALUES ('DNA_LDC','DNA LDC',NULL,NULL,'LDC',17) ON CONFLICT (code) DO NOTHING;

CREATE UNIQUE INDEX learning_cycles_one_open_user ON learning_cycles(user_id) WHERE ends_at IS NULL;
CREATE UNIQUE INDEX chapter_terms_one_open ON chapter_competition_terms(chapter_id) WHERE ends_at IS NULL;
CREATE UNIQUE INDEX chapter_transfers_one_applied_season ON chapter_reorganizations(chapter_id,transfer_season_id) WHERE status = 'APPLIED' AND transfer_season_id IS NOT NULL;
ALTER TABLE competition_months ADD CONSTRAINT competition_month_bounds CHECK (ends_at > starts_at);
ALTER TABLE learning_cycles ADD CONSTRAINT learning_cycle_bounds CHECK (ends_at IS NULL OR ends_at >= starts_at);
ALTER TABLE monthly_video_replays ADD CONSTRAINT replay_nonnegative CHECK (furthest_seconds >= 0);
ALTER TABLE quiz_reward_high_water_marks ADD CONSTRAINT quiz_reward_bounds CHECK (maximum_stars >= 0 AND maximum_stars <= reward_question_count AND reward_question_count > 0);


-- Record only history observed from this migration onwards; never infer earlier terms.
INSERT INTO account_state_intervals(id,user_id,role,status,starts_at)
SELECT gen_random_uuid(),id,role::text,status::text,clock_timestamp() FROM users;
CREATE UNIQUE INDEX account_state_one_open ON account_state_intervals(user_id) WHERE ends_at IS NULL;
CREATE FUNCTION record_learning_account_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE at_time timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO account_state_intervals(id,user_id,role,status,starts_at) VALUES(gen_random_uuid(),NEW.id,NEW.role::text,NEW.status::text,at_time);
  ELSIF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE account_state_intervals SET ends_at=at_time WHERE user_id=NEW.id AND ends_at IS NULL;
    INSERT INTO account_state_intervals(id,user_id,role,status,starts_at) VALUES(gen_random_uuid(),NEW.id,NEW.role::text,NEW.status::text,at_time);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER learning_account_state AFTER INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION record_learning_account_state();

INSERT INTO chapter_affiliation_intervals(id,user_id,chapter_id,starts_at)
SELECT gen_random_uuid(),user_id,chapter_id,clock_timestamp() FROM chapter_members;
CREATE UNIQUE INDEX chapter_affiliation_one_open ON chapter_affiliation_intervals(user_id) WHERE ends_at IS NULL;
CREATE FUNCTION record_learning_chapter_affiliation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE at_time timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    UPDATE chapter_affiliation_intervals SET ends_at=at_time WHERE user_id=OLD.user_id AND chapter_id=OLD.chapter_id AND ends_at IS NULL;
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    INSERT INTO chapter_affiliation_intervals(id,user_id,chapter_id,starts_at) VALUES(gen_random_uuid(),NEW.user_id,NEW.chapter_id,at_time);
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER learning_chapter_affiliation AFTER INSERT OR UPDATE OR DELETE ON chapter_members FOR EACH ROW EXECUTE FUNCTION record_learning_chapter_affiliation();

INSERT INTO course_publication_events(id,course_id,status,effective_at)
SELECT gen_random_uuid(),id,status::text,clock_timestamp() FROM courses;
CREATE FUNCTION record_learning_course_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO course_publication_events(id,course_id,status,effective_at) VALUES(gen_random_uuid(),NEW.id,NEW.status::text,clock_timestamp());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER learning_course_publication AFTER INSERT OR UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION record_learning_course_publication();

-- Canonical President is a position, not an eighth Department.
INSERT INTO positions(id,code,name,scope,is_manager) VALUES(gen_random_uuid(),'CHAPTER_PRESIDENT',U&'Ch\1EE7 t\1ECBch Chapter','CHAPTER',false) ON CONFLICT(code) DO NOTHING;

-- Deferred checks allow an atomic Chapter -> DNA replacement while rejecting dual final state.
CREATE FUNCTION enforce_single_learning_affiliation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user uuid; has_dna boolean; has_chapter boolean;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM learning_policy WHERE id='default' AND cutover_at <= clock_timestamp() AND mapping_approved_at IS NOT NULL) THEN RETURN NEW; END IF;
  target_user := NEW.user_id;
  SELECT EXISTS(SELECT 1 FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id
    WHERE m.user_id=target_user AND m.status='ACTIVE' AND m.starts_at <= (clock_timestamp() AT TIME ZONE 'UTC')
      AND (m.ends_at IS NULL OR m.ends_at > (clock_timestamp() AT TIME ZONE 'UTC')) AND u.type IN ('DNA','DNA_GROUP')) INTO has_dna;
  SELECT EXISTS(SELECT 1 FROM chapter_members WHERE user_id=target_user) OR EXISTS(
    SELECT 1 FROM organization_memberships m JOIN organization_units u ON u.id=m.unit_id
    WHERE m.user_id=target_user AND m.status='ACTIVE' AND m.starts_at <= (clock_timestamp() AT TIME ZONE 'UTC')
      AND (m.ends_at IS NULL OR m.ends_at > (clock_timestamp() AT TIME ZONE 'UTC')) AND u.type IN ('CHAPTER','DEPARTMENT')) INTO has_chapter;
  IF has_dna AND has_chapter THEN RAISE EXCEPTION 'SingleOrganizationAffiliationRequired' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER single_affiliation_membership AFTER INSERT OR UPDATE ON organization_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_single_learning_affiliation();
CREATE CONSTRAINT TRIGGER single_affiliation_chapter AFTER INSERT OR UPDATE ON chapter_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_single_learning_affiliation();

COMMIT;
