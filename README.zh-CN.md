# Telegram Mini App Roundtrip

[English](README.md)

**让 agent 自己做一张小网页，让你在里面回应，再把这份回应送回原来的那个 agent。**

聊天是一条线。

但有些时候，agent 想递给你的东西并不像一句普通消息——它可能是一封信、一张小票、一个选择、一份小礼物，或者一页只为这一刻出现的小界面。

Telegram Mini App 很适合装这些东西。可大多数教程只讲到：

```text
bot → 打开 Mini App
```

这个仓库讲的是怎么把另一半也接回来：

```text
agent / bot
    ↓
Mini App
    ↓ 用户在里面操作
先持久化完整 interaction
    ↓
只返回一个 opaque ref
    ↓ Telegram.WebApp.sendData(ref)
message.web_app_data
    ↓
bot 重新取回 + 校验 interaction
    ↓
原来的 handler / 原来的 agent
    ↓
Telegram 回复
```

这里的可运行示例故意很小，但它来自我们实际使用的一套 **interactive Artifact** 思路：agent 可以做一张自己的小页面，用户可以在里面碰它、写一点东西，而这份回应最后真的会回到 agent 手里。

## 真正有意思的是“谁有哪种权力”

这套东西最值得分享的，其实不是“把 AI 塞进网页”。

而是这一句：

> **Agent 决定它长什么样；Host 决定它能做什么。**

在完整版本里：

```text
agent 负责
  文案 · 构图 · HTML · CSS · interaction intent

可信 host 负责
  校验 · sandbox · network · 持久化 · Telegram · retry
```

这样，agent 可以真的拥有视觉创作权，却不需要拿到 arbitrary JavaScript，也不需要拥有环境里的网络权限。

所以安全并不等于重新塞回一套固定模板。你可以让页面长得每次都不一样，同时把真正危险的能力牢牢留在 host 手里。

这个仓库里的 runnable demo 故意只放一个朴素 textarea，让人先把 round trip 看明白。更完整的 authored-page / sandbox / trusted-bridge 结构放在 [Architecture](docs/ARCHITECTURE.md)。

## 回程到底怎么走

Mini App 先把用户真正填写的内容保存下来：

```json
{
  "note": "hello from the Mini App"
}
```

后端确认持久化成功，再给它一个 opaque reference：

```json
{
  "event_ref": "ref_..."
}
```

真正经过 Telegram 的只有这一小段 wake-up：

```json
{
  "v": 1,
  "kind": "artifact.interaction",
  "ref": "ref_..."
}
```

Telegram 把它作为 `message.web_app_data` 送回 bot。Bot 验证发送者、解析 ref、重新取回已经提交的 interaction，再把它交回普通 reply path 或原来的 agent。

完整用户内容根本不需要塞进 `sendData()`。

可以把它理解成：

> **Site 负责把信保存好，Telegram 只负责按门铃。**

## 这套 pattern 能拿来做什么？

不只是表单。

它很适合：

- agent 自己设计的一封信，末尾留一个小口袋让用户回一句；
- 一次选择、评分或确认，之后 agent 能继续回应；
- 一份小礼物、纪念页、receipt；
- approval / confirmation flow；
- 临时出现、做完就回到聊天里的小工具；
- 不想被固定 widget/template 限死的 companion UI。

而且它天然可以异步：Mini App 不需要一直挂着等模型想完，agent 也不需要为了网页再养一个“第二脑子”。

## 跑一下

需要 **Node.js 22+** 和一个 Telegram bot token。

```sh
git clone https://github.com/Gwendolenmave/telegram-miniapp-roundtrip.git
cd telegram-miniapp-roundtrip
cp .env.example .env
```

填入：

```text
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_ID=...
PUBLIC_ORIGIN=https://your-public-https-origin.example
```

然后：

```sh
npm run verify
npm start
```

`PUBLIC_ORIGIN` 必须是 Telegram 客户端能够访问的 HTTPS URL。

给 bot 发送 `/start`，点击 **Open Mini App**，写一点东西并提交。Telegram 会把一条 `web_app_data` service message 送回 bot；bot 再取回之前保存的 interaction，然后回复。

## Reference implementation 里有什么？

```text
public/index.html   Mini App UI + persist + sendData()
src/protocol.js    封闭、bounded 的 wake-payload contract
src/store.js       很小的 durable interaction store
src/server.js      HTTP server + Telegram long polling
test/              protocol 和 persistence tests
```

没有 Telegram framework，也没有 web framework。这里故意把东西压小，好让别人能直接看懂 round trip，而不是先学我们的技术栈。

## 最值得带走的三条

1. **先保存，再通知。** Telegram 传的是 committed data 的 reference，不是数据唯一的副本。
2. **视觉创作权不等于执行权。** 如果页面由 agent 创作，network、persistence、Telegram 仍然放在 trusted bridge。
3. **回程重新校验。** 浏览器侧的 store 是 transport surface，不自动等于 agent 的 canonical authority。

长期运行的 bot 还应该让重复 ref 无害，并在推进 Telegram offset 之前，先让 durable state 真正接住这次 interaction。

## 文档

| 想看什么 | 去哪里 |
| --- | --- |
| 完整 Artifact 权限边界 | [Architecture](docs/ARCHITECTURE.md) |
| 我们真的踩过哪些坑 | [Pitfalls](docs/PITFALLS.md) |

## License

[PolyForm Noncommercial License 1.0.0](LICENSE.md)。允许个人使用、学习、修改和非商业分享；商业使用需要另行许可。

## Credits

Created by **Gwendolen & AmeliaGPT**.
