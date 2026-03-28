type ParsedTurn = {
  role: string;
  text: string;
};

type MessageContentItem = {
  text?: string;
};

type MessagePayload = {
  type?: string;
  role?: string;
  content?: MessageContentItem[];
};

type SessionEvent = {
  type?: string;
  payload?: MessagePayload;
};

type SessionTurn = {
  role?: string;
  content?: string;
};

type SessionPayload = {
  turns?: SessionTurn[];
};

export function parseSession(content: string): ParsedTurn[] {
  // Codex sessions are JSONL. Keep legacy JSON support for compatibility.
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && content.includes('\n')) {
    return parseJsonlSession(content);
  }

  return parseLegacySession(content);
}

function parseJsonlSession(content: string): ParsedTurn[] {
  const turns: ParsedTurn[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;

    try {
      const event = JSON.parse(raw) as SessionEvent;
      if (event.type !== 'response_item' || event.payload?.type !== 'message') {
        continue;
      }

      const role = event.payload.role;
      if (role !== 'user' && role !== 'assistant') {
        continue;
      }

      const rawText = (event.payload.content ?? [])
        .map((item: MessageContentItem) => item.text ?? '')
        .join('\n')
        .trim();
      const text = sanitizeTurnText(role, rawText);

      if (!text) continue;
      turns.push({ role, text });
    } catch {
      // Ignore malformed lines in stream files.
    }
  }

  return turns;
}

function sanitizeTurnText(role: string, text: string): string {
  if (!text) return '';
  if (role !== 'user') return text;

  const requestMatch = text.match(/My request for Codex:\s*([\s\S]+)/i);
  if (requestMatch) {
    const request = requestMatch[1].trim();
    return request.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  }

  if (
    text.startsWith('<environment_context>') ||
    text.startsWith('# Context from my IDE setup:') ||
    text.startsWith('<permissions instructions>') ||
    text.startsWith('<collaboration_mode>')
  ) {
    return '';
  }

  return text;
}

function parseLegacySession(content: string): ParsedTurn[] {
  try {
    const json = JSON.parse(content) as SessionPayload;

    if (!Array.isArray(json.turns)) return [];

    return json.turns.map((turn: SessionTurn) => ({
      role: turn.role ?? 'assistant',
      text: turn.content || ''
    }));
  } catch (e) {
    console.error('Failed to parse session', e);
    return [];
  }
}
