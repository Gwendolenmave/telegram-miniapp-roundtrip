import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { validRef } from "./protocol.js";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isSubmission(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.v === 1 &&
    typeof value.event_id === "string" &&
    typeof value.ref_sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.ref_sha256) &&
    typeof value.note === "string" &&
    value.note.length > 0 &&
    value.note.length <= 2000 &&
    typeof value.created_at === "string" &&
    Number.isFinite(Date.parse(value.created_at));
}

export class FileInteractionStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  }

  create(note, now = new Date()) {
    const clean = note.trim();
    if (clean.length === 0 || clean.length > 2000) throw new Error("invalid_note");

    const ref = `ref_${randomBytes(24).toString("base64url")}`;
    const interaction = {
      v: 1,
      event_id: `evt_${randomUUID()}`,
      ref_sha256: sha256(ref),
      note: clean,
      created_at: now.toISOString(),
    };
    this.#write(ref, interaction);
    return { ref, interaction };
  }

  read(ref) {
    if (!validRef(ref)) return null;
    try {
      const value = JSON.parse(readFileSync(this.#path(ref), "utf8"));
      if (!isSubmission(value) || value.ref_sha256 !== sha256(ref)) return null;
      return value;
    } catch {
      return null;
    }
  }

  #path(ref) {
    return join(this.rootDir, `${sha256(ref)}.json`);
  }

  #write(ref, interaction) {
    const path = this.#path(ref);
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, `${JSON.stringify(interaction)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  }
}
