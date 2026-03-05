import * as vscode from 'vscode';
import { SftpGuiViewProvider } from './panels/SftpGuiPanel';
import { DiffFolderPanel } from './panels/DiffFolderPanel';
import { SftpConfigProvider } from './sftpConfigProvider';
import { SftpStatusBar } from './SftpStatusBar';

export function activate(context: vscode.ExtensionContext) {
  const configProvider = new SftpConfigProvider();
  const guiProvider = new SftpGuiViewProvider(context, configProvider);
  
  // Instalujemy pasek statusu
  new SftpStatusBar(context, configProvider);

  // Rejestracja WebView w sidebarze
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('sftpGuiView', guiProvider)
  );

  // Komenda: Otwórz Manager
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpGui.openManager', () => {
      vscode.commands.executeCommand('sftpGuiView.focus');
    })
  );

  // Komenda: Dodaj Profil
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpGui.addProfile', () => {
      guiProvider.addNewProfile();
    })
  );

  // Komenda: Diff Folder with Remote
  context.subscriptions.push(
    vscode.commands.registerCommand('sftpGui.diffFolder', async (uri: vscode.Uri) => {
      if (!uri) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
          vscode.window.showErrorMessage('Brak otwartego workspace.');
          return;
        }
        const selected = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          defaultUri: folders[0].uri,
          openLabel: 'Wybierz folder do porównania'
        });
        if (!selected || selected.length === 0) { return; }
        uri = selected[0];
      }

      try {
        const config = await configProvider.getConfig();
        if (!config) {
          vscode.window.showErrorMessage('Nie znaleziono pliku sftp.json. Skonfiguruj połączenie najpierw.');
          return;
        }

        // Jeśli jest wiele profili – pozwól wybrać
        let effectiveConfig = { ...config };
        delete effectiveConfig.profiles;
        delete effectiveConfig.defaultProfile;

        if (config.profiles && Object.keys(config.profiles).length > 0) {
          const profileNames = Object.keys(config.profiles);
          let selectedProfile: string | undefined;

          if (profileNames.length === 1) {
            selectedProfile = profileNames[0];
          } else {
            const items = profileNames.map(name => ({
              label: name,
              description: name === config.defaultProfile ? '(domyślny)' : ''
            }));

            const picked = await vscode.window.showQuickPick(items, {
              placeHolder: 'Wybierz profil połączenia',
              title: 'Diff Folder with Remote'
            });
            if (!picked) { return; }
            selectedProfile = picked.label;
          }

          if (selectedProfile && config.profiles[selectedProfile]) {
            effectiveConfig = { ...effectiveConfig, ...config.profiles[selectedProfile] };
          }
        }

        DiffFolderPanel.createOrShow(context, uri, effectiveConfig, configProvider);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Błąd: ${err.message}`);
      }
    })
  );
}

export function deactivate() {}
