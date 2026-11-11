import test from "node:test";
import assert from "node:assert/strict";
import { validateFreshDeployTarget } from "./test-fresh-deploy.mjs";

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
