import { randomBytes } from "node:crypto";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeStyleText(css) {
  return css.replace(/<\/style/giu, "<\\/style");
}

function randomNonce() {
  return randomBytes(18).toString("base64url");
}

export function authoredArtifactPageCsp(nonce) {
  return [
    "default-src 'none'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' https://telegram.org 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src data: blob:",
    "frame-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function preFixCspForRegression() {
  return [
    "default-src 'none'",
    "style-src 'self'",
    "script-src 'self' https://telegram.org",
    "connect-src 'self'",
    "frame-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const FRAME_BRIDGE = `(() => {
  "use strict";
  const send = (kind, values) => parent.postMessage({
    source: "miniapp-artifact-frame",
    kind,
    ...(values ? { values } : {})
  }, "*");
  const status = () => document.querySelector("[data-artifact-status]");
  const say = (text) => { const node = status(); if (node) node.textContent = text; };
  const collect = () => {
    const values = {};
    const choiceIds = new Set();
    for (const node of document.querySelectorAll("[data-artifact-choice]")) {
      const id = node.getAttribute("data-artifact-choice");
      if (!id || choiceIds.has(id)) continue;
      choiceIds.add(id);
      const checked = document.querySelector('[data-artifact-choice="' + CSS.escape(id) + '"]:checked');
      if (checked) values[id] = checked.value;
    }
    for (const node of document.querySelectorAll("[data-artifact-rating]")) {
      const id = node.getAttribute("data-artifact-rating");
      if (!id || node.value === "") continue;
      const value = Number(node.value);
      if (Number.isFinite(value)) values[id] = value;
    }
    for (const node of document.querySelectorAll("[data-artifact-note]")) {
      const id = node.getAttribute("data-artifact-note");
      if (id) values[id] = node.value;
    }
    return values;
  };

  document.addEventListener("submit", (event) => event.preventDefault());
  document.addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (anchor) event.preventDefault();
    const button = event.target && event.target.closest ? event.target.closest("[data-artifact-submit]") : null;
    if (!button) return;
    event.preventDefault();
    button.disabled = true;
    if (document.body.dataset.artifactState === "submitted") {
      say("Handing the same interaction back…");
      send("renotify");
      return;
    }
    say("Saving…");
    send("submit", collect());
  });

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "miniapp-artifact-host") return;
    if (data.state === "submitted") document.body.dataset.artifactState = "submitted";
    if (typeof data.text === "string") say(data.text);
    const button = document.querySelector("[data-artifact-submit]");
    if (button) button.disabled = false;
  });
})();`;

function childCsp(nonce) {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function authoredSrcdoc(document, nonce, submitted) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(childCsp(nonce))}">
<style>${safeStyleText(document.css)}</style>
<script nonce="${nonce}">${FRAME_BRIDGE}<\/script>
</head>
<body data-artifact-state="${submitted ? "submitted" : "fresh"}">
${document.html}
</body>
</html>`;
}

const HOST_BRIDGE = `(() => {
  "use strict";
  const frame = document.querySelector("[data-authored-artifact]");
  if (!frame) return;
  const tell = (text, state = null) => {
    frame.contentWindow?.postMessage({
      source: "miniapp-artifact-host",
      text,
      ...(state ? { state } : {})
    }, "*");
  };
  const telegram = () => {
    const app = window.Telegram?.WebApp;
    return app && typeof app.sendData === "function" ? app : null;
  };

  window.addEventListener("message", async (event) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.source !== "miniapp-artifact-frame") return;

    if (data.kind === "renotify") {
      const wake = frame.dataset.submittedWake;
      if (!wake) {
        tell("No committed interaction is available yet.");
        return;
      }
      const app = telegram();
      if (!app) {
        tell("Already saved. Reopen this Artifact from Telegram to notify the bot again.", "submitted");
        return;
      }
      tell("Handing the same interaction back…", "submitted");
      app.sendData(wake);
      return;
    }

    if (data.kind !== "submit") return;

    tell("Saving…");
    try {
      const response = await fetch(frame.dataset.interactionEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: data.values }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.wake !== "string") {
        tell(response.status === 409
          ? "This Artifact already has a different committed submission."
          : "Not accepted. Check the values and try again.");
        return;
      }

      frame.dataset.submittedWake = body.wake;
      const app = telegram();
      if (!app) {
        tell("Saved. Reopen this Artifact from Telegram to hand it back.", "submitted");
        return;
      }

      tell("Handing it back to the bot…", "submitted");
      app.sendData(body.wake);
    } catch {
      tell("Could not reach the host. Try again.");
    }
  });
})();`;

export function renderAuthoredArtifactPage(
  document,
  { artifactId, interactionEndpoint, submittedWake = null },
) {
  const nonce = randomNonce();
  const submitted = typeof submittedWake === "string" && submittedWake.length > 0;
  const srcdoc = escapeHtml(authoredSrcdoc(document, nonce, submitted));
  const submittedAttr = submitted
    ? ` data-submitted-wake="${escapeHtml(submittedWake)}"`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${escapeHtml(document.title)}</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style nonce="${nonce}">html,body{margin:0;min-height:100%;background:#fff}.frame{display:block;width:100%;height:100dvh;border:0}</style>
</head>
<body>
<iframe
  class="frame"
  title="${escapeHtml(document.title)}"
  data-authored-artifact
  data-artifact-id="${escapeHtml(artifactId)}"
  data-interaction-endpoint="${escapeHtml(interactionEndpoint)}"${submittedAttr}
  sandbox="allow-scripts"
  srcdoc="${srcdoc}"
></iframe>
<script nonce="${nonce}">${HOST_BRIDGE}<\/script>
</body>
</html>`;

  return Object.freeze({
    html,
    csp: authoredArtifactPageCsp(nonce),
    nonce,
  });
}
