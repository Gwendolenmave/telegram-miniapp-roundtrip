# Pitfalls from a real integration

These are not hypothetical style preferences. They are failure modes that showed up while turning the pattern into a live Telegram Mini App + agent loop.

## 1. "Transferred to the bot" does not mean the bot already processed it

After `Telegram.WebApp.sendData()`, Telegram may show a toast such as:

```text
Data from the button was transferred to the bot.
```

That proves the client accepted the handoff. It does **not** prove your bot has already polled, persisted, looked up, and processed the interaction.

A production loop may legitimately take another poll/tick before the agent replies.

Treat the UI toast as:

```text
client handoff accepted
```

not:

```text
agent has read the submission
```

## 2. `web_app_data` is a Message field

Telegram does not deliver Mini App data as a special top-level update type.

It arrives on a normal message:

```text
update.message.web_app_data.data
```

If your update parser only recognizes text/photo/voice and drops unknown Message fields, the handoff disappears before your business logic ever sees it.

## 3. Launch method matters

For the return path demonstrated here, launch the Mini App with a **reply-keyboard Web App button**:

```text
KeyboardButton.web_app
```

Do not assume every way of opening a Telegram Mini App has the same `sendData()` return semantics.

Keep the launch path explicit and test the exact client flow you ship.

## 4. Persist the real submission before calling `sendData()`

The tempting version is:

```text
Mini App
→ sendData(full user payload)
→ bot
```

A more durable shape is:

```text
Mini App
→ POST full submission
→ persist
→ receive opaque event_ref
→ sendData(event_ref)
→ bot looks up committed submission
```

That gives you one authority for the submitted values, a bounded Telegram payload, and a clean retry/idempotency key.

## 5. Do not trust `button_text`

Telegram includes both:

```text
web_app_data.data
web_app_data.button_text
```

The visible button label is presentation, not authority.

Parse and validate `data`. Do not use `button_text` to decide what operation is allowed.

## 6. One bot token should have one update consumer

A live long-polling bot plus a "quick debug" `getUpdates` script is still two consumers.

Telegram may answer with:

```text
409 Conflict
```

and a correctly defensive production runtime may stop itself to avoid split-brain processing.

Inspect logs, durable receipts, or your own state. Do not probe a live bot by starting a second poller.

## 7. Own the update before advancing the offset

In a durable bot, the safe order is:

```text
receive web_app_data
→ validate
→ persist a subordinate interaction job
→ only then advance Telegram offset
```

If persistence fails first, leave the offset behind so Telegram can redeliver.

Acknowledging first creates the classic crash window:

```text
offset advanced
→ process crashes
→ interaction never became durable
→ Telegram will not send it again
```

The tiny reference implementation in this repo is intentionally simpler than a full production queue, but this invariant is worth keeping when you harden it.

## 8. Duplicate notification must be harmless

A user may tap again, Telegram may redeliver, or your own retry path may notify the same reference twice.

Use a stable opaque reference and make this safe:

```text
same ref
→ same committed interaction
→ at most one logical agent action
```

Do not generate a second semantic event just because transport repeated.

## 9. Async ordering can make a healthy system look broken

A real bot may process ordinary chat and Mini App interaction work in separate lanes.

This can happen:

```text
Mini App submit
→ Telegram accepts sendData
→ user immediately types "did you get it?"
→ ordinary message is answered first
→ interaction lane finishes moments later
→ agent then replies to the Mini App submission
```

That is a UX ordering issue, not necessarily data loss.

Do not diagnose from message order alone. Inspect the durable interaction state.

## 10. `srcdoc` inherits the embedder's CSP

This was the nastiest bug in the live integration.

The authored page lived inside:

```html
<iframe sandbox="allow-scripts" srcdoc="...">
```

The frame's own meta CSP allowed its inline stylesheet and a nonced trusted bridge. But the outer response still sent:

```text
style-src 'self'
script-src 'self' https://telegram.org
```

A `srcdoc` document inherits the embedder's CSP. Both policies must allow the resource.

Result:

- authored HTML appeared;
- CSS was present in storage;
- the page rendered like naked browser defaults;
- the trusted bridge script was also blocked.

The fix was not "make the design prompt stronger". It was to give the V2 response a narrowly scoped parent policy that allowed the exact capabilities the frame needed.

## 11. A child CSP cannot loosen the parent CSP

This is the subtle part of the previous bug.

Putting:

```text
style-src 'unsafe-inline'
script-src 'nonce-...'
```

inside the frame does not override a stricter parent policy.

Effective policy is the intersection.

If the parent says no, the child cannot say yes.

## 12. `default-src 'none'` also blocks fetch unless `connect-src` is opened

A page can look perfect and still fail on submit.

If your response policy says:

```text
default-src 'none'
```

and omits `connect-src`, then a same-origin `fetch()` is blocked too.

For a trusted parent bridge that POSTs to your own Site, explicitly allow:

```text
connect-src 'self'
```

Keep the model-authored/opaque frame itself at `connect-src 'none'` if the frame should have no network authority.

## 13. Do not globally relax CSP to fix one dynamic page

The easy patch is:

```text
style-src 'self' 'unsafe-inline'
script-src 'self' 'unsafe-inline'
```

for the whole Site.

Do not do that.

Scope the policy to the one response that actually needs dynamic inline CSS, and authorize trusted script with a nonce or hash rather than broad `'unsafe-inline'`.

The principle is:

> **Widen one capability boundary, not the entire application.**

## 14. "The CSS string is in the HTML" is not a browser test

Our original tests proved that the CSS text had been inserted into `srcdoc`.

They all passed while the real browser blocked the stylesheet.

A useful regression test must ask the browser what the user actually gets:

```text
getComputedStyle(frame.body).backgroundColor
getComputedStyle(control).fontSize
```

For CSP bugs, also listen for `securitypolicyviolation`.

A negative control is valuable: re-run the same browser test with the pre-fix policy and prove that it fails.

## 15. A browser test that silently skips is not a hard gate

Headless browser tests often need a downloaded browser binary and system libraries.

If CI installs JavaScript packages but no Chromium, a test can "pass" only because it never ran.

Make the distinction visible:

```text
PASS = browser executed and assertions passed
SKIP = browser unavailable
```

If the regression is important enough to gate release, install the browser explicitly in CI.

## 16. If AI authors the Mini App, constrain capabilities instead of visual layout

The live integration wanted the agent to design each Artifact freely.

The safe split was:

```text
agent authors HTML + CSS
trusted host owns network + persistence + Telegram
agent-authored page gets no arbitrary JS
```

That preserves visual creativity without giving generated markup ambient network or execution authority.

Do not solve safety by reintroducing a finite visual template system unless templates are actually the product you want.

## The meta-lesson

Most of the difficult bugs were not "Telegram API bugs".

They were boundary bugs:

- client handoff vs. server processing;
- transport payload vs. canonical data;
- update receipt vs. durable ownership;
- child policy vs. parent CSP;
- source-string tests vs. real browser behavior;
- visual freedom vs. executable authority.

The round trip stays manageable when each boundary has one clear owner.
