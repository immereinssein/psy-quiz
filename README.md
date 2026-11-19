# Psychologie-Quiz

Statische Quiz-Webseite (HTML/CSS/JS, kein Build-Schritt). Läuft auf GitHub Pages.

## Aufbau
- `index.html`, `style.css`, `app.js` – Oberfläche
- `store.js` – Speichert den Fortschritt pro Name im Browser (localStorage) und, falls eingerichtet, in Firebase Firestore
- `sync-config.js` – Firebase-Zugang (leer = nur lokal)
- `themen/index.json` – Liste der Themen
- `themen/<thema>.enc.json` – Fragen eines Themas, mit dem App-Passwort verschlüsselt (AES-256-GCM, PBKDF2)

Die unverschlüsselten Fragen gehören **nicht** in dieses Repository (urheberrechtlich geschützte Quellen).

## Neues Thema hinzufügen
1. Fragen als `<id>.json` im unten gezeigten Format erstellen (außerhalb des Repositorys).
2. Verschlüsseln: `node verschluesseln.mjs <id>.json themen/<id>.enc.json <App-Passwort>`
3. Eintrag in `themen/index.json` ergänzen.

Fragenformat:
```json
{ "id": 1, "level": "leicht", "question": "…", "formula": null,
  "options": ["…", "…", "…", "…"], "correct": [0, 2],
  "explanation": "…", "slides": "Folien 4–5" }
```
`correct` zählt die Optionen ab 0 (A = 0, B = 1 …).

## Firestore-Regeln (für den Sync)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /progress/{name} {
      allow read, write: if true;
    }
  }
}
```
