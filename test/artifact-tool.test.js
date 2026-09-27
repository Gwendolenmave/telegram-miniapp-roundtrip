import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT_CREATE_TOOL,
  parseArtifactCreateArguments,
} from "../src/artifact-tool.js";
import { DEMO_ARTIFACT } from "../src/example-artifact.js";

test("artifact.create exposes the authored document contract to a tool-calling model", () => {
  assert.equal(ARTIFACT_CREATE_TOOL.name, "artifact.create");
  assert.deepEqual(
    ARTIFACT_CREATE_TOOL.inputSchema.required,
    ["document", "interaction_mode"],
  );

  const parsed = parseArtifactCreateArguments({
    document: DEMO_ARTIFACT,
    interaction_mode: "single_submit",
  });
  assert.equal(parsed.document.title, DEMO_ARTIFACT.title);
  assert.equal(parsed.interaction_mode, "single_submit");
});

test("artifact.create rejects interaction-mode/document mismatches", () => {
  assert.throws(
    () => parseArtifactCreateArguments({
      document: DEMO_ARTIFACT,
      interaction_mode: "none",
    }),
    /noninteractive_mode_forbids_interactions/u,
  );
});
