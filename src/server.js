import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { parseWakePayload } from "./protocol.js";
import { InteractionStore } from "./store.js";

const BOT_TOKEN = required("TELEGRAM_BOT_TOKEN");
const ALLOWED_USER_ID = positiveInt(required("TELEGRAM_ALLOWED_USER_ID"), "TELEGRAM_ALLOWED_USER_ID");
const PUBLIC_ORIGIN = publicOrigin(required("PUBLIC_ORIGIN"));
const PORT = positiveInt(process.env.PORT ?? "3000", "PORT");
const DATA_FILE = process.env.DATA_FILE?.trim() || "./data/interactions.json";

const INDEX_HTML = await readFile(
  fileURLToPath(new URL("../public/index.html", import.meta.url)),
  "utf8",
);

const store = new InteractionStore(DATA_FILE);
await store.init();

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

function reply(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
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
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text);
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/") {
      reply(response, 200, "text/html; charset=utf-8", INDEX_HTML);
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
        if (note === null) {
          json(response, 400, { error: "invalid_submission" });
          return;
        }
        const record = await store.create(note);
        json(response, 201, { event_ref: record.ref });
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
  console.log(`Telegram button URL: ${PUBLIC_ORIGIN}`);
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

async function handleUpdate(update) {
  const message = update?.message;
  if (!message || message.chat?.type !== "private") return;
  if (message.from?.id !== ALLOWED_USER_ID) return;

  if (message.web_app_data) {
    const parsed = parseWakePayload(message.web_app_data.data);
    if (parsed === null) {
      await sendMessage(message.chat.id, "I received Mini App data, but the wake payload was invalid.");
      return;
    }

    const record = store.get(parsed.ref);
    if (record === null) {
      await sendMessage(message.chat.id, "I received the Mini App reference, but no saved interaction matched it.");
      return;
    }

    if (record.handled_at !== null) {
      await sendMessage(message.chat.id, "I already received this Mini App interaction.");
      return;
    }

    // Replace this function with your own agent turn if you want an AI reply.
    await sendMessage(message.chat.id, `Received from the Mini App:\n\n${record.note}`);
    await store.markHandled(record.ref);
    return;
  }

  if (typeof message.text === "string" && message.text.startsWith("/start")) {
    await sendMessage(
      message.chat.id,
      "Open the Mini App, write something, and submit it. The saved interaction will come back here as web_app_data.",
      {
        reply_markup: {
          keyboard: [[{
            text: "💌 Open Mini App",
            web_app: { url: PUBLIC_ORIGIN },
          }]],
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
  let offset = null;

  for (;;) {
    try {
      const updates = await getUpdates(offset);
      for (const update of updates) {
        await handleUpdate(update);
        offset = update.update_id + 1;
      }
    } catch (error) {
      console.error(`Telegram loop error: ${error instanceof Error ? error.message : "unknown_error"}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
