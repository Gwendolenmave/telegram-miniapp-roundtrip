import { createHash } from "node:crypto";

export const ARTIFACT_MAX_DOCUMENT_BYTES = 64 * 1024;
export const ARTIFACT_MAX_HTML_CHARS = 48_000;
export const ARTIFACT_MAX_CSS_CHARS = 16_000;

const KINDS = new Set(["letter", "gift", "interactive", "receipt"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const FORBIDDEN_TAG = /<\s*\/?\s*(?:script|iframe|frame|object|embed|link|meta|base|form|style)\b/iu;
const FORBIDDEN_ATTR = /\s(?:on[a-z0-9_-]+|href|xlink:href|action|formaction)\s*=/iu;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedString(value, max, allowEmpty = false) {
  return typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    Array.from(value).length <= max;
}

function parseInteraction(value, index) {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error(`invalid_interaction_${index}`);
  }

  if (value.type === "choice") {
    if (
      !exactKeys(value, ["type", "id", "prompt", "required", "options"]) ||
      typeof value.id !== "string" ||
      !ID_PATTERN.test(value.id) ||
      !boundedString(value.prompt, 300) ||
      typeof value.required !== "boolean" ||
      !Array.isArray(value.options) ||
      value.options.length < 2 ||
      value.options.length > 8
    ) {
      throw new Error(`invalid_choice_${index}`);
    }

    const ids = new Set();
    const options = value.options.map((option) => {
      if (
        !isRecord(option) ||
        !exactKeys(option, ["id", "label"]) ||
        typeof option.id !== "string" ||
        !ID_PATTERN.test(option.id) ||
        !boundedString(option.label, 120) ||
        ids.has(option.id)
      ) {
        throw new Error(`invalid_choice_${index}`);
      }
      ids.add(option.id);
      return Object.freeze({ id: option.id, label: option.label });
    });

    return Object.freeze({
      type: "choice",
      id: value.id,
      prompt: value.prompt,
      required: value.required,
      options: Object.freeze(options),
    });
  }

  if (value.type === "rating") {
    if (
      !exactKeys(value, ["type", "id", "label", "required", "min", "max", "step"]) ||
      typeof value.id !== "string" ||
      !ID_PATTERN.test(value.id) ||
      !boundedString(value.label, 200) ||
      typeof value.required !== "boolean" ||
      value.min !== 1 ||
      value.max !== 5 ||
      value.step !== 0.5
    ) {
      throw new Error(`invalid_rating_${index}`);
    }
    return Object.freeze({
      type: "rating",
      id: value.id,
      label: value.label,
      required: value.required,
      min: 1,
      max: 5,
      step: 0.5,
    });
  }

  if (value.type === "note") {
    if (
      !exactKeys(value, ["type", "id", "prompt", "required", "maxChars"]) ||
      typeof value.id !== "string" ||
      !ID_PATTERN.test(value.id) ||
      !boundedString(value.prompt, 300) ||
      typeof value.required !== "boolean" ||
      !Number.isInteger(value.maxChars) ||
      value.maxChars < 1 ||
      value.maxChars > 2000
    ) {
      throw new Error(`invalid_note_${index}`);
    }
    return Object.freeze({
      type: "note",
      id: value.id,
      prompt: value.prompt,
      required: value.required,
      maxChars: value.maxChars,
    });
  }

  throw new Error(`unsupported_interaction_${index}`);
}

export function authoredHtmlIsSafe(html) {
  return typeof html === "string" &&
    !FORBIDDEN_TAG.test(html) &&
    !FORBIDDEN_ATTR.test(html);
}

export function parseArtifactDocument(value) {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["schemaVersion", "title", "kind", "html", "css", "interactions"]) ||
    value.schemaVersion !== 2 ||
    !boundedString(value.title, 120) ||
    typeof value.kind !== "string" ||
    !KINDS.has(value.kind) ||
    !boundedString(value.html, ARTIFACT_MAX_HTML_CHARS) ||
    !authoredHtmlIsSafe(value.html) ||
    !boundedString(value.css, ARTIFACT_MAX_CSS_CHARS, true) ||
    !Array.isArray(value.interactions) ||
    value.interactions.length > 24
  ) {
    throw new Error("invalid_artifact_document");
  }

  const interactions = value.interactions.map(parseInteraction);
  const ids = new Set();
  for (const interaction of interactions) {
    if (ids.has(interaction.id)) throw new Error("duplicate_interaction_id");
    ids.add(interaction.id);
  }

  const document = Object.freeze({
    schemaVersion: 2,
    title: value.title,
    kind: value.kind,
    html: value.html,
    css: value.css,
    interactions: Object.freeze(interactions),
  });

  if (Buffer.byteLength(JSON.stringify(document), "utf8") > ARTIFACT_MAX_DOCUMENT_BYTES) {
    throw new Error("artifact_document_too_large");
  }
  return document;
}

export function validateInteractionValues(document, raw) {
  if (!isRecord(raw)) throw new Error("invalid_interaction_values");

  const specs = new Map(document.interactions.map((item) => [item.id, item]));
  for (const key of Object.keys(raw)) {
    if (!specs.has(key)) throw new Error("unknown_interaction_field");
  }

  const values = {};
  for (const spec of document.interactions) {
    const rawValue = raw[spec.id];

    if (spec.type === "choice") {
      if (rawValue === undefined || rawValue === "") {
        if (spec.required) throw new Error("required_interaction_missing");
        continue;
      }
      if (typeof rawValue !== "string" || !spec.options.some((option) => option.id === rawValue)) {
        throw new Error("invalid_choice_value");
      }
      values[spec.id] = rawValue;
      continue;
    }

    if (spec.type === "rating") {
      if (rawValue === undefined || rawValue === "") {
        if (spec.required) throw new Error("required_interaction_missing");
        continue;
      }
      if (
        typeof rawValue !== "number" ||
        !Number.isFinite(rawValue) ||
        rawValue < spec.min ||
        rawValue > spec.max ||
        Math.abs((rawValue - spec.min) / spec.step - Math.round((rawValue - spec.min) / spec.step)) > 1e-9
      ) {
        throw new Error("invalid_rating_value");
      }
      values[spec.id] = rawValue;
      continue;
    }

    if (rawValue === undefined) {
      if (spec.required) throw new Error("required_interaction_missing");
      continue;
    }
    if (
      typeof rawValue !== "string" ||
      Array.from(rawValue).length > spec.maxChars ||
      (spec.required && rawValue.trim().length === 0)
    ) {
      throw new Error("invalid_note_value");
    }
    values[spec.id] = rawValue;
  }

  return Object.freeze(values);
}

export function artifactDocumentSha256(document) {
  return createHash("sha256").update(JSON.stringify(document), "utf8").digest("hex");
}
