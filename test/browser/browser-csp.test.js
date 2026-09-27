import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { chromium } from "playwright";

import { makeWakePayload } from "../../src/protocol.js";
import { DEMO_ARTIFACT, DEMO_ARTIFACT_ID } from "../../src/example-artifact.js";
import {
  preFixCspForRegression,
  renderAuthoredArtifactPage,
} from "../../src/render-artifact.js";

async function serve({ cspOverride = null, submittedWake = null } = {}) {
  const submissions = [];
  const rendered = renderAuthoredArtifactPage(DEMO_ARTIFACT, {
    artifactId: DEMO_ARTIFACT_ID,
    interactionEndpoint: `/api/artifacts/${DEMO_ARTIFACT_ID}/interactions`,
    submittedWake,
  });

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": cspOverride ?? rendered.csp,
      });
      response.end(rendered.html);
      return;
    }

    if (
      request.method === "POST" &&
      request.url === `/api/artifacts/${DEMO_ARTIFACT_ID}/interactions`
    ) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      submissions.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const ref = `ref_${"a".repeat(32)}`;
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({
        event_ref: ref,
        wake: makeWakePayload(ref),
      }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing_test_address");

  return {
    url: `http://127.0.0.1:${address.port}/`,
    submissions,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function installTelegramStub(page) {
  await page.route("https://telegram.org/js/telegram-web-app.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `
        window.__telegramWake = null;
        window.Telegram = {
          WebApp: {
            ready() {},
            expand() {},
            sendData(value) { window.__telegramWake = value; }
          }
        };
      `,
    });
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push(event.violatedDirective);
    });
  });
}

async function authoredFrame(page) {
  await page.waitForSelector("iframe[data-authored-artifact]");
  const frame = page.frames().find((candidate) => candidate.parentFrame() !== null);
  if (!frame) throw new Error("authored_frame_missing");
  return frame;
}

test("real Chromium applies authored CSS and runs only the trusted bridge", async () => {
  const app = await serve();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await installTelegramStub(page);
    await page.goto(app.url);

    const frame = await authoredFrame(page);
    assert.equal(
      await frame.evaluate(() => getComputedStyle(document.body).backgroundColor),
      "rgb(13, 23, 37)",
    );
    assert.equal(
      await frame.locator("h1").evaluate((node) => getComputedStyle(node).fontSize),
      "34px",
    );

    await frame.locator('input[value="playful"]').check();
    await frame.locator("[data-artifact-note]").fill("hello from chromium");
    await frame.locator("[data-artifact-submit]").click();

    await page.waitForFunction(() => typeof window.__telegramWake === "string");
    assert.deepEqual(app.submissions, [{
      values: { mood: "playful", reply: "hello from chromium" },
    }]);

    const wake = await page.evaluate(() => window.__telegramWake);
    assert.match(wake, /"kind":"artifact\.interaction"/u);

    for (const candidate of page.frames()) {
      const violations = await candidate.evaluate(() => window.__cspViolations ?? []);
      assert.deepEqual(violations, []);
    }
  } finally {
    await browser.close();
    await app.close();
  }
});

test("the pre-fix parent CSP reproduces the naked-HTML bug", async () => {
  const app = await serve({ cspOverride: preFixCspForRegression() });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await installTelegramStub(page);
    await page.goto(app.url);

    const frame = await authoredFrame(page);
    assert.notEqual(
      await frame.evaluate(() => getComputedStyle(document.body).backgroundColor),
      "rgb(13, 23, 37)",
    );

    await frame.locator("[data-artifact-submit]").click();
    await page.waitForTimeout(250);
    assert.equal(app.submissions.length, 0);
    assert.equal(await page.evaluate(() => window.__telegramWake), null);
  } finally {
    await browser.close();
    await app.close();
  }
});


test("a reopened single-submit Artifact re-notifies with the same ref without a second POST", async () => {
  const wake = makeWakePayload(`ref_${"b".repeat(32)}`);
  const app = await serve({ submittedWake: wake });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await installTelegramStub(page);
    await page.goto(app.url);

    const frame = await authoredFrame(page);
    await frame.locator("[data-artifact-submit]").click();

    await page.waitForFunction(() => typeof window.__telegramWake === "string");
    assert.equal(await page.evaluate(() => window.__telegramWake), wake);
    assert.equal(app.submissions.length, 0);
  } finally {
    await browser.close();
    await app.close();
  }
});
