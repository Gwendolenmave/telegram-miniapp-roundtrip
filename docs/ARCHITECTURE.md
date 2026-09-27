# Architecture

This document describes the fuller Artifact pattern behind the tiny runnable round trip in this repository.

The demo uses one static textarea on purpose. The production pattern can go further: the agent may author the page itself while the host keeps executable and network authority.

## The central split

An Artifact has two very different kinds of authorship:

```text
visual / semantic authorship
        belongs to the agent

executable / transport authority
        belongs to the host
```

A useful contract looks like:

```text
agent output
  ├── HTML
  ├── CSS
  └── typed interaction specs
            ↓
host validation
            ↓
opaque sandboxed page
            ↓
trusted bridge
  ├── persistence
  ├── network
  └── Telegram
```

The agent can decide whether a page feels like a letter, a ticket, a tiny control panel, a receipt, or something stranger. The host does not need to choose from a fixed theme/layout enum.

At the same time, model-authored markup does not get arbitrary JavaScript, navigation, forms, or network access.

## Typed behavior, free presentation

The page may be visually free while interaction semantics remain typed.

For example:

```text
choice
rating
note
```

The agent can decide how those controls look and where they live in the composition. The host still knows exactly which fields exist, which values are legal, which are required, and how to validate the returned event.

That is a much smaller trust surface than “let the model write a full app”.

## Trusted bridge

A production authored page can live in an opaque sandbox:

```html
<iframe sandbox="allow-scripts" srcdoc="...">
```

The authored frame owns presentation. A fixed host bridge owns capabilities.

A typical boundary is:

```text
authored frame
  ↓ postMessage({ kind: "submit", values })
trusted parent
  ↓ validate
  ↓ POST to same-origin interaction endpoint
  ↓ receive opaque event_ref
  ↓ Telegram.WebApp.sendData(ref)
```

The frame itself can stay network-free.

Do not add `allow-same-origin` unless you have a specific reason and have re-evaluated the isolation model.

## CSP is part of the architecture

A `srcdoc` frame inherits the embedder's Content Security Policy. The child policy cannot loosen the parent policy.

That means the outer response must intentionally allow the capabilities the frame genuinely needs.

One workable split is:

```text
parent response
  style-src 'self' 'unsafe-inline'
  script-src 'self' https://telegram.org 'nonce-...'
  connect-src 'self'

authored frame
  connect-src 'none'
  frame-src 'none'
  object-src 'none'
  form-action 'none'
```

The exact policy is application-specific. The invariant is not “use these strings”; it is:

> The trusted parent may have the minimum network authority required for persistence and Telegram. The authored page should not inherit more authority than it needs.

## Persist, then notify

The interaction values are committed before Telegram is notified:

```text
user submits
→ Site validates + persists event
→ Site returns event_ref
→ Mini App sends only event_ref through Telegram
```

Telegram therefore carries a wake-up, not the canonical interaction body.

This gives the system a durable place to recover from if the client closes, the bot restarts, or the Telegram notification is repeated.

## Revalidate on the bot side

The Site is a browser-facing boundary. It should not define the agent's canonical schema by itself.

When the bot follows an `event_ref` back to the Site:

```text
fetch persisted interaction
→ load the Artifact/document it belongs to
→ revalidate event values against that canonical interaction spec
→ import/commit locally
→ wake the handler or agent
```

Unknown fields, invalid choices, oversized notes, stale artifact ids, and duplicate submissions should fail according to host policy.

## Wake asynchronously

A Mini App submission does not need to become an inline model call.

A durable host can split it into two small jobs:

```text
pull interaction
  → fetch + revalidate + commit locally

wake agent
  → run normal agent turn + persist reply + deliver
```

That separation makes retries easier and prevents a browser request from owning the lifetime of a model turn.

It also explains a UX detail from the live integration: a user can submit an Artifact, immediately type a normal Telegram message, receive that reply first, and then receive the Artifact response a moment later. Message order alone is not proof of data loss.

## One agent, not an Artifact-specific second brain

The Mini App should not need a separate persona or semantic rewriter.

The interaction becomes another trusted event that can be handed to the same agent/runtime that already owns identity, memory, tools, and conversation context.

The Artifact changes the surface, not the author.

## Artifact is not automatically memory

A durable user-facing object is not the same thing as long-term memory.

Keep those concerns separate:

```text
Artifact
  = user-facing object + interaction history

Memory
  = curated context the agent may retrieve later
```

An Artifact can be searchable or retrievable by explicit product rules without silently dumping its full body into memory extraction, summaries, or embeddings.

## Reliability boundaries

For a long-running bot, keep these orderings explicit:

```text
interaction:
persist submission → notify Telegram

Telegram ingress:
validate wake → durably own/enqueue work → advance update offset

agent reply:
generate → persist canonical reply → deliver

retry:
same ref/event id → same logical interaction
```

Exactly-once execution is not required. Stable identifiers and idempotent effects are usually enough to avoid duplicate user-visible behavior.

## What the runnable repository includes

The repository now ships both layers:

```text
/           minimal static textarea roundtrip
/artifact   authored HTML/CSS + typed interactions + opaque sandbox + trusted bridge
```

The authored route implements the reusable Artifact core from this document. It deliberately stops before product-specific concerns such as a model provider, memory system, D1 schema, transcript store, or a large durable job scheduler.

The bot-side example still preserves the important recovery boundary: interaction values are persisted, revalidated against the Artifact document, a canonical reply is persisted before delivery, and the Telegram update offset is durable.

Read [PITFALLS.md](PITFALLS.md) for the bugs we hit while building the full version.
