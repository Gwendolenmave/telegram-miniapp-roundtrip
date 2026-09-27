import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function token(prefix, bytes = 24) {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

function isValues(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((entry) =>
    typeof entry === "string" || (typeof entry === "number" && Number.isFinite(entry))
  );
}

function canonicalValues(values) {
  const sorted = {};
  for (const key of Object.keys(values).sort()) sorted[key] = values[key];
  return JSON.stringify(sorted);
}

function isRecord(value) {
  return value !== null &&
    typeof value === "object" &&
    typeof value.ref === "string" &&
    typeof value.event_id === "string" &&
    typeof value.artifact_id === "string" &&
    typeof value.submitted_at === "string" &&
    isValues(value.values) &&
    (value.reply_text === null || typeof value.reply_text === "string") &&
    (value.delivered_at === null || typeof value.delivered_at === "string");
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
        if (isRecord(record)) {
          this.records.set(
            record.ref,
            Object.freeze({ ...record, values: Object.freeze({ ...record.values }) }),
          );
        }
      }
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") return;
      throw error;
    }
  }

  async create({ artifactId, values }) {
    if (typeof artifactId !== "string" || artifactId.length === 0 || artifactId.length > 120 || !isValues(values)) {
      throw new Error("invalid_interaction_record");
    }

    const record = Object.freeze({
      event_id: token("evt", 18),
      ref: token("ref", 24),
      artifact_id: artifactId,
      submitted_at: new Date().toISOString(),
      values: Object.freeze({ ...values }),
      reply_text: null,
      delivered_at: null,
    });

    this.records.set(record.ref, record);
    await this.persist();
    return record;
  }

  async createSingle({ artifactId, values }) {
    if (typeof artifactId !== "string" || artifactId.length === 0 || artifactId.length > 120 || !isValues(values)) {
      throw new Error("invalid_interaction_record");
    }

    const existing = this.getByArtifactId(artifactId);
    if (existing !== null) {
      if (canonicalValues(existing.values) !== canonicalValues(values)) {
        throw new Error("interaction_conflict");
      }
      return Object.freeze({ record: existing, created: false });
    }

    const record = await this.create({ artifactId, values });
    return Object.freeze({ record, created: true });
  }

  get(ref) {
    return this.records.get(ref) ?? null;
  }

  getByArtifactId(artifactId) {
    for (const record of this.records.values()) {
      if (record.artifact_id === artifactId) return record;
    }
    return null;
  }

  async prepareReply(ref, replyText) {
    const current = this.records.get(ref);
    if (current === undefined) return null;
    if (current.reply_text !== null) return current;
    if (typeof replyText !== "string" || replyText.trim().length === 0 || replyText.length > 100_000) {
      throw new Error("invalid_reply_text");
    }
    const next = Object.freeze({ ...current, reply_text: replyText });
    this.records.set(ref, next);
    await this.persist();
    return next;
  }

  async markDelivered(ref) {
    const current = this.records.get(ref);
    if (current === undefined) return null;
    if (current.delivered_at !== null) return current;
    const next = Object.freeze({ ...current, delivered_at: new Date().toISOString() });
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
