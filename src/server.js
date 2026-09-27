import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { encodeWake, parseWake } from "./protocol.js";
import { OffsetState } from "./state.js";
import { FileInteractionStore } from "./store.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const publicDir = resolve("./public");
const publicOrigin = (process.env.PUBLIC_ORIGIN ?? "").replace(/\/+$/u, "");
const botToken = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const allowedUserIdRaw = (process.env.TELEGRAM_ALLOWED_USER_ID ?? "").trim();

const store = new FileInteractionStore(join(dataDir, "interactions"));
const offsets = new OffsetState(join(dataDir, "telegram-offset.json"));

const csp = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self' https://telegram.org",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function privateHeaders(contentType) {
  return {
    "cache-control": "no-store",
    "content-security-policy": csp,
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function json(response, status, body) {
  response.writeHead(status, privateHeaders("application/json; charset=utf-8"));
  response.end(JSON.stringify(body));
}

function staticFile(response, name) {
  const contentType = extname(name) === ".js"
    ? "text/javascript; charset=utf-8"
    : extname(name) === ".css"
      ? "text/css; charset=utf-8"
      : "text/html; charset=utf-8";
  try {
    response.writeHead(200, privateHeaders(contentType));
    response.end(readFileSync(join(publicDir, name)));
  } catch {
    response.writeHead(404, privateHeaders("text/plain; charset=utf-8"));
    response.end("Not found");
  }
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 16 * 1024) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true || payload.result === undefined) {
    throw new Error(`telegram_${method}_failed`);
  }
  return payload.result;
}

async function sendMessage(chatId, text, replyMarkup) {
  await telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
  });
}

async function handleTelegramMessage(message, allowedUserId) {
  if (!message || message.chat?.type !== "private" || message.from?.id !== allowedUserId) return;

  if (message.web_app_data !== undefined) {
    const wake = parseWake(message.web_app_data.data);
    if (wake === null) return;
    const interaction = store.read(wake.ref);
    if (interaction === null) {
      await sendMessage(message.chat.id, "I got the Mini App wake-up, but the saved interaction was not found.");
      return;
    }
    // Replace this echo with your existing agent/handler call.
    await sendMessage(message.chat.id, `Received from the Mini App: ${interaction.note}`);
    return;
  }

  if (message.text === "/start" || message.text === "/miniapp") {
    await sendMessage(message.chat.id, "Open the Mini App, submit one note, and let it come back to this bot.", {
      keyboard: [[{ text: "Open Mini App", web_app: { url: `${publicOrigin}/` } }]],
      resize_keyboard: true,
    });
  }
}

async function runTelegramLoop(allowedUserId) {
  let offset = offsets.read();
  for (;;) {
    try {
      const updates = await telegram("getUpdates", {
        ...(offset === null ? {} : { offset }),
        timeout: 30,
        allowed_updates: ["message"],
      });
      for (const update of updates) {
        if (offset !== null && update.update_id < offset) continue;
        await handleTelegramMessage(update.message, allowedUserId);
        offset = update.update_id + 1;
        offsets.write(offset);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : "telegram_loop_failed");
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 2000));
    }
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") return staticFile(response, "index.html");
    if (request.method === "GET" && url.pathname === "/app.js") return staticFile(response, "app.js");
    if (request.method === "GET" && url.pathname === "/styles.css") return staticFile(response, "styles.css");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true });

    if (request.method === "POST" && url.pathname === "/api/interactions") {
      try {
        const body = await readJson(request);
        if (body === null || typeof body !== "object" || Array.isArray(body) || typeof body.note !== "string") {
          throw new Error("invalid_body");
        }
        const { ref } = store.create(body.note);
        return json(response, 201, { event_ref: ref, wake: encodeWake(ref) });
      } catch (error) {
        const code = error instanceof Error ? error.message : "invalid_request";
        return json(response, code === "request_too_large" ? 413 : 400, { error: code });
      }
    }

    response.writeHead(404, privateHeaders("text/plain; charset=utf-8"));
    response.end("Not found");
  })().catch(() => {
    if (!response.headersSent) json(response, 500, { error: "request_failed" });
    else response.end();
  });
});

server.listen(port, () => {
  console.log(`Mini App server listening on http://127.0.0.1:${port}`);
});

if (botToken !== "") {
  if (!/^\d{1,15}$/u.test(allowedUserIdRaw)) {
    throw new Error("TELEGRAM_ALLOWED_USER_ID is required when TELEGRAM_BOT_TOKEN is set");
  }
  if (!publicOrigin.startsWith("https://")) {
    throw new Error("PUBLIC_ORIGIN must be an https:// URL when the Telegram bot is enabled");
  }
  void runTelegramLoop(Number.parseInt(allowedUserIdRaw, 10));
} else {
  console.log("Telegram loop disabled: set TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_USER_ID + PUBLIC_ORIGIN to enable it.");
}
