import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface SftpProfile {
  name?: string;
  context?: string;
  protocol?: 'sftp' | 'ftp';
  color?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  remotePath?: string;
  uploadOnSave?: boolean;
  useTempFile?: boolean;
  openSsh?: boolean;
  downloadOnOpen?: boolean | 'confirm';
  syncOption?: {
    delete?: boolean;
    skipCreate?: boolean;
    ignoreExisting?: boolean;
    update?: boolean;
  };
  ignore?: string[];
  ignoreFile?: string;
  watcher?: {
    files?: string;
    autoUpload?: boolean;
    autoDelete?: boolean;
  };
  remoteTimeOffsetInHours?: number;
  remoteExplorer?: {
    filesExclude?: string[];
    order?: number;
  };
  concurrency?: number;
  connectTimeout?: number;
  limitOpenFilesOnRemote?: boolean | number;
  // SFTP only
  agent?: string;
  privateKeyPath?: string;
  passphrase?: string | boolean;
  interactiveAuth?: boolean | string[];
  algorithms?: {
    kex?: string[];
    cipher?: string[];
    serverHostKey?: string[];
    hmac?: string[];
  };
  sshConfigPath?: string;
  sshCustomParams?: string;
  // FTP only
  secure?: boolean | string;
  secureOptions?: Record<string, any>;
  // Multi-profile
  profiles?: Record<string, Partial<SftpProfile>>;
  defaultProfile?: string;
}

export class SftpConfigProvider {
  private getConfigPath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return undefined; }
    
    const dotVscodePath = path.join(folders[0].uri.fsPath, '.vscode', 'sftp.json');
    if (fs.existsSync(dotVscodePath)) {
      return dotVscodePath;
    }
    
    const rootPath = path.join(folders[0].uri.fsPath, 'sftp.json');
    if (fs.existsSync(rootPath)) {
      return rootPath;
    }
    
    return dotVscodePath; // Default for new files
  }

  getConfigUri(): vscode.Uri | undefined {
    const p = this.getConfigPath();
    return p ? vscode.Uri.file(p) : undefined;
  }

  /** Pobiera konfigurację z otwartego edytora (nawet jeśli niezdana na dysk) */
  async getConfigFromEditor(): Promise<SftpProfile | null> {
    const fileUri = this.getConfigUri();
    if (!fileUri) return null;

    try {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === fileUri.fsPath);
      if (doc) {
        return JSON.parse(doc.getText()) as SftpProfile;
      }
    } catch {
      // Ignoruj błędy parsowania w locie
    }
    return this.getConfig();
  }

  async getConfig(): Promise<SftpProfile | null> {
    const configPath = this.getConfigPath();
    if (!configPath) { return null; }

    try {
      const content = await fs.promises.readFile(configPath, 'utf-8');
      return JSON.parse(content) as SftpProfile;
    } catch {
      return null;
    }
  }

  async ensureConfigFile(): Promise<vscode.Uri> {
    const configPath = this.getConfigPath();
    if (!configPath) {
      throw new Error('Brak otwartego workspace.');
    }

    const dir = path.dirname(configPath);
    await fs.promises.mkdir(dir, { recursive: true });

    const fileUri = vscode.Uri.file(configPath);
    try {
      await fs.promises.access(configPath);
    } catch {
      await fs.promises.writeFile(configPath, '{}', 'utf-8');
    }

    return fileUri;
  }

  /** Otwiera sftp.json w edytorze VS Code i zwraca dokument */
  async openDocument(): Promise<vscode.TextDocument> {
    const fileUri = await this.ensureConfigFile();
    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preview: true,
      preserveFocus: true
    });
    return doc;
  }

  /** Aktualizuje treść dokumentu BEZ zapisu (robi go "dirty") */
  async updateDocument(doc: vscode.TextDocument, config: SftpProfile): Promise<void> {
    const newContent = JSON.stringify(config, null, 2);
    const currentContent = doc.getText();
    if (newContent === currentContent) { return; } // bez zmian

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      doc.lineAt(0).range.start,
      doc.lineAt(doc.lineCount - 1).range.end
    );
    edit.replace(doc.uri, fullRange, newContent);
    await vscode.workspace.applyEdit(edit);
  }

  /** Zapisuje dokument – wyzwala onDidSaveTextDocument (SFTP odświeży config) */
  async saveDocument(doc: vscode.TextDocument): Promise<void> {
    await doc.save();
  }

  async configExists(): Promise<boolean> {
    const configPath = this.getConfigPath();
    if (!configPath) { return false; }
    try {
      await fs.promises.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  getConfigFilePath(): string | undefined {
    return this.getConfigPath();
  }
}
