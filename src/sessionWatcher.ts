import * as chokidar from 'chokidar';
import * as fs from 'fs-extra';
import * as path from 'path';
import { parseSession } from './parser';
import { getConfig } from './config';

let fileLineCursor = new Map<string, number>();

export function watchSessions() {
  const { sessionPath } = getConfig();
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

  const processFile = async (filePath: string) => {
    if (!filePath.endsWith('.json') && !filePath.endsWith('.jsonl')) return;

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const input = getDeltaContent(filePath, content);
      if (!input.trim()) return;

      // Parse incoming data to keep watcher behavior consistent for future
      // history/index features, but do not bridge assistant replies to Telegram.
      parseSession(input);
    } catch (err) {
      console.error('Error reading session:', err);
    }
  };

  watcher.on('add', processFile);
  watcher.on('change', processFile);

  console.log('👀 Watching Codex sessions...');
}

function getDeltaContent(filePath: string, content: string): string {
  if (!filePath.endsWith('.jsonl')) {
    return content;
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  const oldCursor = fileLineCursor.get(filePath) ?? 0;
  const nextCursor = lines.length;
  fileLineCursor.set(filePath, nextCursor);

  if (oldCursor >= nextCursor) return '';
  return lines.slice(oldCursor).join('\n');
}

function primeExistingJsonl(root: string) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

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
      } catch {
        // Ignore unreadable files during priming.
      }
    }
  }
}
