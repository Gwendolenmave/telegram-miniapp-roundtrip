import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InteractionStore } from "../src/store.js";

test("persists interaction values, prepared reply, and delivery state", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniapp-roundtrip-"));
  const file = join(root, "interactions.json");

  try {
    const first = new InteractionStore(file);
    await first.init();
    const created = await first.create({
      artifactId: "demo",
      values: { mood: "quiet", reply: "hello" },
    });

    assert.match(created.ref, /^ref_[A-Za-z0-9_-]+$/u);
    assert.equal(created.reply_text, null);
    assert.equal(created.delivered_at, null);

    const reopened = new InteractionStore(file);
    await reopened.init();
    assert.deepEqual(reopened.get(created.ref)?.values, { mood: "quiet", reply: "hello" });

    const prepared = await reopened.prepareReply(created.ref, "canonical reply");
    assert.equal(prepared?.reply_text, "canonical reply");

    const again = await reopened.prepareReply(created.ref, "must not replace");
    assert.equal(again?.reply_text, "canonical reply");

    await reopened.markDelivered(created.ref);
    assert.notEqual(reopened.get(created.ref)?.delivered_at, null);

    const onDisk = JSON.parse(await readFile(file, "utf8"));
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].reply_text, "canonical reply");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
