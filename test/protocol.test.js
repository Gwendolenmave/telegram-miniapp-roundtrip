import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_WAKE_BYTES,
  makeWakePayload,
  parseWakePayload,
} from "../src/protocol.js";

const REF = `ref_${"a".repeat(32)}`;

test("round-trips the exact wake payload", () => {
  const payload = makeWakePayload(REF);
  assert.deepEqual(parseWakePayload(payload), { ref: REF });
  assert.ok(new TextEncoder().encode(payload).length <= MAX_WAKE_BYTES);
});

test("rejects malformed, widened, or wrong-kind payloads", () => {
  assert.equal(parseWakePayload("not json"), null);
  assert.equal(parseWakePayload(JSON.stringify({ v: 2, kind: "artifact.interaction", ref: REF })), null);
  assert.equal(parseWakePayload(JSON.stringify({ v: 1, kind: "other", ref: REF })), null);
  assert.equal(parseWakePayload(JSON.stringify({ v: 1, kind: "artifact.interaction", ref: REF, extra: true })), null);
  assert.equal(parseWakePayload(JSON.stringify({ v: 1, kind: "artifact.interaction", ref: "guessable" })), null);
});

test("rejects payloads beyond the application bound", () => {
  assert.equal(parseWakePayload("x".repeat(MAX_WAKE_BYTES + 1)), null);
});
