const WAKE_VERSION = 1;
const WAKE_KIND = "artifact.interaction";
const MAX_WAKE_BYTES = 512;
const REF_PATTERN = /^ref_[A-Za-z0-9_-]{32}$/u;

export function validRef(value) {
  return typeof value === "string" && REF_PATTERN.test(value);
}

export function encodeWake(ref) {
  if (!validRef(ref)) throw new Error("invalid_ref");
  const payload = JSON.stringify({ v: WAKE_VERSION, kind: WAKE_KIND, ref });
  if (new TextEncoder().encode(payload).byteLength > MAX_WAKE_BYTES) {
    throw new Error("wake_payload_too_large");
  }
  return payload;
}

export function parseWake(value) {
  if (typeof value !== "string") return null;
  if (new TextEncoder().encode(value).byteLength > MAX_WAKE_BYTES) return null;

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (Object.keys(parsed).length !== 3) return null;
  if (parsed.v !== WAKE_VERSION || parsed.kind !== WAKE_KIND || !validRef(parsed.ref)) return null;
  return { v: WAKE_VERSION, kind: WAKE_KIND, ref: parsed.ref };
}
