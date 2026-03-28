import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { getConfig } from './config';

export type SessionSummary = {
  id: string;
  filePath: string;
  timestamp?: string;
  cwd?: string;
  title?: string;
  threadName?: string;
};

type SessionMetaLine = {
  type?: string;
  payload?: {
    id?: string;
    timestamp?: string;
    cwd?: string;
  };
};

type SessionMessageLine = {
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    content?: Array<{ text?: string }>;
  };
};

type SessionIndexLine = {
  id?: string;
  thread_name?: string;
  updated_at?: string;
};

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export async function listRecentSessions(limit = 8): Promise<SessionSummary[]> {
  const { sessionPath } = getConfig();
  if (!sessionPath || !fs.existsSync(sessionPath)) {
    return [];
  }

  const files = await collectSessionFiles(sessionPath);
  const stats = await Promise.all(
    files.map(async (filePath) => ({ filePath, stat: await fs.stat(filePath) }))
  );

  const sorted = stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).map((item) => item.filePath);
  const sessions: SessionSummary[] = [];
  const sessionIndex = await loadSessionIndex();

  for (const filePath of sorted) {
    const meta = await readSessionMeta(filePath);
    if (!meta?.id) continue;
    sessions.push({
      id: meta.id,
      filePath,
      timestamp: meta.timestamp,
      cwd: meta.cwd,
      title: meta.title,
      threadName: sessionIndex.idToThreadName.get(meta.id)
    });
    if (sessions.length >= limit) break;
  }

  return sessions;
}

export async function getLatestSessionIdByThreadName(threadName: string): Promise<string | null> {
  const sessionIndex = await loadSessionIndex();
  return sessionIndex.threadToLatestSessionId.get(threadName) ?? null;
}

export async function getSessionSummaryByFilePath(filePath: string): Promise<SessionSummary | null> {
  const summary = await readSessionMeta(filePath);
  if (!summary?.id) return summary;

  const sessionIndex = await loadSessionIndex();
  return {
    ...summary,
    threadName: sessionIndex.idToThreadName.get(summary.id)
  };
}

async function collectSessionFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results: string[] = [];

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

async function readSessionMeta(filePath: string): Promise<SessionSummary | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const firstLine = content.split('\n').find((line) => line.trim().length > 0);
    if (!firstLine) return null;

    const meta = JSON.parse(firstLine) as SessionMetaLine;
    const payload = meta.payload;
    const id = payload?.id ?? extractIdFromFilename(filePath);
    if (!id) return null;

    return {
      id,
      filePath,
      timestamp: payload?.timestamp,
      cwd: payload?.cwd,
      title: extractTaskTitle(content)
    };
  } catch {
    const id = extractIdFromFilename(filePath);
    if (!id) return null;
    return { id, filePath };
  }
}

function extractTaskTitle(content: string): string | undefined {
  let fallback: string | undefined;
  const lines = content.split('\n');
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    try {
      const event = JSON.parse(raw) as SessionMessageLine;
      if (event.type !== 'response_item' || event.payload?.type !== 'message') continue;
      if (event.payload.role !== 'user') continue;

      const text = (event.payload.content ?? [])
        .map((item) => item.text ?? '')
        .join('\n')
        .trim();
      if (!text) continue;

      const byRequest = normalizeTitle(text, true);
      if (byRequest) return byRequest;

      if (!fallback) {
        const candidate = normalizeTitle(text, false);
        if (candidate) fallback = candidate;
      }
    } catch {
      // Ignore malformed lines
    }
  }
  return fallback;
}

function normalizeTitle(text: string, requestOnly: boolean): string | undefined {
  const requestMatch = text.match(/My request for Codex:\s*([\s\S]+)/i);
  if (requestOnly && !requestMatch) {
    return undefined;
  }

  const source = requestMatch ? requestMatch[1] : text;
  const firstLine = source
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && isUsefulTitle(line));

  if (!firstLine) return undefined;
  return firstLine.slice(0, 40);
}

function isUsefulTitle(line: string): boolean {
  if (line.startsWith('<') || line.startsWith('##') || line.startsWith('# Context')) {
    return false;
  }
  return true;
}

function extractIdFromFilename(filePath: string): string | null {
  const matched = path.basename(filePath).match(UUID_REGEX);
  return matched ? matched[0] : null;
}

async function loadSessionIndex(): Promise<{
  idToThreadName: Map<string, string>;
  threadToLatestSessionId: Map<string, string>;
}> {
  const result = {
    idToThreadName: new Map<string, string>(),
    threadToLatestSessionId: new Map<string, string>()
  };

  const indexFile = path.join(os.homedir(), '.codex', 'session_index.jsonl');
  if (!fs.existsSync(indexFile)) {
    return result;
  }

  const latestAtByThread = new Map<string, number>();
  const lines = (await fs.readFile(indexFile, 'utf-8')).split('\n');

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;

    try {
      const row = JSON.parse(raw) as SessionIndexLine;
      if (!row.id || !row.thread_name) continue;
      result.idToThreadName.set(row.id, row.thread_name);

      const ts = row.updated_at ? Date.parse(row.updated_at) : 0;
      const prev = latestAtByThread.get(row.thread_name) ?? -1;
      if (ts >= prev) {
        latestAtByThread.set(row.thread_name, ts);
        result.threadToLatestSessionId.set(row.thread_name, row.id);
      }
    } catch {
      // Ignore malformed index lines.
    }
  }

  return result;
}
