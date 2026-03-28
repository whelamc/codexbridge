import * as vscode from 'vscode';
import * as os from 'os';

function resolvePath(rawPath: string): string {
  const envExpanded = rawPath.replace(/\$\{env:([^}]+)\}/g, (_match, varName: string) => {
    return process.env[varName] ?? '';
  });

  if (envExpanded.startsWith('~/')) {
    return `${os.homedir()}/${envExpanded.slice(2)}`;
  }

  return envExpanded;
}

export function getConfig() {
  const config = vscode.workspace.getConfiguration('codexbridge');
  const sessionPath = config.get<string>('sessionPath') || '';
  const codexBinary = config.get<string>('codexBinary') || 'codex';
  return {
    telegramToken: config.get<string>('telegramToken') || '',
    telegramChatId: config.get<string>('telegramChatId') || '',
    sessionPath: resolvePath(sessionPath),
    codexBinary: resolvePath(codexBinary)
  };
}
