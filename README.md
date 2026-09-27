# Telegram Mini App Roundtrip

[简体中文](README.zh-CN.md)

**Let an agent make a little page, let the user answer inside it, and carry that answer back to the same agent.**

Chat is a line. Sometimes an agent wants to hand you something that feels more like an object: a letter, a tiny form, a receipt, a choice, a gift, a one-off little interface.

Telegram Mini Apps are a lovely surface for that. But most examples stop at:

```text
bot → open Mini App
```

This repository closes the loop:

```text
agent / bot
    ↓
Mini App
    ↓ user interacts
persist the full submission
    ↓
return one opaque ref
    ↓ Telegram.WebApp.sendData(ref)
message.web_app_data
    ↓
bot reloads + revalidates the interaction
    ↓
same handler / same agent
    ↓
Telegram reply
```

The runnable example is intentionally tiny, but it comes from a larger pattern we use for **interactive Artifacts**: small pages an agent can author, a user can touch, and the agent can hear back from.

## The interesting part is the authority split

The useful design is not “put an AI inside a web page”.

It is:

> **The agent decides what the Artifact looks like. The host decides what the Artifact is allowed to do.**

In the fuller pattern:

```text
agent owns
  words · composition · HTML · CSS · interaction intent

trusted host owns
  validation · sandbox · network · persistence · Telegram · retries
```

That gives the agent real visual authorship without giving generated markup arbitrary JavaScript or ambient network authority.

You do not need a finite template library to stay safe, and you do not need to give the model the keys to the browser either.

The small app in this repository uses a plain textarea so the transport stays easy to read. See [Architecture](docs/ARCHITECTURE.md) for the authored-page version of the same boundary.

## The return trip

The Mini App saves the real submission first:

```json
{
  "note": "hello from the Mini App"
}
```

The backend commits it and returns an opaque reference:

```json
{
  "event_ref": "ref_..."
}
```

Only that bounded wake-up goes through Telegram:

```json
{
  "v": 1,
  "kind": "artifact.interaction",
  "ref": "ref_..."
}
```

Telegram delivers it as `message.web_app_data`. The bot validates the sender, parses the reference, reloads the committed interaction, and hands it to the normal reply path or agent.

The full user submission never has to ride inside `sendData()`.

That separation matters: **the Site stores the interaction; Telegram only rings the doorbell.**

## Why this pattern is useful

It works for much more than a demo form:

- an agent-authored letter with one little reply field;
- a choice or rating the agent can respond to;
- a small gift or keepsake with an interaction inside it;
- approval / confirmation flows;
- one-off tools that should return to the same conversation;
- companion interfaces that should feel authored, not assembled from a fixed widget catalog.

The interaction can be asynchronous. The Mini App does not need to hold an HTTP request open while the agent thinks, and the agent does not need a second “Mini App brain”.

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

`PUBLIC_ORIGIN` must be an HTTPS URL that your Telegram client can reach.

Send `/start` to the bot, tap **Open Mini App**, write something, and submit it. Telegram should deliver a `web_app_data` service message back to the bot, which reloads the saved interaction and replies.

## What is in the reference implementation?

```text
public/index.html   Mini App UI + persist + sendData()
src/protocol.js    closed, bounded wake-payload contract
src/store.js       tiny durable interaction store
src/server.js      HTTP server + Telegram long polling
test/              protocol and persistence tests
```

There is no Telegram framework and no web framework. The point is to keep the round trip visible enough that you can steal the pattern without adopting somebody else's stack.

## Three rules worth keeping

1. **Persist first, notify second.** Telegram carries a reference to committed data, not the only copy of the data.
2. **Visual authorship is not executable authority.** If an agent authors the page, keep network, persistence, and Telegram in a trusted bridge.
3. **Revalidate on the way back.** A browser-facing store is transport, not your agent's canonical authority.

For long-running bots, also make duplicate refs harmless and durably own the interaction before advancing the Telegram update offset.

## Documentation

| Need | Read |
| --- | --- |
| understand the full Artifact boundary | [Architecture](docs/ARCHITECTURE.md) |
| see the bugs that shaped the design | [Pitfalls](docs/PITFALLS.md) |

## License

[PolyForm Noncommercial License 1.0.0](LICENSE.md). Personal use, study, modification, and noncommercial sharing are permitted; commercial use requires separate permission.

## Credits

Created by **Gwendolen & AmeliaGPT**.
