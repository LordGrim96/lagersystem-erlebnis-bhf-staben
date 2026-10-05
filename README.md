# Getränkelager Erlebnisbahnhof Staben

Web-App für das Getränkelager des Erlebnisbahnhofs Staben
(Cola, Calypso, Eistee, Jambo, Holundersirup, Radler, Bier, alkoholfreies Bier, Forst, Prosecco, Aperol).
Läuft im Browser auf PC, Tablet und Handy – ohne Installation.

## Funktionen

- **Getränke** anlegen und bearbeiten (Bezeichnung, Sorte, Einzelstück wie Flasche/Dose, Stück pro Kiste, Mindestbestände, Notiz)
- **Gezählt wird in Einzelstücken.** Kisten sind nur Eingabehilfe bei Lieferungen (2 Kisten à 24 = 48 Flaschen) und Orientierung im Lager
- **Lager und Waggon getrennt**: Umschalter zwischen *Übersicht* (beide Bestände + Summe), *Lager* und *Waggon*
  - **Lieferung** → ins Lager, **Lager → Waggon** beim Auffüllen, **Verkauft** → aus dem Waggon
  - Verkauf auch per Zählen: eingeben, was noch im Waggon steht – die verkaufte Menge wird ausgerechnet
  - Eigene Mindestbestände und Warnungen: „nachbestellen“ (Lager) und „auffüllen“ (Waggon)
- **Gestaltung im Stil des Bahnhofsplakats** (Papier, Druckfarbe, Bordeaux, Stempel), mit dunkler Variante
- **Getränkeliste mit einem Klick**: bei leerem Lager legt ein Button alle Getränke des Bahnhofs an
- Anzeige **nach Sorten gruppiert**: Alkoholfrei, Bier & Radler, Wein & Prosecco, Spirituosen
- Buchungen mit Menge, Person und Notiz – es kann nie mehr umgebucht oder verkauft werden, als vorhanden ist
- **Verlauf** aller Buchungen, filterbar nach Getränk und Buchungsart
- **Mindestbestand-Warnung**: Getränke am oder unter Mindestbestand werden oben hervorgehoben
  („nachbestellen“/„auffüllen“), bis 25 % darüber als „knapp“ markiert
- **Gemeinsame Datenbank** (optional, Supabase): alle Geräte sehen dieselben Daten, Änderungen
  erscheinen live; Zugang nur mit Anmeldung
- **Datensicherung** als JSON und Bestandsliste als CSV für Excel

## Zwei Betriebsarten

| | Lokaler Modus | Gemeinsame Datenbank |
|---|---|---|
| Einrichtung | keine | einmalig ca. 10 Minuten (siehe unten) |
| Daten liegen | nur im jeweiligen Browser | zentral bei Supabase |
| Mehrere Geräte/Personen | nein | ja, mit Live-Abgleich |
| Anmeldung | nein | ja (E-Mail + Passwort) |

Solange in `config.js` nichts eingetragen ist, läuft die App im lokalen Modus.

## Gemeinsame Datenbank einrichten (Supabase, kostenlos)

1. Auf <https://supabase.com> ein Konto anlegen und **New project** erstellen
   (Region z. B. *Frankfurt*, Datenbank-Passwort sicher notieren).
2. Im Projekt links **SQL Editor** öffnen, den kompletten Inhalt von
   [`supabase/schema.sql`](supabase/schema.sql) einfügen und **Run** klicken.
3. **Authentication → Sign In / Providers**: *Allow new users to sign up* **ausschalten**
   (damit sich niemand selbst registrieren kann).
4. **Authentication → Users → Add user → Create new user**: für jede Person E-Mail und
   Passwort anlegen (*Auto Confirm User* anhaken).
5. **Project Settings → API** (bzw. *Data API* / *API Keys*): die **Project URL** und den
   **anon / publishable key** kopieren und in [`config.js`](config.js) eintragen.
6. Änderung committen – fertig. Beim Öffnen der App erscheint nun die Anmeldung.

Daten aus dem lokalen Modus übernehmen: im lokalen Modus unter **Daten → Sicherung herunterladen**,
dann angemeldet unter **Daten → Sicherung übernehmen** die Datei auswählen. Getränke und aktuelle
Bestände werden übernommen (der alte Buchungsverlauf nicht).

### Sicherheit

- Ohne Anmeldung ist kein Lesen oder Schreiben möglich (Row Level Security).
- Der Bestand ändert sich nur über Buchungen; Buchungen können nicht nachträglich geändert
  oder gelöscht werden – der Verlauf bleibt lückenlos.
- Der `anon`-Schlüssel in `config.js` ist zur Veröffentlichung gedacht; geheim bleiben müssen
  nur das Datenbank-Passwort und der `service_role`-Schlüssel (niemals in dieses Repo!).

## Online stellen (GitHub Pages)

Der Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) veröffentlicht die App
bei jedem Push auf `main`.

1. Repository → **Settings → Pages** → *Source*: **GitHub Actions** wählen.
2. Auf `main` pushen (oder unter **Actions → GitHub Pages → Run workflow** starten).
3. Die Adresse steht danach unter Settings → Pages, z. B.
   `https://lordgrim96.github.io/lagersystem-erlebnis-bhf-staben/`.

> **Hinweis:** GitHub Pages für **private** Repositories gibt es nur mit GitHub Pro/Team.
> Mit kostenlosem Konto entweder das Repository öffentlich machen (die Daten liegen ja in der
> Datenbank, nicht im Code) oder einen anderen kostenlosen Hoster nutzen, der private Repos
> unterstützt, z. B. Netlify oder Cloudflare Pages (Build-Befehl leer, Ausgabeordner `/`).

## Lokal starten

`index.html` im Browser öffnen – fertig.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | Oberfläche und Dialoge |
| `style.css` | Gestaltung (inkl. Handy-Ansicht und Dark Mode) |
| `app.js` | Logik, lokale Speicherung bzw. Datenbank-Anbindung, Export/Import |
| `config.js` | Zugangsdaten zur Datenbank (leer = lokaler Modus) |
| `supabase/schema.sql` | Tabellen, Zugriffsregeln und Buchungsfunktion für Supabase |
| `.github/workflows/pages.yml` | Automatische Veröffentlichung über GitHub Pages |
