import { parseArtifactDocument } from "./artifact-schema.js";

const interactionSchema = Object.freeze({
  oneOf: Object.freeze([
    Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["type", "id", "prompt", "required", "options"]),
      properties: Object.freeze({
        type: Object.freeze({ const: "choice" }),
        id: Object.freeze({ type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }),
        prompt: Object.freeze({ type: "string", minLength: 1, maxLength: 300 }),
        required: Object.freeze({ type: "boolean" }),
        options: Object.freeze({
          type: "array",
          minItems: 2,
          maxItems: 8,
          items: Object.freeze({
            type: "object",
            additionalProperties: false,
            required: Object.freeze(["id", "label"]),
            properties: Object.freeze({
              id: Object.freeze({ type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }),
              label: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
            }),
          }),
        }),
      }),
    }),
    Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["type", "id", "label", "required", "min", "max", "step"]),
      properties: Object.freeze({
        type: Object.freeze({ const: "rating" }),
        id: Object.freeze({ type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }),
        label: Object.freeze({ type: "string", minLength: 1, maxLength: 200 }),
        required: Object.freeze({ type: "boolean" }),
        min: Object.freeze({ const: 1 }),
        max: Object.freeze({ const: 5 }),
        step: Object.freeze({ const: 0.5 }),
      }),
    }),
    Object.freeze({
      type: "object",
      additionalProperties: false,
      required: Object.freeze(["type", "id", "prompt", "required", "maxChars"]),
      properties: Object.freeze({
        type: Object.freeze({ const: "note" }),
        id: Object.freeze({ type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$" }),
        prompt: Object.freeze({ type: "string", minLength: 1, maxLength: 300 }),
        required: Object.freeze({ type: "boolean" }),
        maxChars: Object.freeze({ type: "integer", minimum: 1, maximum: 2000 }),
      }),
    }),
  ]),
});

export const ARTIFACT_CREATE_TOOL = Object.freeze({
  name: "artifact.create",
  description:
    "Create one agent-authored page. HTML and CSS are presentation only; the host supplies the trusted behavior bridge. Do not include JavaScript, script tags, external resources, iframes, embeds, forms, navigation, or secrets. For single-submit interactions, author controls with data-artifact-choice, data-artifact-rating, data-artifact-note, one data-artifact-submit control, and optionally data-artifact-status.",
  inputSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: Object.freeze(["document", "interaction_mode"]),
    properties: Object.freeze({
      document: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["schemaVersion", "title", "kind", "html", "css", "interactions"]),
        properties: Object.freeze({
          schemaVersion: Object.freeze({ const: 2 }),
          title: Object.freeze({ type: "string", minLength: 1, maxLength: 120 }),
          kind: Object.freeze({ enum: Object.freeze(["letter", "gift", "interactive", "receipt"]) }),
          html: Object.freeze({ type: "string", minLength: 1, maxLength: 48000 }),
          css: Object.freeze({ type: "string", maxLength: 16000 }),
          interactions: Object.freeze({
            type: "array",
            maxItems: 24,
            items: interactionSchema,
          }),
        }),
      }),
      interaction_mode: Object.freeze({ enum: Object.freeze(["single_submit", "none"]) }),
    }),
  }),
});

export function parseArtifactCreateArguments(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_artifact_create_arguments");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "document" || keys[1] !== "interaction_mode") {
    throw new Error("invalid_artifact_create_arguments");
  }
  if (value.interaction_mode !== "single_submit" && value.interaction_mode !== "none") {
    throw new Error("invalid_artifact_create_arguments");
  }
  const document = parseArtifactDocument(value.document);
  if (value.interaction_mode === "single_submit" && document.interactions.length === 0) {
    throw new Error("interactive_mode_requires_interactions");
  }
  if (value.interaction_mode === "none" && document.interactions.length !== 0) {
    throw new Error("noninteractive_mode_forbids_interactions");
  }
  return Object.freeze({
    document,
    interaction_mode: value.interaction_mode,
  });
}
