import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export class OffsetState {
  constructor(filePath) {
    this.filePath = resolve(filePath);
  }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8"));
      return Number.isSafeInteger(value.offset) && value.offset >= 0 ? value.offset : null;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async write(offset) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid_offset");
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ offset }) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temp, this.filePath);
  }
}
