-- Baseline schema at migration head 20261110_standardize_roles_positions, cut by scripts/db/cut-baseline.mjs.
-- schema.prisma first, then every migration replayed statement by statement; see prisma/bootstrap/README.md.
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE public.assessment_type AS ENUM (
    'LESSON',
    'COURSE_FINAL'
);

CREATE TYPE public.attempt_status AS ENUM (
    'IN_PROGRESS',
    'SUBMITTED',
    'AUTO_SUBMITTED',
    'CANCELLED'
);

CREATE TYPE public.chapter_reorganization_status AS ENUM (
    'DRAFT',
    'SCHEDULED',
    'APPLIED',
    'CANCELLED'
);

CREATE TYPE public.chapter_status AS ENUM (
    'ACTIVE',
    'INACTIVE'
);

CREATE TYPE public.course_status AS ENUM (
    'DRAFT',
    'PUBLISHED'
);

CREATE TYPE public.course_visibility AS ENUM (
    'PUBLIC',
    'PRIVATE'
);

CREATE TYPE public.invitation_role AS ENUM (
    'LEAD',
    'DNA_LEAD',
    'MEMBER'
);

CREATE TYPE public.invitation_status AS ENUM (
    'PENDING',
    'ACCEPTED',
    'EXPIRED',
    'CANCELLED'
);

CREATE TYPE public.kpi_status AS ENUM (
    'BLACK',
    'RED',
    'YELLOW',
    'GREEN'
);

CREATE TYPE public.learning_assignment_status AS ENUM (
    'ASSIGNED',
    'IN_PROGRESS',
    'COMPLETED',
    'OVERDUE',
    'WAIVED',
    'ENDED'
);

CREATE TYPE public.membership_status AS ENUM (
    'ACTIVE',
    'LEFT'
);

CREATE TYPE public.organization_membership_status AS ENUM (
    'ACTIVE',
    'ENDED'
);

CREATE TYPE public.organization_unit_type AS ENUM (
    'ROOT',
    'DNA',
    'DNA_GROUP',
    'CHAPTER',
    'DEPARTMENT'
);

CREATE TYPE public.position_scope AS ENUM (
    'PLATFORM',
    'DNA',
    'CHAPTER',
    'DEPARTMENT'
);

CREATE TYPE public.question_type AS ENUM (
    'SINGLE_CHOICE',
    'MULTIPLE_CHOICE',
    'TRUE_FALSE'
);

CREATE TYPE public.restriction_type AS ENUM (
    'DIRECT_ADMIN',
    'DEADLINE',
    'CHAPTER_CASCADE'
);

CREATE TYPE public.star_reason AS ENUM (
    'VIDEO_COMPLETION',
    'MODULE_QUIZ_PASS',
    'MODULE_QUIZ_BONUS',
    'COURSE_FINAL_PASS',
    'COURSE_FINAL_BONUS',
    'ADMIN_ADJUSTMENT'
);

CREATE TYPE public.user_role AS ENUM (
    'ADMIN',
    'LEAD',
    'MEMBER'
);

CREATE TYPE public.user_status AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'LOCKED'
);

CREATE TYPE public.video_provider AS ENUM (
    'YOUTUBE'
);

CREATE FUNCTION public.assert_organization_integrity(target_user uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION public.enforce_organization_definition_integrity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION public.enforce_organization_integrity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME='users' THEN PERFORM assert_organization_integrity(NEW.id);
  ELSE
    IF TG_OP<>'INSERT' THEN PERFORM assert_organization_integrity(OLD.user_id); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM assert_organization_integrity(NEW.user_id); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.enforce_single_learning_affiliation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION public.immutable_chapter_lead_binding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'ChapterLeadPermanentBinding' USING ERRCODE='23514'; END $$;

CREATE FUNCTION public.normalize_organization_email() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.email := lower(btrim(NEW.email)); RETURN NEW; END $$;

CREATE FUNCTION public.prevent_member_lead_promotion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF OLD.role='MEMBER' AND NEW.role='LEAD' THEN RAISE EXCEPTION 'LeadInvitationRequiresNewAccount' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.record_learning_account_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION public.record_learning_chapter_affiliation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION public.record_learning_course_publication() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO course_publication_events(id,course_id,status,effective_at) VALUES(gen_random_uuid(),NEW.id,NEW.status::text,clock_timestamp());
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.serialize_organization_writer() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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

CREATE TABLE public.access_restrictions (
    id uuid NOT NULL,
    user_id uuid,
    organization_unit_id uuid,
    type public.restriction_type NOT NULL,
    reason text NOT NULL,
    source_reference character varying(255),
    created_by_user_id uuid,
    lifted_by_user_id uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    lifted_at timestamp without time zone
);

CREATE TABLE public.account_state_intervals (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(40) NOT NULL,
    status character varying(40) NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone
);

CREATE TABLE public.assessments (
    id uuid NOT NULL,
    type public.assessment_type DEFAULT 'LESSON'::public.assessment_type NOT NULL,
    lesson_id uuid,
    course_id uuid,
    title character varying(255) NOT NULL,
    description text,
    question_count integer DEFAULT 10 NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    CONSTRAINT assessments_duration_minutes_check CHECK (((duration_minutes >= 1) AND (duration_minutes <= 240))),
    CONSTRAINT assessments_exactly_one_owner_check CHECK ((((type = 'LESSON'::public.assessment_type) AND (lesson_id IS NOT NULL) AND (course_id IS NULL)) OR ((type = 'COURSE_FINAL'::public.assessment_type) AND (lesson_id IS NULL) AND (course_id IS NOT NULL)))),
    CONSTRAINT assessments_question_count_check CHECK (((question_count >= 1) AND (question_count <= 100)))
);

CREATE TABLE public.attempt_answers (
    id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    question_id uuid NOT NULL,
    selected_option_id uuid,
    answered_at timestamp without time zone,
    is_correct boolean
);

CREATE TABLE public.attempt_questions (
    question_snapshot jsonb,
    id uuid NOT NULL,
    attempt_id uuid NOT NULL,
    question_id uuid NOT NULL,
    display_order integer NOT NULL
);

CREATE TABLE public.attempts (
    grading_snapshot jsonb,
    learning_cycle_id uuid,
    cancellation_reason character varying(120),
    id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    final_exam_version_id uuid,
    user_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    status public.attempt_status DEFAULT 'IN_PROGRESS'::public.attempt_status NOT NULL,
    started_at timestamp without time zone NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    submitted_at timestamp without time zone,
    score numeric(5,2),
    passed boolean,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.audit_logs (
    id uuid NOT NULL,
    actor_user_id uuid,
    action character varying(100) NOT NULL,
    entity_type character varying(100) NOT NULL,
    entity_id uuid NOT NULL,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.chapter_affiliation_intervals (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone
);

CREATE TABLE public.chapter_competition_terms (
    id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    season_id uuid,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone
);

CREATE TABLE public.chapter_lead_bindings (
    user_id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    bound_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.chapter_members (
    id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.chapter_monthly_kpis (
    id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    month_start date NOT NULL,
    status public.kpi_status NOT NULL,
    configured_by_user_id uuid NOT NULL,
    note text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.chapter_reorganization_items (
    id uuid NOT NULL,
    reorganization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    display_name character varying(120),
    department_unit_id uuid,
    position_id uuid,
    is_primary boolean DEFAULT true NOT NULL,
    validation_error text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.chapter_reorganizations (
    last_error text,
    apply_attempts integer DEFAULT 0 NOT NULL,
    transfer_season_id uuid,
    id uuid NOT NULL,
    chapter_id uuid NOT NULL,
    effective_at timestamp without time zone NOT NULL,
    term_number integer,
    status public.chapter_reorganization_status DEFAULT 'DRAFT'::public.chapter_reorganization_status NOT NULL,
    source_url text,
    created_by_user_id uuid NOT NULL,
    confirmed_at timestamp without time zone,
    applied_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.chapters (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    status public.chapter_status DEFAULT 'ACTIVE'::public.chapter_status NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    organization_unit_id uuid,
    current_term_number integer
);

CREATE TABLE public.competition_months (
    id uuid NOT NULL,
    key character varying(7) NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone NOT NULL,
    state character varying(30) DEFAULT 'OPEN'::character varying NOT NULL,
    closed_at timestamp(3) with time zone,
    CONSTRAINT competition_month_bounds CHECK ((ends_at > starts_at))
);

CREATE TABLE public.course_drafts (
    id uuid NOT NULL,
    course_id uuid NOT NULL,
    base_content_version integer NOT NULL,
    draft_version integer DEFAULT 1 NOT NULL,
    content jsonb NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.course_publication_events (
    id uuid NOT NULL,
    course_id uuid NOT NULL,
    status character varying(40) NOT NULL,
    effective_at timestamp(3) with time zone NOT NULL
);

CREATE TABLE public.course_requirement_versions (
    id uuid NOT NULL,
    course_id uuid NOT NULL,
    version integer NOT NULL,
    lesson_ids uuid[],
    assessment_ids uuid[],
    final_version_id uuid,
    published_at timestamp(3) with time zone NOT NULL,
    fingerprint text NOT NULL
);

CREATE TABLE public.courses (
    program_id uuid,
    content_version integer DEFAULT 1 NOT NULL,
    id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    status public.course_status DEFAULT 'DRAFT'::public.course_status NOT NULL,
    visibility public.course_visibility DEFAULT 'PRIVATE'::public.course_visibility NOT NULL,
    created_by uuid NOT NULL,
    published_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    cover_url character varying(1000),
    cover_public_id character varying(500),
    mandatory_default_due_days integer DEFAULT 30 NOT NULL
);

CREATE TABLE public.cycle_lesson_progress (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    learning_cycle_id uuid NOT NULL,
    furthest_seconds double precision DEFAULT 0 NOT NULL,
    completed_at timestamp(3) with time zone,
    unlocked_at timestamp(3) with time zone,
    provenance character varying(30) DEFAULT 'NATIVE'::character varying NOT NULL
);

CREATE TABLE public.documents (
    id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    file_name character varying(255) NOT NULL,
    storage_key character varying(500) NOT NULL,
    mime_type character varying(100) NOT NULL,
    file_size bigint NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.final_exam_versions (
    id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    version_number integer NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    question_count integer NOT NULL,
    duration_minutes integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.invitations (
    id uuid NOT NULL,
    email character varying(255) NOT NULL,
    display_name character varying(120),
    chapter_name character varying(255),
    chapter_description text,
    role public.invitation_role NOT NULL,
    chapter_id uuid,
    organization_unit_id uuid,
    invited_by uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    status public.invitation_status DEFAULT 'PENDING'::public.invitation_status NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    accepted_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT invitations_exactly_one_scope_check CHECK (((chapter_id IS NOT NULL) <> (organization_unit_id IS NOT NULL)))
);

CREATE TABLE public.learning_cycles (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    chapter_id uuid,
    trigger_key character varying(255) NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone,
    provenance character varying(30) DEFAULT 'NATIVE'::character varying NOT NULL,
    CONSTRAINT learning_cycle_bounds CHECK (((ends_at IS NULL) OR (ends_at >= starts_at)))
);

CREATE TABLE public.learning_notices (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    event_key character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    body text NOT NULL,
    created_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    read_at timestamp(3) with time zone
);

CREATE TABLE public.learning_outbox (
    id uuid NOT NULL,
    event_key character varying(255) NOT NULL,
    kind character varying(60) NOT NULL,
    user_id uuid,
    payload jsonb NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp(3) with time zone,
    last_error text
);

CREATE TABLE public.learning_path_changes (
    id uuid NOT NULL,
    path_id uuid NOT NULL,
    changed_at timestamp(3) with time zone NOT NULL,
    previous_budget jsonb NOT NULL,
    next_budget jsonb NOT NULL,
    due_at timestamp(3) with time zone,
    reason character varying(120) NOT NULL
);

CREATE TABLE public.learning_paths (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    learning_cycle_id uuid NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    due_at timestamp(3) with time zone,
    imported_due_at timestamp(3) with time zone,
    budget_fingerprint text DEFAULT ''::text NOT NULL,
    budget jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE public.learning_policy (
    id text DEFAULT 'default'::text NOT NULL,
    cutover_at timestamp(3) with time zone,
    mapping_approved_at timestamp(3) with time zone,
    updated_at timestamp(3) with time zone NOT NULL
);

CREATE TABLE public.learning_programs (
    id uuid NOT NULL,
    code character varying(60) NOT NULL,
    name character varying(255) NOT NULL,
    is_core boolean DEFAULT false NOT NULL,
    sort_order integer NOT NULL
);

CREATE TABLE public.learning_rules (
    target_code character varying(100),
    id uuid NOT NULL,
    course_id uuid NOT NULL,
    organization_unit_id uuid,
    position_id uuid,
    mandatory boolean DEFAULT true NOT NULL,
    can_view boolean DEFAULT true NOT NULL,
    can_assess boolean DEFAULT true NOT NULL,
    can_earn_stars boolean DEFAULT true NOT NULL,
    due_days integer,
    effective_from timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    effective_until timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.learning_snapshots (
    id uuid NOT NULL,
    key character varying(255) NOT NULL,
    kind character varying(60) NOT NULL,
    captured_at timestamp(3) with time zone NOT NULL,
    payload jsonb NOT NULL
);

CREATE TABLE public.learning_targets (
    code character varying(100) NOT NULL,
    label character varying(255) NOT NULL,
    department_code character varying(100),
    position_code character varying(100),
    dna_unit_code character varying(100),
    sort_order integer NOT NULL
);

CREATE TABLE public.lesson_comments (
    id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    user_id uuid NOT NULL,
    parent_id uuid,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.lesson_progress (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    completed_at timestamp without time zone,
    last_position_seconds integer,
    furthest_watched_position_seconds integer,
    last_watched_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.lessons (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    sort_order integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.monthly_video_replays (
    reward_suppressed_at timestamp(3) with time zone,
    view_session_id character varying(80),
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    video_id uuid NOT NULL,
    competition_month_id uuid NOT NULL,
    learning_cycle_id uuid NOT NULL,
    furthest_seconds double precision DEFAULT 0 NOT NULL,
    last_heartbeat_at timestamp(3) with time zone,
    completed_at timestamp(3) with time zone,
    CONSTRAINT replay_nonnegative CHECK ((furthest_seconds >= (0)::double precision))
);

CREATE TABLE public.organization_memberships (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    status public.organization_membership_status DEFAULT 'ACTIVE'::public.organization_membership_status NOT NULL,
    starts_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ends_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.organization_units (
    code character varying(100),
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    type public.organization_unit_type NOT NULL,
    parent_id uuid,
    status public.chapter_status DEFAULT 'ACTIVE'::public.chapter_status NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.password_reset_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.permissions (
    id uuid NOT NULL,
    code character varying(120) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.position_assignments (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    position_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    starts_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ends_at timestamp without time zone,
    appointed_by uuid,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.position_permissions (
    position_id uuid NOT NULL,
    permission_id uuid NOT NULL
);

CREATE TABLE public.positions (
    id uuid NOT NULL,
    code character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    scope public.position_scope NOT NULL,
    is_manager boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.question_options (
    id uuid NOT NULL,
    question_id uuid NOT NULL,
    option_text text NOT NULL,
    is_correct boolean DEFAULT false NOT NULL,
    sort_order integer NOT NULL
);

CREATE TABLE public.question_pools (
    id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    sort_order integer NOT NULL,
    draw_count integer DEFAULT 3 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.questions (
    id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    question_text text NOT NULL,
    question_type public.question_type DEFAULT 'SINGLE_CHOICE'::public.question_type NOT NULL,
    points integer DEFAULT 1 NOT NULL,
    sort_order integer NOT NULL,
    explanation text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    pool_id uuid,
    final_exam_version_id uuid,
    source_assessment_id uuid
);

CREATE TABLE public.quiz_reward_high_water_marks (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    competition_month_id uuid NOT NULL,
    learning_cycle_id uuid NOT NULL,
    reward_question_count integer NOT NULL,
    reward_config jsonb NOT NULL,
    maximum_stars integer DEFAULT 0 NOT NULL,
    CONSTRAINT quiz_reward_bounds CHECK (((maximum_stars >= 0) AND (maximum_stars <= reward_question_count) AND (reward_question_count > 0)))
);

CREATE TABLE public.refresh_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.sessions (
    id uuid NOT NULL,
    course_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    sort_order integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

CREATE TABLE public.star_ledger (
    competition_month_id uuid,
    learning_cycle_id uuid,
    chapter_at_award_id uuid,
    provenance character varying(30) DEFAULT 'LEGACY'::character varying NOT NULL,
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    reason public.star_reason NOT NULL,
    reward_key character varying(255) NOT NULL,
    source_type character varying(100) NOT NULL,
    source_id uuid NOT NULL,
    metadata jsonb,
    awarded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.supplemental_learning_requirements (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    learning_cycle_id uuid NOT NULL,
    requirement_version_id uuid NOT NULL,
    lesson_ids uuid[],
    added_days integer NOT NULL,
    due_at timestamp(3) with time zone NOT NULL,
    completed_at timestamp(3) with time zone,
    violated_at timestamp(3) with time zone,
    ended_at timestamp(3) with time zone
);

CREATE TABLE public.transfer_seasons (
    id uuid NOT NULL,
    code character varying(100) NOT NULL,
    starts_at timestamp(3) with time zone NOT NULL,
    ends_at timestamp(3) with time zone NOT NULL,
    reward_boundary_at timestamp(3) with time zone,
    CONSTRAINT reward_boundary_is_vietnam_half_year CHECK (((reward_boundary_at IS NULL) OR ((EXTRACT(month FROM (reward_boundary_at AT TIME ZONE 'Asia/Ho_Chi_Minh'::text)) = ANY (ARRAY[(4)::numeric, (10)::numeric])) AND (EXTRACT(day FROM (reward_boundary_at AT TIME ZONE 'Asia/Ho_Chi_Minh'::text)) = (1)::numeric) AND (((reward_boundary_at AT TIME ZONE 'Asia/Ho_Chi_Minh'::text))::time without time zone = '00:00:00'::time without time zone) AND (starts_at <= reward_boundary_at) AND (reward_boundary_at < ends_at))))
);

CREATE TABLE public.user_learning_assignments (
    learning_cycle_id uuid,
    requirement_version integer DEFAULT 1 NOT NULL,
    source_rule_ids uuid[] DEFAULT ARRAY[]::uuid[],
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    rule_id uuid,
    mandatory boolean DEFAULT true NOT NULL,
    can_view boolean DEFAULT true NOT NULL,
    can_assess boolean DEFAULT true NOT NULL,
    can_earn_stars boolean DEFAULT true NOT NULL,
    due_at timestamp without time zone,
    status public.learning_assignment_status DEFAULT 'ASSIGNED'::public.learning_assignment_status NOT NULL,
    assigned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ended_at timestamp without time zone,
    completed_at timestamp without time zone
);

CREATE TABLE public.users (
    anonymized_at timestamp(3) with time zone,
    id uuid NOT NULL,
    email character varying(255) NOT NULL,
    display_name character varying(120),
    password_hash character varying(255) NOT NULL,
    role public.user_role NOT NULL,
    status public.user_status DEFAULT 'ACTIVE'::public.user_status NOT NULL,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    auth_version integer DEFAULT 1 NOT NULL,
    deactivated_by_user_id uuid,
    deactivated_by_role character varying(50),
    deactivated_at timestamp without time zone,
    deactivated_reason text,
    cascade_lead_id uuid,
    lock_reason character varying(50)
);

CREATE TABLE public.videos (
    id uuid NOT NULL,
    lesson_id uuid NOT NULL,
    provider public.video_provider DEFAULT 'YOUTUBE'::public.video_provider NOT NULL,
    youtube_video_id character varying(255) NOT NULL,
    duration_seconds integer NOT NULL,
    title character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone NOT NULL
);

ALTER TABLE ONLY public.access_restrictions
    ADD CONSTRAINT access_restrictions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_state_intervals
    ADD CONSTRAINT account_state_intervals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attempt_answers
    ADD CONSTRAINT attempt_answers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attempt_questions
    ADD CONSTRAINT attempt_questions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chapter_affiliation_intervals
    ADD CONSTRAINT chapter_affiliation_intervals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chapter_competition_terms
    ADD CONSTRAINT chapter_competition_terms_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chapter_lead_bindings
    ADD CONSTRAINT chapter_lead_bindings_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.chapter_members
    ADD CONSTRAINT chapter_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chapter_monthly_kpis
    ADD CONSTRAINT chapter_monthly_kpis_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chapter_reorganization_items
    ADD CONSTRAINT chapter_reorganization_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chapter_reorganizations
    ADD CONSTRAINT chapter_reorganizations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT chapters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.competition_months
    ADD CONSTRAINT competition_months_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_drafts
    ADD CONSTRAINT course_drafts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_publication_events
    ADD CONSTRAINT course_publication_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.course_requirement_versions
    ADD CONSTRAINT course_requirement_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.cycle_lesson_progress
    ADD CONSTRAINT cycle_lesson_progress_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.final_exam_versions
    ADD CONSTRAINT final_exam_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_cycles
    ADD CONSTRAINT learning_cycles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_notices
    ADD CONSTRAINT learning_notices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_outbox
    ADD CONSTRAINT learning_outbox_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_path_changes
    ADD CONSTRAINT learning_path_changes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_paths
    ADD CONSTRAINT learning_paths_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_policy
    ADD CONSTRAINT learning_policy_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_programs
    ADD CONSTRAINT learning_programs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_rules
    ADD CONSTRAINT learning_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_snapshots
    ADD CONSTRAINT learning_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.learning_targets
    ADD CONSTRAINT learning_targets_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.lesson_comments
    ADD CONSTRAINT lesson_comments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.monthly_video_replays
    ADD CONSTRAINT monthly_video_replays_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.organization_units
    ADD CONSTRAINT organization_units_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.position_assignments
    ADD CONSTRAINT position_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.position_permissions
    ADD CONSTRAINT position_permissions_pkey PRIMARY KEY (position_id, permission_id);

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.question_options
    ADD CONSTRAINT question_options_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.question_pools
    ADD CONSTRAINT question_pools_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.quiz_reward_high_water_marks
    ADD CONSTRAINT quiz_reward_high_water_marks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.star_ledger
    ADD CONSTRAINT star_ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.supplemental_learning_requirements
    ADD CONSTRAINT supplemental_learning_requirements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transfer_seasons
    ADD CONSTRAINT transfer_seasons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_learning_assignments
    ADD CONSTRAINT user_learning_assignments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.videos
    ADD CONSTRAINT videos_pkey PRIMARY KEY (id);

CREATE INDEX access_restrictions_organization_unit_id_lifted_at_idx ON public.access_restrictions USING btree (organization_unit_id, lifted_at);

CREATE INDEX access_restrictions_type_created_at_idx ON public.access_restrictions USING btree (type, created_at);

CREATE INDEX access_restrictions_user_id_lifted_at_idx ON public.access_restrictions USING btree (user_id, lifted_at);

CREATE INDEX account_state_intervals_user_id_starts_at_ends_at_idx ON public.account_state_intervals USING btree (user_id, starts_at, ends_at);

CREATE UNIQUE INDEX account_state_one_open ON public.account_state_intervals USING btree (user_id) WHERE (ends_at IS NULL);

CREATE INDEX assessments_course_id_idx ON public.assessments USING btree (course_id);

CREATE UNIQUE INDEX assessments_course_id_key ON public.assessments USING btree (course_id);

CREATE UNIQUE INDEX assessments_lesson_id_key ON public.assessments USING btree (lesson_id);

CREATE INDEX attempt_answers_attempt_id_idx ON public.attempt_answers USING btree (attempt_id);

CREATE INDEX attempt_answers_attempt_id_question_id_idx ON public.attempt_answers USING btree (attempt_id, question_id);

CREATE UNIQUE INDEX attempt_answers_attempt_id_question_id_key ON public.attempt_answers USING btree (attempt_id, question_id);

CREATE INDEX attempt_answers_attempt_idx ON public.attempt_answers USING btree (attempt_id);

CREATE INDEX attempt_answers_attempt_question_idx ON public.attempt_answers USING btree (attempt_id, question_id);

CREATE INDEX attempt_answers_question_id_idx ON public.attempt_answers USING btree (question_id);

CREATE INDEX attempt_answers_question_idx ON public.attempt_answers USING btree (question_id);

CREATE INDEX attempt_questions_attempt_display_idx ON public.attempt_questions USING btree (attempt_id, display_order);

CREATE INDEX attempt_questions_attempt_id_display_order_idx ON public.attempt_questions USING btree (attempt_id, display_order);

CREATE INDEX attempt_questions_attempt_id_question_id_idx ON public.attempt_questions USING btree (attempt_id, question_id);

CREATE UNIQUE INDEX attempt_questions_attempt_id_question_id_key ON public.attempt_questions USING btree (attempt_id, question_id);

CREATE INDEX attempt_questions_attempt_question_idx ON public.attempt_questions USING btree (attempt_id, question_id);

CREATE INDEX attempts_assessment_id_user_id_created_at_idx ON public.attempts USING btree (assessment_id, user_id, created_at);

CREATE INDEX attempts_assessment_user_created_idx ON public.attempts USING btree (assessment_id, user_id, created_at);

CREATE INDEX attempts_final_exam_version_id_idx ON public.attempts USING btree (final_exam_version_id);

CREATE INDEX attempts_status_idx ON public.attempts USING btree (status);

CREATE INDEX attempts_user_assessment_idx ON public.attempts USING btree (user_id, assessment_id);

CREATE INDEX attempts_user_id_assessment_id_idx ON public.attempts USING btree (user_id, assessment_id);

CREATE INDEX attempts_user_id_status_assessment_id_submitted_at_idx ON public.attempts USING btree (user_id, status, assessment_id, submitted_at);

CREATE INDEX audit_logs_action_idx ON public.audit_logs USING btree (action);

CREATE INDEX audit_logs_actor_idx ON public.audit_logs USING btree (actor_user_id);

CREATE INDEX audit_logs_actor_user_id_idx ON public.audit_logs USING btree (actor_user_id);

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at);

CREATE INDEX audit_logs_created_idx ON public.audit_logs USING btree (created_at);

CREATE INDEX audit_logs_entity_idx ON public.audit_logs USING btree (entity_type, entity_id);

CREATE INDEX audit_logs_entity_type_entity_id_idx ON public.audit_logs USING btree (entity_type, entity_id);

CREATE INDEX chapter_affiliation_intervals_chapter_id_starts_at_ends_at_idx ON public.chapter_affiliation_intervals USING btree (chapter_id, starts_at, ends_at);

CREATE UNIQUE INDEX chapter_affiliation_one_open ON public.chapter_affiliation_intervals USING btree (user_id) WHERE (ends_at IS NULL);

CREATE UNIQUE INDEX chapter_competition_terms_chapter_id_season_id_key ON public.chapter_competition_terms USING btree (chapter_id, season_id);

CREATE INDEX chapter_competition_terms_chapter_id_starts_at_ends_at_idx ON public.chapter_competition_terms USING btree (chapter_id, starts_at, ends_at);

CREATE INDEX chapter_lead_bindings_chapter_id_idx ON public.chapter_lead_bindings USING btree (chapter_id);

CREATE INDEX chapter_members_chapter_id_user_id_idx ON public.chapter_members USING btree (chapter_id, user_id);

CREATE UNIQUE INDEX chapter_members_chapter_id_user_id_key ON public.chapter_members USING btree (chapter_id, user_id);

CREATE INDEX chapter_members_chapter_user_idx ON public.chapter_members USING btree (chapter_id, user_id);

CREATE UNIQUE INDEX chapter_members_user_id_key ON public.chapter_members USING btree (user_id);

CREATE UNIQUE INDEX chapter_monthly_kpis_chapter_id_month_start_key ON public.chapter_monthly_kpis USING btree (chapter_id, month_start);

CREATE INDEX chapter_monthly_kpis_month_start_status_idx ON public.chapter_monthly_kpis USING btree (month_start, status);

CREATE INDEX chapter_reorganization_items_reorganization_id_idx ON public.chapter_reorganization_items USING btree (reorganization_id);

CREATE UNIQUE INDEX chapter_reorganization_items_reorganization_id_user_id_key ON public.chapter_reorganization_items USING btree (reorganization_id, user_id);

CREATE INDEX chapter_reorganizations_chapter_id_status_effective_at_idx ON public.chapter_reorganizations USING btree (chapter_id, status, effective_at);

CREATE UNIQUE INDEX chapter_terms_one_open ON public.chapter_competition_terms USING btree (chapter_id) WHERE (ends_at IS NULL);

CREATE UNIQUE INDEX chapter_transfers_one_applied_season ON public.chapter_reorganizations USING btree (chapter_id, transfer_season_id) WHERE ((status = 'APPLIED'::public.chapter_reorganization_status) AND (transfer_season_id IS NOT NULL));

CREATE INDEX chapters_name_idx ON public.chapters USING btree (name);

CREATE UNIQUE INDEX chapters_name_key ON public.chapters USING btree (name);

CREATE UNIQUE INDEX chapters_organization_unit_id_key ON public.chapters USING btree (organization_unit_id);

CREATE INDEX chapters_status_idx ON public.chapters USING btree (status);

CREATE UNIQUE INDEX competition_months_key_key ON public.competition_months USING btree (key);

CREATE UNIQUE INDEX course_drafts_course_id_key ON public.course_drafts USING btree (course_id);

CREATE INDEX course_publication_events_course_id_effective_at_idx ON public.course_publication_events USING btree (course_id, effective_at);

CREATE UNIQUE INDEX course_requirement_versions_course_id_version_key ON public.course_requirement_versions USING btree (course_id, version);

CREATE INDEX courses_created_by_idx ON public.courses USING btree (created_by);

CREATE INDEX courses_status_visibility_idx ON public.courses USING btree (status, visibility);

CREATE UNIQUE INDEX cycle_lesson_progress_user_id_lesson_id_learning_cycle_id_key ON public.cycle_lesson_progress USING btree (user_id, lesson_id, learning_cycle_id);

CREATE INDEX documents_lesson_id_idx ON public.documents USING btree (lesson_id);

CREATE INDEX documents_lesson_idx ON public.documents USING btree (lesson_id);

CREATE INDEX final_exam_versions_assessment_id_is_active_idx ON public.final_exam_versions USING btree (assessment_id, is_active);

CREATE UNIQUE INDEX final_exam_versions_assessment_id_version_number_key ON public.final_exam_versions USING btree (assessment_id, version_number);

CREATE UNIQUE INDEX final_exam_versions_one_active_per_assessment ON public.final_exam_versions USING btree (assessment_id) WHERE is_active;

CREATE INDEX invitations_email_idx ON public.invitations USING btree (email);

CREATE INDEX invitations_email_status_idx ON public.invitations USING btree (email, status);

CREATE INDEX invitations_expires_at_idx ON public.invitations USING btree (expires_at);

CREATE INDEX invitations_organization_unit_id_status_idx ON public.invitations USING btree (organization_unit_id, status);

CREATE INDEX invitations_status_idx ON public.invitations USING btree (status);

CREATE INDEX invitations_token_hash_idx ON public.invitations USING btree (token_hash);

CREATE UNIQUE INDEX invitations_token_hash_key ON public.invitations USING btree (token_hash);

CREATE UNIQUE INDEX learning_cycles_one_open_user ON public.learning_cycles USING btree (user_id) WHERE (ends_at IS NULL);

CREATE UNIQUE INDEX learning_cycles_trigger_key_key ON public.learning_cycles USING btree (trigger_key);

CREATE INDEX learning_cycles_user_id_ends_at_idx ON public.learning_cycles USING btree (user_id, ends_at);

CREATE UNIQUE INDEX learning_notices_event_key_key ON public.learning_notices USING btree (event_key);

CREATE INDEX learning_notices_user_id_read_at_idx ON public.learning_notices USING btree (user_id, read_at);

CREATE UNIQUE INDEX learning_outbox_event_key_key ON public.learning_outbox USING btree (event_key);

CREATE INDEX learning_outbox_processed_at_available_at_idx ON public.learning_outbox USING btree (processed_at, available_at);

CREATE INDEX learning_path_changes_path_id_changed_at_idx ON public.learning_path_changes USING btree (path_id, changed_at);

CREATE UNIQUE INDEX learning_paths_learning_cycle_id_key ON public.learning_paths USING btree (learning_cycle_id);

CREATE UNIQUE INDEX learning_programs_code_key ON public.learning_programs USING btree (code);

CREATE UNIQUE INDEX learning_rules_active_scope_key ON public.learning_rules USING btree (course_id, COALESCE(organization_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(position_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (effective_until IS NULL);

CREATE INDEX learning_rules_course_id_effective_from_effective_until_idx ON public.learning_rules USING btree (course_id, effective_from, effective_until);

CREATE INDEX learning_rules_course_id_organization_unit_id_position_id_e_idx ON public.learning_rules USING btree (course_id, organization_unit_id, position_id, effective_until);

CREATE INDEX learning_rules_course_id_organization_unit_id_position_id_effec ON public.learning_rules USING btree (course_id, organization_unit_id, position_id, effective_until);

CREATE INDEX learning_rules_organization_unit_id_position_id_idx ON public.learning_rules USING btree (organization_unit_id, position_id);

CREATE UNIQUE INDEX learning_snapshots_key_key ON public.learning_snapshots USING btree (key);

CREATE INDEX lesson_comments_lesson_id_created_at_idx ON public.lesson_comments USING btree (lesson_id, created_at);

CREATE INDEX lesson_comments_parent_id_idx ON public.lesson_comments USING btree (parent_id);

CREATE INDEX lesson_progress_lesson_id_idx ON public.lesson_progress USING btree (lesson_id);

CREATE INDEX lesson_progress_lesson_idx ON public.lesson_progress USING btree (lesson_id);

CREATE INDEX lesson_progress_user_id_completed_lesson_id_idx ON public.lesson_progress USING btree (user_id, completed, lesson_id);

CREATE INDEX lesson_progress_user_id_idx ON public.lesson_progress USING btree (user_id);

CREATE INDEX lesson_progress_user_id_lesson_id_idx ON public.lesson_progress USING btree (user_id, lesson_id);

CREATE UNIQUE INDEX lesson_progress_user_id_lesson_id_key ON public.lesson_progress USING btree (user_id, lesson_id);

CREATE INDEX lesson_progress_user_idx ON public.lesson_progress USING btree (user_id);

CREATE INDEX lesson_progress_user_lesson_idx ON public.lesson_progress USING btree (user_id, lesson_id);

CREATE INDEX lessons_session_id_sort_order_idx ON public.lessons USING btree (session_id, sort_order);

CREATE INDEX lessons_session_sort_idx ON public.lessons USING btree (session_id, sort_order);

CREATE UNIQUE INDEX monthly_video_replays_user_id_video_id_competition_month_id_key ON public.monthly_video_replays USING btree (user_id, video_id, competition_month_id, learning_cycle_id);

CREATE INDEX organization_memberships_unit_id_status_idx ON public.organization_memberships USING btree (unit_id, status);

CREATE INDEX organization_memberships_unit_id_status_starts_at_ends_at_idx ON public.organization_memberships USING btree (unit_id, status, starts_at, ends_at);

CREATE INDEX organization_memberships_user_id_status_idx ON public.organization_memberships USING btree (user_id, status);

CREATE INDEX organization_memberships_user_id_status_starts_at_ends_at_idx ON public.organization_memberships USING btree (user_id, status, starts_at, ends_at);

CREATE INDEX organization_units_parent_id_idx ON public.organization_units USING btree (parent_id);

CREATE UNIQUE INDEX organization_units_parent_id_name_key ON public.organization_units USING btree (parent_id, name);

CREATE INDEX organization_units_type_status_idx ON public.organization_units USING btree (type, status);

CREATE INDEX password_reset_tokens_expires_at_idx ON public.password_reset_tokens USING btree (expires_at);

CREATE INDEX password_reset_tokens_expires_idx ON public.password_reset_tokens USING btree (expires_at);

CREATE INDEX password_reset_tokens_token_hash_idx ON public.password_reset_tokens USING btree (token_hash);

CREATE UNIQUE INDEX password_reset_tokens_token_hash_key ON public.password_reset_tokens USING btree (token_hash);

CREATE INDEX password_reset_tokens_user_id_idx ON public.password_reset_tokens USING btree (user_id);

CREATE INDEX password_reset_tokens_user_idx ON public.password_reset_tokens USING btree (user_id);

CREATE UNIQUE INDEX permissions_code_key ON public.permissions USING btree (code);

CREATE INDEX position_assignments_unit_id_position_id_starts_at_ends_at_idx ON public.position_assignments USING btree (unit_id, position_id, starts_at, ends_at);

CREATE INDEX position_assignments_user_id_starts_at_ends_at_idx ON public.position_assignments USING btree (user_id, starts_at, ends_at);

CREATE UNIQUE INDEX positions_code_key ON public.positions USING btree (code);

CREATE INDEX question_options_question_id_idx ON public.question_options USING btree (question_id);

CREATE INDEX question_options_question_id_sort_order_idx ON public.question_options USING btree (question_id, sort_order);

CREATE INDEX question_options_question_idx ON public.question_options USING btree (question_id);

CREATE INDEX question_options_question_sort_idx ON public.question_options USING btree (question_id, sort_order);

CREATE INDEX question_pools_assessment_id_idx ON public.question_pools USING btree (assessment_id);

CREATE UNIQUE INDEX question_pools_assessment_id_sort_order_key ON public.question_pools USING btree (assessment_id, sort_order);

CREATE INDEX questions_assessment_id_sort_order_idx ON public.questions USING btree (assessment_id, sort_order);

CREATE INDEX questions_assessment_sort_idx ON public.questions USING btree (assessment_id, sort_order);

CREATE INDEX questions_final_exam_version_id_idx ON public.questions USING btree (final_exam_version_id);

CREATE INDEX questions_pool_id_idx ON public.questions USING btree (pool_id);

CREATE UNIQUE INDEX quiz_reward_high_water_marks_user_id_assessment_id_competit_key ON public.quiz_reward_high_water_marks USING btree (user_id, assessment_id, competition_month_id, learning_cycle_id);

CREATE INDEX refresh_tokens_expires_at_idx ON public.refresh_tokens USING btree (expires_at);

CREATE INDEX refresh_tokens_expires_idx ON public.refresh_tokens USING btree (expires_at);

CREATE INDEX refresh_tokens_revoked_at_idx ON public.refresh_tokens USING btree (revoked_at);

CREATE INDEX refresh_tokens_revoked_idx ON public.refresh_tokens USING btree (revoked_at);

CREATE INDEX refresh_tokens_token_hash_idx ON public.refresh_tokens USING btree (token_hash);

CREATE UNIQUE INDEX refresh_tokens_token_hash_key ON public.refresh_tokens USING btree (token_hash);

CREATE INDEX refresh_tokens_user_id_idx ON public.refresh_tokens USING btree (user_id);

CREATE INDEX refresh_tokens_user_idx ON public.refresh_tokens USING btree (user_id);

CREATE INDEX sessions_course_id_sort_order_idx ON public.sessions USING btree (course_id, sort_order);

CREATE INDEX sessions_course_sort_idx ON public.sessions USING btree (course_id, sort_order);

CREATE INDEX star_ledger_competition_month_id_chapter_at_award_id_idx ON public.star_ledger USING btree (competition_month_id, chapter_at_award_id);

CREATE INDEX star_ledger_learning_cycle_id_user_id_idx ON public.star_ledger USING btree (learning_cycle_id, user_id);

CREATE UNIQUE INDEX star_ledger_reward_key_key ON public.star_ledger USING btree (reward_key);

CREATE INDEX star_ledger_source_type_source_id_idx ON public.star_ledger USING btree (source_type, source_id);

CREATE INDEX star_ledger_user_id_awarded_at_idx ON public.star_ledger USING btree (user_id, awarded_at);

CREATE INDEX supplemental_learning_requirements_completed_at_due_at_idx ON public.supplemental_learning_requirements USING btree (completed_at, due_at);

CREATE UNIQUE INDEX supplemental_learning_requirements_user_id_learning_cycle_i_key ON public.supplemental_learning_requirements USING btree (user_id, learning_cycle_id, requirement_version_id);

CREATE UNIQUE INDEX transfer_seasons_code_key ON public.transfer_seasons USING btree (code);

CREATE UNIQUE INDEX transfer_seasons_reward_boundary_at_key ON public.transfer_seasons USING btree (reward_boundary_at);

CREATE UNIQUE INDEX user_learning_assignments_active_rule_key ON public.user_learning_assignments USING btree (user_id, rule_id) WHERE ((ended_at IS NULL) AND (rule_id IS NOT NULL));

CREATE INDEX user_learning_assignments_course_id_status_idx ON public.user_learning_assignments USING btree (course_id, status);

CREATE INDEX user_learning_assignments_rule_id_idx ON public.user_learning_assignments USING btree (rule_id);

CREATE INDEX user_learning_assignments_rule_id_status_idx ON public.user_learning_assignments USING btree (rule_id, status);

CREATE UNIQUE INDEX user_learning_assignments_user_id_course_id_learning_cycle__key ON public.user_learning_assignments USING btree (user_id, course_id, learning_cycle_id);

CREATE INDEX user_learning_assignments_user_id_status_due_at_idx ON public.user_learning_assignments USING btree (user_id, status, due_at);

CREATE INDEX users_cascade_lead_id_idx ON public.users USING btree (cascade_lead_id);

CREATE INDEX users_deactivated_by_user_id_idx ON public.users USING btree (deactivated_by_user_id);

CREATE INDEX users_email_idx ON public.users USING btree (email);

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);

CREATE UNIQUE INDEX users_email_normalized_key ON public.users USING btree (lower(btrim((email)::text)));

CREATE INDEX users_role_idx ON public.users USING btree (role);

CREATE INDEX users_status_idx ON public.users USING btree (status);

CREATE INDEX videos_lesson_id_idx ON public.videos USING btree (lesson_id);

CREATE UNIQUE INDEX videos_lesson_id_key ON public.videos USING btree (lesson_id);

CREATE INDEX videos_provider_youtube_idx ON public.videos USING btree (provider, youtube_video_id);

CREATE INDEX videos_provider_youtube_video_id_idx ON public.videos USING btree (provider, youtube_video_id);

CREATE CONSTRAINT TRIGGER chapter_membership_integrity AFTER INSERT OR DELETE OR UPDATE ON public.chapter_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_integrity();

CREATE TRIGGER immutable_lead_binding BEFORE DELETE OR UPDATE ON public.chapter_lead_bindings FOR EACH ROW EXECUTE FUNCTION public.immutable_chapter_lead_binding();

CREATE TRIGGER learning_account_state AFTER INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.record_learning_account_state();

CREATE TRIGGER learning_chapter_affiliation AFTER INSERT OR DELETE OR UPDATE ON public.chapter_members FOR EACH ROW EXECUTE FUNCTION public.record_learning_chapter_affiliation();

CREATE TRIGGER learning_course_publication AFTER INSERT OR UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.record_learning_course_publication();

CREATE TRIGGER no_member_lead_promotion BEFORE UPDATE OF role ON public.users FOR EACH ROW EXECUTE FUNCTION public.prevent_member_lead_promotion();

CREATE TRIGGER organization_email BEFORE INSERT OR UPDATE OF email ON public.users FOR EACH ROW EXECUTE FUNCTION public.normalize_organization_email();

CREATE CONSTRAINT TRIGGER organization_membership_integrity AFTER INSERT OR DELETE OR UPDATE ON public.organization_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_integrity();

CREATE CONSTRAINT TRIGGER organization_position_definition_integrity AFTER UPDATE OF code, scope ON public.positions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_definition_integrity();

CREATE CONSTRAINT TRIGGER organization_unit_definition_integrity AFTER UPDATE OF type ON public.organization_units DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_definition_integrity();

CREATE CONSTRAINT TRIGGER organization_user_role_integrity AFTER INSERT OR UPDATE OF role ON public.users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_integrity();

CREATE CONSTRAINT TRIGGER position_assignment_integrity AFTER INSERT OR DELETE OR UPDATE ON public.position_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_integrity();

CREATE TRIGGER serialize_chapter_membership BEFORE INSERT OR DELETE OR UPDATE ON public.chapter_members FOR EACH ROW EXECUTE FUNCTION public.serialize_organization_writer();

CREATE TRIGGER serialize_organization_membership BEFORE INSERT OR DELETE OR UPDATE ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.serialize_organization_writer();

CREATE TRIGGER serialize_position_assignment BEFORE INSERT OR DELETE OR UPDATE ON public.position_assignments FOR EACH ROW EXECUTE FUNCTION public.serialize_organization_writer();

CREATE CONSTRAINT TRIGGER single_affiliation_chapter AFTER INSERT OR UPDATE ON public.chapter_members DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_single_learning_affiliation();

CREATE CONSTRAINT TRIGGER single_affiliation_membership AFTER INSERT OR UPDATE ON public.organization_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_single_learning_affiliation();

ALTER TABLE ONLY public.access_restrictions
    ADD CONSTRAINT access_restrictions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.access_restrictions
    ADD CONSTRAINT access_restrictions_lifted_by_user_id_fkey FOREIGN KEY (lifted_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.access_restrictions
    ADD CONSTRAINT access_restrictions_organization_unit_id_fkey FOREIGN KEY (organization_unit_id) REFERENCES public.organization_units(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.access_restrictions
    ADD CONSTRAINT access_restrictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_learning_assignments
    ADD CONSTRAINT assignment_cycle_fk FOREIGN KEY (learning_cycle_id) REFERENCES public.learning_cycles(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.attempt_answers
    ADD CONSTRAINT attempt_answers_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.attempts(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.attempt_answers
    ADD CONSTRAINT attempt_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.attempt_answers
    ADD CONSTRAINT attempt_answers_selected_option_id_fkey FOREIGN KEY (selected_option_id) REFERENCES public.question_options(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempt_cycle_fk FOREIGN KEY (learning_cycle_id) REFERENCES public.learning_cycles(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.attempt_questions
    ADD CONSTRAINT attempt_questions_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.attempts(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.attempt_questions
    ADD CONSTRAINT attempt_questions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_final_exam_version_id_fkey FOREIGN KEY (final_exam_version_id) REFERENCES public.final_exam_versions(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.attempts
    ADD CONSTRAINT attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.chapter_lead_bindings
    ADD CONSTRAINT chapter_lead_bindings_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.chapter_lead_bindings
    ADD CONSTRAINT chapter_lead_bindings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.chapter_members
    ADD CONSTRAINT chapter_members_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.chapter_members
    ADD CONSTRAINT chapter_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.chapter_monthly_kpis
    ADD CONSTRAINT chapter_monthly_kpis_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.chapter_monthly_kpis
    ADD CONSTRAINT chapter_monthly_kpis_configured_by_user_id_fkey FOREIGN KEY (configured_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.chapter_reorganization_items
    ADD CONSTRAINT chapter_reorganization_items_reorganization_id_fkey FOREIGN KEY (reorganization_id) REFERENCES public.chapter_reorganizations(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.chapters
    ADD CONSTRAINT chapters_organization_unit_id_fkey FOREIGN KEY (organization_unit_id) REFERENCES public.organization_units(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.course_drafts
    ADD CONSTRAINT course_drafts_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.course_drafts
    ADD CONSTRAINT course_drafts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.learning_programs(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.final_exam_versions
    ADD CONSTRAINT final_exam_versions_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_organization_unit_id_fkey FOREIGN KEY (organization_unit_id) REFERENCES public.organization_units(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_rules
    ADD CONSTRAINT learning_rules_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_rules
    ADD CONSTRAINT learning_rules_organization_unit_id_fkey FOREIGN KEY (organization_unit_id) REFERENCES public.organization_units(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_rules
    ADD CONSTRAINT learning_rules_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_comments
    ADD CONSTRAINT lesson_comments_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_comments
    ADD CONSTRAINT lesson_comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.lesson_comments(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_comments
    ADD CONSTRAINT lesson_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_progress
    ADD CONSTRAINT lesson_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.quiz_reward_high_water_marks
    ADD CONSTRAINT mark_cycle_fk FOREIGN KEY (learning_cycle_id) REFERENCES public.learning_cycles(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.quiz_reward_high_water_marks
    ADD CONSTRAINT mark_month_fk FOREIGN KEY (competition_month_id) REFERENCES public.competition_months(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.organization_units(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.organization_memberships
    ADD CONSTRAINT organization_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.organization_units
    ADD CONSTRAINT organization_units_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.organization_units(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.learning_paths
    ADD CONSTRAINT path_cycle_fk FOREIGN KEY (learning_cycle_id) REFERENCES public.learning_cycles(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.position_assignments
    ADD CONSTRAINT position_assignments_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.position_assignments
    ADD CONSTRAINT position_assignments_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.organization_units(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.position_assignments
    ADD CONSTRAINT position_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.position_permissions
    ADD CONSTRAINT position_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.position_permissions
    ADD CONSTRAINT position_permissions_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.cycle_lesson_progress
    ADD CONSTRAINT progress_cycle_fk FOREIGN KEY (learning_cycle_id) REFERENCES public.learning_cycles(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.question_options
    ADD CONSTRAINT question_options_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.question_pools
    ADD CONSTRAINT question_pools_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_final_exam_version_id_fkey FOREIGN KEY (final_exam_version_id) REFERENCES public.final_exam_versions(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pool_id_fkey FOREIGN KEY (pool_id) REFERENCES public.question_pools(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.monthly_video_replays
    ADD CONSTRAINT replay_cycle_fk FOREIGN KEY (learning_cycle_id) REFERENCES public.learning_cycles(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.monthly_video_replays
    ADD CONSTRAINT replay_month_fk FOREIGN KEY (competition_month_id) REFERENCES public.competition_months(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.star_ledger
    ADD CONSTRAINT star_cycle_fk FOREIGN KEY (learning_cycle_id) REFERENCES public.learning_cycles(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.star_ledger
    ADD CONSTRAINT star_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.star_ledger
    ADD CONSTRAINT star_month_fk FOREIGN KEY (competition_month_id) REFERENCES public.competition_months(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.user_learning_assignments
    ADD CONSTRAINT user_learning_assignments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.user_learning_assignments
    ADD CONSTRAINT user_learning_assignments_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.learning_rules(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY public.user_learning_assignments
    ADD CONSTRAINT user_learning_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.videos
    ADD CONSTRAINT videos_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lessons(id) ON UPDATE CASCADE ON DELETE CASCADE;
