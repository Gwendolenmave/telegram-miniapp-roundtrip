import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class OffsetState {
  constructor(path) {
    this.path = path;
  }

  read() {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      return Number.isSafeInteger(value.offset) && value.offset >= 0 ? value.offset : null;
    } catch {
      return null;
    }
  }

  write(offset) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid_offset");
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ offset })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temp, this.path);
  }
}
