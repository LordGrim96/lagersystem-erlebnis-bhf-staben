# Lagersystem Erlebnisbahnhof Staben

Einfache Web-App zur Lagerverwaltung für den Erlebnisbahnhof Staben.
Läuft im Browser auf PC, Tablet und Handy – ohne Installation.

## Funktionen

- **Artikel** anlegen und bearbeiten (Bezeichnung, Lagerort, Einheit, Mindestbestand, Notiz)
- **Ein- und Ausbuchen** mit Menge, Person und Notiz – Ausgänge über den Bestand hinaus werden verhindert
- **Verlauf** aller Buchungen, filterbar nach Artikel und Ein-/Ausgang
- **Mindestbestand-Warnung**: Artikel am oder unter Mindestbestand werden oben hervorgehoben
  („nachbestellen“), knapp darüber als „knapp“ markiert
- **Datensicherung** als JSON (herunterladen / einspielen) und Bestandsliste als CSV für Excel

## Starten

`index.html` im Browser öffnen – fertig.

## Datenspeicherung

Die Daten liegen aktuell **lokal im Browser** (localStorage) des jeweiligen Geräts.
Bitte regelmäßig unter **Daten → Sicherung herunterladen** sichern. Eine gemeinsame Datenbank
für mehrere Geräte/Nutzer ist als nächster Ausbauschritt vorgesehen.

## Aufbau

| Datei        | Inhalt                          |
|--------------|---------------------------------|
| `index.html` | Oberfläche und Dialoge          |
| `style.css`  | Gestaltung (inkl. Handy-Ansicht und Dark Mode) |
| `app.js`     | Logik, Speicherung, Export/Import |
