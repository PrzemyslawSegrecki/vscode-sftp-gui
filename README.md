# SFTP GUI Manager for VS Code

Graficzny manager i edytor konfiguracji dla popularnego rozszerzenia **SFTP** (l_p_shane). Pozwala na wygodne zarządzanie plikiem `sftp.json` bez konieczności ręcznej edycji JSON-a, oferuje wsparcie dla wielu profili oraz zaawansowane narzędzie do porównywania folderów (Diff).

## ✨ Funkcje

- **📍 Manager Połączeń**: Wygodny formularz w sidebarze do edycji wszystkich parametrów SFTP/FTP.
- **📁 Graficzny Directory Picker**: Przeglądaj i wybieraj katalogi bezpośrednio z serwera za pomocą interaktywnego drzewa.
- **👥 Obsługa Wielu Profili**: Zarządzaj wieloma profilami połączeń (np. staging, production) w jednym projekcie.
- **🌈 Kolorowe Profile**: Przypisuj kolory do profili, aby łatwo odróżnić, na którym serwerze aktualnie pracujesz (widoczne na pasku statusu).
- **🔄 Diff Folder with Remote**: Potężne narzędzie do porównywania lokalnego folderu z zawartością serwera (identyfikacja zmian, nowych plików i plików do usunięcia).
- **🔍 Automatyczne Wykrywanie**: Obsługuje pliki konfiguracji zarówno w `.vscode/sftp.json` jak i w głównym katalogu projektu.
- **⚡ Synchronizacja na żywo**: Zmiany w GUI są natychmiast odzwierciedlane w edytorze (dirty state), co pozwala na szybki podgląd zmian przed zapisem.

## 🚀 Jak zacząć

1. Otwórz panel **SFTP GUI** w pasku bocznym (ikona połączenia).
2. Jeśli nie masz jeszcze konfiguracji, kliknij **"Utwórz konfigurację"**.
3. Wypełnij dane serwera w formularzu.
4. Kliknij **"Zapisz"**, aby utrwalić zmiany w pliku `sftp.json`.

## 🛠 Wykorzystane technologie

- **ssh2**: Do obsługi połączeń SFTP i przeglądania katalogów.
- **basic-ftp**: Do obsługi połączeń FTP.
- **VS Code Webview API**: Do renderowania nowoczesnego interfejsu użytkownika.

## 📝 Wymagania

Rozszerzenie jest nakładką GUI i wymaga zainstalowanego rozszerzenia `SFTP` (autor: l_p_shane) do faktycznego wykonywania operacji przesyłania plików.

---
Autor: **OpenCode Przemysław Segrecki**
