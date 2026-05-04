import * as vscode from 'vscode';
import * as path from 'path';
import { SftpConfigProvider, SftpProfile } from '../sftpConfigProvider';
import { RemoteDirectoryPicker } from '../RemoteDirectoryPicker';

export class SftpGuiViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _doc?: vscode.TextDocument;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configProvider: SftpConfigProvider
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = this.getWebviewContent();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          // Otwórz sftp.json w edytorze i załaduj do formularza
          await this.initDocument();
          await this.sendConfigToWebview();
          break;
        case 'liveUpdate':
          // Aktualizuj treść sftp.json na żywo (bez zapisu)
          if (msg.data) {
            await this.liveUpdateDocument(msg.data);
          }
          break;
        case 'selectRemotePath':
          if (msg.data) {
            const selectedProfileConfig = msg.data;
            const result = await RemoteDirectoryPicker.pickDirectory(selectedProfileConfig, selectedProfileConfig.remotePath);
            if (result) {
              webviewView.webview.postMessage({ type: 'remotePathSelected', path: result });
            }
          }
          break;
        case 'save':
          // Zapisz dokument → SFTP plugin wykrywa zmianę
          await this.saveDocument();
          break;
        case 'openFile':
          this.openConfigFile();
          break;
        case 'prompt': {
          const name = await vscode.window.showInputBox({
            prompt: msg.prompt,
            placeHolder: msg.placeholder,
            validateInput: (val) => val.trim() ? null : msg.validateInput
          });
          if (name) {
            webviewView.webview.postMessage({ type: 'promptResult', trigger: msg.trigger, value: name.trim() });
          }
          break;
        }
        case 'confirm': {
          const answer = await vscode.window.showWarningMessage(
            msg.message,
            { modal: true },
            msg.confirmText
          );
          if (answer === msg.confirmText) {
            webviewView.webview.postMessage({ type: 'confirmResult', trigger: msg.trigger, value: msg.profileName });
          }
          break;
        }
      }
    });
  }

  async addNewProfile() {
    if (this._view) {
      this._view.show(true);
      this._view.webview.postMessage({ type: 'addNewProfile' });
    }
  }

  /** Otwiera sftp.json w edytorze i trzyma referencję */
  private async initDocument() {
    try {
      this._doc = await this.configProvider.openDocument();
    } catch {
      // Plik nie istnieje jeszcze – OK
    }
  }

  private async sendConfigToWebview() {
    const config = await this.configProvider.getConfig();
    this._view?.webview.postMessage({
      type: 'loadConfig',
      data: config
    });
  }

  /** Aktualizuje treść sftp.json w edytorze BEZ zapisu (dirty state) */
  private async liveUpdateDocument(data: SftpProfile) {
    try {
      if (!this._doc) {
        this._doc = await this.configProvider.openDocument();
      }
      await this.configProvider.updateDocument(this._doc, data);
    } catch (err: any) {
      // Cicho – live update nie powinien przeszkadzać
    }
  }

  /** Zapisuje dokument → wyzwala onDidSaveTextDocument → SFTP odświeża */
  private async saveDocument() {
    try {
      if (!this._doc) {
        this._doc = await this.configProvider.openDocument();
      }
      await this.configProvider.saveDocument(this._doc);
      vscode.window.showInformationMessage('✅ Konfiguracja sftp.json zapisana.');
      this._view?.webview.postMessage({ type: 'saved' });
    } catch (err: any) {
      vscode.window.showErrorMessage('Błąd zapisu: ' + err.message);
    }
  }

  private openConfigFile() {
    const filePath = this.configProvider.getConfigFilePath();
    if (filePath) {
      vscode.workspace.openTextDocument(filePath).then(doc => {
        vscode.window.showTextDocument(doc);
      });
    }
  }

  private getWebviewContent(): string {
    return /*html*/`<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>SFTP GUI Manager</title>
<style>
:root {
  --bg: var(--vscode-sideBar-background, #1e1e1e);
  --fg: var(--vscode-sideBar-foreground, #cccccc);
  --input-bg: var(--vscode-input-background, #3c3c3c);
  --input-fg: var(--vscode-input-foreground, #cccccc);
  --input-border: var(--vscode-input-border, #555);
  --btn-bg: var(--vscode-button-background, #0e639c);
  --btn-fg: var(--vscode-button-foreground, #fff);
  --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
  --btn-secondary-bg: var(--vscode-button-secondaryBackground, #3a3d41);
  --btn-secondary-fg: var(--vscode-button-secondaryForeground, #ccc);
  --danger: #f44747;
  --success: #89d185;
  --border: var(--vscode-panel-border, #444);
  --section-bg: var(--vscode-editor-background, #252526);
  --focus: var(--vscode-focusBorder, #007fd4);
  --badge-bg: var(--vscode-badge-background, #4d4d4d);
  --badge-fg: var(--vscode-badge-foreground, #fff);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
  font-size: var(--vscode-font-size, 13px);
  color: var(--fg);
  background: var(--bg);
  padding: 0;
  overflow-x: hidden;
}

/* === HEADER === */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--section-bg);
}
.header h2 {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.9;
}
.header-actions { display: flex; gap: 4px; }
.icon-btn {
  background: none;
  border: none;
  color: var(--fg);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 3px;
  font-size: 14px;
  opacity: 0.7;
  transition: all 0.15s;
}
.icon-btn:hover { opacity: 1; background: rgba(255,255,255,0.08); }

/* === PROFILE TABS === */
.profile-bar {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  background: var(--section-bg);
  flex-wrap: wrap;
}
.profile-tab {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  transition: all 0.15s;
  white-space: nowrap;
  opacity: 0.7;
}
.profile-tab:hover { opacity: 1; background: rgba(255,255,255,0.05); }
.profile-tab.active {
  background: var(--btn-bg);
  color: var(--btn-fg);
  border-color: var(--btn-bg);
  opacity: 1;
}
.profile-tab.base { font-weight: 600; }
.profile-tab .default-badge {
  font-size: 9px;
  background: var(--badge-bg);
  color: var(--badge-fg);
  padding: 1px 4px;
  border-radius: 2px;
  margin-left: 4px;
}
.profile-add-btn {
  padding: 4px 8px;
  border: 1px dashed var(--border);
  border-radius: 3px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font-size: 14px;
  opacity: 0.5;
  transition: all 0.15s;
}
.profile-add-btn:hover { opacity: 1; border-style: solid; }

/* === FORM === */
.form-container {
  padding: 8px 12px 16px;
  overflow-y: auto;
  max-height: calc(100vh - 100px);
}
.field {
  margin-bottom: 10px;
}
.field label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  opacity: 0.7;
  margin-bottom: 3px;
}
.field input, .field select, .field textarea {
  width: 100%;
  background: var(--input-bg);
  color: var(--input-fg);
  border: 1px solid var(--input-border);
  border-radius: 3px;
  padding: 5px 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.field input:focus, .field select:focus, .field textarea:focus {
  border-color: var(--focus);
}
.field textarea { min-height: 60px; resize: vertical; }
.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.checkbox-field {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  cursor: pointer;
}
.checkbox-field input[type="checkbox"] {
  width: auto;
  accent-color: var(--btn-bg);
  cursor: pointer;
}
.checkbox-field label {
  margin: 0;
  text-transform: none;
  font-weight: normal;
  font-size: 13px;
  opacity: 1;
  cursor: pointer;
}

/* === SECTIONS === */
.section {
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-bottom: 8px;
  overflow: hidden;
}
.section-header {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  cursor: pointer;
  background: var(--section-bg);
  user-select: none;
  font-size: 12px;
  font-weight: 600;
  gap: 6px;
  transition: background 0.15s;
}
.section-header:hover { background: rgba(255,255,255,0.04); }
.section-header .arrow {
  transition: transform 0.2s;
  font-size: 10px;
}
.section-header .arrow.open { transform: rotate(90deg); }
.section-body {
  padding: 8px 10px;
  display: none;
  border-top: 1px solid var(--border);
}
.section-body.open { display: block; }

/* === BUTTONS === */
.btn-group {
  display: flex;
  gap: 6px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.btn {
  padding: 6px 14px;
  border: none;
  border-radius: 3px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  font-weight: 500;
}
.btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
.btn-primary:hover { background: var(--btn-hover); }
.btn-secondary { background: var(--btn-secondary-bg); color: var(--btn-secondary-fg); }
.btn-secondary:hover { opacity: 0.85; }
.btn-danger { background: var(--danger); color: #fff; }
.btn-danger:hover { opacity: 0.85; }
.btn-sm { padding: 3px 8px; font-size: 11px; }

/* === STATUS === */
.status-bar {
  padding: 6px 12px;
  font-size: 11px;
  opacity: 0.7;
  border-top: 1px solid var(--border);
  display: none;
}
.status-bar.visible { display: block; }
.status-bar.success { color: var(--success); opacity: 1; }

/* === NOTICE === */
.profile-notice {
  padding: 6px 10px;
  margin-bottom: 8px;
  border-radius: 3px;
  background: rgba(14,99,156,0.15);
  border: 1px solid rgba(14,99,156,0.3);
  font-size: 11px;
  opacity: 0.85;
}

/* === EMPTY === */
.empty-state {
  text-align: center;
  padding: 30px 16px;
  opacity: 0.7;
}
.empty-state .icon { font-size: 32px; margin-bottom: 10px; }
.empty-state p { margin-bottom: 12px; font-size: 12px; }
</style>
</head>
<body>

<div class="header">
  <h2>SFTP Manager</h2>
  <div class="header-actions">
    <button class="icon-btn" id="btnReload" title="Odśwież">🔄</button>
  </div>
</div>

<!-- Pasek Profili -->
<div class="profile-bar" id="profileBar" style="display:none;">
  <button class="profile-tab base active" data-profile="__base__">⚙ Bazowa</button>
  <button class="profile-add-btn" id="btnAddProfile" title="Dodaj profil">+</button>
</div>

<div class="form-container" id="formContainer">
  <div class="empty-state" id="emptyState">
    <div class="icon">🔌</div>
    <p>Brak konfiguracji SFTP w tym workspace.</p>
    <button class="btn btn-primary" id="btnCreateNew">Utwórz konfigurację</button>
  </div>

  <div id="editor" style="display:none;">
    <div class="profile-notice" id="profileNotice" style="display:none;">
      ℹ Edytujesz profil – pola puste dziedziczą z konfiguracji bazowej.
    </div>

    <!-- Połączenie -->
    <div class="section" id="sectionConnection">
      <div class="section-header" data-section="connection">
        <span class="arrow open">▶</span> Połączenie
      </div>
      <div class="section-body open">
        <div class="field">
          <label>Nazwa</label>
          <input type="text" id="f_name" placeholder="Mój serwer">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Kolor profilu</label>
            <select id="f_color">
              <option value="#28a745">Zielony</option>
              <option value="#dc3545">Czerwony</option>
              <option value="#ffc107">Żółty</option>
              <option value="#007bff">Niebieski</option>
              <option value="#fd7e14">Pomarańczowy</option>
            </select>
          </div>
          <div class="field">
            <label>Protokół</label>
            <select id="f_protocol">
              <option value="sftp">SFTP</option>
              <option value="ftp">FTP</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Host</label>
            <input type="text" id="f_host" placeholder="example.com">
          </div>
          <div class="field">
            <label>Port</label>
            <input type="number" id="f_port" value="22">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Użytkownik</label>
            <input type="text" id="f_username" placeholder="user">
          </div>
          <div class="field">
            <label>Hasło</label>
            <input type="password" id="f_password" placeholder="••••">
          </div>
        </div>
        <div class="field">
          <label>Ścieżka zdalna</label>
          <div style="display: flex; gap: 5px;">
            <input type="text" id="f_remotePath" placeholder="/" style="flex-grow: 1;">
            <button class="btn btn-secondary" id="btnBrowseRemote" title="Wybierz katalog z serwera..." style="padding: 4px 8px; font-size: 14px;">Wybierz</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Autoryzacja SFTP -->
    <div class="section" id="sectionAuth">
      <div class="section-header" data-section="auth">
        <span class="arrow">▶</span> Autoryzacja SSH
      </div>
      <div class="section-body">
        <div class="field">
          <label>Ścieżka klucza prywatnego</label>
          <input type="text" id="f_privateKeyPath" placeholder="~/.ssh/id_rsa">
        </div>
        <div class="field">
          <label>Passphrase</label>
          <input type="text" id="f_passphrase" placeholder="Zostaw puste jeśli brak">
        </div>
        <div class="field">
          <label>Agent SSH</label>
          <input type="text" id="f_agent" placeholder="pageant (Windows)">
        </div>
        <div class="field">
          <label>Ścieżka SSH config</label>
          <input type="text" id="f_sshConfigPath" placeholder="~/.ssh/config">
        </div>
        <div class="checkbox-field">
          <input type="checkbox" id="f_interactiveAuth">
          <label for="f_interactiveAuth">Interaktywna autoryzacja (np. 2FA)</label>
        </div>
      </div>
    </div>

    <!-- FTP -->
    <div class="section" id="sectionFtp" style="display:none;">
      <div class="section-header" data-section="ftp">
        <span class="arrow">▶</span> Opcje FTP
      </div>
      <div class="section-body">
        <div class="field">
          <label>Szyfrowanie (secure)</label>
          <select id="f_secure">
            <option value="false">Brak</option>
            <option value="true">Pełne (TLS)</option>
            <option value="control">Tylko kontrolne</option>
            <option value="implicit">Implicit</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Synchronizacja -->
    <div class="section">
      <div class="section-header" data-section="sync">
        <span class="arrow">▶</span> Synchronizacja
      </div>
      <div class="section-body">
        <div class="checkbox-field">
          <input type="checkbox" id="f_uploadOnSave">
          <label for="f_uploadOnSave">Upload przy zapisie</label>
        </div>
        <div class="checkbox-field">
          <input type="checkbox" id="f_useTempFile">
          <label for="f_useTempFile">Używaj pliku tymczasowego</label>
        </div>
        <div class="field">
          <label>Download przy otwarciu</label>
          <select id="f_downloadOnOpen">
            <option value="confirm">Pytaj</option>
            <option value="true">Tak</option>
            <option value="false">Nie</option>
          </select>
        </div>
        <div class="field">
          <label>Ignorowane pliki (po jednym w linii)</label>
          <textarea id="f_ignore" placeholder=".vscode&#10;.git&#10;.DS_Store"></textarea>
        </div>
        <div class="field">
          <label>Plik ignorowania</label>
          <input type="text" id="f_ignoreFile" placeholder=".gitignore">
        </div>
      </div>
    </div>

    <!-- Watcher -->
    <div class="section">
      <div class="section-header" data-section="watcher">
        <span class="arrow">▶</span> Watcher
      </div>
      <div class="section-body">
        <div class="field">
          <label>Wzorzec plików</label>
          <input type="text" id="f_watcherFiles" placeholder="**/*">
        </div>
        <div class="checkbox-field">
          <input type="checkbox" id="f_watcherAutoUpload" checked>
          <label for="f_watcherAutoUpload">Auto-upload</label>
        </div>
        <div class="checkbox-field">
          <input type="checkbox" id="f_watcherAutoDelete">
          <label for="f_watcherAutoDelete">Auto-delete</label>
        </div>
      </div>
    </div>

    <!-- Zaawansowane -->
    <div class="section">
      <div class="section-header" data-section="advanced">
        <span class="arrow">▶</span> Zaawansowane
      </div>
      <div class="section-body">
        <div class="field-row">
          <div class="field">
            <label>Współbieżność</label>
            <input type="number" id="f_concurrency" value="4">
          </div>
          <div class="field">
            <label>Timeout (ms)</label>
            <input type="number" id="f_connectTimeout" value="10000">
          </div>
        </div>
        <div class="field">
          <label>Offset czasu (godz.)</label>
          <input type="number" id="f_remoteTimeOffsetInHours" value="0" step="0.5">
        </div>
        <div class="field" id="fieldDefaultProfile" style="display:none;">
          <label>Domyślny profil</label>
          <select id="f_defaultProfile">
            <option value="">(brak)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Sync Options -->
    <div class="section">
      <div class="section-header" data-section="syncopt">
        <span class="arrow">▶</span> Opcje Sync
      </div>
      <div class="section-body">
        <div class="checkbox-field">
          <input type="checkbox" id="f_syncDelete">
          <label for="f_syncDelete">Usuń nadmiarowe pliki z celu</label>
        </div>
        <div class="checkbox-field">
          <input type="checkbox" id="f_syncSkipCreate">
          <label for="f_syncSkipCreate">Pomiń tworzenie nowych plików</label>
        </div>
        <div class="checkbox-field">
          <input type="checkbox" id="f_syncIgnoreExisting">
          <label for="f_syncIgnoreExisting">Pomiń istniejące pliki</label>
        </div>
        <div class="checkbox-field">
          <input type="checkbox" id="f_syncUpdate">
          <label for="f_syncUpdate">Aktualizuj tylko nowsze</label>
        </div>
      </div>
    </div>

    <div class="btn-group">
      <button class="btn btn-primary" id="btnSave">💾 Zapisz</button>
      <button class="btn btn-warning btn-sm" id="btnSetDefault" style="display:none;">⭐ Ustaw domyślny</button>
      <button class="btn btn-danger btn-sm" id="btnDeleteProfile" style="display:none;">🗑 Usuń profil</button>
    </div>
  </div>
</div>

<div class="status-bar" id="statusBar"></div>

<script>
(function() {
  const vscode = acquireVsCodeApi();

  // === State ===
  let fullConfig = null;     // cały obiekt z sftp.json
  let activeProfile = '__base__';  // '__base__' = konfiguracja bazowa, inne = nazwa profilu

  // === DOM ===
  const editor = document.getElementById('editor');
  const emptyState = document.getElementById('emptyState');
  const statusBar = document.getElementById('statusBar');
  const profileBar = document.getElementById('profileBar');
  const profileNotice = document.getElementById('profileNotice');
  const btnDeleteProfile = document.getElementById('btnDeleteProfile');
  const btnSetDefault = document.getElementById('btnSetDefault');
  const fieldDefaultProfile = document.getElementById('fieldDefaultProfile');

  // === Sekcje zwijane ===
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      const arrow = header.querySelector('.arrow');
      const body = header.nextElementSibling;
      const isOpen = body.classList.toggle('open');
      arrow.classList.toggle('open', isOpen);
    });
  });

  // === Protokół -> widoczność sekcji ===
  const protocolSelect = document.getElementById('f_protocol');
  const sectionAuth = document.getElementById('sectionAuth');
  const sectionFtp = document.getElementById('sectionFtp');

  protocolSelect.addEventListener('change', () => {
    const isSftp = protocolSelect.value === 'sftp';
    sectionAuth.style.display = isSftp ? '' : 'none';
    sectionFtp.style.display = isSftp ? 'none' : '';
    document.getElementById('f_port').value = isSftp ? '22' : '21';
  });

  // === Renderuj paski profili ===
  function renderProfileTabs() {
    if (!fullConfig) return;

    const profiles = fullConfig.profiles || {};
    const profileNames = Object.keys(profiles);
    const hasProfiles = profileNames.length > 0;

    profileBar.style.display = '';
    profileBar.innerHTML = '';

    // Zakładka bazowa
    const baseTab = document.createElement('button');
    baseTab.className = 'profile-tab base' + (activeProfile === '__base__' ? ' active' : '');
    baseTab.dataset.profile = '__base__';
    baseTab.innerHTML = '⚙ Bazowa';
    baseTab.addEventListener('click', () => switchProfile('__base__'));
    profileBar.appendChild(baseTab);

    // Zakładki profili
    profileNames.forEach(name => {
      const tab = document.createElement('button');
      tab.className = 'profile-tab' + (activeProfile === name ? ' active' : '');
      tab.dataset.profile = name;
      const isDefault = fullConfig.defaultProfile === name;
      tab.innerHTML = name + (isDefault ? '<span class="default-badge">domyślny</span>' : '');
      tab.addEventListener('click', () => switchProfile(name));
      profileBar.appendChild(tab);
    });

    // Przycisk dodaj
    const addBtn = document.createElement('button');
    addBtn.className = 'profile-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Dodaj profil';
    addBtn.addEventListener('click', addProfile);
    profileBar.appendChild(addBtn);

    // Pole domyślny profil (tylko w widoku bazowym)
    if (activeProfile === '__base__' && hasProfiles) {
      fieldDefaultProfile.style.display = '';
      const sel = document.getElementById('f_defaultProfile');
      sel.innerHTML = '<option value="">(brak)</option>';
      profileNames.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        if (fullConfig.defaultProfile === n) opt.selected = true;
        sel.appendChild(opt);
      });
    } else {
      fieldDefaultProfile.style.display = 'none';
    }

    // Przycisk usuwania i ustawiania jako domyślny
    if (activeProfile === '__base__') {
      btnDeleteProfile.style.display = 'none';
      btnSetDefault.style.display = 'none';
    } else {
      btnDeleteProfile.style.display = '';
      btnSetDefault.style.display = fullConfig.defaultProfile === activeProfile ? 'none' : '';
    }
    profileNotice.style.display = (activeProfile !== '__base__') ? '' : 'none';
  }

  function switchProfile(name) {
    // Zapisz bieżące dane do pamięci (nie do pliku)
    saveCurrentToMemory();
    activeProfile = name;
    renderProfileTabs();
    loadFormFromConfig();
  }

  function addProfile() {
    // Deleguj do extension host (prompt zablokowany w sandbox)
    vscode.postMessage({
      type: 'prompt',
      trigger: 'newProfile',
      placeholder: 'np. production, staging',
      prompt: 'Nazwa nowego profilu',
      validateInput: 'Nazwa nie może być pusta'
    });
  }

  function handlePromptResult(trigger, value) {
    if (trigger === 'newProfile') {
      const pName = value;
      if (!fullConfig) fullConfig = {};
      if (!fullConfig.profiles) fullConfig.profiles = {};
      if (fullConfig.profiles[pName]) {
        showStatus('⚠️ Profil o tej nazwie już istnieje!', false);
        return;
      }
      fullConfig.profiles[pName] = {};
      activeProfile = pName;
      renderProfileTabs();
      loadFormFromConfig();
      vscode.postMessage({ type: 'liveUpdate', data: fullConfig });
      showStatus('Profil "' + pName + '" dodany – widoczny w edytorze. Kliknij Zapisz aby utrwalić.', true);
    }
  }

  // === Załaduj konfigurację z fullConfig do formularza ===
  function loadFormFromConfig() {
    if (!fullConfig) return;

    let data;
    if (activeProfile === '__base__') {
      // Konfiguracja bazowa – cały config bez "profiles"
      data = { ...fullConfig };
      delete data.profiles;
      delete data.defaultProfile;
    } else {
      // Profil – dziedziczy z bazy wyjściowe wartości dla protokołu, portu i koloru
      data = {
        protocol: fullConfig.protocol,
        port: fullConfig.port,
        color: fullConfig.color,
        ...(fullConfig.profiles?.[activeProfile] || {})
      };
    }

    fillForm(data);
  }

  function fillForm(config) {
    setVal('f_color', config.color || '#28a745');
    setVal('f_name', config.name || '');
    setVal('f_protocol', config.protocol || 'sftp');
    setVal('f_host', config.host || '');
    setVal('f_port', config.port || (config.protocol === 'ftp' ? 21 : 22));
    setVal('f_username', config.username || '');
    setVal('f_password', config.password || '');
    setVal('f_remotePath', config.remotePath || (activeProfile === '__base__' ? '/' : ''));

    // Auth
    setVal('f_privateKeyPath', config.privateKeyPath || '');
    setVal('f_passphrase', typeof config.passphrase === 'string' ? config.passphrase : '');
    setVal('f_agent', config.agent || '');
    setVal('f_sshConfigPath', config.sshConfigPath || '');
    setChecked('f_interactiveAuth', !!config.interactiveAuth);

    // FTP
    setVal('f_secure', String(config.secure || 'false'));

    // Sync
    setChecked('f_uploadOnSave', !!config.uploadOnSave);
    setChecked('f_useTempFile', !!config.useTempFile);
    setVal('f_downloadOnOpen', String(config.downloadOnOpen ?? 'confirm'));
    setVal('f_ignore', (config.ignore || []).join('\\n'));
    setVal('f_ignoreFile', config.ignoreFile || '');

    // Watcher
    if (config.watcher) {
      setVal('f_watcherFiles', config.watcher.files || '');
      setChecked('f_watcherAutoUpload', config.watcher.autoUpload !== false);
      setChecked('f_watcherAutoDelete', !!config.watcher.autoDelete);
    } else {
      setVal('f_watcherFiles', '');
      setChecked('f_watcherAutoUpload', false);
      setChecked('f_watcherAutoDelete', false);
    }

    // Advanced
    setVal('f_concurrency', config.concurrency || (activeProfile === '__base__' ? 4 : ''));
    setVal('f_connectTimeout', config.connectTimeout || (activeProfile === '__base__' ? 10000 : ''));
    setVal('f_remoteTimeOffsetInHours', config.remoteTimeOffsetInHours || 0);

    // Sync options
    if (config.syncOption) {
      setChecked('f_syncDelete', !!config.syncOption.delete);
      setChecked('f_syncSkipCreate', !!config.syncOption.skipCreate);
      setChecked('f_syncIgnoreExisting', !!config.syncOption.ignoreExisting);
      setChecked('f_syncUpdate', !!config.syncOption.update);
    } else {
      setChecked('f_syncDelete', false);
      setChecked('f_syncSkipCreate', false);
      setChecked('f_syncIgnoreExisting', false);
      setChecked('f_syncUpdate', false);
    }

    // Widoczność sekcji
    const isSftp = protocolSelect.value === 'sftp';
    sectionAuth.style.display = isSftp ? '' : 'none';
    sectionFtp.style.display = isSftp ? 'none' : '';
  }

  // === Zbierz dane z formularza ===
  function collectFormData(isProfile) {
    const protocol = getVal('f_protocol');
    const config = {};

    // Profile: tylko wypełnione pola (puste = dziedzicz z bazy)
    const addIfSet = (key, val) => {
      if (isProfile) {
        if (val !== '' && val !== undefined && val !== null) config[key] = val;
      } else {
        config[key] = val;
      }
    };

    const nameVal = getVal('f_name');
    if (nameVal || !isProfile) addIfSet('name', nameVal || undefined);
    const color = getVal('f_color');
    if (isProfile) {
      // Dla profilu zapisuj color, protokół i port tylko gdy różnią się od bazowego, żeby JSON był czysty
      if (color && color !== (fullConfig.color || '#28a745')) config.color = color;
      if (protocol !== fullConfig.protocol) config.protocol = protocol;
    } else {
      if (color && color !== '#28a745') config.color = color;
      addIfSet('protocol', protocol);
    }

    const host = getVal('f_host');
    if (host || !isProfile) addIfSet('host', host);

    const port = parseInt(getVal('f_port'));
    if (!isNaN(port)) {
      if (isProfile) {
        if (port !== fullConfig.port) config.port = port;
      } else {
        if (port) config.port = port;
      }
    } else if (!isProfile) {
      config.port = protocol === 'ftp' ? 21 : 22;
    }

    const user = getVal('f_username');
    if (user || !isProfile) addIfSet('username', user || undefined);

    const pw = getVal('f_password');
    if (pw) config.password = pw;

    const rp = getVal('f_remotePath');
    if (rp || !isProfile) addIfSet('remotePath', rp || '/');

    // Booleans – dla profili dodaj tylko jeśli zaznaczony
    if (isChecked('f_uploadOnSave') || !isProfile) config.uploadOnSave = isChecked('f_uploadOnSave');
    if (isChecked('f_useTempFile')) config.useTempFile = true;

    const doo = getVal('f_downloadOnOpen');
    if (doo !== 'confirm' || !isProfile) {
      config.downloadOnOpen = doo === 'true' ? true : (doo === 'false' ? false : 'confirm');
    }

    // Ignore
    const ignoreText = getVal('f_ignore').trim();
    if (ignoreText) config.ignore = ignoreText.split('\\n').map(s => s.trim()).filter(Boolean);
    const ignoreFile = getVal('f_ignoreFile');
    if (ignoreFile) config.ignoreFile = ignoreFile;

    // Advanced
    const conc = parseInt(getVal('f_concurrency'));
    if (!isNaN(conc) && conc) config.concurrency = conc;
    const ct = parseInt(getVal('f_connectTimeout'));
    if (!isNaN(ct) && ct) config.connectTimeout = ct;
    const offset = parseFloat(getVal('f_remoteTimeOffsetInHours'));
    if (offset !== 0 && !isNaN(offset)) config.remoteTimeOffsetInHours = offset;

    // Sync options
    const syncOpt = {};
    if (isChecked('f_syncDelete')) syncOpt.delete = true;
    if (isChecked('f_syncSkipCreate')) syncOpt.skipCreate = true;
    if (isChecked('f_syncIgnoreExisting')) syncOpt.ignoreExisting = true;
    if (isChecked('f_syncUpdate')) syncOpt.update = true;
    if (Object.keys(syncOpt).length > 0) config.syncOption = syncOpt;

    // Watcher
    const wf = getVal('f_watcherFiles');
    if (wf || isChecked('f_watcherAutoUpload') || isChecked('f_watcherAutoDelete')) {
      config.watcher = {
        files: wf || '**/*',
        autoUpload: isChecked('f_watcherAutoUpload'),
        autoDelete: isChecked('f_watcherAutoDelete'),
      };
    }

    // SFTP only
    if (protocol === 'sftp' || isProfile) {
      const pkPath = getVal('f_privateKeyPath');
      if (pkPath) config.privateKeyPath = pkPath;
      const pp = getVal('f_passphrase');
      if (pp) config.passphrase = pp;
      const agent = getVal('f_agent');
      if (agent) config.agent = agent;
      const sshCfg = getVal('f_sshConfigPath');
      if (sshCfg) config.sshConfigPath = sshCfg;
      if (isChecked('f_interactiveAuth')) config.interactiveAuth = true;
    }

    // FTP only
    if (protocol === 'ftp' || isProfile) {
      const sec = getVal('f_secure');
      if (sec === 'true') config.secure = true;
      else if (sec === 'control' || sec === 'implicit') config.secure = sec;
    }

    return config;
  }

  // === Zapisz bieżący formularz do pamięci (fullConfig) ===
  function saveCurrentToMemory() {
    if (!fullConfig) return;

    const managedKeys = ['name', 'protocol', 'color', 'host', 'port', 'username', 'password', 'remotePath', 'uploadOnSave', 'useTempFile', 'downloadOnOpen', 'ignore', 'ignoreFile', 'watcher', 'concurrency', 'connectTimeout', 'remoteTimeOffsetInHours', 'syncOption', 'privateKeyPath', 'passphrase', 'agent', 'sshConfigPath', 'interactiveAuth', 'secure'];

    if (activeProfile === '__base__') {
      const data = collectFormData(false);
      
      // Aktualizuj klucze zarządzane przez GUI, nie niszcząc pozostałych
      managedKeys.forEach(k => {
        if (data.hasOwnProperty(k)) {
          if (data[k] === undefined) {
            delete fullConfig[k];
          } else {
            fullConfig[k] = data[k];
          }
        } else {
          delete fullConfig[k];
        }
      });

      // Aktualizuj defaultProfile z selecta
      const dpVal = getVal('f_defaultProfile');
      if (dpVal) fullConfig.defaultProfile = dpVal;
      else delete fullConfig.defaultProfile;
    } else {
      if (!fullConfig.profiles) fullConfig.profiles = {};
      const currentProfile = fullConfig.profiles[activeProfile] || {};
      const profileData = collectFormData(true);
      
      managedKeys.forEach(k => {
        if (profileData.hasOwnProperty(k)) {
          if (profileData[k] === undefined) {
            delete currentProfile[k];
          } else {
            currentProfile[k] = profileData[k];
          }
        } else {
          delete currentProfile[k];
        }
      });
      fullConfig.profiles[activeProfile] = currentProfile;
    }
    
    // Zawsze wysyłaj liveUpdate po aktualizacji pamięci
    vscode.postMessage({ type: 'liveUpdate', data: fullConfig });
  }

  // Nasłuchiwanie zmian w formularzu do trybu live-update
  document.getElementById('formContainer').addEventListener('input', () => {
    if (fullConfig) saveCurrentToMemory();
  });
  document.getElementById('formContainer').addEventListener('change', () => {
    if (fullConfig) saveCurrentToMemory();
  });

  // === Helpers ===
  function setVal(id, val) { document.getElementById(id).value = val; }
  function getVal(id) { return document.getElementById(id).value; }
  function setChecked(id, val) { document.getElementById(id).checked = val; }
  function isChecked(id) { return document.getElementById(id).checked; }

  function showStatus(msg, isSuccess) {
    statusBar.textContent = msg;
    statusBar.className = 'status-bar visible' + (isSuccess ? ' success' : '');
    setTimeout(() => { statusBar.className = 'status-bar'; }, 3000);
  }

  // === Załaduj config (z extension host) ===
  function loadFullConfig(config) {
    if (!config) {
      fullConfig = null;
      editor.style.display = 'none';
      emptyState.style.display = '';
      profileBar.style.display = 'none';
      return;
    }
    fullConfig = JSON.parse(JSON.stringify(config)); // deep copy
    editor.style.display = '';
    emptyState.style.display = 'none';
    activeProfile = '__base__';
    renderProfileTabs();
    loadFormFromConfig();
  }

  // === Buttons ===
  document.getElementById('btnSave').addEventListener('click', () => {
    saveCurrentToMemory();

    if (!fullConfig) return;
    if (!fullConfig.host && activeProfile === '__base__') {
      showStatus('⚠️ Podaj adres hosta!', false);
      return;
    }

    vscode.postMessage({ type: 'save' });
  });

  document.getElementById('btnCreateNew').addEventListener('click', () => {
    loadFullConfig({
      protocol: 'sftp',
      host: '',
      port: 22,
      username: '',
      remotePath: '/',
      uploadOnSave: false,
    });
  });
  document.getElementById('btnReload').addEventListener('click', () => {
    vscode.postMessage({ type: 'ready' });
  });

  document.getElementById('btnBrowseRemote').addEventListener('click', (e) => {
    e.preventDefault();
    // Pobierz bieżące wpisane dane do połączenia
    const currentData = collectFormData(activeProfile !== '__base__');
    vscode.postMessage({ type: 'selectRemotePath', data: currentData });
  });

  document.getElementById('btnSetDefault').addEventListener('click', () => {
    fullConfig.defaultProfile = activeProfile;
    renderProfileTabs();
    vscode.postMessage({ type: 'liveUpdate', data: fullConfig });
    vscode.postMessage({ type: 'save' });
    showStatus('Profil "' + activeProfile + '" ustawiony jako domyślny i zapisany.', true);
  });

  document.getElementById('btnDeleteProfile').addEventListener('click', () => {
    if (activeProfile === '__base__') return;
    vscode.postMessage({
      type: 'confirm',
      trigger: 'deleteProfile',
      message: 'Usunąć profil ' + activeProfile + '?',
      confirmText: 'Usuń',
      profileName: activeProfile
    });
  });

  function handleConfirmResult(trigger, value) {
    if (trigger === 'deleteProfile') {
      const profileName = value;
      if (fullConfig && fullConfig.profiles) {
        delete fullConfig.profiles[profileName];
        if (fullConfig.defaultProfile === profileName) {
          delete fullConfig.defaultProfile;
        }
        if (Object.keys(fullConfig.profiles).length === 0) {
          delete fullConfig.profiles;
        }
      }
      activeProfile = '__base__';
      renderProfileTabs();
      loadFormFromConfig();
      vscode.postMessage({ type: 'liveUpdate', data: fullConfig });
      showStatus('Profil "' + profileName + '" usunięty z edytora. Kliknij Zapisz aby utrwalić na dysku.', true);
    }
  }

  // === Odbiór wiadomości ===
  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'loadConfig':
        loadFullConfig(msg.data);
        break;
      case 'saved':
        showStatus('✅ Zapisano pomyślnie', true);
        break;
      case 'addNewProfile':
        if (!fullConfig) {
          loadFullConfig({ protocol: 'sftp', host: '', port: 22, username: '', remotePath: '/' });
        }
        addProfile();
        break;
      case 'promptResult':
        if (msg.trigger === 'newProfile') {
          handlePromptResult(msg.trigger, msg.value);
        }
        break;
      case 'confirmResult':
        if (msg.trigger === 'deleteProfile') {
          handleConfirmResult(msg.trigger, msg.value);
        }
        break;
      case 'remotePathSelected':
        if (msg.path) {
          setVal('f_remotePath', msg.path);
          saveCurrentToMemory(); // Od razu łapiemy ten input i updatujemy live
        }
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
  }
}
