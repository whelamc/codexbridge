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
exports.listRecentSessions = listRecentSessions;
exports.getLatestSessionIdByThreadName = getLatestSessionIdByThreadName;
exports.getSessionSummaryByFilePath = getSessionSummaryByFilePath;
const fs = __importStar(require("fs-extra"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const config_1 = require("./config");
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
async function listRecentSessions(limit = 8) {
    const { sessionPath } = (0, config_1.getConfig)();
    if (!sessionPath || !fs.existsSync(sessionPath)) {
        return [];
    }
    const files = await collectSessionFiles(sessionPath);
    const stats = await Promise.all(files.map(async (filePath) => ({ filePath, stat: await fs.stat(filePath) })));
    const sorted = stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).map((item) => item.filePath);
    const sessions = [];
    const sessionIndex = await loadSessionIndex();
    for (const filePath of sorted) {
        const meta = await readSessionMeta(filePath);
        if (!meta?.id)
            continue;
        sessions.push({
            id: meta.id,
            filePath,
            timestamp: meta.timestamp,
            cwd: meta.cwd,
            title: meta.title,
            threadName: sessionIndex.idToThreadName.get(meta.id)
        });
        if (sessions.length >= limit)
            break;
    }
    return sessions;
}
async function getLatestSessionIdByThreadName(threadName) {
    const sessionIndex = await loadSessionIndex();
    return sessionIndex.threadToLatestSessionId.get(threadName) ?? null;
}
async function getSessionSummaryByFilePath(filePath) {
    const summary = await readSessionMeta(filePath);
    if (!summary?.id)
        return summary;
    const sessionIndex = await loadSessionIndex();
    return {
        ...summary,
        threadName: sessionIndex.idToThreadName.get(summary.id)
    };
}
async function collectSessionFiles(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            results.push(...(await collectSessionFiles(fullPath)));
            continue;
        }
        if (entry.isFile() && fullPath.endsWith('.jsonl')) {
            results.push(fullPath);
        }
    }
    return results;
}
async function readSessionMeta(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const firstLine = content.split('\n').find((line) => line.trim().length > 0);
        if (!firstLine)
            return null;
        const meta = JSON.parse(firstLine);
        const payload = meta.payload;
        const id = payload?.id ?? extractIdFromFilename(filePath);
        if (!id)
            return null;
        return {
            id,
            filePath,
            timestamp: payload?.timestamp,
            cwd: payload?.cwd,
            title: extractTaskTitle(content)
        };
    }
    catch {
        const id = extractIdFromFilename(filePath);
        if (!id)
            return null;
        return { id, filePath };
    }
}
function extractTaskTitle(content) {
    let fallback;
    const lines = content.split('\n');
    for (const line of lines) {
        const raw = line.trim();
        if (!raw)
            continue;
        try {
            const event = JSON.parse(raw);
            if (event.type !== 'response_item' || event.payload?.type !== 'message')
                continue;
            if (event.payload.role !== 'user')
                continue;
            const text = (event.payload.content ?? [])
                .map((item) => item.text ?? '')
                .join('\n')
                .trim();
            if (!text)
                continue;
            const byRequest = normalizeTitle(text, true);
            if (byRequest)
                return byRequest;
            if (!fallback) {
                const candidate = normalizeTitle(text, false);
                if (candidate)
                    fallback = candidate;
            }
        }
        catch {
            // Ignore malformed lines
        }
    }
    return fallback;
}
function normalizeTitle(text, requestOnly) {
    const requestMatch = text.match(/My request for Codex:\s*([\s\S]+)/i);
    if (requestOnly && !requestMatch) {
        return undefined;
    }
    const source = requestMatch ? requestMatch[1] : text;
    const firstLine = source
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0 && isUsefulTitle(line));
    if (!firstLine)
        return undefined;
    return firstLine.slice(0, 40);
}
function isUsefulTitle(line) {
    if (line.startsWith('<') || line.startsWith('##') || line.startsWith('# Context')) {
        return false;
    }
    return true;
}
function extractIdFromFilename(filePath) {
    const matched = path.basename(filePath).match(UUID_REGEX);
    return matched ? matched[0] : null;
}
async function loadSessionIndex() {
    const result = {
        idToThreadName: new Map(),
        threadToLatestSessionId: new Map()
    };
    const indexFile = path.join(os.homedir(), '.codex', 'session_index.jsonl');
    if (!fs.existsSync(indexFile)) {
        return result;
    }
    const latestAtByThread = new Map();
    const lines = (await fs.readFile(indexFile, 'utf-8')).split('\n');
    for (const line of lines) {
        const raw = line.trim();
        if (!raw)
            continue;
        try {
            const row = JSON.parse(raw);
            if (!row.id || !row.thread_name)
                continue;
            result.idToThreadName.set(row.id, row.thread_name);
            const ts = row.updated_at ? Date.parse(row.updated_at) : 0;
            const prev = latestAtByThread.get(row.thread_name) ?? -1;
            if (ts >= prev) {
                latestAtByThread.set(row.thread_name, ts);
                result.threadToLatestSessionId.set(row.thread_name, row.id);
            }
        }
        catch {
            // Ignore malformed index lines.
        }
    }
    return result;
}
//# sourceMappingURL=sessionCatalog.js.map