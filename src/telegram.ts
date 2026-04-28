import TelegramBot from 'node-telegram-bot-api';
import { spawn } from 'child_process';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { getConfig } from './config';
import { parseSession } from './parser';
import { listRecentSessions, type SessionSummary } from './sessionCatalog';

let bot: TelegramBot | null = null;
let pollingLockFd: number | null = null;
let pollingLockPath: string | null = null;
const selectedSessionByChat = new Map<number, string>();
const tgHistoryByChat = new Map<number, Array<{ role: 'user' | 'assistant'; text: string }>>();
const sessionCacheById = new Map<string, SessionSummary>();
const runningByChat = new Set<number>();
const callbacks = new Set<string>();
const SESSION_PREFIX = 'session:';

export function initTelegram() {
  const { telegramToken } = getConfig();
  if (!telegramToken) {
    console.warn('Telegram token not set in settings');
    return null;
  }

  if (!acquirePollingLock()) {
    console.warn('Another CodexBridge process is already polling Telegram. Skip polling in this process.');
    return null;
  }

  bot = new TelegramBot(telegramToken, {
    polling: {
      autoStart: false
    }
  });
  bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err.message);
  });
  bot
    .deleteWebHook()
    .catch((err) => {
      console.warn('Failed to clear webhook, continue polling:', err.message);
    })
    .finally(() => {
      bot
        ?.startPolling()
        .then(() => console.log('Telegram polling started'))
        .catch((err) => console.error('Failed to start polling:', err.message));
    });

  registerHandlers();
  return bot;
}

export function sendMessage(text: string) {
  const { telegramChatId } = getConfig();
  if (!bot || !telegramChatId) return;

  bot.sendMessage(telegramChatId, text).catch(console.error);
}

export async function markActiveSessionFromFile(filePath: string) {
  // Independent Telegram mode: no automatic bridge from Codex sessions.
  void filePath;
}

export function getBot() {
  return bot;
}

export function releaseTelegramResources() {
  if (bot) {
    bot.stopPolling().catch(() => {
      // Ignore stop polling errors during shutdown.
    });
    bot = null;
  }

  if (pollingLockFd !== null) {
    try {
      fs.closeSync(pollingLockFd);
    } catch {
      // Ignore close errors during shutdown.
    }
    pollingLockFd = null;
  }

  if (pollingLockPath) {
    try {
      fs.unlinkSync(pollingLockPath);
    } catch {
      // Ignore unlink errors during shutdown.
    }
    pollingLockPath = null;
  }
}

function registerHandlers() {
  if (!bot || callbacks.has('registered')) return;
  callbacks.add('registered');

  bot.on('message', async (msg: TelegramBot.Message) => {
    try {
      const chatId = msg.chat.id;
      const text = msg.text?.trim();
      if (!text) return;

      const command = text.split(/\s+/)[0].toLowerCase();

      if (isCommand(command, 'start')) {
        await bot?.sendMessage(chatId, '已连接。先发送 /tasks 选择任务，再发送问题。');
        return;
      }
      if (isCommand(command, 'tasks')) {
        await sendSessionList(chatId);
        return;
      }
      if (isCommand(command, 'current')) {
        const current = selectedSessionByChat.get(chatId);
        await bot?.sendMessage(chatId, current ? `当前历史会话: ${current}` : '尚未选择历史会话，先发送 /tasks');
        return;
      }
      if (command.startsWith('/')) return;

      if (runningByChat.has(chatId)) {
        await bot?.sendMessage(chatId, '上一条消息还在处理中，请稍等再发下一条。');
        return;
      }

      runningByChat.add(chatId);
      await runIndependentChat(chatId, text);
      runningByChat.delete(chatId);
    } catch (err) {
      console.error('Telegram message handler error:', err);
      const chatId = msg.chat.id;
      runningByChat.delete(chatId);
      await bot?.sendMessage(chatId, '处理命令失败，请稍后重试。');
    }
  });

  bot.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
    const data = query.data ?? '';
    const chatId = query.message?.chat.id;
    if (!chatId || !data.startsWith(SESSION_PREFIX)) return;

    const sessionId = data.slice(SESSION_PREFIX.length);
    const summary = sessionCacheById.get(sessionId);
    selectedSessionByChat.set(chatId, sessionId);
    await bot?.answerCallbackQuery(query.id, { text: '会话已切换' });
    await bot?.sendMessage(chatId, `已选择历史会话: ${sessionId}`);
    if (summary?.filePath) {
      await sendRecentHistory(chatId, summary.filePath);
    }
  });
}

function isCommand(command: string, name: string): boolean {
  return command === `/${name}` || command.startsWith(`/${name}@`);
}

async function sendSessionList(chatId: number) {
  const sessions = await listRecentSessions(10);
  sessionCacheById.clear();
  if (!sessions.length) {
    await bot?.sendMessage(chatId, '没有找到会话文件，请确认 codex 正在产生日志。');
    return;
  }

  const keyboard = sessions.map((session) => {
    sessionCacheById.set(session.id, session);
    const display = formatSessionLabel(session.timestamp, session.title);
    return [{ text: display, callback_data: `${SESSION_PREFIX}${session.id}` }];
  });

  await bot?.sendMessage(chatId, '选择一个任务会话：', {
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

function formatSessionLabel(timestamp: string | undefined, title: string | undefined): string {
  const shortTime = timestamp ? timestamp.replace('T', ' ').slice(5, 16) : 'unknown-time';
  const task = (title ?? '未命名任务').replace(/\s+/g, ' ').trim().slice(0, 28);
  return `${shortTime} | ${task}`;
}

function runIndependentChat(chatId: number, userText: string): Promise<void> {
  return new Promise((resolve) => {
    const history: Array<{ role: 'user' | 'assistant'; text: string }> = tgHistoryByChat.get(chatId) ?? [];
    const prompt = buildIndependentPrompt(history, userText);
    const codexBinary = resolveCodexBinary();
    const child = spawn(
      codexBinary,
      ['exec', prompt, '--json', '--skip-git-repo-check'],
      {
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stderr = '';
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', async (err) => {
      console.error('Failed to run codex resume:', err.message);
      await bot?.sendMessage(
        chatId,
        `提交失败：${err.message}\n请在设置里配置 codexbridge.codexBinary 为 codex 可执行文件绝对路径。`
      );
      resolve();
    });

    child.on('close', async (code) => {
      if (code !== 0) {
        const detail = stderr.trim().split('\n').slice(-1)[0] || `exit code ${code}`;
        await bot?.sendMessage(chatId, `提交失败：${detail}`);
      } else {
        const runtimeError = extractRuntimeError(stdout);
        const reply = extractAssistantReply(stdout);
        if (runtimeError) {
          await bot?.sendMessage(chatId, `提交失败：${runtimeError}`);
        } else if (reply) {
          const nextHistory: Array<{ role: 'user' | 'assistant'; text: string }> = history.slice(-10);
          nextHistory.push({ role: 'user', text: userText });
          nextHistory.push({ role: 'assistant', text: reply });
          tgHistoryByChat.set(chatId, nextHistory.slice(-12));
          await bot?.sendMessage(chatId, `🤖: ${reply}`);
        } else {
          await bot?.sendMessage(chatId, '提交失败：本次调用没有返回可用回复。');
        }
      }
      resolve();
    });
  });
}

function extractAssistantReply(stdout: string): string | null {
  let latest: string | null = null;
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        payload?: {
          type?: string;
          role?: string;
          content?: Array<{ text?: string }>;
        };
      };
      if (event.type === 'response_item' && event.payload?.type === 'message' && event.payload.role === 'assistant') {
        const text = (event.payload.content ?? [])
          .map((item) => item.text ?? '')
          .join('\n')
          .trim();
        if (text) latest = text;
      }
    } catch {
      // Ignore malformed jsonl lines.
    }
  }
  return latest;
}

function extractRuntimeError(stdout: string): string | null {
  let latest: string | null = null;
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: string;
        error?: { message?: string };
      };
      if (event.type === 'error' && event.message) {
        latest = event.message;
      }
      if (event.type === 'turn.failed' && event.error?.message) {
        latest = event.error.message;
      }
    } catch {
      // Ignore malformed jsonl lines.
    }
  }
  return latest;
}

function buildIndependentPrompt(
  history: Array<{ role: 'user' | 'assistant'; text: string }>,
  userText: string
): string {
  const historyText = history
    .slice(-8)
    .map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.text}`)
    .join('\n');

  return [
    'You are assisting in a Telegram chat.',
    'This chat is independent from any VSCode Codex thread.',
    'Keep replies concise and practical.',
    historyText ? `Conversation history:\n${historyText}` : '',
    `User: ${userText}`,
    'Assistant:'
  ]
    .filter(Boolean)
    .join('\n\n');
}

function acquirePollingLock(): boolean {
  const lockPath = path.join(os.tmpdir(), 'codexbridge-telegram-polling.lock');
  const content = `${process.pid}\n`;

  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, content, 'utf8');
    pollingLockFd = fd;
    pollingLockPath = lockPath;
    return true;
  } catch {
    try {
      const existingPidRaw = fs.readFileSync(lockPath, 'utf8').trim();
      const existingPid = Number.parseInt(existingPidRaw, 10);
      if (!Number.isNaN(existingPid) && isProcessAlive(existingPid)) {
        return false;
      }

      fs.unlinkSync(lockPath);
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, content, 'utf8');
      pollingLockFd = fd;
      pollingLockPath = lockPath;
      return true;
    } catch {
      return false;
    }
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveCodexBinary(): string {
  const { codexBinary } = getConfig();
  if (codexBinary && codexBinary !== 'codex' && fs.existsSync(codexBinary)) {
    return codexBinary;
  }

  const bundled = findBundledCodexBinary();
  if (bundled) {
    return bundled;
  }

  return codexBinary || 'codex';
}

function findBundledCodexBinary(): string | null {
  const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
  if (!fs.existsSync(extensionsDir)) {
    return null;
  }

  const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('openai.chatgpt-'))
    .map((entry) => path.join(extensionsDir, entry.name, 'bin', 'macos-aarch64', 'codex'))
    .filter((binaryPath) => fs.existsSync(binaryPath));

  return candidates.length > 0 ? candidates.sort().reverse()[0] : null;
}

async function sendRecentHistory(chatId: number, filePath: string) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const turns = parseSession(content).slice(-5);
    if (!turns.length) {
      await bot?.sendMessage(chatId, '该会话暂无可展示的历史对话。');
      return;
    }

    const lines = turns.map((turn) => {
      const prefix = turn.role === 'assistant' ? '🤖' : '🧑';
      const text = compactText(turn.text, 320);
      return `${prefix}: ${text}`;
    });

    await bot?.sendMessage(chatId, `最近 5 条对话：\n\n${lines.join('\n\n')}`);
  } catch (err) {
    console.error('Failed to read session history:', err);
    await bot?.sendMessage(chatId, '读取历史对话失败。');
  }
}

function compactText(text: string, maxLen: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}
