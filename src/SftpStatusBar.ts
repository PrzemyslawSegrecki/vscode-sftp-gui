import * as vscode from 'vscode';
import { SftpConfigProvider } from './sftpConfigProvider';

export class SftpStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private configProvider: SftpConfigProvider;

    constructor(context: vscode.ExtensionContext, configProvider: SftpConfigProvider) {
        this.configProvider = configProvider;
        
        // Priorytet wyższy by był blisko po prawej stronie (obok natywnego SFTP)
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
        this.statusBarItem.command = 'sftpGui.openManager';
        
        context.subscriptions.push(this.statusBarItem);

        // Nasłuchujemy zmian w dokumentach VS Code
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (this.isConfigDoc(doc)) this.update();
            }),
            vscode.workspace.onDidChangeTextDocument(e => {
                if (this.isConfigDoc(e.document)) this.update();
            })
        );

        this.update();
    }

    private isConfigDoc(doc: vscode.TextDocument): boolean {
        const configUri = this.configProvider.getConfigUri();
        return !!configUri && doc.uri.fsPath === configUri.fsPath;
    }

    public async update() {
        const config = await this.configProvider.getConfigFromEditor();
        if (!config) {
            this.statusBarItem.hide();
            return;
        }

        let profileName = 'Bazowa';
        let color = config.color || '#28a745';

        if (config.defaultProfile && config.profiles && config.profiles[config.defaultProfile]) {
            profileName = config.defaultProfile;
            color = config.profiles[config.defaultProfile].color || config.color || '#28a745';
        } else {
            // Jeśli nie ma domyślnego profilu, SFTP plugin używa parametrów z głównego obiektu
            profileName = 'Bazowa';
            color = config.color || '#28a745';
        }

        this.statusBarItem.text = `Profil: ${profileName}`;
        this.statusBarItem.tooltip = `SFTP: Manager połączeń. Kliknij aby pobrać / ustanowić domyślny profil w GUI`;
        this.statusBarItem.color = color; // Kolor the foreground
        this.statusBarItem.show();
    }
}
