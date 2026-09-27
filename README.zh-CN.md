# Telegram Mini App Roundtrip

[English](README.md)

**从 Bot 打开 Mini App，在里面提交内容，再把这次交互送回 Bot。**

很多 Telegram Mini App 教程只讲到这里：

```text
bot → 打开 Mini App
```

这个仓库讲的是回程：

```text
Telegram bot
    ↓ KeyboardButton.web_app
Mini App
    ↓ POST 完整提交内容
你的后端
    ↓ 持久化 → 返回 opaque event_ref
Mini App
    ↓ Telegram.WebApp.sendData({ ref })
Telegram message.web_app_data
    ↓
bot 找回已保存的 interaction
    ↓
reply / agent turn
```

核心只有一句：

> **先持久化 interaction。通过 Telegram 只发送一个小而 opaque 的 reference。**

这样 Telegram handoff 会一直很小，retry 更容易做成幂等，真正的提交内容也仍然由你的后端负责。

这个仓库是一套从真实长期运行的 Telegram + AI agent 集成里抽出来的小型 reference implementation。

## 整个技巧

Mini App 先把用户输入保存到后端：

```json
{
  "note": "hello from the Mini App"
}
```

后端持久化后返回：

```json
{
  "event_ref": "ref_..."
}
```

Mini App 再只把这份 bounded wake payload 交给 Telegram：

```json
{
  "v": 1,
  "kind": "artifact.interaction",
  "ref": "ref_..."
}
```

Telegram 会把它作为 `message.web_app_data` 送回 bot。Bot 验证发送者、解析 reference、加载已保存的 interaction，再交给普通 reply handler 或 agent。

完整用户提交不需要塞进 `sendData()`。

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

`PUBLIC_ORIGIN` 必须是 Telegram 客户端能够访问、并指向这个 server 的 HTTPS URL。

给 bot 发送 `/start`，点击 **Open Mini App**，写一点内容并提交。Telegram 应该关闭 Mini App，并把一条 `web_app_data` service message 送回 bot。

## Reference implementation 里有什么？

```text
public/index.html   Mini App UI + POST + sendData()
src/protocol.js    精确、bounded 的 wake-payload contract
src/store.js       很小的持久化 file-backed interaction store
src/server.js      HTTP server + Telegram long polling
test/              protocol 和 store tests
```

没有 Telegram framework，也没有 web framework。示例只用 Node 自带的 `http`、`fetch`、`crypto` 和 `node:test`，让整条 round trip 一眼能看明白。

## Production 只记七条

1. **先 persist，再 `sendData()`。** Telegram 应该传 committed data 的 reference，而不是成为这份数据唯一的副本。
2. **把 `web_app_data` 当成独立 ingress。** 不要把它当普通聊天消息处理。
3. **验证 sender 和 private chat。** 不能因为 payload 格式合法就接受 interaction。
4. **不要信任 `button_text`。** 真正有用的是 `web_app_data.data`。
5. **一个 bot token 只保留一个 update consumer。** 第二个 `getUpdates` worker 可能触发 409 conflict。
6. **重复 reference 必须无害。** Telegram redelivery 或 retry 不应该让同一个 interaction 跑两次 agent turn。
7. **长期运行的 bot 要先让 durable state 接住 update，再推进 offset。** 先持久化 interaction job，再 acknowledge Telegram。

## 这个仓库只负责什么

只负责这条 round-trip pattern：

- 从 Telegram bot 打开 Mini App；
- 持久化一次 submission；
- 给 Telegram 一个 bounded opaque reference；
- 接收 `message.web_app_data`；
- 找回已持久化的 submission；
- 把它交给 reply handler 或 agent。

认证、model provider、memory、database、deployment、secret、observability 和产品 UI 仍然属于你的应用。

## Pitfalls

这个项目真正值钱的不只是 happy path。真实接入过程中，我们踩过不少很容易漏掉的坑：`sendData()`、`web_app_data`、update ordering、CSP inheritance，以及“测试绿了但真实浏览器没跑”的假象。

生产化之前建议先读 **[真实集成踩坑记录](docs/PITFALLS.md)**。

## License

[PolyForm Noncommercial License 1.0.0](LICENSE.md)。允许个人使用、学习、修改和非商业分享；商业使用需要另行许可。

## Credits

Created by **Gwendolen & AmeliaGPT**.
