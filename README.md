# Meier Marketing-Dashboard

Automatischer täglicher Marketing-Überblick für Meier Sanitär (Website-Besucher + Google-Suche).

## Was passiert hier?
- `fetch-all.js` holt per Dienstkonto (nur Lesezugriff) Zahlen aus Google Analytics (GA4) und Google Search Console und schreibt `data.json`.
- `generate.js` baut daraus eine verständliche `dashboard.html` (Ampeln, Trends, Erklärungen auf Deutsch).
- GitHub Actions (`.github/workflows/daily.yml`) führt das täglich in der Cloud aus und veröffentlicht die Seite über GitHub Pages — **unabhängig davon, ob ein PC läuft**.

## Einrichtung
Der geheime Dienstkonto-Schlüssel liegt NICHT im Code, sondern als verschlüsseltes Repository-Secret `GA_SA_KEY` (Settings → Secrets and variables → Actions).

Lokal (optional) liest `lib.js` stattdessen die Datei `sa-key.json` (nicht eingecheckt, siehe `.gitignore`).

## Nur Lesen
Es werden ausschließlich Berichtsdaten gelesen. Es werden keinerlei Einstellungen in Google-Konten verändert.
