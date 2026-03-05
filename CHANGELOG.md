# Changelog

## [1.2.0] - 2026-03-05

### Dodane

- **Graficzny wybór ścieżki zdalnej** – nowy przycisk obok pola "Ścieżka zdalna" otwierający drzewo katalogów bezpośrednio z serwera (SFTP/FTP)
- **Wykrywanie sftp.json w root** – rozszerzenie szuka teraz pliku konfiguracji zarówno w `.vscode/sftp.json` jak i bezpośrednio w głównym katalogu workspace

### Poprawione

- Poprawiona obsługa statusu i odświeżanie GUI po ustawieniu domyślnego profilu
- Usprawniona stabilność WebView i lepsza obsługa komunikatów o błędach zapisu
- Poprawione formatowanie i czytelność kodu panelu

## [1.1.0] - 2026-03-04

### Dodane

- **Obsługa wielu profili** – jeden plik `sftp.json` może zawierać wiele konfiguracji/profili (sekcja `profiles`), zgodnie z oryginalnym pluginem SFTP
- Wybór aktywnego profilu z listy rozwijanej
- Dodawanie / usuwanie profili z GUI
- Pole `defaultProfile` do ustawienia domyślnego profilu
- Profile dziedziczą ustawienia z konfiguracji bazowej i nadpisują wybrane pola

### Poprawione

- Diff Folder with Remote – obsługa protokołu FTP (basic-ftp) obok SFTP (ssh2)
- Poprawiona ikona w Activity Bar (brakujący tag SVG)

## [1.0.0] - 2026-03-04

### Dodane

- Manager połączeń SFTP/FTP w sidebarze (WebView)
- Formularz konfiguracji z sekcjami: Połączenie, Autoryzacja SSH, FTP, Synchronizacja, Watcher, Zaawansowane
- Dynamiczne ukrywanie pól SFTP/FTP zależnie od protokołu
- Odczyt i zapis pliku `.vscode/sftp.json`
- Tworzenie nowej konfiguracji jeśli plik nie istnieje
- **Diff Folder with Remote** – PPM na folder w explorerze, porównanie z serwerem
- Panel z listą różnic: zmodyfikowane / tylko lokalne / tylko zdalne
- Kliknięcie na plik deleguje diff do komendy `sftp.diff` pluginu SFTP
- Pakiet `.vsix` do dystrybucji
