import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InteractionStore } from "../src/store.js";

test("persists an interaction and can reopen it by opaque reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniapp-roundtrip-"));
  const file = join(root, "interactions.json");

  try {
    const first = new InteractionStore(file);
    await first.init();
    const created = await first.create("hello");

    assert.match(created.ref, /^ref_[A-Za-z0-9_-]+$/u);
    assert.equal(created.handled_at, null);

    const reopened = new InteractionStore(file);
    await reopened.init();
    assert.equal(reopened.get(created.ref)?.note, "hello");

    await reopened.markHandled(created.ref);
    assert.notEqual(reopened.get(created.ref)?.handled_at, null);

    const onDisk = JSON.parse(await readFile(file, "utf8"));
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].note, "hello");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects empty and oversized notes", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniapp-roundtrip-invalid-"));
  const file = join(root, "interactions.json");

  try {
    const store = new InteractionStore(file);
    await store.init();
    await assert.rejects(() => store.create("   "), /invalid_note/u);
    await assert.rejects(() => store.create("x".repeat(2001)), /invalid_note/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
