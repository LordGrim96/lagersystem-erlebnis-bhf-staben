# Getränkelager Erlebnisbahnhof Staben

Web-App für das Getränkelager des Erlebnisbahnhofs Staben
(Cola, Calypso, Eistee, Jambo, Holundersirup, Radler, Bier, alkoholfreies Bier, Forst, Prosecco, Aperol).
Läuft im Browser auf PC, Tablet und Handy – ohne Installation.

## Funktionen

- **Getränke** anlegen und bearbeiten (Bezeichnung, Sorte, Einzelstück wie Flasche/Dose, Stück pro Kiste, Mindestbestände, Notiz)
- **Gezählt wird in Einzelstücken.** Kisten sind nur Eingabehilfe bei Lieferungen (2 Kisten à 24 = 48 Flaschen) und Orientierung im Lager
- **Navigation**: Waggon (Startseite) · Lager · Übersicht · Verlauf · Einstellungen (inkl. Datensicherung)
  - **Waggon zählen**: pro Getränk nur eingeben, wie viel noch da ist → die App zeigt sofort, wie viel
    bis zur Mindeststückzahl **nachgefüllt** werden muss (die Differenz wird als Verkauf gebucht)
  - **Lager**: zeigt pro Getränk „Zum Waggon bringen“ – mit „✓ Gebracht“ bzw. „Alles zum Waggon gebracht“
    wird umgebucht; **Lieferungen** auch in Kisten eingebbar
  - Warnung „nachbestellen“, wenn das Lager seine Mindeststückzahl erreicht
- **Einstellungen**: Mindeststückzahl im Waggon, Mindeststückzahl im Lager und Stück pro Kiste für alle
  Getränke jederzeit auf einer Seite ändern
- **Gestaltung im Stil des Bahnhofsplakats** (Papier, Druckfarbe, Bordeaux, Stempel), mit dunkler Variante
- **Getränkeliste mit einem Klick**: bei leerem Lager legt ein Button alle Getränke des Bahnhofs an
- Anzeige **nach Sorten gruppiert**: Alkoholfrei, Bier & Radler, Wein & Prosecco, Spirituosen
- Buchungen mit Menge, Person und Notiz – es kann nie mehr umgebucht oder verkauft werden, als vorhanden ist
- **Verlauf** aller Buchungen, filterbar nach Getränk und Buchungsart
- **Mindestbestand-Warnung**: Getränke am oder unter Mindestbestand werden oben hervorgehoben
  („nachbestellen“/„auffüllen“), bis 25 % darüber als „knapp“ markiert
- **Gemeinsame Datenbank** (optional, Supabase): alle Geräte sehen dieselben Daten, Änderungen
  erscheinen live; Zugang nur mit Anmeldung
- **Rollen**: *Admins* sehen und ändern alles; *Mitarbeiter* sehen nur den Waggon und tragen ein, was
  verbraucht wurde. Unter Einstellungen → Benutzer sieht der Admin letzte Anmeldung, zuletzt aktiv und letzte
  Buchung jedes Benutzers und legt fest, wer Admin ist. Die Rechte werden in der Datenbank geprüft.
- **Als App installierbar**: eigenes Symbol auf dem Startbildschirm, Vollbild ohne Browser-Leiste
  (Android: Knopf „Installieren“, iPhone: Safari → Teilen → „Zum Home-Bildschirm“)
- **Funktioniert auch ohne Internet**: Die App wird auf dem Gerät gespeichert und startet auch ohne Netz
  mit dem zuletzt geladenen Stand. Lieferungen, „Gebracht“, Zählungen und Verkäufe werden zwischengespeichert
  und automatisch hochgeladen, sobald wieder Internet da ist (Getränke anlegen und Einstellungen nur online)
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
4. **Authentication → Users → Add user → Create new user**: für jede Person als E-Mail
   `name@staben.lager` und ein Passwort anlegen (*Auto Confirm User* anhaken). Angemeldet wird in der
   App dann nur mit dem **Benutzernamen** (`name`). Echte E-Mail-Adressen funktionieren ebenfalls.
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
| `sw.js` | Speichert die App-Dateien fürs Arbeiten ohne Internet |
| `manifest.webmanifest`, `icons/` | App-Name, Farben und App-Symbole für die Installation |
| `supabase/schema.sql` | Tabellen, Zugriffsregeln und Buchungsfunktion für Supabase |
| `.github/workflows/pages.yml` | Automatische Veröffentlichung über GitHub Pages |
