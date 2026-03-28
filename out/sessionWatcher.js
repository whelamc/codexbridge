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
Object.defineProperty(exports, "__esModule", { value: true });
exports.watchSessions = watchSessions;
const chokidar = __importStar(require("chokidar"));
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const parser_1 = require("./parser");
const telegram_1 = require("./telegram");
const config_1 = require("./config");
let lastMessages = new Set();
let fileLineCursor = new Map();
function watchSessions() {
    const { sessionPath } = (0, config_1.getConfig)();
    if (!sessionPath) {
        console.warn('Codex session path not set');
        return;
    }
    if (!fs.existsSync(sessionPath)) {
        console.warn(`Codex session path does not exist: ${sessionPath}`);
        return;
    }
    const watcher = chokidar.watch(sessionPath, {
        ignoreInitial: true,
        persistent: true
    });
    primeExistingJsonl(sessionPath);
    const processFile = async (filePath) => {
        if (!filePath.endsWith('.json') && !filePath.endsWith('.jsonl'))
            return;
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const input = getDeltaContent(filePath, content);
            if (!input.trim())
                return;
            const turns = (0, parser_1.parseSession)(input);
            let hasAssistantReply = false;
            for (const turn of turns) {
                if (turn.role !== 'assistant') {
                    continue;
                }
                const key = `${filePath}-${turn.role}-${turn.text}`;
                if (!lastMessages.has(key)) {
                    lastMessages.add(key);
                    hasAssistantReply = true;
                    (0, telegram_1.sendMessage)(`🤖: ${turn.text}`);
                }
            }
            if (hasAssistantReply) {
                await (0, telegram_1.markActiveSessionFromFile)(filePath);
            }
        }
        catch (err) {
            console.error('Error reading session:', err);
        }
    };
    watcher.on('add', processFile);
    watcher.on('change', processFile);
    console.log('👀 Watching Codex sessions...');
}
function getDeltaContent(filePath, content) {
    if (!filePath.endsWith('.jsonl')) {
        return content;
    }
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    const oldCursor = fileLineCursor.get(filePath) ?? 0;
    const nextCursor = lines.length;
    fileLineCursor.set(filePath, nextCursor);
    if (oldCursor >= nextCursor)
        return '';
    return lines.slice(oldCursor).join('\n');
}
function primeExistingJsonl(root) {
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current)
            continue;
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile() || !fullPath.endsWith('.jsonl')) {
                continue;
            }
            try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lineCount = content.split('\n').filter((line) => line.trim().length > 0).length;
                fileLineCursor.set(fullPath, lineCount);
            }
            catch {
                // Ignore unreadable files during priming.
            }
        }
    }
}
//# sourceMappingURL=sessionWatcher.js.map