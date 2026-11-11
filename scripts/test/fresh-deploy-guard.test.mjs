import test from "node:test";
import assert from "node:assert/strict";
import { validateFreshDeployTarget } from "./test-fresh-deploy.mjs";
import * as cut from "../db/cut-baseline.mjs";

test("fresh-deploy accepts only loopback bbe_test_* databases", () => {
  assert.deepEqual(validateFreshDeployTarget("postgresql://u:p@127.0.0.1:5432/bbe_test_fresh_deploy"), { databaseName: "bbe_test_fresh_deploy" });
  assert.deepEqual(validateFreshDeployTarget("postgres://u:p@localhost/bbe_test_x?schema=public"), { databaseName: "bbe_test_x" });
  for (const target of [
    undefined,
    "not a url",
    "mysql://u:p@127.0.0.1/bbe_test_x",
    "postgresql://u:p@db.example.com/bbe_test_x",
    "postgresql://u:p@10.0.0.5/bbe_test_x",
    "postgresql://u:p@127.0.0.1/postgres",
    "postgresql://u:p@127.0.0.1/bbe_production",
    "postgresql://u:p@127.0.0.1/bbe_test_X",
    "postgresql://u:p@127.0.0.1/bbe_test_x?schema=other",
    "postgresql://u:p@127.0.0.1/bbe_test_x?host=db.example.com",
  ]) assert.throws(() => validateFreshDeployTarget(target), undefined, String(target));
});

test("fresh-deploy guard errors never echo credentials", () => {
  try { validateFreshDeployTarget("postgresql://user:s3cret@db.example.com/bbe_test_x"); }
  catch (error) { assert.ok(!error.message.includes("s3cret")); return; }
  assert.fail("expected rejection");
});

test("cut-baseline rejects query overrides, invalid protocols and credential-bearing malformed URLs", () => {
  for (const suffix of ["host=db.example.com", "hostaddr=10.0.0.5", "port=5433", "options=-csearch_path=other", "dbname=production", "user=other", "password=secret", "schema=public"]) {
    assert.throws(() => cut.validateCutTarget(`postgresql://u:p@127.0.0.1/bbe_test_x?${suffix}`));
  }
  for (const url of ["mysql://u:p@localhost/bbe_test_x", "postgresql://u:s3cret@/bbe_test_x", "postgresql://u:s3cret@db.example.com/bbe_test_x"]) {
    assert.throws(() => cut.validateCutTarget(url), (error) => !error.message.includes("s3cret"));
  }
  for (const url of [undefined, "not a url", "postgresql://localhost/postgres", "postgresql://localhost/bbe_test_X", "postgresql://u:%zz@localhost/bbe_test_x", "postgresql://localhost:0/bbe_test_x"]) assert.throws(() => cut.validateCutTarget(url));
  assert.deepEqual(cut.validateCutTarget("postgres://[::1]/bbe_test_x").connection, { host: "::1", port: 5432, database: "bbe_test_x", user: "postgres", password: "", ssl: false });
});

test("cut-baseline pins pg and client tools to the validated target without putting passwords in argv", () => {
  const target = cut.validateCutTarget("postgresql://a%40b:p%40ss@localhost:5544/bbe_test_x");
  assert.deepEqual(target.connection, { host: "127.0.0.1", port: 5544, database: "bbe_test_x", user: "a@b", password: "p@ss", ssl: false });
  for (const container of ["", "test-pg"]) {
    for (const tool of ["psql", "pg_dump"]) {
      const invocation = cut.pgToolInvocation(tool, target, ["--schema-only"], container, { PGHOSTADDR: "10.0.0.5", PGSERVICE: "production", PGOPTIONS: "unsafe", PATH: "bin" });
      for (const arg of ["--host=127.0.0.1", `--port=${container ? 5432 : 5544}`, "--dbname=bbe_test_x", "--username=a@b"]) assert.ok(invocation.args.includes(arg));
      assert.ok(!invocation.args.some((arg) => arg.includes("p@ss")));
      assert.equal(invocation.env.PGPASSWORD, "p@ss");
      assert.equal(invocation.env.PGHOSTADDR, undefined);
      if (container) assert.ok(!invocation.args.some((arg) => /^PG(HOSTADDR|SERVICE|SERVICEFILE|OPTIONS)/.test(arg)));
    }
  }
});

const nonceTarget = cut.validateCutTarget("postgresql://u:p@127.0.0.1:54329/bbe_test_x");
const expectedNonce = "cutbaseline:0123456789abcdef";

test("cut-baseline accepts matching database, user and nonce across remapped ports and addresses", () => {
  assert.doesNotThrow(() => cut.assertCutIdentity(nonceTarget, {
    database: "bbe_test_x", user: "u", nonce: expectedNonce, port: 5432, server: "::1",
  }, expectedNonce));
});

test("cut-baseline refuses a different nonce, database or user", () => {
  const identity = { database: "bbe_test_x", user: "u", nonce: expectedNonce, port: 54329, sameServer: true };
  for (const change of [{ nonce: "cutbaseline:other" }, { database: "bbe_test_other" }, { user: "other" }]) {
    assert.throws(() => cut.assertCutIdentity(nonceTarget, { ...identity, ...change }, expectedNonce));
  }
});

test("cut-baseline refuses an unreadable nonce or identity", () => {
  const checked = { database: "bbe_test_x", user: "u", port: 54329, sameServer: true };
  for (const identity of [undefined, null, "bad json", {}, checked,
    { ...checked, nonce: null }, { ...checked, nonce: "" }]) {
    assert.throws(() => cut.assertCutIdentity(nonceTarget, identity, expectedNonce));
  }
  assert.throws(() => cut.assertCutIdentity(nonceTarget, checked));
});

function nonceFixture(originalComment = "original owner's comment") {
  const restoreSql = originalComment === null ? "COMMENT ON DATABASE bbe_test_x IS NULL" : "COMMENT ON DATABASE bbe_test_x IS 'original owner''s comment'";
  const state = { comment: originalComment, probes: 0, writes: 0, restores: 0, nonces: [] };
  const client = { async query(sql, values) {
    if (sql.startsWith("SELECT")) {
      assert.deepEqual(values, ["bbe_test_x", "u"]);
      assert.ok(sql.includes("current_database()") && sql.includes("current_user"));
      return { rows: [{ restore_sql: restoreSql }] };
    }
    if (sql === restoreSql) { state.comment = originalComment; state.restores++; return { rows: [] }; }
    const match = sql.match(/^COMMENT ON DATABASE "bbe_test_x" IS '(cutbaseline:[a-f0-9]{64})'$/);
    assert.ok(match, "write a random nonce only to the checked database comment");
    state.comment = match[1];
    state.nonces.push(match[1]);
    return { rows: [] };
  } };
  const probe = (tool, checked, args, sql) => {
    assert.equal(tool, "psql");
    assert.equal(checked, nonceTarget);
    assert.ok(args.includes("ON_ERROR_STOP=1"));
    assert.ok(sql.includes("shobj_description") && sql.includes("current_database()"));
    assert.ok(!sql.includes(state.comment), "the tool must read the nonce, never echo it from its input");
    state.probes++;
    return { status: 0, stdout: JSON.stringify({ database: "bbe_test_x", user: "u", nonce: state.comment }) };
  };
  const write = async () => {
    assert.equal(state.probes, 1);
    assert.match(state.comment, /^cutbaseline:[a-f0-9]{64}$/);
    state.writes++;
    return "written";
  };
  return { client, probe, state, write };
}

test("cut-baseline verifies a fresh nonce before writing and restores the previous comment afterward", async () => {
  for (const original of [null, "original owner's comment"]) {
    const { client, probe, state, write } = nonceFixture(original);
    assert.equal(await cut.verifyToolTarget(client, nonceTarget, probe, write), "written");
    assert.equal(state.writes, 1);
    assert.equal(state.comment, original);
    assert.equal(state.restores, 1);
    state.probes = 0;
    await cut.verifyToolTarget(client, nonceTarget, probe, write);
    assert.equal(new Set(state.nonces).size, 2);
  }
});

test("cut-baseline fails closed on unreadable or different tool nonces and always cleans up", async () => {
  for (const result of [
    { status: 1, stdout: "" }, { status: null, stdout: "" }, { status: 0, stdout: "" },
    { status: 0, stdout: "bad json" }, { status: 0, stdout: "null" },
    { status: 0, stdout: JSON.stringify({ database: "bbe_test_x", user: "u", nonce: "cutbaseline:other" }) },
    new Error("psql could not start"),
  ]) {
    const { client, state, write } = nonceFixture();
    await assert.rejects(() => cut.verifyToolTarget(client, nonceTarget, () => {
      if (result instanceof Error) throw result;
      return result;
    }, write));
    assert.equal(state.writes, 0);
    assert.equal(state.comment, "original owner's comment");
    assert.equal(state.restores, 1);
  }
});

test("cut-baseline restores the nonce comment when the subsequent write or dump fails", async () => {
  const { client, probe, state } = nonceFixture();
  await assert.rejects(() => cut.verifyToolTarget(client, nonceTarget, probe, async () => {
    throw new Error("dump failed");
  }), /dump failed/);
  assert.equal(state.comment, "original owner's comment");
  assert.equal(state.restores, 1);
});

test("cut-baseline does not write even a nonce if the URL database/user cannot be verified", async () => {
  for (const result of [{ rows: [] }, new Error("cannot read database comment")]) {
    let queries = 0;
    const client = { async query() {
      queries++;
      if (result instanceof Error) throw result;
      return result;
    } };
    await assert.rejects(() => cut.verifyToolTarget(client, nonceTarget, () => assert.fail("unexpected probe"),
      async () => assert.fail("unexpected write")));
    assert.equal(queries, 1);
  }
});

test("cut-baseline attempts nonce cleanup even if writing the nonce fails", async () => {
  const fixture = nonceFixture();
  const client = { async query(sql, values) {
    const result = await fixture.client.query(sql, values);
    if (sql.startsWith('COMMENT ON DATABASE "')) throw new Error("nonce write failed");
    return result;
  } };
  await assert.rejects(() => cut.verifyToolTarget(client, nonceTarget, () => assert.fail("unexpected probe"),
    fixture.write), /nonce write failed/);
  assert.equal(fixture.state.comment, "original owner's comment");
  assert.equal(fixture.state.restores, 1);
  assert.equal(fixture.state.writes, 0);
});

test("cut-baseline splits SQL without splitting function bodies, quoted strings or comments", () => {
  assert.deepEqual(cut.splitSqlStatements(`BEGIN;
    -- comment with ;
    CREATE FUNCTION f() RETURNS void AS $body$ BEGIN PERFORM ';'; END $body$ LANGUAGE plpgsql;
    /* outer ; /* nested ; */ */ SELECT 'it''s;ok', E'escaped\\\';ok', "semi;colon";
    COMMIT;`), [
    "CREATE FUNCTION f() RETURNS void AS $body$ BEGIN PERFORM ';'; END $body$ LANGUAGE plpgsql;",
    `SELECT 'it''s;ok', E'escaped\\\';ok', "semi;colon";`,
  ]);
  assert.throws(() => cut.splitSqlStatements("DO $$ BEGIN;"));
  assert.throws(() => cut.splitSqlStatements("SELECT 'unfinished"));
  assert.throws(() => cut.splitSqlStatements("/* unfinished"));
});

test("cut-baseline tolerates only expected duplicate DDL and named historical missing temp tables", () => {
  for (const [sql, code, message] of [
    ['CREATE TABLE "users" (id uuid);', "42P07", 'relation "users" already exists'],
    ['CREATE TYPE "user_role" AS ENUM (\'ADMIN\');', "42710", 'type "user_role" already exists'],
    ['CREATE UNIQUE INDEX users_idx ON users(id);', "42P07", 'relation "users_idx" already exists'],
    ['ALTER TABLE users ADD COLUMN email text;', "42701", 'column "email" already exists'],
  ]) assert.equal(cut.isToleratedReplayError("20250831_init", sql, { code, message }), true);
  const missing = { code: "42P01", message: 'relation "_final_question_map" does not exist' };
  assert.equal(cut.isToleratedReplayError("20261016_course_final_versions", 'INSERT INTO "_final_question_map" SELECT 1;', missing), true);
  assert.equal(cut.isToleratedReplayError("new_migration", 'INSERT INTO "_final_question_map" SELECT 1;', missing), false);
  assert.equal(cut.isToleratedReplayError("20261016_course_final_versions", "SELECT * FROM users;", { code: "42P01", message: 'relation "users" does not exist' }), false);
  const lockError = { code: "25P01", message: "LOCK TABLE can only be used in transaction blocks" };
  assert.equal(cut.isToleratedReplayError("20261025_organization_integrity", "LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;", lockError), true);
  assert.equal(cut.isToleratedReplayError("new_migration", "LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;", lockError), false);
});

test("cut-baseline never tolerates failed function, trigger, policy or ALTER TYPE, even with duplicate SQLSTATE", () => {
  for (const sql of ["CREATE FUNCTION f() RETURNS void LANGUAGE sql AS 'SELECT 1';", "CREATE OR REPLACE FUNCTION f() RETURNS void LANGUAGE sql AS 'SELECT 1';", "CREATE TRIGGER t BEFORE INSERT ON users EXECUTE FUNCTION f();", "CREATE CONSTRAINT TRIGGER t AFTER INSERT ON users EXECUTE FUNCTION f();", "CREATE POLICY p ON users USING (true);", "ALTER TYPE user_role RENAME VALUE 'CHAPTER_LEADER' TO 'LEAD';"]) {
    for (const code of ["42710", "42P07", "42701", "42P01", "22P02", "42601"]) assert.equal(cut.isToleratedReplayError("20250831_init", sql, { code, message: "already exists" }), false, sql);
  }
});

test("cut-baseline replay logs expected errors but stops immediately on unexpected SQL or connection failures", async () => {
  const statements = [];
  const log = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.startsWith("CREATE TABLE")) throw Object.assign(new Error('relation "users" already exists'), { code: "42P07" });
    if (sql.startsWith("CREATE FUNCTION")) throw Object.assign(new Error("syntax error"), { code: "42601" });
    return { rows: [] };
  } };
  await assert.rejects(() => cut.replayMigration(client, "init", "CREATE TABLE users(id uuid); CREATE FUNCTION broken(); SELECT 1;", log), /init.*42601/);
  assert.equal(statements.length, 2);
  assert.ok(log.some((line) => line.includes("42P07") && line.includes("tolerated")));
  assert.ok(log.some((line) => line.includes("42601") && line.includes("FATAL")));
  for (const error of [Object.assign(new Error("permission denied"), { code: "42501" }), new Error("connection lost")]) {
    await assert.rejects(() => cut.replayMigration({ async query() { throw error; } }, "init", "SELECT 1;", []));
  }
});

test("cut-baseline checks all important functions and enabled triggers before allowing snapshot", () => {
  assert.throws(() => cut.assertRequiredObjects({ functions: [], triggers: [] }), /assert_organization_integrity/);
  const functions = ["assert_organization_integrity(uuid)", "enforce_single_learning_affiliation()", "immutable_chapter_lead_binding()", "serialize_organization_writer()", "record_learning_account_state()", "record_learning_chapter_affiliation()", "record_learning_course_publication()", "normalize_organization_email()", "enforce_organization_integrity()", "enforce_organization_definition_integrity()", "prevent_member_lead_promotion()"];
  const bindings = [
    ["users", "learning_account_state", "record_learning_account_state"], ["chapter_members", "learning_chapter_affiliation", "record_learning_chapter_affiliation"], ["courses", "learning_course_publication", "record_learning_course_publication"],
    ["organization_memberships", "single_affiliation_membership", "enforce_single_learning_affiliation"], ["chapter_members", "single_affiliation_chapter", "enforce_single_learning_affiliation"],
    ["users", "organization_email", "normalize_organization_email"], ["chapter_lead_bindings", "immutable_lead_binding", "immutable_chapter_lead_binding"],
    ["organization_memberships", "serialize_organization_membership", "serialize_organization_writer"], ["chapter_members", "serialize_chapter_membership", "serialize_organization_writer"], ["position_assignments", "serialize_position_assignment", "serialize_organization_writer"],
    ["organization_memberships", "organization_membership_integrity", "enforce_organization_integrity"], ["chapter_members", "chapter_membership_integrity", "enforce_organization_integrity"], ["position_assignments", "position_assignment_integrity", "enforce_organization_integrity"], ["users", "organization_user_role_integrity", "enforce_organization_integrity"],
    ["organization_units", "organization_unit_definition_integrity", "enforce_organization_definition_integrity"], ["positions", "organization_position_definition_integrity", "enforce_organization_definition_integrity"], ["users", "no_member_lead_promotion", "prevent_member_lead_promotion"],
  ];
  const triggers = bindings.map(([table, name, fn]) => ({ table, name, function: fn, enabled: "O" }));
  assert.doesNotThrow(() => cut.assertRequiredObjects({ functions, triggers }));
  for (const signature of functions) assert.throws(() => cut.assertRequiredObjects({ functions: functions.filter((fn) => fn !== signature), triggers }));
  for (const trigger of triggers) {
    assert.throws(() => cut.assertRequiredObjects({ functions, triggers: triggers.filter((t) => t !== trigger) }));
    assert.throws(() => cut.assertRequiredObjects({ functions, triggers: triggers.map((t) => t === trigger ? { ...t, enabled: "D" } : t) }));
    assert.throws(() => cut.assertRequiredObjects({ functions, triggers: triggers.map((t) => t === trigger ? { ...t, function: "wrong_function" } : t) }));
  }
});
