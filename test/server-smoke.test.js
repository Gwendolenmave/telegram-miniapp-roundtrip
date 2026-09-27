import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing_address");
  return address.port;
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("wait_timeout");
}

test("a stranger can boot the real server and complete the authored Artifact roundtrip", async () => {
  const root = await mkdtemp(join(tmpdir(), "miniapp-server-smoke-"));
  const capability = "A".repeat(43);
  const allowedUserId = 123456;
  const chatId = 654321;
  const sentMessages = [];
  let pendingUpdate = null;

  const telegramStub = createServer((request, response) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length === 0
        ? {}
        : JSON.parse(Buffer.concat(chunks).toString("utf8"));

      if (request.url === "/botTEST_TOKEN/getUpdates") {
        if (pendingUpdate !== null) {
          const update = pendingUpdate;
          pendingUpdate = null;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true, result: [update] }));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result: [] }));
        return;
      }

      if (request.url === "/botTEST_TOKEN/sendMessage") {
        sentMessages.push(body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result: { message_id: sentMessages.length } }));
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });

  const telegramPort = await listen(telegramStub);
  const appPort = await freePort();
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: "TEST_TOKEN",
      TELEGRAM_ALLOWED_USER_ID: String(allowedUserId),
      PUBLIC_ORIGIN: "https://example.invalid",
      ARTIFACT_CAPABILITY: capability,
      PORT: String(appPort),
      DATA_FILE: join(root, "interactions.json"),
      OFFSET_FILE: join(root, "offset.json"),
      TELEGRAM_API_ORIGIN: `http://127.0.0.1:${telegramPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  try {
    const origin = `http://127.0.0.1:${appPort}`;

    await waitFor(async () => {
      try {
        const response = await fetch(`${origin}/health`);
        return response.ok;
      } catch {
        return false;
      }
    });

    assert.equal((await fetch(`${origin}/artifact`)).status, 404);

    const artifactPath = `/artifact/${capability}`;
    const artifactResponse = await fetch(`${origin}${artifactPath}`);
    assert.equal(artifactResponse.status, 200);
    const artifactHtml = await artifactResponse.text();
    assert.match(artifactHtml, /data-authored-artifact/u);
    assert.match(artifactResponse.headers.get("content-security-policy") ?? "", /nonce-/u);

    const interactionPath = `/api/artifacts/${capability}/interactions`;
    const submit = async (values) => fetch(`${origin}${interactionPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values }),
    });

    const firstResponse = await submit({ mood: "quiet", reply: "hello from stranger smoke" });
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    assert.equal(first.status, "submitted");
    assert.match(first.event_ref, /^ref_[A-Za-z0-9_-]+$/u);
    assert.match(first.wake, /"kind":"artifact\.interaction"/u);

    const replayResponse = await submit({ reply: "hello from stranger smoke", mood: "quiet" });
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    assert.equal(replay.status, "existing");
    assert.equal(replay.event_ref, first.event_ref);

    const conflict = await submit({ mood: "playful", reply: "different answer" });
    assert.equal(conflict.status, 409);

    pendingUpdate = {
      update_id: 100,
      message: {
        message_id: 10,
        chat: { id: chatId, type: "private" },
        from: { id: allowedUserId },
        web_app_data: {
          data: first.wake,
          button_text: "Open authored Artifact",
        },
      },
    };

    const sent = await waitFor(() =>
      sentMessages.find((message) =>
        message.chat_id === chatId &&
        typeof message.text === "string" &&
        message.text.includes("Received from the authored Artifact")
      )
    );
    assert.match(sent.text, /hello from stranger smoke/u);
    assert.match(sent.text, /mood: quiet/u);

    const offset = await waitFor(async () => {
      try {
        return JSON.parse(await readFile(join(root, "offset.json"), "utf8"));
      } catch {
        return null;
      }
    });
    assert.equal(offset.offset, 101);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nserver output:\n${childOutput}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise((resolve) => telegramStub.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
