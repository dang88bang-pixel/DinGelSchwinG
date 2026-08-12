# Bilder

Dieses Verzeichnis hält App-Grafiken (Splash, Icons, Illustrationen).

| Datei | Zweck |
|---|---|
| `splash.png` | Launch-Splash der App (empfohlen 1152×1152 px) |
| `app_icon.png` | App-Icon (für Android/iOS-Ressourcen) |

Hinweis: Die Dateien werden hier nicht mitgeliefert (binäre Assets).
Vor dem Release einfügen; `flutter pub get` + `flutter build` erwartet die
unter `pubspec.yaml` deklarierten Asset-Ordner.
