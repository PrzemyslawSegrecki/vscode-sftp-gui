import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SftpProfile, SftpConfigProvider } from '../sftpConfigProvider';

interface DiffEntry {
  relativePath: string;
  status: 'modified' | 'local-only' | 'remote-only';
  localSize?: number;
  remoteSize?: number;
  localMtime?: number;
  remoteMtime?: number;
}

export class DiffFolderPanel {
  private static panels: Map<string, DiffFolderPanel> = new Map();
  private panel: vscode.WebviewPanel;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly folderUri: vscode.Uri,
    private readonly config: SftpProfile,
    private readonly configProvider: SftpConfigProvider
  ) {
    const folderName = path.basename(folderUri.fsPath);

    this.panel = vscode.window.createWebviewPanel(
      'sftpGuiDiffFolder',
      `Diff: ${folderName} ↔ Remote`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
        case 'refresh':
          await this.runDiff();
          break;
        case 'openDiff':
          await this.openFileDiff(msg.relativePath);
          break;
      }
    });

    this.panel.onDidDispose(() => {
      DiffFolderPanel.panels.delete(folderUri.fsPath);
    });
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    folderUri: vscode.Uri,
    config: SftpProfile,
    configProvider: SftpConfigProvider
  ) {
    const existing = DiffFolderPanel.panels.get(folderUri.fsPath);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const panel = new DiffFolderPanel(context, folderUri, config, configProvider);
    DiffFolderPanel.panels.set(folderUri.fsPath, panel);
  }

  private async openFileDiff(relativePath: string) {
    // Budujemy pełną ścieżkę lokalną
    const localFile = vscode.Uri.file(path.join(this.folderUri.fsPath, relativePath));

    try {
      // Delegujemy do komendy sftp.diff z pluginu SFTP
      await vscode.commands.executeCommand('sftp.diff', localFile);
    } catch {
      // Fallback: jeśli sftp.diff nie zadziała, otwieramy plik lokalny
      const doc = await vscode.workspace.openTextDocument(localFile);
      await vscode.window.showTextDocument(doc);
    }
  }

  private async runDiff() {
    this.panel.webview.postMessage({ type: 'loading' });

    try {
      const entries = await this.compareFolder();
      this.panel.webview.postMessage({
        type: 'results',
        data: entries,
        folderName: path.basename(this.folderUri.fsPath)
      });
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'error',
        message: err.message || 'Nieznany błąd'
      });
    }
  }

  private async compareFolder(): Promise<DiffEntry[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) { throw new Error('Brak workspace'); }

    // Ścieżka relatywna folderu w workspace
    const relativeFolder = path.relative(workspaceRoot, this.folderUri.fsPath).replace(/\\/g, '/');
    const remotePath = this.config.remotePath || '/';
    const remoteFolder = relativeFolder
      ? `${remotePath.replace(/\/$/, '')}/${relativeFolder}`
      : remotePath;

    // Skanuj pliki lokalne
    const localFiles = new Map<string, { size: number; mtime: number }>();
    await this.scanLocalDir(this.folderUri.fsPath, '', localFiles);

    // Skanuj pliki zdalne
    const remoteFiles = new Map<string, { size: number; mtime: number }>();
    await this.scanRemoteDir(remoteFolder, '', remoteFiles);

    // Porównaj
    const entries: DiffEntry[] = [];

    for (const [rel, local] of localFiles) {
      const remote = remoteFiles.get(rel);
      if (!remote) {
        entries.push({ relativePath: rel, status: 'local-only', localSize: local.size });
      } else if (local.size !== remote.size) {
        entries.push({
          relativePath: rel,
          status: 'modified',
          localSize: local.size,
          remoteSize: remote.size,
          localMtime: local.mtime,
          remoteMtime: remote.mtime
        });
      }
    }

    for (const [rel, remote] of remoteFiles) {
      if (!localFiles.has(rel)) {
        entries.push({ relativePath: rel, status: 'remote-only', remoteSize: remote.size });
      }
    }

    // Sortuj: modified first, then local-only, then remote-only
    const order: Record<string, number> = { 'modified': 0, 'local-only': 1, 'remote-only': 2 };
    entries.sort((a, b) => (order[a.status] - order[b.status]) || a.relativePath.localeCompare(b.relativePath));

    return entries;
  }

  private async scanLocalDir(
    basePath: string,
    relPath: string,
    result: Map<string, { size: number; mtime: number }>
  ): Promise<void> {
    const fullPath = relPath ? path.join(basePath, relPath) : basePath;
    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      const rel = relPath ? `${relPath}/${entry.name}` : entry.name;
      // Pomijaj .vscode, .git, node_modules
      if (['.vscode', '.git', 'node_modules', '.DS_Store'].includes(entry.name)) { continue; }

      if (entry.isDirectory()) {
        await this.scanLocalDir(basePath, rel, result);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(path.join(basePath, rel));
        result.set(rel, { size: stat.size, mtime: stat.mtimeMs });
      }
    }
  }

  private async scanRemoteDir(
    baseRemotePath: string,
    _relPath: string,
    result: Map<string, { size: number; mtime: number }>
  ): Promise<void> {
    const protocol = this.config.protocol || 'sftp';
    if (protocol === 'ftp') {
      await this.scanRemoteFtp(baseRemotePath, result);
    } else {
      await this.scanRemoteSftp(baseRemotePath, result);
    }
  }

  private async scanRemoteFtp(
    baseRemotePath: string,
    result: Map<string, { size: number; mtime: number }>
  ): Promise<void> {
    const ftp = require('basic-ftp');
    const client = new ftp.Client();
    client.ftp.verbose = false;

    const timeout = this.config.connectTimeout || 10000;
    client.ftp.socket.setTimeout(timeout);

    try {
      const secureVal = this.config.secure;
      const useTLS = secureVal === true || secureVal === 'implicit' || secureVal === 'control';

      await client.access({
        host: this.config.host,
        port: this.config.port || 21,
        user: this.config.username,
        password: this.config.password || '',
        secure: useTLS,
        secureOptions: { rejectUnauthorized: false }
      });

      const ignoredNames = new Set(['.', '..', '.git', '.vscode', 'node_modules', '.DS_Store']);

      const scanDir = async (remotePath: string, rel: string): Promise<void> => {
        let list: any[];
        try {
          list = await client.list(remotePath);
        } catch {
          return; // folder nie istnieje – OK
        }

        for (const item of list) {
          if (ignoredNames.has(item.name)) { continue; }
          const itemRel = rel ? `${rel}/${item.name}` : item.name;
          const itemRemote = `${remotePath}/${item.name}`;

          if (item.isDirectory) {
            await scanDir(itemRemote, itemRel);
          } else if (item.isFile) {
            result.set(itemRel, {
              size: item.size,
              mtime: item.modifiedAt ? item.modifiedAt.getTime() : 0
            });
          }
        }
      };

      await scanDir(baseRemotePath, '');
    } finally {
      client.close();
    }
  }

  private async scanRemoteSftp(
    baseRemotePath: string,
    result: Map<string, { size: number; mtime: number }>
  ): Promise<void> {
    const Client = require('ssh2').Client;

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const port = this.config.port || 22;
      const connConfig: any = {
        host: this.config.host,
        port: port,
        username: this.config.username,
        readyTimeout: this.config.connectTimeout || 10000,
      };

      if (this.config.password) {
        connConfig.password = this.config.password;
      }
      if (this.config.privateKeyPath) {
        try {
          connConfig.privateKey = fs.readFileSync(
            this.config.privateKeyPath.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '')
          );
        } catch {}
      }
      if (this.config.agent) {
        connConfig.agent = this.config.agent;
      }

      conn.on('ready', () => {
        conn.sftp((err: any, sftp: any) => {
          if (err) { conn.end(); return reject(err); }

          const ignoredNames = new Set(['.', '..', '.git', '.vscode', 'node_modules', '.DS_Store']);

          const scanDir = async (remotePath: string, rel: string): Promise<void> => {
            return new Promise<void>((res, rej) => {
              sftp.readdir(remotePath, (err2: any, list: any[]) => {
                if (err2) {
                  if (err2.code === 2) { return res(); }
                  return rej(err2);
                }
                const tasks = list.map(async (item: any) => {
                  if (ignoredNames.has(item.filename)) { return; }
                  const itemRel = rel ? `${rel}/${item.filename}` : item.filename;
                  const itemRemote = `${remotePath}/${item.filename}`;

                  if (item.attrs.isDirectory()) {
                    await scanDir(itemRemote, itemRel);
                  } else {
                    result.set(itemRel, {
                      size: item.attrs.size,
                      mtime: item.attrs.mtime * 1000
                    });
                  }
                });
                Promise.all(tasks).then(() => res()).catch(rej);
              });
            });
          };

          scanDir(baseRemotePath, '')
            .then(() => { conn.end(); resolve(); })
            .catch((e) => { conn.end(); reject(e); });
        });
      });

      conn.on('error', (err: any) => reject(err));
      conn.connect(connConfig);
    });
  }

  private getHtml(): string {
    const folderName = path.basename(this.folderUri.fsPath);
    return /*html*/`<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Diff: ${folderName}</title>
<style>
:root {
  --bg: var(--vscode-editor-background, #1e1e1e);
  --fg: var(--vscode-editor-foreground, #ccc);
  --border: var(--vscode-panel-border, #444);
  --hover: rgba(255,255,255,0.06);
  --btn-bg: var(--vscode-button-background, #0e639c);
  --btn-fg: var(--vscode-button-foreground, #fff);
  --green: #89d185;
  --red: #f44747;
  --yellow: #dcdcaa;
  --blue: #9cdcfe;
  --section-bg: var(--vscode-sideBar-background, #252526);
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
  font-size: 13px;
  color: var(--fg);
  background: var(--bg);
}
.toolbar {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  gap: 10px;
  border-bottom: 1px solid var(--border);
  background: var(--section-bg);
}
.toolbar h2 { font-size: 14px; font-weight: 600; flex:1; }
.toolbar button {
  padding: 5px 12px;
  background: var(--btn-bg);
  color: var(--btn-fg);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}
.toolbar button:hover { opacity: 0.85; }

.summary {
  padding: 10px 16px;
  display: flex;
  gap: 16px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.summary .badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}
.badge.modified { background: rgba(220,220,170,0.15); color: var(--yellow); }
.badge.local-only { background: rgba(137,209,133,0.15); color: var(--green); }
.badge.remote-only { background: rgba(244,71,71,0.15); color: var(--red); }

.list { padding: 0; }
.group-header {
  padding: 6px 16px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: var(--section-bg);
  border-bottom: 1px solid var(--border);
  opacity: 0.8;
}
.file-item {
  display: flex;
  align-items: center;
  padding: 4px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.03);
  gap: 8px;
  transition: background 0.1s;
}
.file-item:hover { background: var(--hover); }
.file-item .icon { font-size: 14px; flex-shrink:0; }
.file-item .path { flex:1; font-size: 13px; }
.file-item .meta {
  font-size: 11px;
  opacity: 0.5;
  flex-shrink: 0;
}

.file-item.modified .icon { color: var(--yellow); }
.file-item.local-only .icon { color: var(--green); }
.file-item.remote-only .icon { color: var(--red); }

.center {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px;
  flex-direction: column;
  gap: 12px;
}
.spinner {
  width: 24px; height: 24px;
  border: 3px solid var(--border);
  border-top-color: var(--btn-bg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.error { color: var(--red); padding: 20px; text-align: center; }
.no-diff { color: var(--green); font-size: 14px; }
</style>
</head>
<body>
<div class="toolbar">
  <h2>📂 Diff: ${folderName} ↔ Remote</h2>
  <button id="btnRefresh">🔄 Odśwież</button>
</div>
<div id="summary" class="summary" style="display:none;"></div>
<div id="content">
  <div class="center">
    <div class="spinner"></div>
    <span>Łączenie z serwerem i skanowanie plików...</span>
  </div>
</div>
<script>
(function(){
  const vscode = acquireVsCodeApi();

  document.getElementById('btnRefresh').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch(msg.type) {
      case 'loading':
        document.getElementById('summary').style.display = 'none';
        document.getElementById('content').innerHTML =
          '<div class="center"><div class="spinner"></div><span>Skanowanie plików...</span></div>';
        break;
      case 'error':
        document.getElementById('content').innerHTML =
          '<div class="error">❌ ' + escapeHtml(msg.message) + '</div>';
        break;
      case 'results':
        renderResults(msg.data, msg.folderName);
        break;
    }
  });

  function renderResults(entries, folderName) {
    const content = document.getElementById('content');
    const summary = document.getElementById('summary');

    if (entries.length === 0) {
      summary.style.display = 'none';
      content.innerHTML = '<div class="center"><div class="no-diff">✅ Brak różnic – folder jest zsynchronizowany!</div></div>';
      return;
    }

    const modified = entries.filter(e => e.status === 'modified');
    const localOnly = entries.filter(e => e.status === 'local-only');
    const remoteOnly = entries.filter(e => e.status === 'remote-only');

    summary.style.display = 'flex';
    summary.innerHTML =
      '<span class="badge modified">✏ Zmienione: ' + modified.length + '</span>' +
      '<span class="badge local-only">➕ Tylko lokalne: ' + localOnly.length + '</span>' +
      '<span class="badge remote-only">➖ Tylko zdalne: ' + remoteOnly.length + '</span>';

    let html = '';

    if (modified.length > 0) {
      html += '<div class="group-header">✏ Zmodyfikowane</div>';
      modified.forEach(e => { html += fileItem(e); });
    }
    if (localOnly.length > 0) {
      html += '<div class="group-header">➕ Tylko lokalnie</div>';
      localOnly.forEach(e => { html += fileItem(e); });
    }
    if (remoteOnly.length > 0) {
      html += '<div class="group-header">➖ Tylko zdalnie</div>';
      remoteOnly.forEach(e => { html += fileItem(e); });
    }

    content.innerHTML = html;

    // Kliknięcia na pliki
    content.querySelectorAll('.file-item').forEach(item => {
      item.addEventListener('click', () => {
        const relPath = item.getAttribute('data-path');
        vscode.postMessage({ type: 'openDiff', relativePath: relPath });
      });
    });
  }

  function fileItem(entry) {
    const icons = { 'modified': '✏', 'local-only': '➕', 'remote-only': '➖' };
    let meta = '';
    if (entry.localSize !== undefined && entry.remoteSize !== undefined) {
      meta = formatSize(entry.localSize) + ' ↔ ' + formatSize(entry.remoteSize);
    } else if (entry.localSize !== undefined) {
      meta = formatSize(entry.localSize);
    } else if (entry.remoteSize !== undefined) {
      meta = formatSize(entry.remoteSize);
    }

    return '<div class="file-item ' + entry.status + '" data-path="' + escapeHtml(entry.relativePath) + '">' +
      '<span class="icon">' + icons[entry.status] + '</span>' +
      '<span class="path">' + escapeHtml(entry.relativePath) + '</span>' +
      '<span class="meta">' + meta + '</span>' +
    '</div>';
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
  }
}
