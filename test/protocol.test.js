import assert from "node:assert/strict";
import test from "node:test";
import { encodeWake, parseWake } from "../src/protocol.js";

const REF = `ref_${"a".repeat(32)}`;

test("wake payload round-trips as one closed opaque-reference message", () => {
  assert.deepEqual(parseWake(encodeWake(REF)), { v: 1, kind: "artifact.interaction", ref: REF });
});

test("wake parser rejects extra keys, bad refs, and non-json", () => {
  assert.equal(parseWake("nope"), null);
  assert.equal(parseWake(JSON.stringify({ v: 1, kind: "artifact.interaction", ref: "../secret" })), null);
  assert.equal(parseWake(JSON.stringify({ v: 1, kind: "artifact.interaction", ref: REF, note: "do not send me" })), null);
});
