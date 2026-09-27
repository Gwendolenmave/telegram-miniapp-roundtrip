(() => {
  "use strict";
  const form = document.querySelector("#note-form");
  const note = document.querySelector("#note");
  const status = document.querySelector("#status");
  if (!(form instanceof HTMLFormElement) || !(note instanceof HTMLTextAreaElement) || !status) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = note.value.trim();
    if (!text) return;
    const button = form.querySelector("button");
    if (button instanceof HTMLButtonElement) button.disabled = true;
    status.textContent = "Saving…";

    try {
      const response = await fetch("/api/interactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: text }),
      });
      const body = await response.json();
      if (!response.ok || !body || typeof body.wake !== "string") {
        status.textContent = "The server did not accept the note.";
        return;
      }

      const app = window.Telegram?.WebApp;
      if (!app || typeof app.sendData !== "function") {
        status.textContent = "Saved. Open this page from the bot's Web App keyboard button to send it back.";
        return;
      }
      status.textContent = "Handing the reference to Telegram…";
      app.sendData(body.wake);
    } catch {
      status.textContent = "Could not reach the server.";
    } finally {
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  });
})();
