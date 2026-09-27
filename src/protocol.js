export const WAKE_KIND = "artifact.interaction";
export const WAKE_VERSION = 1;
export const MAX_WAKE_BYTES = 512;

const REF_PATTERN = /^ref_[A-Za-z0-9_-]{24,96}$/u;

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

export function makeWakePayload(ref) {
  if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
    throw new Error("invalid_event_ref");
  }
  const payload = JSON.stringify({ v: WAKE_VERSION, kind: WAKE_KIND, ref });
  if (byteLength(payload) > MAX_WAKE_BYTES) {
    throw new Error("wake_payload_too_large");
  }
  return payload;
}

export function parseWakePayload(input) {
  if (typeof input !== "string" || byteLength(input) > MAX_WAKE_BYTES) {
    return null;
  }

  let value;
  try {
    value = JSON.parse(input);
  } catch {
    return null;
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const keys = Object.keys(value).sort();
  if (keys.length !== 3 || keys[0] !== "kind" || keys[1] !== "ref" || keys[2] !== "v") {
    return null;
  }

  if (
    value.v !== WAKE_VERSION ||
    value.kind !== WAKE_KIND ||
    typeof value.ref !== "string" ||
    !REF_PATTERN.test(value.ref)
  ) {
    return null;
  }

  return { ref: value.ref };
}
