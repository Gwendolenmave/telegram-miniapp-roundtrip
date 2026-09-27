# Telegram Mini App Roundtrip

[简体中文](README.zh-CN.md)

**Open a Mini App from a bot, submit something inside it, and get that interaction back to the bot.**

Most Telegram Mini App examples stop here:

```text
bot → open Mini App
```

This repository shows the return trip:

```text
Telegram bot
    ↓ KeyboardButton.web_app
Mini App
    ↓ POST the full submission
your backend
    ↓ persist → return opaque event_ref
Mini App
    ↓ Telegram.WebApp.sendData({ ref })
Telegram message.web_app_data
    ↓
bot looks up the saved interaction
    ↓
reply / agent turn
```

The important idea is simple:

> **Persist the interaction first. Send only a small opaque reference through Telegram.**

That keeps the Telegram handoff tiny, makes retries idempotent, and lets the backend remain the authority for the submitted data.

This repository is a small reference implementation extracted from a real long-running Telegram + AI-agent integration.

## The whole trick

The Mini App saves the user's text to the backend:

```json
{
  "note": "hello from the Mini App"
}
```

The backend persists it and returns:

```json
{
  "event_ref": "ref_..."
}
```

The Mini App sends only this bounded wake payload to Telegram:

```json
{
  "v": 1,
  "kind": "artifact.interaction",
  "ref": "ref_..."
}
```

Telegram delivers that as `message.web_app_data`. The bot validates the sender, parses the reference, loads the saved interaction, and replies.

The full user submission never has to ride inside `sendData()`.

## Try it

Requires **Node.js 22+** and a Telegram bot token.

```sh
git clone https://github.com/Gwendolenmave/telegram-miniapp-roundtrip.git
cd telegram-miniapp-roundtrip
cp .env.example .env
```

Fill in:

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_ID=...
PUBLIC_ORIGIN=https://your-public-https-origin.example
```

Then:

```sh
npm run verify
npm start
```

`PUBLIC_ORIGIN` must be an HTTPS URL that your Telegram client can reach and that points to this server.

Send `/start` to the bot, tap **Open Mini App**, write something, and submit it. Telegram should close the Mini App and deliver a `web_app_data` service message back to the bot.

## What is in the reference implementation?

```text
public/index.html   Mini App UI + POST + sendData()
src/protocol.js    exact bounded wake-payload contract
src/store.js       tiny durable file-backed interaction store
src/server.js      HTTP server + Telegram long polling
test/              protocol and store tests
```

There is no Telegram framework and no web framework. The example uses Node's built-in `http`, `fetch`, `crypto`, and `node:test` so the round trip stays visible.

## Production rules

1. **Persist before `sendData()`.** Telegram should carry a reference to committed data, not be the only copy of the data.
2. **Treat `web_app_data` as ingress, not as a normal chat message.** Validate it separately.
3. **Authorize the sender and private chat.** Never accept an interaction just because the payload parses.
4. **Ignore `button_text` for trust decisions.** The useful field is `web_app_data.data`.
5. **Keep one update consumer per bot token.** A second `getUpdates` worker can create a 409 conflict.
6. **Make duplicate references harmless.** Telegram delivery and retries are not a reason to run the same agent turn twice.
7. **In a durable bot, own the update before advancing the offset.** Persist the interaction job first; acknowledge Telegram second.

## What this repository owns

Only the round-trip pattern:

- launch a Mini App from a Telegram bot;
- persist a submission;
- hand Telegram a bounded opaque reference;
- receive `message.web_app_data`;
- recover the persisted submission;
- hand it to a reply handler or agent.

Your application still owns authentication, model providers, memory, databases, deployment, secrets, observability, and product UI.

## Pitfalls

The useful part of this project is not just the happy path. The live integration found several easy-to-miss failures around `sendData()`, `web_app_data`, update ordering, CSP inheritance, and browser-only regressions.

Read **[Pitfalls from a real integration](docs/PITFALLS.md)** before turning the pattern into production infrastructure.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE.md). Personal use, study, modification, and noncommercial sharing are permitted; commercial use requires separate permission.

## Credits

Created by **Gwendolen & AmeliaGPT**.
