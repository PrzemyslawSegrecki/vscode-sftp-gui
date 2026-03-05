import * as vscode from 'vscode';
import { SftpProfile } from './sftpConfigProvider';
import * as path from 'path';

export class RemoteDirectoryPicker {
  public static async pickDirectory(config: SftpProfile, startPath: string = '/'): Promise<string | undefined> {
    const protocol = config.protocol || 'sftp';
    
    if (protocol === 'ftp') {
      return this.pickDirectoryFtp(config, startPath);
    } else {
      return this.pickDirectorySftp(config, startPath);
    }
  }

  private static async pickDirectoryFtp(config: SftpProfile, startPath: string): Promise<string | undefined> {
    const ftp = require('basic-ftp');
    const client = new ftp.Client();
    client.ftp.verbose = false;

    let currentPath = startPath || '/';

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Łączenie z serwerem FTP...',
        cancellable: false
      }, async () => {
        const secureVal = config.secure;
        const useTLS = secureVal === true || secureVal === 'implicit' || secureVal === 'control';
        
        await client.access({
          host: config.host,
          port: config.port || 21,
          user: config.username,
          password: config.password || '',
          secure: useTLS,
          secureOptions: { rejectUnauthorized: false }
        });
      });

      while (true) {
        const items = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Window,
          title: 'Zczytywanie katalogu FTP...'
        }, async () => {
          const list = await client.list(currentPath);
          return list.filter((item: any) => item.isDirectory).sort((a: any, b: any) => a.name.localeCompare(b.name));
        });

        const qpItems: vscode.QuickPickItem[] = [
          { label: '$(check) Wybierz obecny katalog', description: currentPath, picked: true },
        ];
        
        if (currentPath !== '/' && currentPath !== '') {
          qpItems.push({ label: '$(arrow-up) ..' });
        }

        for (const dir of Object.values(items)) {
          qpItems.push({ label: `$(folder) ${(dir as any).name}` });
        }

        const picked = await vscode.window.showQuickPick(qpItems, {
          placeHolder: `Wybierz katalog... (${currentPath})`,
          ignoreFocusOut: true
        });

        if (!picked) {
          // Cancelled
          return undefined;
        }

        if (picked.label.startsWith('$(check)')) {
          // Selected this directory
          return currentPath;
        } else if (picked.label.startsWith('$(arrow-up)')) {
          // Go up
          const parent = path.posix.dirname(currentPath);
          currentPath = parent === '.' ? '/' : parent;
        } else {
          // Go down
          const folderName = picked.label.replace('$(folder) ', '');
          currentPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
        }
      }
    } finally {
      client.close();
    }
  }

  private static async pickDirectorySftp(config: SftpProfile, startPath: string): Promise<string | undefined> {
    const Client = require('ssh2').Client;
    const conn = new Client();
    
    let currentPath = (startPath || '/').replace(/\\/g, '/');

    return new Promise((resolve, reject) => {
      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Łączenie z serwerem SFTP...',
        cancellable: false
      }, async () => {
        return new Promise<void>((connResolve, connReject) => {
          conn.on('ready', () => connResolve());
          conn.on('error', (err: any) => connReject(err));
          
          const connectOptions: any = {
            host: config.host,
            port: config.port || 22,
            username: config.username,
            readyTimeout: config.connectTimeout || 10000,
          };
      
          if (config.privateKeyPath) {
            connectOptions.privateKey = require('fs').readFileSync(
              config.privateKeyPath.replace(/^~/, require('os').homedir())
            );
          } else {
            connectOptions.password = config.password || '';
          }
      
          conn.connect(connectOptions);
        });
      }).then(async () => {
        conn.sftp(async (err: any, sftp: any) => {
          if (err) {
            conn.end();
            vscode.window.showErrorMessage('Błąd SFTP: ' + err.message);
            return resolve(undefined);
          }

          const readDir = (dirPath: string): Promise<any[]> => {
            return new Promise((res, rej) => {
              sftp.readdir(dirPath, (rErr: any, list: any[]) => {
                if (rErr) return rej(rErr);
                res(list);
              });
            });
          };

          try {
            while (true) {
              const list = await vscode.window.withProgress({
                  location: vscode.ProgressLocation.Window,
                  title: 'Zczytywanie katalogu SFTP...'
              }, async () => {
                  try {
                    return await readDir(currentPath);
                  } catch (e) {
                    vscode.window.showErrorMessage('Nie można odczytać: ' + currentPath);
                    return [];
                  }
              });

              // Filtruj foldery
              const folders = list.filter(item => {
                // Konwersja maski do typu
                // (item.attrs.mode & require('fs').constants.S_IFMT) === require('fs').constants.S_IFDIR
                // Ale w SSH2 atrybuty zwracają funkcję isDirectory() objęte w atrybutach, lub mode z którego można odczytać
                // Jako uproszczenie sprawdzamy pierwszy znak longname (zwykle 'd') lub attrs isDirectory
                if (item.attrs && item.attrs.isDirectory) return item.attrs.isDirectory();
                return item.longname && item.longname.startsWith('d');
              }).sort((a, b) => a.filename.localeCompare(b.filename));

              const qpItems: vscode.QuickPickItem[] = [
                { label: '$(check) Wybierz obecny katalog', description: currentPath, picked: true },
              ];
              
              if (currentPath !== '/' && currentPath !== '') {
                qpItems.push({ label: '$(arrow-up) ..' });
              }
      
              for (const dir of folders) {
                if (dir.filename === '.' || dir.filename === '..') continue;
                qpItems.push({ label: `$(folder) ${dir.filename}` });
              }
      
              const picked = await vscode.window.showQuickPick(qpItems, {
                placeHolder: `Wybierz katalog... (${currentPath})`,
                ignoreFocusOut: true
              });
      
              if (!picked) {
                conn.end();
                return resolve(undefined);
              }
      
              if (picked.label.startsWith('$(check)')) {
                conn.end();
                return resolve(currentPath);
              } else if (picked.label.startsWith('$(arrow-up)')) {
                const parent = path.posix.dirname(currentPath);
                currentPath = parent === '.' ? '/' : parent;
              } else {
                const folderName = picked.label.replace('$(folder) ', '');
                currentPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
              }
            }
          } catch (loopErr: any) {
            vscode.window.showErrorMessage('Błąd przeglądania: ' + loopErr.message);
            conn.end();
            resolve(undefined);
          }
        });
      }).catch(err => {
        vscode.window.showErrorMessage('Błąd łączenia: ' + err.message);
        resolve(undefined);
      });
    });
  }
}
