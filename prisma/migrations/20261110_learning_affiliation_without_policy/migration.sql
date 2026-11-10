BEGIN;

CREATE OR REPLACE FUNCTION enforce_single_learning_affiliation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user uuid; has_dna boolean; has_chapter boolean;
BEGIN
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

COMMIT;
