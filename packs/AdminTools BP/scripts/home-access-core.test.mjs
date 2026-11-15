import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAccessOptions, grantIsActive, visitAllowed, useGrant,
  homeGeneration, requestIsCurrent,
} from "./home-access-core.js";

const now = 1000000;
test("owner needs no grant, staff visitor still needs one", () => {
  assert.equal(visitAllowed("owner", "owner", null, "a", now), true);
  assert.equal(visitAllowed("admin", "owner", null, "a", now), false);
  assert.equal(visitAllowed("", "", null, "a", now), false);
});
test("one-time consent is consumed only through explicit successful-use commit", () => {
  const grant = { generation: "a", ...normalizeAccessOptions({ mode: "once" }, now) };
  assert.equal(grantIsActive(grant, "a", now), true);
  assert.equal(grantIsActive(grant, "a", now), true);
  assert.equal(grant.remainingUses, 1);
  const after = useGrant(grant, "a", now);
  assert.equal(after.remainingUses, 0);
  assert.equal(grantIsActive(after, "a", now), false);
  assert.equal(useGrant(after, "a", now), null);
});
test("temporary boundary expires exactly at deadline", () => {
  const grant = { generation: "a", ...normalizeAccessOptions({ mode: "temporary", minutes: 1, uses: 2 }, now) };
  assert.equal(grantIsActive(grant, "a", now + 59999), true);
  assert.equal(grantIsActive(grant, "a", now + 60000), false);
  assert.equal(useGrant(grant, "a", now).remainingUses, 1);
});
test("permanent unlimited grant remains unlimited", () => {
  const grant = { generation: "a", ...normalizeAccessOptions({ mode: "permanent", uses: 0 }, now) };
  assert.equal(useGrant(grant, "a", now + 99999999).remainingUses, null);
});
test("delete and recreate invalidates old grant, coordinate update preserves it", () => {
  const home = { x: 1, destinationId: "stable-id" };
  const grant = { generation: homeGeneration(home), ...normalizeAccessOptions({}, now) };
  assert.equal(grantIsActive(grant, homeGeneration({ ...home, x: 50 }), now), true);
  assert.equal(grantIsActive(grant, homeGeneration({ x: 1, destinationId: "new-id" }), now), false);
});
test("invalid options fail closed", () => {
  for (const opts of [{ mode: "wrong" }, { mode: "temporary", minutes: 0 },
    { mode: "temporary", minutes: 1.5 }, { mode: "temporary", minutes: Infinity },
    { mode: "permanent", uses: -1 }, { mode: "permanent", uses: 0.5 }]) {
    assert.throws(() => normalizeAccessOptions(opts, now));
  }
  assert.equal(grantIsActive({ generation: "a", expiresAt: NaN, remainingUses: null }, "a", now), false);
});
test("stale requests cannot approve recreated homes and expire after seven days", () => {
  const request = { generation: "a", createdAt: now };
  assert.equal(requestIsCurrent(request, { destinationId: "a" }, now), true);
  assert.equal(requestIsCurrent(request, { destinationId: "b" }, now), false);
  assert.equal(requestIsCurrent(request, { destinationId: "a" }, now + 7 * 86400000), false);
  assert.equal(requestIsCurrent(request, null, now), false);
});
