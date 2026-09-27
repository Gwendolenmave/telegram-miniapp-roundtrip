import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileInteractionStore } from "../src/store.js";

test("interaction survives a fresh store instance and raw ref is not a filename", () => {
  const root = mkdtempSync(join(tmpdir(), "miniapp-roundtrip-"));
  try {
    const first = new FileInteractionStore(root);
    const { ref } = first.create("hello", new Date("2026-09-28T00:00:00.000Z"));
    const second = new FileInteractionStore(root);
    assert.equal(second.read(ref)?.note, "hello");
    const files = readdirSync(root);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.includes(ref), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
