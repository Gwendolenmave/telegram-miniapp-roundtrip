import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArtifactDocument,
  validateInteractionValues,
} from "../src/artifact-schema.js";
import { DEMO_ARTIFACT } from "../src/example-artifact.js";

test("accepts the authored V2 document and typed interaction values", () => {
  const values = validateInteractionValues(DEMO_ARTIFACT, {
    mood: "playful",
    reply: "hello",
  });
  assert.deepEqual(values, { mood: "playful", reply: "hello" });
});

test("rejects executable authored markup and widened interaction values", () => {
  const base = {
    schemaVersion: 2,
    title: "x",
    kind: "interactive",
    css: "",
    interactions: [],
  };

  assert.throws(
    () => parseArtifactDocument({ ...base, html: "<script>alert(1)</script>" }),
    /invalid_artifact_document/u,
  );
  assert.throws(
    () => parseArtifactDocument({ ...base, html: '<button onclick="x()">x</button>' }),
    /invalid_artifact_document/u,
  );
  assert.throws(
    () => parseArtifactDocument({ ...base, html: '<a href="https://example.com">x</a>' }),
    /invalid_artifact_document/u,
  );
  assert.throws(
    () => validateInteractionValues(DEMO_ARTIFACT, {
      mood: "playful",
      reply: "hello",
      surprise: "extra",
    }),
    /unknown_interaction_field/u,
  );
});

test("enforces required fields and typed option bounds", () => {
  assert.throws(
    () => validateInteractionValues(DEMO_ARTIFACT, { reply: "hello" }),
    /required_interaction_missing/u,
  );
  assert.throws(
    () => validateInteractionValues(DEMO_ARTIFACT, { mood: "nope", reply: "hello" }),
    /invalid_choice_value/u,
  );
  assert.throws(
    () => validateInteractionValues(DEMO_ARTIFACT, { mood: "quiet", reply: "x".repeat(281) }),
    /invalid_note_value/u,
  );
});
