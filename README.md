# CodexBridge

[中文说明（README.zh-CN）](./README.zh-CN.md)
| [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Whelam.codexbridge)

CodexBridge is a VS Code extension that connects local Codex session history with Telegram.

## Features

- Read Codex session files from `~/.codex/sessions`.
- Show recent tasks in Telegram via `/tasks`.
- View the latest 5 messages after selecting a task.
- Run an independent Telegram chat flow (does not modify VS Code Codex thread).

## Important Limitation

- Telegram chat is **independent** from the VS Code Codex chat panel.
- This extension **cannot** fully synchronize Telegram messages into the live Codex UI thread.
- It is designed to avoid interfering with your Codex panel conversation.

## Extension Settings

- `codexbridge.telegramToken`: Telegram bot token.
- `codexbridge.telegramChatId`: Telegram chat ID.
- `codexbridge.sessionPath`: Codex session directory (default `${env:HOME}/.codex/sessions`).
- `codexbridge.codexBinary`: Codex CLI binary path (default `codex`).

## Quick Start

1. Install the extension in VS Code.
2. Create a Telegram bot with `@BotFather`:
   - Send `/newbot` to `@BotFather`.
   - Set a bot name and username.
   - Copy the returned bot token.
3. Get your Telegram `chat_id`:
   - Start a chat with your bot and send any message (for example: `hello`).
   - Open:
     - `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Find `message.chat.id` from the JSON response.
4. Configure extension settings in VS Code:
   - `codexbridge.telegramToken` = your bot token
   - `codexbridge.telegramChatId` = your `chat_id`
   - Optional: `codexbridge.sessionPath`, `codexbridge.codexBinary`
5. Reload VS Code window.
6. In Telegram:
   - send `/tasks`
   - pick one task to view recent history
   - send messages to use independent TG chat mode

## QR Code Image

Use the QR code image below:

![Telegram QR Code](./assets/qrcode/qr-code.png)

If you find this project useful, you are welcome to sponsor me.

## Privacy & Data

- This extension reads local files under your configured `sessionPath`.
- Messages sent through Telegram are processed by Telegram infrastructure.
- The extension does not upload your local files to a custom backend.

## Known Limits

- Telegram and VS Code Codex UI are intentionally decoupled.
- This extension cannot provide full real-time, bidirectional sync with the Codex panel.
- If Codex CLI/network is unavailable, Telegram replies may fail.

## License

MIT. See [LICENSE.md](./LICENSE.md).
