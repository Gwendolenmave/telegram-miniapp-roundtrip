import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function token(prefix, bytes = 24) {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

export class InteractionStore {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    this.records = new Map();
    this.writeChain = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("invalid_store_shape");
      for (const record of parsed) {
        if (
          record &&
          typeof record === "object" &&
          typeof record.ref === "string" &&
          typeof record.event_id === "string" &&
          typeof record.note === "string"
        ) {
          this.records.set(record.ref, Object.freeze({ ...record }));
        }
      }
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") return;
      throw error;
    }
  }

  async create(note) {
    if (typeof note !== "string" || note.trim().length === 0 || note.length > 2000) {
      throw new Error("invalid_note");
    }

    const record = Object.freeze({
      event_id: token("evt", 18),
      ref: token("ref", 24),
      submitted_at: new Date().toISOString(),
      note,
      handled_at: null,
    });

    this.records.set(record.ref, record);
    await this.persist();
    return record;
  }

  get(ref) {
    return this.records.get(ref) ?? null;
  }

  async markHandled(ref) {
    const current = this.records.get(ref);
    if (current === undefined || current.handled_at !== null) return current ?? null;
    const next = Object.freeze({ ...current, handled_at: new Date().toISOString() });
    this.records.set(ref, next);
    await this.persist();
    return next;
  }

  async persist() {
    const snapshot = [...this.records.values()];
    this.writeChain = this.writeChain.then(async () => {
      const temp = `${this.filePath}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temp, this.filePath);
    });
    await this.writeChain;
  }
}
