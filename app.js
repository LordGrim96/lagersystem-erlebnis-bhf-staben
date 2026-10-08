'use strict';

// ---------- Hilfsfunktionen ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const round = (n) => Math.round(n * 1000) / 1000;
const fmt = (n) => Number(n).toLocaleString('de-DE', { maximumFractionDigits: 3 });
const fmtDate = (iso) => new Date(iso).toLocaleString('de-DE', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const $ = (sel) => document.querySelector(sel);
const byName = (x, y) => x.name.localeCompare(y.name, 'de');

// Pro Getränk: bestand = im Lager, waggon = im Waggon (jeweils mit eigenem Mindestbestand)
let state = { artikel: [], buchungen: [] };
const findArtikel = (id) => state.artikel.find((a) => a.id === id);

// Gezählt wird in Einzelstücken (Flasche, Dose …). Kisten dienen nur als Eingabehilfe
// bei Lieferungen und als Orientierung im Lager ("52 Flaschen (2 Kisten + 4)").
const PLURAL = { Kiste: 'Kisten', Flasche: 'Flaschen', Dose: 'Dosen', Glas: 'Gläser', Fass: 'Fässer', Karton: 'Kartons' };
const plural = (n, einheit) => (Number(n) === 1 ? einheit : PLURAL[einheit] ?? einheit);
const mengeText = (n, einheit = '') => `${fmt(n)} ${plural(n, einheit)}`.trim();
function kistenText(n, proKiste) {
  if (!(proKiste > 0) || n < proKiste) return '';
  const kisten = Math.floor(n / proKiste);
  const rest = round(n - kisten * proKiste);
  return `${kisten} ${plural(kisten, 'Kiste')}${rest ? ` + ${fmt(rest)}` : ''}`;
}
const lagerText = (a) => {
  const k = kistenText(a.bestand, a.proKiste);
  return mengeText(a.bestand, a.einheit) + (k ? ` (${k})` : '');
};
// HTML-Variante: Kistenangabe separat, damit sie am Handy in eine eigene Zeile rutschen kann
const lagerHtml = (a) => {
  const k = kistenText(a.bestand, a.proKiste);
  return esc(mengeText(a.bestand, a.einheit)) + (k ? ` <span class="kisten">(${esc(k)})</span>` : '');
};

// Status: "krit" = Mindestbestand erreicht/unterschritten, "warn" = knapp darüber
function stufe(menge, mindest) {
  if (mindest > 0 && menge <= mindest) return 'krit';
  if (mindest > 0 && menge <= mindest * 1.25) return 'warn';
  return 'ok';
}
const statusLager = (a) => stufe(a.bestand, a.mindest);
// Waggon: die Mindeststückzahl ist der Soll-Stand – alles darunter wird nachgefüllt
const nachfuellen = (a) => Math.max(0, round((a.mindestWaggon || 0) - a.waggon));
const statusWaggon = (a) => (nachfuellen(a) > 0 ? 'krit' : 'ok');
const STATUS_LABEL = {
  lager: { ok: 'OK', warn: 'knapp', krit: 'nachbestellen' },
  waggon: { ok: 'voll', warn: 'knapp', krit: 'nachfüllen' },
};

// Buchungsarten und ihre Wirkung auf Lager und Waggon
const TYP_LABEL = { ein: 'Lieferung', aus: 'Lager → Waggon', verkauf: 'Verkauft', korrektur: 'Zählung (mehr da)' };
const WIRKUNG = {
  ein: { lager: 1, waggon: 0 },      // Lieferung kommt ins Lager
  aus: { lager: -1, waggon: 1 },     // Waggon wird aus dem Lager aufgefüllt
  verkauf: { lager: 0, waggon: -1 }, // im Waggon verkauft/verbraucht
  korrektur: { lager: 0, waggon: 1 }, // beim Zählen mehr im Waggon als gebucht
};

// Sorten in Anzeige-Reihenfolge ('' = Sonstiges)
const SORTEN = ['Alkoholfrei', 'Bier & Radler', 'Wein & Prosecco', 'Spirituosen', ''];
const sorteName = (s) => s || 'Sonstiges';

// Getränkeliste des Erlebnisbahnhofs: [Name, Sorte, Einzelstück]
const GETRAENKELISTE = [
  ['Cola', 'Alkoholfrei', 'Flasche'],
  ['Calypso', 'Alkoholfrei', 'Flasche'],
  ['Eistee', 'Alkoholfrei', 'Flasche'],
  ['Jambo', 'Alkoholfrei', 'Flasche'],
  ['Holundersirup', 'Alkoholfrei', 'Flasche'],
  ['Hacker-Pschorr Radler', 'Bier & Radler', 'Flasche'],
  ['Bier', 'Bier & Radler', 'Flasche'],
  ['Alkoholfreies Bier', 'Bier & Radler', 'Flasche'],
  ['Forst', 'Bier & Radler', 'Flasche'],
  ['Prosecco', 'Wein & Prosecco', 'Flasche'],
  ['Aperol', 'Spirituosen', 'Flasche'],
];

// ---------- Speicher: lokal (Browser) ----------
const STORAGE_KEY = 'lager-bhf-staben-v1';

const localStore = {
  cloud: false,
  async laden() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (data && Array.isArray(data.artikel) && Array.isArray(data.buchungen)) {
        // Daten älterer Versionen ergänzen (Artikelname in Buchungen, Waggon-Bestand)
        data.artikel.forEach((a) => {
          a.waggon ??= 0;
          a.mindestWaggon ??= 0;
          a.proKiste ??= 0;
        });
        data.buchungen.forEach((b) => {
          b.artikelName ??= data.artikel.find((a) => a.id === b.artikelId)?.name ?? '';
        });
        state = data;
        return;
      }
    } catch (e) {
      console.warn('Daten konnten nicht geladen werden', e);
    }
    state = { artikel: [], buchungen: [] };
  },
  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      if (CFG.demo) return; // Testversion: ohne Browser-Speicher einfach im Speicher weiterarbeiten
      throw new Error('Speichern fehlgeschlagen! Bitte Sicherung herunterladen.');
    }
  },
  async artikelSpeichern(daten, id) {
    if (id) {
      Object.assign(findArtikel(id), daten);
      this.persist();
      return findArtikel(id);
    }
    const a = { id: uid(), ...daten, bestand: 0, waggon: 0, angelegt: new Date().toISOString() };
    state.artikel.push(a);
    this.persist();
    return a;
  },
  async artikelLoeschen(id) {
    state.artikel = state.artikel.filter((a) => a.id !== id);
    this.persist();
  },
  async buchen(artikelId, typ, menge, person, notiz) {
    const a = findArtikel(artikelId);
    a.bestand = round(a.bestand + WIRKUNG[typ].lager * menge);
    a.waggon = round(a.waggon + WIRKUNG[typ].waggon * menge);
    state.buchungen.push({
      id: uid(), artikelId, artikelName: a.name, typ, menge,
      bestandDanach: a.bestand, waggonDanach: a.waggon,
      person, notiz, datum: new Date().toISOString(),
    });
    this.persist();
  },
  async importieren(data) {
    state = data;
    this.persist();
    await this.laden();
  },
  async reset() {
    state = { artikel: [], buchungen: [] };
    this.persist();
  },
};

// ---------- Speicher: gemeinsame Datenbank (Supabase) ----------
const CFG = window.LAGER_CONFIG || {};
let sb = null; // Supabase-Client

const mapArtikel = (r) => ({
  id: r.id, name: r.name, sorte: r.sorte ?? '', einheit: r.einheit, notiz: r.notiz,
  mindest: Number(r.mindest), bestand: Number(r.bestand),
  mindestWaggon: Number(r.mindest_waggon ?? 0), waggon: Number(r.waggon ?? 0), proKiste: Number(r.pro_kiste ?? 0),
  angelegt: r.angelegt,
});
const mapBuchung = (r) => ({
  id: r.id, artikelId: r.artikel_id, artikelName: r.artikel_name, typ: r.typ,
  menge: Number(r.menge), bestandDanach: Number(r.bestand_danach),
  waggonDanach: r.waggon_danach == null ? null : Number(r.waggon_danach),
  person: r.person, notiz: r.notiz, datum: r.datum,
});
const artikelZeile = (d) => ({
  name: d.name, sorte: d.sorte, einheit: d.einheit, mindest: d.mindest,
  mindest_waggon: d.mindestWaggon, pro_kiste: d.proKiste || 0, notiz: d.notiz,
});

function dbFehler(error) {
  if (!error) return;
  const msg = error.message || String(error);
  if (/fetch|network/i.test(msg)) throw new Error('Keine Verbindung zur Datenbank. Bitte Internet prüfen.');
  throw new Error(msg);
}

async function alleZeilen(tabelle, sortierung) {
  const SEITE = 1000;
  const zeilen = [];
  for (let von = 0; ; von += SEITE) {
    const { data, error } = await sb.from(tabelle).select('*')
      .order(sortierung, { ascending: true }).range(von, von + SEITE - 1);
    dbFehler(error);
    zeilen.push(...data);
    if (data.length < SEITE) return zeilen;
  }
}

// ---------- Offline: letzter Stand + Warteschlange für Buchungen ----------
// Ohne Netz zeigt die App den zuletzt geladenen Stand. Buchungen (Lieferung, Gebracht,
// Zählung, Verkauf) werden auf dem Gerät gesammelt und hochgeladen, sobald wieder Netz da ist.
const CACHE_KEY = 'lager-bhf-staben-cache';
const QUEUE_KEY = 'lager-bhf-staben-warteschlange';
const speicher = {
  lesen(key, ersatz) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? ersatz; } catch { return ersatz; }
  },
  schreiben(key, wert) {
    try { localStorage.setItem(key, JSON.stringify(wert)); } catch { /* Speicher voll/gesperrt */ }
  },
};
let warteschlange = speicher.lesen(QUEUE_KEY, []);
let offline = false;          // letzter Ladeversuch ohne Verbindung
let angemeldeterNutzer = null; // für den Start ohne Netz
const istNetzFehler = (err) => /fetch|network|load failed|verbindung|timeout|offline/i.test(err?.message || String(err));
const OFFLINE_NUR_ONLINE = 'Ohne Internet können Getränke und Einstellungen nicht geändert werden. '
  + 'Buchen und Zählen geht auch offline.';

// Wendet eine noch nicht hochgeladene Buchung auf den angezeigten Stand an
function vorgemerktAnwenden(st, q) {
  const a = st.artikel.find((x) => x.id === q.artikelId);
  if (!a) return;
  a.bestand = round(a.bestand + WIRKUNG[q.typ].lager * q.menge);
  a.waggon = round(a.waggon + WIRKUNG[q.typ].waggon * q.menge);
  st.buchungen.push({
    id: q.id, artikelId: a.id, artikelName: a.name, typ: q.typ, menge: q.menge,
    bestandDanach: a.bestand, waggonDanach: a.waggon, person: q.person, notiz: q.notiz,
    datum: q.zeit, wartend: true,
  });
}

const cloudStore = {
  cloud: true,
  async laden() {
    try {
      if (!navigator.onLine) throw new Error('offline');
      const [artikel, buchungen] = await Promise.all([
        alleZeilen('artikel', 'name'), alleZeilen('buchungen', 'datum'),
      ]);
      state = { artikel: artikel.map(mapArtikel), buchungen: buchungen.map(mapBuchung) };
      speicher.schreiben(CACHE_KEY, { nutzer: angemeldeterNutzer, state });
      offline = false;
    } catch (err) {
      const cache = speicher.lesen(CACHE_KEY, null);
      if (!istNetzFehler(err) || !cache) throw err;
      state = cache.state;
      offline = true;
    }
    warteschlange.forEach((q) => vorgemerktAnwenden(state, q));
  },
  // Buchung für später merken und sofort im angezeigten Stand berücksichtigen
  vormerken(artikelId, typ, menge, person, notiz) {
    const a = findArtikel(artikelId);
    const q = {
      id: `offline-${uid()}`, artikelId, artikelName: a?.name ?? '', typ, menge, person, notiz,
      zeit: new Date().toISOString(),
    };
    warteschlange.push(q);
    speicher.schreiben(QUEUE_KEY, warteschlange);
    vorgemerktAnwenden(state, q);
    offline = true;
    renderOffline();
    return 'vorgemerkt';
  },
  async artikelSpeichern(daten, id) {
    if (!navigator.onLine) throw new Error(OFFLINE_NUR_ONLINE);
    const q = id
      ? sb.from('artikel').update(artikelZeile(daten)).eq('id', id)
      : sb.from('artikel').insert(artikelZeile(daten));
    const { data, error } = await q.select().single();
    dbFehler(error);
    await this.laden();
    return mapArtikel(data);
  },
  async artikelLoeschen(id) {
    if (!navigator.onLine) throw new Error(OFFLINE_NUR_ONLINE);
    const { error } = await sb.from('artikel').delete().eq('id', id);
    dbFehler(error);
    await this.laden();
  },
  async buchen(artikelId, typ, menge, person, notiz, { neuLaden = true } = {}) {
    // Ohne Netz (oder solange noch Offline-Buchungen warten, damit die Reihenfolge stimmt) vormerken
    if (!navigator.onLine || warteschlange.length) return this.vormerken(artikelId, typ, menge, person, notiz);
    const { error } = await sb.rpc('buchen', {
      p_artikel: artikelId, p_typ: typ, p_menge: menge, p_person: person, p_notiz: notiz,
    });
    if (error && istNetzFehler(error)) return this.vormerken(artikelId, typ, menge, person, notiz);
    dbFehler(error);
    if (neuLaden) await this.laden();
    return 'gebucht';
  },
  // Übernimmt Getränke und aktuelle Bestände aus einer Sicherung (z. B. aus dem lokalen Modus).
  // Der alte Buchungsverlauf wird dabei nicht übertragen.
  async importieren(data) {
    if (!navigator.onLine) throw new Error(OFFLINE_NUR_ONLINE);
    for (const a of data.artikel) {
      const { data: neu, error } = await sb.from('artikel').insert(artikelZeile({
        name: a.name, sorte: a.sorte || '', einheit: a.einheit || 'Flasche', proKiste: Number(a.proKiste) || 0,
        mindest: Number(a.mindest) || 0, mindestWaggon: Number(a.mindestWaggon) || 0, notiz: a.notiz || '',
      })).select().single();
      dbFehler(error);
      await anfangsbestandBuchen(neu.id, Number(a.bestand) || 0, Number(a.waggon) || 0, 'Übernahme aus Sicherung');
    }
    await this.laden();
  },
};

let store = localStore;

// Startbestände: Lager per Lieferung, Waggon per Lieferung + Umlagerung (so bleibt der Verlauf lückenlos)
async function anfangsbestandBuchen(id, lager, waggon, notiz) {
  const opt = { neuLaden: false };
  if (lager + waggon > 0) await store.buchen(id, 'ein', round(lager + waggon), '', notiz, opt);
  if (waggon > 0) await store.buchen(id, 'aus', waggon, '', `${notiz} (Waggon)`, opt);
}

// ---------- Fachlogik ----------
async function buchen(artikelId, typ, menge, person, notiz) {
  const a = findArtikel(artikelId);
  if (!a) throw new Error('Getränk nicht gefunden.');
  menge = round(Number(menge));
  if (!(menge > 0)) throw new Error('Bitte eine Menge größer 0 eingeben.');
  if (typ === 'aus' && menge > a.bestand) {
    throw new Error(`So viel ist nicht im Lager – vorhanden: ${lagerText(a)}.`);
  }
  if (typ === 'verkauf' && menge > a.waggon) {
    throw new Error(`So viel ist nicht im Waggon – vorhanden: ${mengeText(a.waggon, a.einheit)}.`);
  }
  const vorher = { lager: statusLager(a), waggon: statusWaggon(a) };
  const ergebnis = await store.buchen(artikelId, typ, menge, person.trim(), notiz.trim());
  const n = findArtikel(artikelId);
  if (ergebnis === 'vorgemerkt') {
    toast('📶 Ohne Internet gespeichert – wird automatisch hochgeladen', 4000);
  } else if (n && statusLager(n) === 'krit' && vorher.lager !== 'krit') {
    toast(`⚠️ ${a.name}: Mindestbestand im Lager erreicht – bitte nachbestellen!`, 5000);
  } else {
    const m = `${mengeText(menge, a.einheit)} ${a.name}`;
    toast({ ein: `Lieferung gebucht: ${m}`, aus: `In den Waggon gebracht: ${m}`, verkauf: `Verkauf gebucht: ${m}` }[typ]);
  }
}

// ---------- Ansichten ----------
// Bereiche der Navigation: Waggon, Lager und Übersicht teilen sich die Bestandsansicht.
// Die App startet immer mit dem Waggon.
const ORTE = ['waggon', 'lager', 'uebersicht'];
const BEREICHE = [...ORTE, 'verlauf', 'einstellungen'];
let ort = 'waggon';
let aktiveAnsicht = 'waggon';

// Rollen: Admins sehen alles, Mitarbeiter nur den Waggon (geprüft wird zusätzlich in der Datenbank)
let rolle = 'admin';
let rollenUpdateFehlt = false; // Datenbank noch ohne Rollen-Funktionen (SQL-Update nicht ausgeführt)
const istAdmin = () => rolle === 'admin';
// Waggon: "verbraucht" eintragen (alle) oder "noch da" zählen (nur Admin)
let waggonModus = 'verbraucht';

function rolleAnwenden() {
  document.body.dataset.rolle = rolle;
  if (!istAdmin()) {
    waggonModus = 'verbraucht';
    if (aktiveAnsicht !== 'waggon') zeigeAnsicht('waggon');
  }
  render();
}

function zeigeAnsicht(name) {
  if (name === 'bestand') name = ort;
  if (!istAdmin() && BEREICHE.includes(name)) name = 'waggon';
  if (ORTE.includes(name) && name !== ort) {
    ort = name;
    renderBestand();
    renderWarnungen();
  }
  if (BEREICHE.includes(name)) aktiveAnsicht = name;
  const view = ORTE.includes(name) ? 'bestand' : name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === name);
    t.setAttribute('aria-selected', t.dataset.view === name);
  });
  $('#tabs').hidden = name === 'login' || name === 'laden' || !istAdmin();
  if (name === 'einstellungen') nutzerLaden();
  window.scrollTo(0, 0);
}

function render() {
  renderBestand();
  renderWarnungen();
  renderVerlauf();
  renderEinstellungen();
  renderDatalists();
}

const badge = (art, s) => `<span class="badge ${s}">${STATUS_LABEL[art][s]}</span>`;

const zumWaggonText = (a) => {
  const n = nachfuellen(a);
  if (!n) return '<span class="still">–</span>';
  const fehlt = n > a.bestand ? ` <span class="small-note">nur ${fmt(a.bestand)} im Lager</span>` : '';
  return `<strong class="bringen">${esc(mengeText(n, a.einheit))}</strong>${fehlt}`;
};
// Zählfeld im Waggon: "noch da" → nachfüllen bis zur Mindeststückzahl
// Zahlenfeld mit − und + (große Knöpfe fürs Handy; Eintippen geht weiterhin)
const stepper = (feld, name) => `<div class="stepper">
    <button type="button" class="schritt" data-schritt="-1" aria-label="${esc(name)}: eins weniger">−</button>
    ${feld}
    <button type="button" class="schritt" data-schritt="1" aria-label="${esc(name)}: eins mehr">+</button>
  </div>`;
const zaehlFeld = (a) => stepper(`<input class="zaehl" type="number" min="0" step="1" inputmode="numeric"
  data-zaehl="${a.id}" placeholder="${fmt(a.waggon)}" aria-label="${esc(a.name)}: noch im Waggon">`, a.name);
// Verbraucht-Feld: so viel wurde aus dem Waggon verkauft/verbraucht
const verbrauchtFeld = (a) => stepper(`<input class="zaehl" type="number" min="0" step="1" inputmode="numeric"
  data-verbraucht="${a.id}" placeholder="0" aria-label="${esc(a.name)}: verbraucht">`, a.name);
const nachfuellenZelle = (a) => `<span data-nachfuellen="${a.id}">${zumWaggonText(a)}</span>`;
const WAGGON_SPALTEN = {
  verbraucht: [
    ['Im Waggon', (a) => `<span data-imwaggon="${a.id}">${esc(mengeText(a.waggon, a.einheit))}</span>`, true],
    ['Verbraucht', verbrauchtFeld, true],
    ['Nachfüllen', nachfuellenZelle, true],
  ],
  zaehlen: [
    ['Mindestens', (a) => esc(mengeText(a.mindestWaggon || 0, a.einheit)), true],
    ['Noch da', zaehlFeld, true],
    ['Nachfüllen', nachfuellenZelle, true],
  ],
};
// Name: für Admins zum Bearbeiten antippbar, für Mitarbeiter nur Text
const nameHtml = (a) => (istAdmin()
  ? `<button class="name-link" data-edit="${a.id}" title="Bearbeiten">${esc(a.name)}</button>`
  : `<span class="name-text">${esc(a.name)}</span>`);

// Spalten je Ansicht: [Kopf, Zelle(a), Zahlenspalte?]
// Lager: nur "vom Lager in den Waggon" – Menge ist mit dem vorgeschlagen, was im Waggon fehlt
const vorschlag = (a) => Math.max(0, Math.min(nachfuellen(a), a.bestand));
const bringenFeld = (a) => stepper(`<input class="zaehl" type="number" min="0" step="1" inputmode="numeric"
  data-bringen-menge="${a.id}" placeholder="0" value="${vorschlag(a) || ''}" aria-label="${esc(a.name)}: in den Waggon">`, a.name);
const SPALTEN = {
  lager: [
    ['Im Lager', lagerHtml, true],
    ['Im Waggon', (a) => esc(mengeText(a.waggon, a.einheit)), true],
    ['In den Waggon', bringenFeld, true],
  ],
  // Übersicht: reine Anzeige – nur was im Lager und im Waggon ist
  uebersicht: [
    ['Lager', lagerHtml, true],
    ['Waggon', (a) => esc(mengeText(a.waggon, a.einheit)), true],
  ],
};
const istKritisch = (a) => ({
  lager: false,
  waggon: nachfuellen(a) > 0,
  uebersicht: false,
}[ort]);

// Eingetippte, noch nicht gespeicherte Zahlen im Waggon über ein Neuzeichnen retten
// (z. B. wenn ein anderes Gerät bucht, während hier jemand zählt)
function eingabenMerken() {
  const werte = {};
  document.querySelectorAll('#artikelListe input.zaehl').forEach((f) => {
    // Lager: nur selbst geänderte Mengen merken (sonst gilt der aktuelle Vorschlag)
    if (f.dataset.bringenMenge) { if (f.dataset.bearbeitet) werte[`b:${f.dataset.bringenMenge}`] = f.value; }
    else if (f.value !== '') werte[f.dataset.zaehl ? `z:${f.dataset.zaehl}` : `v:${f.dataset.verbraucht}`] = f.value;
  });
  return werte;
}
function eingabenLeeren() {
  document.querySelectorAll('#artikelListe input.zaehl').forEach((f) => { f.value = ''; delete f.dataset.bearbeitet; });
}

function renderBestand() {
  const eingaben = eingabenMerken();
  $('#nurKritischText').textContent = { uebersicht: 'nur mit Handlungsbedarf', lager: 'nur mit Handlungsbedarf', waggon: 'nur nachfüllen' }[ort];
  $('#view-bestand').dataset.ort = ort;

  const spalten = ort === 'waggon' ? WAGGON_SPALTEN[waggonModus] : SPALTEN[ort];
  $('#waggonModus').hidden = ort !== 'waggon' || !istAdmin() || !state.artikel.length;
  document.querySelectorAll('#waggonModus [data-modus]').forEach((b) => b.classList.toggle('active', b.dataset.modus === waggonModus));
  $('#zaehlText').innerHTML = waggonModus === 'verbraucht'
    ? 'Trag bei jedem Getränk ein, <strong>wie viel verbraucht wurde</strong>. Leere Felder bleiben unverändert.'
    : 'Trag ein, <strong>wie viel noch im Waggon ist</strong>. Graue Zahl = letzter Stand, leere Felder bleiben unverändert.';
  $('#btnZaehlung').textContent = waggonModus === 'verbraucht' ? 'Verbrauch speichern' : 'Zählung speichern';
  $('#btnZaehlung').disabled = true;
  const nurAnzeige = ort === 'uebersicht';
  $('#bestandKopf').innerHTML = `<tr><th>Getränk</th>${spalten.map(([kopf, , num]) => `<th class="${num ? 'num' : ''}">${kopf}</th>`).join('')}</tr>`;

  // Suche/Filter gibt es nur im Waggon – Übersicht und Lager zeigen immer alles
  const q = ort === 'waggon' ? $('#suche').value.trim().toLowerCase() : '';
  const nurKrit = ort === 'waggon' && $('#nurKritisch').checked;
  const liste = state.artikel
    .filter((a) => !q || [a.name, sorteName(a.sorte)].some((t) => (t || '').toLowerCase().includes(q)))
    .filter((a) => !nurKrit || istKritisch(a));

  const zeile = (a) => `<tr class="${istKritisch(a) ? 'krit' : ''}">
      <td data-k="name">${nurAnzeige ? `<span class="name-text">${esc(a.name)}</span>` : nameHtml(a)}
        ${a.notiz && !nurAnzeige ? `<span class="small-note">${esc(a.notiz)}</span>` : ''}</td>
      ${spalten.map(([kopf, zelle, num]) => `<td class="${num ? 'num' : ''}" data-label="${kopf}">${zelle(a)}</td>`).join('')}
    </tr>`;
  // Nach Sorte gruppiert; unbekannte Sorten landen unter "Sonstiges"
  const gruppe = (a) => (SORTEN.includes(a.sorte || '') ? a.sorte || '' : '');
  $('#artikelListe').innerHTML = SORTEN.map((sorte) => {
    const inGruppe = liste.filter((a) => gruppe(a) === sorte).sort(byName);
    if (!inGruppe.length) return '';
    return `<tr class="gruppe"><th colspan="${spalten.length + 1}">${esc(sorteName(sorte))}</th></tr>` + inGruppe.map(zeile).join('');
  }).join('');

  // Gerettete Eingaben wieder einsetzen (inkl. Vorschau "nachfüllen")
  Object.entries(eingaben).forEach(([key, wert]) => {
    const [art, id] = [key.slice(0, 1), key.slice(2)];
    const f = document.querySelector({ z: `[data-zaehl="${id}"]`, v: `[data-verbraucht="${id}"]`, b: `[data-bringen-menge="${id}"]` }[art]);
    if (!f) return;
    f.value = wert;
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });

  renderGrafik(liste, gruppe);

  // Leisten unter der Tabelle: Zählung speichern (Waggon) bzw. alles gebracht (Lager)
  $('#zaehlLeiste').hidden = ort !== 'waggon' || !state.artikel.length;
  $('#bringenLeiste').hidden = ort !== 'lager' || !state.artikel.length;
  bringenKnopf();

  const leer = $('#leer');
  leer.hidden = liste.length > 0;
  leer.innerHTML = state.artikel.length
    ? 'Keine passenden Getränke gefunden.'
    : !istAdmin() ? 'Noch keine Getränke angelegt – das macht ein Admin.'
    : `Noch keine Getränke angelegt.<br>
       <button class="btn primary" id="btnListe">Getränkeliste anlegen (${GETRAENKELISTE.length} Getränke)</button>
       <span class="small-note">Cola, Calypso, Eistee, Jambo, Holundersirup, Radler, Bier, alkoholfreies Bier,
       Forst, Prosecco und Aperol – Mindeststückzahlen stellst du danach unter „Einstellungen“ ein.</span>`;
}

// ---------- Zeitangaben ("vor 5 Min.", "gestern 14:30") ----------
function wannText(iso) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d) / 60000);
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const gestern = new Date(Date.now() - 86400000).toDateString();
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  if (d.toDateString() === new Date().toDateString()) return `heute ${uhr}`;
  if (d.toDateString() === gestern) return `gestern ${uhr}`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ` ${uhr}`;
}

// ---------- Übersicht: Grafik (gestapelter Balken Lager + Waggon je Getränk) ----------
// Eine Achse für alle Getränke; Zahlen stehen direkt am Balken, die Tabelle darunter ist die Textfassung.
function schoeneSkala(max) {
  if (max <= 0) return { ende: 10, schritt: 5 };
  const roh = max / 4;
  const zehner = 10 ** Math.floor(Math.log10(roh));
  const schritt = [1, 2, 5, 10].map((f) => f * zehner).find((x) => x >= roh);
  return { ende: Math.ceil(max / schritt) * schritt, schritt };
}

function renderGrafik(liste, gruppe) {
  const fig = $('#grafik');
  fig.hidden = ort !== 'uebersicht' || !liste.length;
  if (fig.hidden) return;
  const max = Math.max(...liste.map((a) => a.bestand + a.waggon));
  const { ende, schritt } = schoeneSkala(max);
  const pct = (n) => (n / ende) * 100;

  const ticks = [];
  for (let t = 0; t <= ende; t += schritt) ticks.push(t);
  $('#grafikAchse').innerHTML = `<span></span><div class="achse-skala">${ticks.map((t) => `<span style="left:${pct(t)}%">${fmt(t)}</span>`).join('')}</div><span></span>`;
  const gitter = ticks.map((t) => `<i style="left:${pct(t)}%"></i>`).join('');

  const zeile = (a) => {
    const gesamt = round(a.bestand + a.waggon);
    const l = pct(a.bestand);
    const w = pct(a.waggon);
    // Zahl im Segment nur, wenn genug Platz ist (sonst: Info beim Antippen + Tabelle)
    const label = (n, breite) => (breite >= 9 ? `<b>${fmt(n)}</b>` : '');
    return `<div class="grafik-zeile" data-grafik="${a.id}" tabindex="0"
        aria-label="${esc(a.name)}: Lager ${fmt(a.bestand)}, Waggon ${fmt(a.waggon)}">
      <span class="grafik-name">${esc(a.name)}</span>
      <span class="grafik-balken">${gitter}
        <span class="seg-lager ${a.waggon ? '' : 'ende'}" style="width:${l}%">${label(a.bestand, l)}</span>${a.bestand && a.waggon ? '<span class="seg-luecke"></span>' : ''}<span class="seg-waggon ende" style="width:${w}%">${label(a.waggon, w)}</span>
      </span>
      <span class="grafik-summe">${fmt(gesamt)}</span>
    </div>`;
  };
  $('#grafikZeilen').innerHTML = SORTEN.map((sorte) => {
    const inGruppe = liste.filter((a) => gruppe(a) === sorte).sort(byName);
    if (!inGruppe.length) return '';
    return `<div class="grafik-gruppe">${esc(sorteName(sorte))}</div>${inGruppe.map(zeile).join('')}`;
  }).join('');
  $('#grafikTipp').hidden = true;
}

// Info zur Zeile beim Drüberfahren (Maus) bzw. Antippen/Fokus (Handy, Tastatur)
function grafikTipp(zeile) {
  const tipp = $('#grafikTipp');
  const a = zeile && findArtikel(zeile.dataset.grafik);
  if (!a) { tipp.hidden = true; return; }
  tipp.innerHTML = `<strong>${esc(a.name)}</strong>
    <span><i class="farbe lager"></i>Lager ${esc(lagerText(a))}</span>
    <span><i class="farbe waggon"></i>Waggon ${esc(mengeText(a.waggon, a.einheit))}</span>
    <span class="still">Gesamt ${esc(mengeText(round(a.bestand + a.waggon), a.einheit))}</span>`;
  tipp.hidden = false;
  const fig = $('#grafik').getBoundingClientRect();
  const r = zeile.getBoundingClientRect();
  tipp.style.top = `${r.bottom - fig.top + 4}px`;
}
$('#grafikZeilen').addEventListener('pointerover', (e) => grafikTipp(e.target.closest('.grafik-zeile')));
$('#grafikZeilen').addEventListener('focusin', (e) => grafikTipp(e.target.closest('.grafik-zeile')));
$('#grafik').addEventListener('pointerleave', () => { $('#grafikTipp').hidden = true; });
$('#grafikZeilen').addEventListener('focusout', () => { $('#grafikTipp').hidden = true; });

function renderWarnungen() {
  // Übersicht und Lager bleiben bewusst schlicht – kein Warnkasten
  const nachbestellen = [];
  const bringen = [];
  const box = $('#warnungen');
  box.hidden = !nachbestellen.length && !bringen.length;
  if (box.hidden) return;
  // Kurzzeile zum Auf- und Zuklappen (am Handy anfangs zu, am PC offen)
  const kurz = [
    nachbestellen.length ? `⚠️ ${nachbestellen.length} nachbestellen` : '',
    bringen.length ? `→ ${bringen.length} zum Waggon bringen` : '',
  ].filter(Boolean).join(' · ');
  const teil = (liste, titel, text) => (liste.length ? `<div class="warn-teil">
      <strong>${titel} (${liste.length})</strong>
      <ul>${liste.map((a) => `<li>${esc(a.name)}: ${text(a)}</li>`).join('')}</ul>
    </div>` : '');
  box.innerHTML = `<summary>${kurz}</summary>`
    + teil(nachbestellen, '⚠️ Lager: bitte nachbestellen',
      (a) => `${fmt(a.bestand)} von mind. ${esc(mengeText(a.mindest, a.einheit))}`)
    + teil(bringen, '→ Vom Lager zum Waggon bringen',
      (a) => esc(mengeText(nachfuellen(a), a.einheit)));
}
$('#warnungen').open = window.matchMedia('(min-width: 681px)').matches;

// ---------- Benutzer: Rollen und Aktivität (nur Admin, nur mit Datenbank) ----------
async function nutzerLaden() {
  const card = $('#nutzerCard');
  card.hidden = !store.cloud || !istAdmin();
  if (card.hidden) return;
  const hinweisEl = $('#nutzerHinweis');
  hinweisEl.hidden = true;
  if (rollenUpdateFehlt) {
    hinweisEl.textContent = 'Für Benutzerrollen fehlt noch das Datenbank-Update: bitte die aktuelle supabase/schema.sql '
      + 'einmal im Supabase SQL Editor ausführen. Bis dahin haben alle Benutzer volle Rechte.';
    hinweisEl.hidden = false;
    $('#nutzerListe').innerHTML = '';
    return;
  }
  if (!navigator.onLine) {
    $('#nutzerListe').innerHTML = '<tr><td colspan="5" class="still">Die Benutzerliste gibt es nur mit Internet.</td></tr>';
    return;
  }
  const { data, error } = await sb.rpc('nutzer_liste');
  if (error) {
    hinweisEl.textContent = `Benutzer konnten nicht geladen werden: ${error.message}`;
    hinweisEl.hidden = false;
    return;
  }
  const wann = (iso, leer) => (iso ? esc(wannText(iso)) : `<span class="still">${leer}</span>`);
  $('#nutzerListe').innerHTML = data.map((n) => `<tr>
      <td data-k="name"><strong>${esc(anzeigeName(n.email))}</strong>${n.id === angemeldeterNutzer?.id ? ' <span class="small-note">(du)</span>' : ''}</td>
      <td data-label="Rolle">
        <select data-rolle-fuer="${n.id}" aria-label="Rolle von ${esc(anzeigeName(n.email))}">
          <option value="admin" ${n.rolle === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="mitarbeiter" ${n.rolle !== 'admin' ? 'selected' : ''}>Mitarbeiter</option>
        </select>
      </td>
      <td data-label="Letzte Anmeldung">${wann(n.letzte_anmeldung, 'noch nie')}</td>
      <td data-label="Zuletzt aktiv">${wann(n.zuletzt_aktiv, '–')}</td>
      <td data-label="Letzte Buchung">${wann(n.letzte_buchung, '–')}</td>
    </tr>`).join('');
}

$('#nutzerListe').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-rolle-fuer]');
  if (!sel) return;
  sel.disabled = true;
  const { error } = await sb.rpc('rolle_setzen', { p_user: sel.dataset.rolleFuer, p_rolle: sel.value });
  if (error) hinweis('Rolle nicht geändert', error.message);
  else toast(`Rolle geändert: ${sel.value === 'admin' ? 'Admin' : 'Mitarbeiter'}`);
  if (sel.dataset.rolleFuer === angemeldeterNutzer?.id && !error) {
    rolle = sel.value;
    angemeldeterNutzer.rolle = rolle;
    rolleAnwenden();
  }
  nutzerLaden();
});

// Eigene Rolle aus der Datenbank; ohne Netz die zuletzt bekannte
async function rolleLaden(gemerkt) {
  try {
    if (!navigator.onLine) throw new Error('offline');
    const { data, error } = await sb.rpc('meine_rolle');
    if (error) {
      if (istNetzFehler(error)) throw error;
      rollenUpdateFehlt = true; // Funktion fehlt noch – wie bisher volle Rechte
      return 'admin';
    }
    rollenUpdateFehlt = false;
    return data === 'admin' ? 'admin' : 'mitarbeiter';
  } catch {
    return gemerkt || 'mitarbeiter';
  }
}

// "Ich bin da" für die Spalte "Zuletzt aktiv" (höchstens alle 5 Minuten)
let zuletztGemeldet = 0;
function binDa() {
  if (!sb || !angemeldeterNutzer || !navigator.onLine || Date.now() - zuletztGemeldet < 5 * 60 * 1000) return;
  zuletztGemeldet = Date.now();
  sb.rpc('ich_bin_da').then(() => {}, () => {});
}

// ---------- Einstellungen: Mindeststückzahlen und Stück pro Kiste ----------
function renderEinstellungen() {
  const feld = (a, name, wert) => `<input type="number" min="0" step="1" inputmode="numeric"
    data-einst="${a.id}" name="${name}" value="${wert || 0}" aria-label="${esc(a.name)}">`;
  const gruppe = (a) => (SORTEN.includes(a.sorte || '') ? a.sorte || '' : '');
  $('#einstListe').innerHTML = SORTEN.map((sorte) => {
    const inGruppe = state.artikel.filter((a) => gruppe(a) === sorte).sort(byName);
    if (!inGruppe.length) return '';
    return `<tr class="gruppe"><th colspan="4">${esc(sorteName(sorte))}</th></tr>` + inGruppe.map((a) => `<tr>
      <td data-k="name">${esc(a.name)} <span class="small-note">gezählt in ${esc(PLURAL[a.einheit] ?? a.einheit)}</span></td>
      <td class="num" data-label="Mindestens im Waggon">${feld(a, 'mindestWaggon', a.mindestWaggon)}</td>
      <td class="num" data-label="Mindestens im Lager">${feld(a, 'mindest', a.mindest)}</td>
      <td class="num" data-label="Stück pro Kiste">${feld(a, 'proKiste', a.proKiste)}</td>
    </tr>`).join('');
  }).join('');
  $('#einstLeer').hidden = state.artikel.length > 0;
  $('#einstLeiste').hidden = !state.artikel.length;
  $('#btnEinstSpeichern').disabled = true;
}

function renderVerlauf() {
  const sel = $('#verlaufFilter');
  const aktuell = sel.value;
  sel.innerHTML = '<option value="">Alle Getränke</option>' + [...state.artikel].sort(byName)
    .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  sel.value = findArtikel(aktuell) ? aktuell : '';

  const typ = $('#verlaufTyp').value;
  const liste = state.buchungen
    .filter((b) => !sel.value || b.artikelId === sel.value)
    .filter((b) => !typ || b.typ === typ)
    .slice().reverse();

  $('#verlaufListe').innerHTML = liste.map((b) => {
    const a = findArtikel(b.artikelId);
    const name = a ? esc(a.name) : `${esc(b.artikelName)} <em>(gelöscht)</em>`;
    const vorz = { ein: '+', aus: '', verkauf: '−', korrektur: '+' }[b.typ] ?? '';
    const danach = `Lager ${fmt(b.bestandDanach)}${b.waggonDanach == null ? '' : ` · Waggon ${fmt(b.waggonDanach)}`}`;
    return `<tr>
      <td class="v-datum">${fmtDate(b.datum)}</td>
      <td class="v-name">${name}</td>
      <td class="v-art typ-${b.typ}">${TYP_LABEL[b.typ] ?? esc(b.typ)}${b.wartend ? ' <span class="wartend" title="Noch nicht hochgeladen">⏳ wartet</span>' : ''}</td>
      <td class="v-menge num">${vorz}${esc(mengeText(b.menge, a ? a.einheit : ''))}</td>
      <td class="v-danach num">${danach}</td>
      <td class="v-person">${esc(b.person || '–')}</td>
      <td class="v-notiz">${esc(b.notiz || '')}</td>
    </tr>`;
  }).join('');
  $('#verlaufLeer').hidden = liste.length > 0;
}

function renderDatalists() {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'de'));
  $('#personenListe').innerHTML = uniq(state.buchungen.map((b) => b.person))
    .map((p) => `<option value="${esc(p)}">`).join('');
}

// ---------- Benutzernamen statt E-Mail ----------
// Supabase braucht eine E-Mail-Adresse. Benutzer werden als "name@staben.lager" angelegt
// (keine echte Adresse, es werden nie E-Mails verschickt) und melden sich nur mit "name" an.
const BENUTZER_DOMAIN = CFG.benutzerDomain || 'staben.lager';
const loginAdresse = (eingabe) => {
  const v = eingabe.trim();
  return v.includes('@') ? v : `${v.toLowerCase()}@${BENUTZER_DOMAIN}`;
};
const anzeigeName = (email = '') => (email.toLowerCase().endsWith(`@${BENUTZER_DOMAIN}`) ? email.split('@')[0] : email);

// ---------- Rückfragen (eigener Dialog statt confirm/alert/prompt) ----------
// Liefert true, wenn bestätigt. Mit "eingabe" muss das Wort zur Sicherheit eingetippt werden.
function frage(titel, text, { ok = 'OK', gefahr = false, nurHinweis = false, eingabe = '' } = {}) {
  const dlg = $('#dlgFrage');
  $('#frageTitel').textContent = titel;
  $('#frageText').textContent = text;
  const okBtn = $('#frageOk');
  okBtn.textContent = ok;
  okBtn.className = `btn ${gefahr ? 'danger-solid' : 'primary'}`;
  $('#frageAbbrechen').hidden = nurHinweis;
  $('#frageEingabeLabel').hidden = !eingabe;
  $('#frageEingabeText').textContent = `Zur Bestätigung „${eingabe}“ eintippen`;
  const feld = $('#frageEingabe');
  feld.value = '';
  const pruefen = () => { okBtn.disabled = !!eingabe && feld.value.trim() !== eingabe; };
  pruefen();
  return new Promise((resolve) => {
    const ende = (wert) => {
      $('#formFrage').onsubmit = null; $('#frageAbbrechen').onclick = null; dlg.onclose = null; feld.oninput = null;
      if (dlg.open) dlg.close();
      resolve(wert);
    };
    feld.oninput = pruefen;
    $('#formFrage').onsubmit = (e) => { e.preventDefault(); ende(true); };
    $('#frageAbbrechen').onclick = () => ende(false);
    dlg.onclose = () => ende(false);
    dlg.showModal();
    (eingabe ? feld : okBtn).focus();
  });
}
const hinweis = (titel, text) => frage(titel, text, { nurHinweis: true });

// ---------- Formulare: gemeinsames Verhalten ----------
// Sperrt den Speichern-Button während einer (evtl. langsamen) Datenbank-Aktion
// und zeigt Fehler im Dialog an, statt ihn zu schließen.
async function ausfuehren(form, fehlerEl, aktion) {
  const btn = form.querySelector('button:not([type=button])');
  btn.disabled = true;
  fehlerEl.hidden = true;
  try {
    await aktion();
    form.closest('dialog')?.close();
    render();
  } catch (err) {
    fehlerEl.textContent = err.message;
    fehlerEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- Getränk-Dialog ----------
const dlgArtikel = $('#dlgArtikel');
const formArtikel = $('#formArtikel');
let editId = null;
const zahl = (feld) => Math.max(0, round(Number(feld.value) || 0));

function openArtikel(id = null) {
  editId = id;
  formArtikel.reset();
  $('#artikelFehler').hidden = true;
  const a = id ? findArtikel(id) : null;
  $('#dlgArtikelTitel').textContent = a ? 'Getränk bearbeiten' : 'Neues Getränk';
  $('#btnArtikelLoeschen').hidden = !a;
  formArtikel.querySelector('.only-new').hidden = !!a;
  if (a) {
    const f = formArtikel.elements;
    f.name.value = a.name;
    f.sorte.value = SORTEN.includes(a.sorte || '') ? a.sorte || '' : '';
    f.einheit.value = a.einheit;
    f.proKiste.value = a.proKiste || '';
    f.mindest.value = a.mindest;
    f.mindestWaggon.value = a.mindestWaggon;
    f.notiz.value = a.notiz;
  }
  dlgArtikel.showModal();
}

formArtikel.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formArtikel.elements;
  const daten = {
    name: f.name.value.trim(),
    sorte: f.sorte.value,
    einheit: f.einheit.value.trim() || 'Flasche',
    proKiste: zahl(f.proKiste),
    mindest: zahl(f.mindest),
    mindestWaggon: zahl(f.mindestWaggon),
    notiz: f.notiz.value.trim(),
  };
  if (!daten.name) return;
  const doppelt = state.artikel.find((a) => a.id !== editId
    && a.name.toLowerCase() === daten.name.toLowerCase());
  if (doppelt && !(await frage('Getränk doppelt?', `„${daten.name}“ gibt es schon. Trotzdem speichern?`, { ok: 'Trotzdem speichern' }))) return;

  const id = editId;
  const anfangLager = zahl(f.anfang);
  const anfangWaggon = zahl(f.anfangWaggon);
  ausfuehren(formArtikel, $('#artikelFehler'), async () => {
    const a = await store.artikelSpeichern(daten, id);
    if (!id) {
      await anfangsbestandBuchen(a.id, anfangLager, anfangWaggon, 'Anfangsbestand');
      if (store.cloud) await store.laden();
    }
    toast(id ? 'Getränk gespeichert' : `„${a.name}“ angelegt`);
  });
});

$('#btnArtikelLoeschen').addEventListener('click', async () => {
  const a = findArtikel(editId);
  if (!a || !(await frage('Getränk löschen?', `„${a.name}“ wird gelöscht. Die Buchungen bleiben im Verlauf erhalten.`, { ok: 'Löschen', gefahr: true }))) return;
  ausfuehren(formArtikel, $('#artikelFehler'), async () => {
    await store.artikelLoeschen(a.id);
    toast('Getränk gelöscht');
  });
});

// ---------- Buchungs-Dialog ----------
const dlgBuchung = $('#dlgBuchung');
const formBuchung = $('#formBuchung');
let buchungId = null;
let letztePerson = '';

// Text je Buchungsart: Frage über der Menge und Beschriftung des Buchen-Knopfs
const BUCHUNG_TEXT = {
  ein: { frage: 'kommen ins Lager?', knopf: 'Lieferung buchen' },
  aus: { frage: 'kommen in den Waggon?', knopf: 'In den Waggon buchen' },
  verkauf: { frage: 'wurden verkauft?', knopf: 'Verkauf buchen' },
};

function updateBuchungInfo() {
  const a = findArtikel(buchungId);
  if (!a) return;
  const f = formBuchung.elements;
  const typ = f.typ.value;
  $('#dlgBuchungTitel').textContent = a.name;
  $('#chipLager').textContent = lagerText(a);
  $('#chipWaggon').textContent = mengeText(a.waggon, a.einheit);
  // Lieferung/Auffüllen wahlweise in Kisten (nur wenn "Stück pro Kiste" bekannt ist)
  const kisten = typ !== 'verkauf' && a.proKiste > 0;
  $('#eingabeWahl').hidden = !kisten;
  if (!kisten) f.eingabe.value = 'stueck';
  $('#eingabeStueck').textContent = PLURAL[a.einheit] ?? a.einheit;
  $('#eingabeKiste').textContent = `Kisten (à ${fmt(a.proKiste)})`;
  updateUmrechnung();
}

// Menge in Einzelstücken (bei Kisten-Eingabe umgerechnet)
function stueckAusEingabe() {
  const a = findArtikel(buchungId);
  const f = formBuchung.elements;
  const n = Number(f.menge.value) || 0;
  return f.eingabe.value === 'kiste' && a ? round(n * a.proKiste) : n;
}

// Vorschau "Lager 5 → 29", Frage und Knopf passend zur Buchungsart
function updateUmrechnung() {
  const a = findArtikel(buchungId);
  if (!a) return;
  const f = formBuchung.elements;
  const typ = f.typ.value;
  const kiste = f.eingabe.value === 'kiste';
  const n = stueckAusEingabe();
  $('#mengeLabel').textContent = `Wie viele ${kiste ? 'Kisten' : PLURAL[a.einheit] ?? a.einheit} ${BUCHUNG_TEXT[typ].frage}`;
  const btn = $('#btnBuchen');
  btn.textContent = BUCHUNG_TEXT[typ].knopf;
  const el = $('#vorschau');
  el.classList.remove('fehler');
  if (!(n > 0)) {
    el.innerHTML = '&nbsp;';
    btn.disabled = true;
    return;
  }
  const w = WIRKUNG[typ];
  const teile = [];
  if (w.lager) teile.push(['Lager', a.bestand, round(a.bestand + w.lager * n)]);
  if (w.waggon) teile.push(['Waggon', a.waggon, round(a.waggon + w.waggon * n)]);
  const zuWenig = teile.find(([, , nach]) => nach < 0);
  btn.disabled = !!zuWenig;
  if (zuWenig) {
    el.classList.add('fehler');
    el.textContent = `So viel ist nicht im ${zuWenig[0]} – vorhanden: ${mengeText(zuWenig[1], a.einheit)}`;
    return;
  }
  el.innerHTML = (kiste ? `= ${esc(mengeText(n, a.einheit))} · ` : '')
    + teile.map(([name, vor, nach]) => `${name} ${fmt(vor)} → <strong>${fmt(nach)}</strong>`).join(' · ');
}

function openBuchung(id, typ, { mitAuswahl = false } = {}) {
  buchungId = id;
  formBuchung.reset();
  $('#artikelWahlBox').hidden = !mitAuswahl;
  $('#buchungArtikel').value = id;
  formBuchung.elements.typ.value = typ;
  formBuchung.elements.person.value = letztePerson;
  $('#buchungArtikel').value = id; // reset() setzt die Auswahl zurück
  formBuchung.querySelector('details.mehr').open = false;
  $('#buchungFehler').hidden = true;
  updateBuchungInfo();
  dlgBuchung.showModal();
  // Am PC gleich ins Mengenfeld; am Handy nicht, sonst verdeckt die Tastatur die −/+ Knöpfe
  if (window.matchMedia('(pointer: fine)').matches) formBuchung.elements.menge.focus();
}

formBuchung.addEventListener('change', (e) => {
  if (e.target.name === 'typ') updateBuchungInfo();
  if (e.target.name === 'eingabe') updateUmrechnung();
});
formBuchung.elements.menge.addEventListener('input', updateUmrechnung);

formBuchung.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = formBuchung.elements;
  ausfuehren(formBuchung, $('#buchungFehler'), async () => {
    await buchen(buchungId, f.typ.value, stueckAusEingabe(), f.person.value, f.notiz.value);
    letztePerson = f.person.value.trim();
  });
});

// ---------- Daten: Export / Import ----------
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const heute = () => new Date().toISOString().slice(0, 10);

$('#btnExport').addEventListener('click', () => {
  download(`lager-bhf-staben-${heute()}.json`, JSON.stringify(state, null, 2), 'application/json');
});

$('#btnCsv').addEventListener('click', () => {
  const zelle = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const zeilen = [['Getränk', 'Sorte', 'Lager', 'Waggon', 'Gesamt', 'Einheit', 'Stück pro Kiste', 'Mindest Lager', 'Mindest Waggon',
    'Status Lager', 'Status Waggon', 'Notiz']]
    .concat([...state.artikel].sort(byName).map((a) => [
      a.name, sorteName(a.sorte), fmt(a.bestand), fmt(a.waggon), fmt(round(a.bestand + a.waggon)), a.einheit, a.proKiste ? fmt(a.proKiste) : '',
      fmt(a.mindest), fmt(a.mindestWaggon),
      STATUS_LABEL.lager[statusLager(a)], STATUS_LABEL.waggon[statusWaggon(a)], a.notiz,
    ]));
  // BOM + Semikolon, damit Excel (deutsch) die Datei direkt richtig öffnet
  download(`bestand-bhf-staben-${heute()}.csv`,
    '﻿' + zeilen.map((z) => z.map(zelle).join(';')).join('\r\n'), 'text/csv');
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!Array.isArray(data.artikel) || !Array.isArray(data.buchungen)) throw new Error();
  } catch {
    hinweis('Datei nicht lesbar', 'Die Datei ist keine gültige Sicherung des Getränkelagers.');
    return;
  }
  const text = store.cloud
    ? `${data.artikel.length} Getränke mit ihren aktuellen Beständen in die gemeinsame Datenbank übernehmen?\n`
      + 'Sie werden zu den vorhandenen Getränken hinzugefügt. Der alte Buchungsverlauf wird nicht übertragen.'
    : `Sicherung mit ${data.artikel.length} Getränken und ${data.buchungen.length} Buchungen einspielen?\n`
      + 'Die aktuellen Daten in diesem Browser werden ersetzt.';
  if (!(await frage('Sicherung einspielen?', text, { ok: store.cloud ? 'Übernehmen' : 'Ersetzen', gefahr: !store.cloud }))) return;
  try {
    toast('Übernehme Daten …', 60000);
    await store.importieren(data);
    toast('Daten übernommen');
  } catch (err) {
    hinweis('Einspielen fehlgeschlagen', err.message);
    await neuLaden();
  }
  render();
});

$('#btnReset').addEventListener('click', async () => {
  if (!(await frage('Alle Daten löschen?', 'Alle Getränke und Buchungen in diesem Browser werden endgültig gelöscht.', { ok: 'Alles löschen', gefahr: true, eingabe: 'LÖSCHEN' }))) return;
  await store.reset();
  render();
  toast('Alle Daten gelöscht');
});

// ---------- Allgemeine Events ----------
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => zeigeAnsicht(tab.dataset.view)));

$('#btnNeu').addEventListener('click', () => openArtikel());
$('#suche').addEventListener('input', renderBestand);
$('#nurKritisch').addEventListener('change', renderBestand);
$('#verlaufFilter').addEventListener('change', renderVerlauf);
$('#verlaufTyp').addEventListener('change', renderVerlauf);

// Legt die Getränkeliste an (nur Getränke, die es noch nicht gibt)
$('#leer').addEventListener('click', async (e) => {
  if (!e.target.closest('#btnListe')) return;
  e.target.disabled = true;
  try {
    const vorhanden = new Set(state.artikel.map((a) => a.name.toLowerCase()));
    for (const [name, sorte, einheit] of GETRAENKELISTE) {
      if (vorhanden.has(name.toLowerCase())) continue;
      await store.artikelSpeichern({ name, sorte, einheit, proKiste: 0, mindest: 0, mindestWaggon: 0, notiz: '' });
    }
    render();
    toast('Getränkeliste angelegt – jetzt Flaschen pro Kiste, Mindestbestände und Bestände eintragen', 5000);
  } catch (err) {
    e.target.disabled = false;
    hinweis('Anlegen fehlgeschlagen', err.message);
  }
});

// Waggon: Live-Vorschau "nachfüllen" beim Eintippen der gezählten Menge
$('#artikelListe').addEventListener('input', (e) => {
  const feld = e.target.closest('[data-zaehl], [data-verbraucht]');
  if (!feld) return;
  const a = findArtikel(feld.dataset.zaehl || feld.dataset.verbraucht);
  let da = a.waggon;
  if (feld.dataset.zaehl) {
    da = feld.value === '' ? a.waggon : Math.max(0, Number(feld.value));
  } else {
    // Verbraucht: danach im Waggon = bisher − verbraucht
    const v = Math.max(0, Number(feld.value) || 0);
    feld.classList.toggle('fehler', v > a.waggon);
    da = Math.max(0, round(a.waggon - v));
    document.querySelector(`[data-imwaggon="${a.id}"]`).innerHTML = v
      ? `${fmt(a.waggon)} → <strong>${esc(mengeText(da, a.einheit))}</strong>`
      : esc(mengeText(a.waggon, a.einheit));
  }
  document.querySelector(`[data-nachfuellen="${a.id}"]`).innerHTML = zumWaggonText({ ...a, waggon: da });
  feld.closest('tr').classList.toggle('krit', nachfuellen({ ...a, waggon: da }) > 0);
  $('#btnZaehlung').disabled = !document.querySelector('[data-zaehl]:not(:placeholder-shown), [data-verbraucht]:not(:placeholder-shown)');
});

// − / + neben den Zahlenfeldern; gedrückt halten zählt schnell weiter
function schritt(knopf) {
  const feld = knopf.closest('.stepper').querySelector('input');
  // Leeres Zählfeld startet beim letzten Stand (Platzhalter), Verbraucht-Feld bei 0
  const basis = feld.value === '' ? Number(String(feld.placeholder).replace(/\./g, '').replace(',', '.')) || 0 : Number(feld.value) || 0;
  feld.value = Math.max(0, round(basis + Number(knopf.dataset.schritt)));
  feld.dispatchEvent(new Event('input', { bubbles: true }));
}
let halteTimer = null;
let halteIntervall = null;
let letzterDruck = 0; // Zeitpunkt des letzten Fingertipps/Mausdrucks auf − oder +
const halteStopp = () => { clearTimeout(halteTimer); clearInterval(halteIntervall); halteTimer = halteIntervall = null; };
document.addEventListener('pointerdown', (e) => {
  const knopf = e.target.closest('[data-schritt]');
  if (!knopf) return;
  e.preventDefault(); // kein Doppeltipp-Zoom, Fokus bleibt
  letzterDruck = Date.now();
  schritt(knopf);
  halteTimer = setTimeout(() => { halteIntervall = setInterval(() => schritt(knopf), 90); }, 450);
});
// Loslassen irgendwo (auch außerhalb des Knopfs) beendet das schnelle Zählen
['pointerup', 'pointercancel', 'blur'].forEach((ev) => window.addEventListener(ev, halteStopp));
document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-schritt]')) halteStopp(); });
// Tastatur (Enter/Leertaste auf dem Knopf); der Klick nach einem Fingertipp zählt nicht doppelt
document.addEventListener('click', (e) => {
  const knopf = e.target.closest('[data-schritt]');
  if (knopf && Date.now() - letzterDruck > 800) schritt(knopf);
});

$('#waggonModus').addEventListener('click', (e) => {
  const b = e.target.closest('[data-modus]');
  if (!b || !istAdmin()) return;
  if (b.dataset.modus === waggonModus) return;
  eingabenLeeren(); // andere Bedeutung der Felder
  waggonModus = b.dataset.modus;
  renderBestand();
});

// Waggon: Verbrauch speichern → als Verkauf buchen
async function verbrauchSpeichern() {
  const eintraege = [...document.querySelectorAll('[data-verbraucht]')]
    .map((f) => [findArtikel(f.dataset.verbraucht), round(Math.max(0, Number(f.value) || 0))])
    .filter(([a, v]) => a && v > 0);
  if (!eintraege.length) return;
  const zuViel = eintraege.filter(([a, v]) => v > a.waggon);
  if (zuViel.length) {
    hinweis('Mehr als im Waggon', `${zuViel.map(([a, v]) => `${a.name}: ${fmt(v)} eingetragen, laut App sind nur ${fmt(a.waggon)} im Waggon`).join('\n')}`
      + '\n\nBitte die Zahl prüfen. Stimmt sie, muss ein Admin den Waggon neu zählen.');
    return;
  }
  const btn = $('#btnZaehlung');
  btn.disabled = true;
  try {
    for (const [a, v] of eintraege) {
      await store.buchen(a.id, 'verkauf', v, letztePerson, 'Verbraucht im Waggon', { neuLaden: false });
    }
    eingabenLeeren();
    if (store.cloud) await store.laden();
    render();
    const stueck = round(eintraege.reduce((sum, [, v]) => sum + v, 0));
    const ohneNetz = warteschlange.length ? ' · 📶 ohne Internet gespeichert' : '';
    toast(`✓ Verbrauch gespeichert: ${fmt(stueck)} Stück bei ${eintraege.length} ${eintraege.length === 1 ? 'Getränk' : 'Getränken'}${ohneNetz}`, 4000);
  } catch (err) {
    hinweis('Verbrauch nicht gespeichert', err.message);
    await neuLaden();
  }
}

// Waggon: Zählung speichern → Differenz wird als Verkauf (bzw. Korrektur) gebucht
$('#btnZaehlung').addEventListener('click', async () => {
  if (waggonModus === 'verbraucht') return verbrauchSpeichern();
  const felder = [...document.querySelectorAll('[data-zaehl]')].filter((f) => f.value !== '');
  if (!felder.length) return;
  const btn = $('#btnZaehlung');
  btn.disabled = true;
  try {
    let verkauft = 0;
    for (const f of felder) {
      const a = findArtikel(f.dataset.zaehl);
      const da = round(Math.max(0, Number(f.value)));
      const diff = round(a.waggon - da);
      if (diff > 0) { await store.buchen(a.id, 'verkauf', diff, letztePerson, 'Zählung im Waggon', { neuLaden: false }); verkauft += 1; }
      if (diff < 0) await store.buchen(a.id, 'korrektur', -diff, letztePerson, 'Zählung im Waggon', { neuLaden: false });
    }
    eingabenLeeren();
    if (store.cloud) await store.laden();
    render();
    const offen = state.artikel.filter((a) => nachfuellen(a) > 0).length;
    const ohneNetz = warteschlange.length ? ' · 📶 ohne Internet gespeichert' : '';
    toast((offen ? `Zählung gespeichert – ${offen} ${offen === 1 ? 'Getränk' : 'Getränke'} nachfüllen (siehe Lager)` : 'Zählung gespeichert – Waggon ist voll') + ohneNetz, 4000);
  } catch (err) {
    hinweis('Zählung nicht gespeichert', err.message);
    await neuLaden();
  }
});

// Lager: eingetragene Mengen vom Lager in den Waggon buchen
const bringenEintraege = () => [...document.querySelectorAll('[data-bringen-menge]')]
  .map((f) => [findArtikel(f.dataset.bringenMenge), round(Math.max(0, Number(f.value) || 0))])
  .filter(([a, n]) => a && n > 0);
function bringenKnopf() {
  const eintraege = bringenEintraege();
  const stueck = round(eintraege.reduce((sum, [, n]) => sum + n, 0));
  const btn = $('#btnBringen');
  btn.disabled = !eintraege.length || eintraege.some(([a, n]) => n > a.bestand);
  btn.textContent = eintraege.length ? `→ ${fmt(stueck)} Stück in den Waggon buchen` : '→ In den Waggon buchen';
}
$('#artikelListe').addEventListener('input', (e) => {
  const feld = e.target.closest('[data-bringen-menge]');
  if (!feld) return;
  const a = findArtikel(feld.dataset.bringenMenge);
  if (e.isTrusted || e.detail !== 'wiederhergestellt') feld.dataset.bearbeitet = '1';
  feld.classList.toggle('fehler', (Number(feld.value) || 0) > a.bestand);
  bringenKnopf();
});
$('#btnBringen').addEventListener('click', async () => {
  const eintraege = bringenEintraege();
  if (!eintraege.length) return;
  const zuViel = eintraege.filter(([a, n]) => n > a.bestand);
  if (zuViel.length) {
    hinweis('Mehr als im Lager', zuViel.map(([a, n]) => `${a.name}: ${fmt(n)} eingetragen, im Lager sind nur ${fmt(a.bestand)}`).join('\n'));
    return;
  }
  const btn = $('#btnBringen');
  btn.disabled = true;
  try {
    for (const [a, n] of eintraege) {
      await store.buchen(a.id, 'aus', n, letztePerson, 'Waggon nachgefüllt', { neuLaden: false });
    }
    eingabenLeeren();
    if (store.cloud) await store.laden();
    render();
    const stueck = round(eintraege.reduce((sum, [, n]) => sum + n, 0));
    toast(`✓ ${fmt(stueck)} Stück in den Waggon gebucht${warteschlange.length ? ' · 📶 ohne Internet gespeichert' : ''}`, 4000);
  } catch (err) {
    hinweis('Nicht gebucht', err.message);
    await neuLaden();
  }
});

// Lieferung: Buchungsdialog mit Getränkeauswahl
$('#btnLieferung').addEventListener('click', () => {
  if (!state.artikel.length) return;
  const sel = $('#buchungArtikel');
  sel.innerHTML = [...state.artikel].sort(byName).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  openBuchung(sel.value, 'ein', { mitAuswahl: true });
});
$('#buchungArtikel').addEventListener('change', (e) => {
  buchungId = e.target.value;
  updateBuchungInfo();
});

// Einstellungen: geänderte Werte speichern
$('#einstListe').addEventListener('input', () => { $('#btnEinstSpeichern').disabled = false; });
$('#btnEinstSpeichern').addEventListener('click', async () => {
  const btn = $('#btnEinstSpeichern');
  btn.disabled = true;
  const neu = new Map();
  document.querySelectorAll('[data-einst]').forEach((f) => {
    const werte = neu.get(f.dataset.einst) ?? {};
    werte[f.name] = Math.max(0, round(Number(f.value) || 0));
    neu.set(f.dataset.einst, werte);
  });
  try {
    let geaendert = 0;
    for (const [id, werte] of neu) {
      const a = findArtikel(id);
      if (!a || Object.entries(werte).every(([k, v]) => (a[k] || 0) === v)) continue;
      const { name, sorte, einheit, proKiste, mindest, mindestWaggon, notiz } = { ...a, ...werte };
      await store.artikelSpeichern({ name, sorte, einheit, proKiste, mindest, mindestWaggon, notiz }, id);
      geaendert += 1;
    }
    render();
    toast(geaendert ? `Einstellungen gespeichert (${geaendert} ${geaendert === 1 ? 'Getränk' : 'Getränke'})` : 'Keine Änderungen');
  } catch (err) {
    btn.disabled = false;
    hinweis('Nicht gespeichert', err.message);
  }
});

$('#artikelListe').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  if (edit) return openArtikel(edit.dataset.edit);
  const b = e.target.closest('[data-buchen]');
  if (b) openBuchung(b.dataset.buchen, b.dataset.typ);
});

let toastTimer;
function toast(text, ms = 2500) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function setSync(ok, text) {
  const s = $('#sync');
  s.className = `sync ${ok ? 'ok' : 'off'}`;
  s.title = text;
}

// ---------- Offline-Hinweis und Hochladen ----------
function renderOffline() {
  const box = $('#offlineBox');
  if (!store.cloud) { box.hidden = true; return; }
  const ohneNetz = offline || !navigator.onLine;
  const n = warteschlange.length;
  box.hidden = !ohneNetz && !n;
  if (box.hidden) return;
  const wartend = n ? ` · <strong>${n} ${n === 1 ? 'Buchung wartet' : 'Buchungen warten'}</strong> auf Upload` : '';
  box.innerHTML = ohneNetz
    ? `📶 <strong>Offline</strong> – du siehst den letzten Stand${wartend}. Buchen und Zählen geht weiter, `
      + 'hochgeladen wird automatisch, sobald wieder Internet da ist.'
    : `⏳ Lade ${n} ${n === 1 ? 'Offline-Buchung' : 'Offline-Buchungen'} hoch …`;
  if (ohneNetz) setSync(false, 'Offline – zeigt den letzten Stand');
}

let laedtHoch = false;
async function hochladen() {
  if (laedtHoch || !warteschlange.length || !navigator.onLine || store !== cloudStore || !sb || !angemeldeterNutzer) return;
  laedtHoch = true;
  renderOffline();
  let ok = 0;
  const fehler = [];
  try {
    while (warteschlange.length) {
      const q = warteschlange[0];
      // Erfassungszeit festhalten, wenn die Buchung erst später ankommt
      const spaet = Date.now() - new Date(q.zeit).getTime() > 2 * 60 * 1000;
      const notiz = spaet ? [q.notiz, `offline erfasst ${fmtDate(q.zeit)}`].filter(Boolean).join(' · ') : q.notiz;
      const { error } = await sb.rpc('buchen', {
        p_artikel: q.artikelId, p_typ: q.typ, p_menge: q.menge, p_person: q.person, p_notiz: notiz,
      });
      if (error && istNetzFehler(error)) break; // weiterhin kein Netz – später nochmal
      if (error) fehler.push(`${q.artikelName} (${TYP_LABEL[q.typ]} ${fmt(q.menge)}): ${error.message}`);
      else ok += 1;
      warteschlange.shift();
      speicher.schreiben(QUEUE_KEY, warteschlange);
    }
  } finally {
    laedtHoch = false;
  }
  await neuLaden();
  if (ok) toast(`✓ ${ok} ${ok === 1 ? 'Offline-Buchung' : 'Offline-Buchungen'} hochgeladen`, 4000);
  if (fehler.length) {
    hinweis('Nicht alle Offline-Buchungen übernommen',
      `${fehler.join('\n')}\n\nWahrscheinlich hat inzwischen jemand anderes gebucht. Bitte Bestand prüfen und bei Bedarf neu buchen.`);
  }
}

window.addEventListener('online', () => { renderOffline(); hochladen(); spaeterNeuLaden(); });
window.addEventListener('offline', () => { offline = true; renderOffline(); });
setInterval(hochladen, 30 * 1000);

// ---------- Start ----------
async function neuLaden() {
  try {
    await store.laden();
    if (store.cloud && !offline) setSync(true, 'Verbunden – Daten aktuell');
  } catch (err) {
    setSync(false, err.message);
    toast(err.message, 5000);
  }
  render();
  renderOffline();
  if (!offline && warteschlange.length) hochladen();
}

// Änderungen von anderen Geräten zusammenfassen und dann neu laden
let refreshTimer;
const spaeterNeuLaden = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(neuLaden, 300);
};

function ladeSkript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
    document.head.append(s);
  });
}

let liveKanal = null;

async function angemeldet(session) {
  const user = session.user;
  angemeldeterNutzer = { id: user.id, email: user.email, user_metadata: user.user_metadata || {}, rolle: user.rolle };
  $('#userBox').hidden = false;
  $('#userName').textContent = user.user_metadata?.name || anzeigeName(user.email);
  letztePerson ||= user.user_metadata?.name || user.email.split('@')[0];
  zeigeAnsicht('laden');
  // Ohne Netz: zuletzt bekannte Rolle dieses Benutzers (aus dem gespeicherten Stand)
  const gemerkt = speicher.lesen(CACHE_KEY, null)?.nutzer;
  rolle = await rolleLaden(user.rolle ?? (gemerkt?.id === user.id ? gemerkt.rolle : undefined));
  angemeldeterNutzer.rolle = rolle;
  document.body.dataset.rolle = rolle;
  await neuLaden();
  rolleAnwenden();
  zeigeAnsicht(istAdmin() ? aktiveAnsicht : 'waggon');
  binDa();

  liveKanal ??= sb.channel('lager-aenderungen')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'artikel' }, spaeterNeuLaden)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'buchungen' }, spaeterNeuLaden)
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') setSync(true, 'Verbunden – Live-Abgleich aktiv');
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setSync(false, 'Live-Abgleich unterbrochen');
    });
}

function abgemeldet() {
  if (liveKanal) { sb.removeChannel(liveKanal); liveKanal = null; }
  angemeldeterNutzer = null;
  letztePerson = ''; // nächster Benutzer bucht unter seinem eigenen Namen
  rolle = 'admin';
  delete document.body.dataset.rolle;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* egal */ }
  state = { artikel: [], buchungen: [] };
  render();
  $('#userBox').hidden = true;
  zeigeAnsicht('login');
}

$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const fehler = $('#loginFehler');
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  fehler.hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email: loginAdresse(f.email.value), password: f.passwort.value });
  btn.disabled = false;
  if (error) {
    fehler.textContent = /invalid/i.test(error.message) ? 'Benutzername oder Passwort falsch.' : error.message;
    fehler.hidden = false;
  } else {
    f.passwort.value = '';
  }
});

$('#btnLogout').addEventListener('click', () => sb.auth.signOut());

// Nur für die Testversion (CFG.demo): Getränkeliste mit Beispielzahlen und etwas Verlauf
async function beispielDatenAnlegen() {
  // In Einzelstücken: [pro Kiste, Mindest Lager, Mindest Waggon, Lieferung, ins Waggon gebracht, verkauft]
  const beispiel = {
    Cola: [24, 48, 24, 96, 24, 15],
    Calypso: [24, 48, 24, 72, 24, 6],
    Eistee: [24, 48, 24, 96, 24, 0],
    Jambo: [24, 24, 12, 48, 12, 2],
    Holundersirup: [0, 3, 2, 6, 2, 0],
    'Hacker-Pschorr Radler': [20, 40, 20, 80, 20, 6],
    Bier: [20, 60, 40, 120, 40, 32],
    'Alkoholfreies Bier': [20, 20, 10, 40, 10, 0],
    Forst: [20, 40, 20, 100, 20, 5],
    Prosecco: [6, 12, 6, 24, 12, 6],
    Aperol: [0, 2, 2, 6, 2, 1],
  };
  for (const [name, sorte, einheit] of GETRAENKELISTE) {
    const [proKiste, mindest, mindestWaggon, lieferung, inWaggon, verkauft] = beispiel[name];
    const a = await store.artikelSpeichern({ name, sorte, einheit, proKiste, mindest, mindestWaggon, notiz: '' });
    await store.buchen(a.id, 'ein', lieferung, '', 'Lieferung Getränkehandel');
    await store.buchen(a.id, 'aus', inWaggon, 'Beispiel', 'Waggon aufgefüllt');
    if (verkauft) await store.buchen(a.id, 'verkauf', verkauft, 'Beispiel', 'Abrechnung Sonntag');
  }
}

async function start() {
  if (!(CFG.supabaseUrl && CFG.supabaseAnonKey)) {
    $('#lokalHinweis').hidden = false;
    if (CFG.demo) {
      $('#lokalHinweis').innerHTML = '<strong>Testversion:</strong> Bestände und Buchungen sind Beispielzahlen. '
        + 'Alles, was du hier änderst, bleibt nur in deinem Browser.';
      // Beispieldaten neu anlegen, wenn leer oder von einer älteren Testversion
      const DEMO_VERSION = 4;
      await store.laden();
      if (!state.artikel.length || state.demoVersion !== DEMO_VERSION) {
        state = { artikel: [], buchungen: [] };
        await beispielDatenAnlegen();
        state.demoVersion = DEMO_VERSION;
        localStore.persist();
      }
    }
    $('#datenText').textContent = 'Die Daten werden in diesem Browser gespeichert. Erstelle regelmäßig eine '
      + 'Sicherung – damit kannst du die Daten auch auf ein anderes Gerät oder in die gemeinsame Datenbank übertragen.';
    await neuLaden();
    zeigeAnsicht('bestand');
    return;
  }

  store = cloudStore;
  $('#resetCard').hidden = true;
  $('#importLabel').textContent = 'Sicherung übernehmen';
  $('#datenText').textContent = 'Die Daten liegen in der gemeinsamen Datenbank und sind auf allen Geräten gleich. '
    + 'Hier kannst du zusätzlich eine Sicherung herunterladen oder Getränke aus einer Sicherung (z. B. aus dem lokalen Modus) übernehmen.';
  zeigeAnsicht('laden');
  try {
    await ladeSkript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
  } catch {
    $('#view-laden').innerHTML = '<p class="empty">Die Datenbank-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen und neu laden.</p>';
    return;
  }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

  let aktiv = null;
  sb.auth.onAuthStateChange((event, session) => {
    // Supabase ruft diesen Callback auch beim Token-Erneuern auf – nur echte Wechsel behandeln
    const neu = session?.user?.id ?? null;
    if (neu === aktiv) return;
    aktiv = neu;
    // Callback darf nicht selbst auf Supabase warten, daher entkoppeln
    setTimeout(() => (session ? angemeldet(session) : abgemeldet()), 0);
  });
  const { data, error } = await sb.auth.getSession();
  if (!data.session && aktiv === null) {
    // Ohne Netz kann die Anmeldung nicht erneuert werden – dann mit dem letzten Stand weiterarbeiten
    const cache = speicher.lesen(CACHE_KEY, null);
    if (cache?.nutzer && (!navigator.onLine || istNetzFehler(error))) {
      aktiv = cache.nutzer.id;
      angemeldet({ user: cache.nutzer });
    } else {
      abgemeldet();
    }
  }

  // Beim Zurückkehren zur App (z. B. Handy entsperrt) Daten auffrischen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && aktiv) { spaeterNeuLaden(); binDa(); }
  });
}

// ---------- Als App installieren ----------
// Android/Chrome bietet die Installation per Knopf an; auf dem iPhone geht es nur über
// "Teilen → Zum Home-Bildschirm" – dafür zeigen wir eine kurze Anleitung.
let installAngebot = null;
const istInstalliert = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const istIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const INSTALL_ZU_KEY = 'lager-bhf-staben-install-zu';
const IOS_ANLEITUNG = 'Auf dem iPhone: unten in Safari auf „Teilen“ (□ mit Pfeil ↑) tippen, '
  + 'dann „Zum Home-Bildschirm“ wählen und „Hinzufügen“ antippen.';

function renderInstall() {
  const moeglich = !istInstalliert() && (installAngebot || istIOS());
  let zu = false;
  try { zu = localStorage.getItem(INSTALL_ZU_KEY) === '1'; } catch { /* egal */ }
  $('#installBox').hidden = !moeglich || zu;
  $('#appCard').hidden = istInstalliert();
  $('#btnInstall2').hidden = !moeglich;
  $('#appText').textContent = istInstalliert()
    ? 'Die App ist installiert.'
    : moeglich
      ? 'Mit eigenem Symbol auf dem Startbildschirm, im Vollbild und auch ohne Internet nutzbar.'
      : 'Im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.';
  if (istIOS() && !installAngebot) {
    $('#btnInstall').textContent = 'So geht’s';
    $('#btnInstall2').textContent = 'So geht’s';
  }
}

async function installieren() {
  if (installAngebot) {
    installAngebot.prompt();
    const { outcome } = await installAngebot.userChoice;
    installAngebot = null;
    if (outcome === 'accepted') toast('App wird installiert – du findest sie gleich auf dem Startbildschirm', 4000);
    renderInstall();
  } else if (istIOS()) {
    hinweis('App aufs iPhone holen', IOS_ANLEITUNG);
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // eigener Knopf statt Browser-Leiste
  installAngebot = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => { installAngebot = null; renderInstall(); });
$('#btnInstall').addEventListener('click', installieren);
$('#btnInstall2').addEventListener('click', installieren);
$('#btnInstallZu').addEventListener('click', () => {
  try { localStorage.setItem(INSTALL_ZU_KEY, '1'); } catch { /* egal */ }
  renderInstall();
});
renderInstall();

// App-Dateien fürs Arbeiten ohne Internet auf dem Gerät speichern (nur über https)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // Neue App-Version: automatisch neu laden – außer jemand tippt gerade Zahlen im Waggon ein
  const warSchonAktiv = !!navigator.serviceWorker.controller;
  let neuGeladen = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!warSchonAktiv || neuGeladen) return;
    if (Object.keys(eingabenMerken()).length) {
      toast('Neue Version verfügbar – sie wird beim nächsten Öffnen geladen', 5000);
      return;
    }
    neuGeladen = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // Beim Zurückkehren zur App nach Updates schauen
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn('Offline-Speicher nicht verfügbar', e));
}

start();
