# CodexBridge（中文说明）

CodexBridge 是一个 VS Code 扩展，用于把本地 Codex 会话历史与 Telegram 做桥接展示。

## 功能

- 读取本地 Codex 会话目录（默认 `~/.codex/sessions`）。
- 在 Telegram 通过 `/tasks` 查看历史任务列表。
- 点击任务后展示最近 5 条历史对话。
- 支持 Telegram 独立会话模式（不写入 VS Code Codex 面板会话）。

## 重要限制（请先看）

- Telegram 对话与 VS Code 中的 Codex 对话是**独立**的。
- 本扩展**不能**把 Telegram 消息完整实时同步到 Codex 面板线程。
- 设计目标是“查看历史 + 独立 TG 对话”，避免干扰你在 VS Code 里的 Codex 会话。

## 配置项

- `codexbridge.telegramToken`：Telegram 机器人 Token。
- `codexbridge.telegramChatId`：Telegram Chat ID。
- `codexbridge.sessionPath`：Codex 会话目录（默认 `${env:HOME}/.codex/sessions`）。
- `codexbridge.codexBinary`：Codex CLI 可执行文件路径（默认 `codex`）。

## 快速开始

1. 在 VS Code 安装扩展。
2. 在 Telegram 注册 Bot（`@BotFather`）：
   - 给 `@BotFather` 发送 `/newbot`
   - 按提示设置 Bot 名称和用户名
   - 复制返回的 Bot Token
3. 获取 `chat_id`：
   - 先和你的 Bot 私聊并发送任意消息（例如 `hello`）
   - 打开：
     - `https://api.telegram.org/bot<你的TOKEN>/getUpdates`
   - 在返回 JSON 中找到 `message.chat.id`
4. 在 VS Code 中配置：
   - `codexbridge.telegramToken` = Bot Token
   - `codexbridge.telegramChatId` = `chat_id`
   - 可选：`codexbridge.sessionPath`、`codexbridge.codexBinary`
5. 重新加载 VS Code 窗口。
6. 在 Telegram 中：
   - 发送 `/tasks`
   - 选择一个历史任务查看最近对话
   - 直接发消息进行 TG 独立会话

## 隐私与数据说明

- 扩展会读取你本地配置的会话目录文件。
- Telegram 消息会经过 Telegram 基础设施。
- 扩展不会把你的本地文件上传到自建后端。

## 已知问题

- 与 VS Code Codex 面板不做完整双向实时同步。
- 当 Codex CLI 或网络异常时，TG 回复可能失败。

## 许可证

MIT，见 [LICENSE.md](./LICENSE.md)。
