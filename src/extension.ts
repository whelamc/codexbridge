import * as vscode from 'vscode';
import { watchSessions } from './sessionWatcher';
import { initTelegram, releaseTelegramResources } from './telegram';

export function activate(context: vscode.ExtensionContext) {
  console.log('🚀 CodexBridge activated');

  // 初始化 Telegram
  initTelegram();

  // Keep watcher for task/history listing and optional assistant sync output.
  watchSessions();

  vscode.window.showInformationMessage('CodexBridge is running!');
}

export function deactivate() {
  releaseTelegramResources();
  console.log('CodexBridge deactivated');
}
