import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { validateInteractionValues } from "./artifact-schema.js";
import { DEMO_ARTIFACT, DEMO_ARTIFACT_ID } from "./example-artifact.js";
import { parseWakePayload, makeWakePayload } from "./protocol.js";
import { renderAuthoredArtifactPage } from "./render-artifact.js";
import { OffsetState } from "./state.js";
import { InteractionStore } from "./store.js";

const BOT_TOKEN = required("TELEGRAM_BOT_TOKEN");
const ALLOWED_USER_ID = positiveInt(required("TELEGRAM_ALLOWED_USER_ID"), "TELEGRAM_ALLOWED_USER_ID");
const PUBLIC_ORIGIN = publicOrigin(required("PUBLIC_ORIGIN"));
const PORT = positiveInt(process.env.PORT ?? "3000", "PORT");
const DATA_FILE = process.env.DATA_FILE?.trim() || "./data/interactions.json";
const OFFSET_FILE = process.env.OFFSET_FILE?.trim() || "./data/telegram-offset.json";

const INDEX_HTML = await readFile(
  fileURLToPath(new URL("../public/index.html", import.meta.url)),
  "utf8",
);

const store = new InteractionStore(DATA_FILE);
await store.init();
const offsets = new OffsetState(OFFSET_FILE);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInt(raw, name) {
  if (!/^\d+$/u.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function publicOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("PUBLIC_ORIGIN must use https");
  return url.origin;
}

function reply(response, status, contentType, body, extraHeaders = {}) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

function json(response, status, body) {
  reply(response, status, "application/json; charset=utf-8", JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16 * 1024) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function exactValuesBody(body) {
  return body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).length === 1 &&
    body.values !== null &&
    typeof body.values === "object" &&
    !Array.isArray(body.values)
      ? body.values
      : null;
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/") {
      reply(response, 200, "text/html; charset=utf-8", INDEX_HTML);
      return;
    }

    if (request.method === "GET" && url.pathname === "/artifact") {
      const rendered = renderAuthoredArtifactPage(DEMO_ARTIFACT, {
        artifactId: DEMO_ARTIFACT_ID,
        interactionEndpoint: `/api/artifacts/${DEMO_ARTIFACT_ID}/interactions`,
      });
      reply(response, 200, "text/html; charset=utf-8", rendered.html, {
        "content-security-policy": rendered.csp,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/interactions") {
      try {
        const body = await readJson(request);
        const note =
          body !== null &&
          typeof body === "object" &&
          !Array.isArray(body) &&
          Object.keys(body).length === 1 &&
          typeof body.note === "string"
            ? body.note
            : null;
        if (note === null || note.trim().length === 0 || note.length > 2000) {
          json(response, 400, { error: "invalid_submission" });
          return;
        }
        const record = await store.create({
          artifactId: "simple-roundtrip",
          values: { note },
        });
        json(response, 201, { event_ref: record.ref });
      } catch (error) {
        const code = error instanceof Error ? error.message : "invalid_request";
        json(response, code === "request_too_large" ? 413 : 400, { error: code });
      }
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `/api/artifacts/${DEMO_ARTIFACT_ID}/interactions`
    ) {
      try {
        const body = await readJson(request);
        const rawValues = exactValuesBody(body);
        if (rawValues === null) throw new Error("invalid_submission");
        const values = validateInteractionValues(DEMO_ARTIFACT, rawValues);
        const record = await store.create({
          artifactId: DEMO_ARTIFACT_ID,
          values,
        });
        json(response, 201, {
          event_ref: record.ref,
          wake: makeWakePayload(record.ref),
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : "invalid_request";
        json(response, code === "request_too_large" ? 413 : 400, { error: code });
      }
      return;
    }

    json(response, 404, { error: "not_found" });
  })().catch(() => {
    if (!response.headersSent) json(response, 500, { error: "request_failed" });
    else response.end();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mini App listening on http://0.0.0.0:${PORT}`);
  console.log(`Telegram button origin: ${PUBLIC_ORIGIN}`);
});

void runBotLoop();

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`telegram_http_${response.status}`);
  const body = await response.json();
  if (!body || body.ok !== true) throw new Error("telegram_api_error");
  return body.result;
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

function revalidateRecord(record) {
  if (record.artifact_id === DEMO_ARTIFACT_ID) {
    return validateInteractionValues(DEMO_ARTIFACT, record.values);
  }
  if (
    record.artifact_id === "simple-roundtrip" &&
    typeof record.values.note === "string" &&
    record.values.note.trim().length > 0 &&
    record.values.note.length <= 2000 &&
    Object.keys(record.values).length === 1
  ) {
    return Object.freeze({ note: record.values.note });
  }
  throw new Error("unknown_or_invalid_interaction");
}

function renderReply(record, values) {
  if (record.artifact_id === DEMO_ARTIFACT_ID) {
    const mood = typeof values.mood === "string" ? values.mood : "(none)";
    const note = typeof values.reply === "string" ? values.reply : "(none)";
    return [
      "Received from the authored Artifact.",
      "",
      `mood: ${mood}`,
      `reply: ${note}`,
      "",
      `external turn key: artifact:${record.artifact_id}:interaction:${record.event_id}`,
    ].join("\n");
  }
  return `Received from the Mini App:\n\n${values.note}`;
}

async function handleInteractionWake(message, wake) {
  const record = store.get(wake.ref);
  if (record === null) {
    await sendMessage(message.chat.id, "I received the Mini App reference, but no saved interaction matched it.");
    return;
  }

  const values = revalidateRecord(record);
  if (record.delivered_at !== null) return;

  let current = record;
  if (current.reply_text === null) {
    // Replace renderReply() with your existing agent call if you want AI output.
    // Keep the stable external turn key above so a host can make model work idempotent.
    const replyText = renderReply(current, values);
    current = await store.prepareReply(current.ref, replyText);
  }

  if (current === null || current.reply_text === null) {
    throw new Error("reply_not_prepared");
  }

  await sendMessage(message.chat.id, current.reply_text);
  await store.markDelivered(current.ref);
}

async function handleUpdate(update) {
  const message = update?.message;
  if (!message || message.chat?.type !== "private") return;
  if (message.from?.id !== ALLOWED_USER_ID) return;

  if (message.web_app_data) {
    const wake = parseWakePayload(message.web_app_data.data);
    if (wake === null) {
      await sendMessage(message.chat.id, "I received Mini App data, but the wake payload was invalid.");
      return;
    }
    await handleInteractionWake(message, wake);
    return;
  }

  if (typeof message.text === "string" && message.text.startsWith("/start")) {
    await sendMessage(
      message.chat.id,
      "Open either example. The authored Artifact demonstrates the full sandbox + trusted-bridge pattern.",
      {
        reply_markup: {
          keyboard: [
            [{
              text: "💌 Open authored Artifact",
              web_app: { url: `${PUBLIC_ORIGIN}/artifact` },
            }],
            [{
              text: "🧪 Open minimal roundtrip",
              web_app: { url: PUBLIC_ORIGIN },
            }],
          ],
          resize_keyboard: true,
        },
      },
    );
    return;
  }

  if (typeof message.text === "string") {
    await sendMessage(message.chat.id, "Send /start to open the Mini App.");
  }
}

async function getUpdates(offset) {
  return telegram("getUpdates", {
    ...(offset === null ? {} : { offset }),
    timeout: 25,
    allowed_updates: ["message"],
  });
}

async function runBotLoop() {
  let offset = await offsets.read();

  for (;;) {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        if (offset !== null && update.update_id < offset) continue;
        await handleUpdate(update);
        offset = update.update_id + 1;
        await offsets.write(offset);
      }
    } catch (error) {
      console.error(`Telegram loop error: ${error instanceof Error ? error.message : "unknown_error"}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
