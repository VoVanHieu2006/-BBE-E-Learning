import test from "node:test";
import assert from "node:assert/strict";
import { decideBootstrapAction, validateBaselineTarget } from "../db/baseline-empty-database.mjs";

const migrationNames = ["20250831_init", "20261013_course_final_assessment"];
const expectedTables = ["users", "assessments"];

test("requires a separate PostgreSQL URL and exact database-name confirmation", () => {
  assert.throws(() => validateBaselineTarget(undefined, "bbe_fresh", undefined), /BASELINE_DATABASE_URL/);
  assert.throws(() => validateBaselineTarget("postgresql://localhost/other", "bbe_fresh", undefined), /exact database name/);
  assert.deepEqual(
    validateBaselineTarget("postgresql://localhost/bbe_fresh", "bbe_fresh", undefined),
    { databaseName: "bbe_fresh", host: "localhost", isLoopback: true },
  );
});

test("remote empty-database baselines require an explicit second confirmation", () => {
  const url = "postgresql://db.example.com/bbe_fresh";
  assert.throws(() => validateBaselineTarget(url, "bbe_fresh", undefined), /BASELINE_ALLOW_REMOTE/);
  assert.equal(
    validateBaselineTarget(url, "bbe_fresh", "I_CREATED_AND_VERIFIED_THIS_EMPTY_DATABASE").databaseName,
    "bbe_fresh",
  );
});

test("initializes only a completely empty schema", () => {
  assert.equal(decideBootstrapAction({
    actualTables: [],
    expectedTables,
    migrationStates: new Map(),
    migrationNames,
    rowCounts: {},
  }), "initialize");
});

test("accepts a fully baselined schema as a no-op, including populated databases", () => {
  assert.equal(decideBootstrapAction({
    actualTables: ["users", "assessments", "_prisma_migrations"],
    expectedTables,
    migrationStates: new Map(migrationNames.map((name) => [name, { applied: true, failed: false }])),
    migrationNames,
    rowCounts: { users: 25, assessments: 2 },
  }), "already-baselined");
});

test("can resume history marking after baseline DDL committed but resolve was interrupted", () => {
  assert.equal(decideBootstrapAction({
    actualTables: ["users", "assessments", "_prisma_migrations"],
    expectedTables,
    migrationStates: new Map([[migrationNames[0], { applied: true, failed: false }]]),
    migrationNames,
    rowCounts: { users: 0, assessments: 0 },
  }), "resume-history");
});

test("refuses partial schemas, non-empty partial baselines, and unknown migration histories", () => {
  const base = {
    expectedTables,
    migrationNames,
    migrationStates: new Map(),
    rowCounts: { users: 0 },
  };
  assert.throws(() => decideBootstrapAction({ ...base, actualTables: ["users"] }), /Refusing baseline/);
  assert.throws(() => decideBootstrapAction({ ...base, actualTables: ["users", "assessments"], rowCounts: { users: 1 } }), /Refusing baseline/);
  assert.throws(() => decideBootstrapAction({
    ...base,
    actualTables: [],
    migrationStates: new Map([["manual_hotfix", { applied: true, failed: false }]]),
  }), /outside this baseline/);
  assert.throws(() => decideBootstrapAction({
    ...base,
    actualTables: [],
    migrationStates: new Map([[migrationNames[0], { applied: false, failed: true }]]),
  }), /unresolved failed attempt/);
});
