"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initTelegram = initTelegram;
exports.sendMessage = sendMessage;
exports.markActiveSessionFromFile = markActiveSessionFromFile;
exports.getBot = getBot;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs-extra"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const config_1 = require("./config");
const parser_1 = require("./parser");
const sessionCatalog_1 = require("./sessionCatalog");
let bot = null;
const selectedSessionByChat = new Map();
const tgHistoryByChat = new Map();
const sessionCacheById = new Map();
const runningByChat = new Set();
const callbacks = new Set();
const SESSION_PREFIX = 'session:';
function initTelegram() {
    const { telegramToken } = (0, config_1.getConfig)();
    if (!telegramToken) {
        console.warn('Telegram token not set in settings');
        return null;
    }
    bot = new node_telegram_bot_api_1.default(telegramToken, {
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
function sendMessage(text) {
    const { telegramChatId } = (0, config_1.getConfig)();
    if (!bot || !telegramChatId)
        return;
    bot.sendMessage(telegramChatId, text).catch(console.error);
}
async function markActiveSessionFromFile(filePath) {
    // Independent Telegram mode: no automatic bridge from Codex sessions.
    void filePath;
}
function getBot() {
    return bot;
}
function registerHandlers() {
    if (!bot || callbacks.has('registered'))
        return;
    callbacks.add('registered');
    bot.on('message', async (msg) => {
        try {
            const chatId = msg.chat.id;
            const text = msg.text?.trim();
            if (!text)
                return;
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
            if (command.startsWith('/'))
                return;
            if (runningByChat.has(chatId)) {
                await bot?.sendMessage(chatId, '上一条消息还在处理中，请稍等再发下一条。');
                return;
            }
            runningByChat.add(chatId);
            await runIndependentChat(chatId, text);
            runningByChat.delete(chatId);
        }
        catch (err) {
            console.error('Telegram message handler error:', err);
            const chatId = msg.chat.id;
            runningByChat.delete(chatId);
            await bot?.sendMessage(chatId, '处理命令失败，请稍后重试。');
        }
    });
    bot.on('callback_query', async (query) => {
        const data = query.data ?? '';
        const chatId = query.message?.chat.id;
        if (!chatId || !data.startsWith(SESSION_PREFIX))
            return;
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
function isCommand(command, name) {
    return command === `/${name}` || command.startsWith(`/${name}@`);
}
async function sendSessionList(chatId) {
    const sessions = await (0, sessionCatalog_1.listRecentSessions)(10);
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
function formatSessionLabel(timestamp, title) {
    const shortTime = timestamp ? timestamp.replace('T', ' ').slice(5, 16) : 'unknown-time';
    const task = (title ?? '未命名任务').replace(/\s+/g, ' ').trim().slice(0, 28);
    return `${shortTime} | ${task}`;
}
function runIndependentChat(chatId, userText) {
    return new Promise((resolve) => {
        const history = tgHistoryByChat.get(chatId) ?? [];
        const prompt = buildIndependentPrompt(history, userText);
        const codexBinary = resolveCodexBinary();
        const child = (0, child_process_1.spawn)(codexBinary, ['exec', prompt, '--json', '--skip-git-repo-check'], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stderr = '';
        let stdout = '';
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', async (err) => {
            console.error('Failed to run codex resume:', err.message);
            await bot?.sendMessage(chatId, `提交失败：${err.message}\n请在设置里配置 codexbridge.codexBinary 为 codex 可执行文件绝对路径。`);
            resolve();
        });
        child.on('close', async (code) => {
            if (code !== 0) {
                const detail = stderr.trim().split('\n').slice(-1)[0] || `exit code ${code}`;
                await bot?.sendMessage(chatId, `提交失败：${detail}`);
            }
            else {
                const runtimeError = extractRuntimeError(stdout);
                const reply = extractAssistantReply(stdout);
                if (runtimeError) {
                    await bot?.sendMessage(chatId, `提交失败：${runtimeError}`);
                }
                else if (reply) {
                    const nextHistory = history.slice(-10);
                    nextHistory.push({ role: 'user', text: userText });
                    nextHistory.push({ role: 'assistant', text: reply });
                    tgHistoryByChat.set(chatId, nextHistory.slice(-12));
                    await bot?.sendMessage(chatId, `🤖: ${reply}`);
                }
                else {
                    await bot?.sendMessage(chatId, '提交失败：本次调用没有返回可用回复。');
                }
            }
            resolve();
        });
    });
}
function extractAssistantReply(stdout) {
    let latest = null;
    const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
    for (const line of lines) {
        try {
            const event = JSON.parse(line);
            if (event.type === 'response_item' && event.payload?.type === 'message' && event.payload.role === 'assistant') {
                const text = (event.payload.content ?? [])
                    .map((item) => item.text ?? '')
                    .join('\n')
                    .trim();
                if (text)
                    latest = text;
            }
        }
        catch {
            // Ignore malformed jsonl lines.
        }
    }
    return latest;
}
function extractRuntimeError(stdout) {
    let latest = null;
    const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
    for (const line of lines) {
        try {
            const event = JSON.parse(line);
            if (event.type === 'error' && event.message) {
                latest = event.message;
            }
            if (event.type === 'turn.failed' && event.error?.message) {
                latest = event.error.message;
            }
        }
        catch {
            // Ignore malformed jsonl lines.
        }
    }
    return latest;
}
function buildIndependentPrompt(history, userText) {
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
function resolveCodexBinary() {
    const { codexBinary } = (0, config_1.getConfig)();
    if (codexBinary && codexBinary !== 'codex' && fs.existsSync(codexBinary)) {
        return codexBinary;
    }
    const bundled = findBundledCodexBinary();
    if (bundled) {
        return bundled;
    }
    return codexBinary || 'codex';
}
function findBundledCodexBinary() {
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
async function sendRecentHistory(chatId, filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const turns = (0, parser_1.parseSession)(content).slice(-5);
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
    }
    catch (err) {
        console.error('Failed to read session history:', err);
        await bot?.sendMessage(chatId, '读取历史对话失败。');
    }
}
function compactText(text, maxLen) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLen)
        return normalized;
    return `${normalized.slice(0, maxLen - 1)}…`;
}
//# sourceMappingURL=telegram.js.map