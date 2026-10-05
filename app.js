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

// Status: "krit" = Mindestbestand erreicht/unterschritten, "warn" = knapp darüber
function stufe(menge, mindest) {
  if (mindest > 0 && menge <= mindest) return 'krit';
  if (mindest > 0 && menge <= mindest * 1.25) return 'warn';
  return 'ok';
}
const statusLager = (a) => stufe(a.bestand, a.mindest);
const statusWaggon = (a) => stufe(a.waggon, a.mindestWaggon);
const STATUS_LABEL = {
  lager: { ok: 'OK', warn: 'knapp', krit: 'nachbestellen' },
  waggon: { ok: 'OK', warn: 'knapp', krit: 'auffüllen' },
};

// Buchungsarten und ihre Wirkung auf Lager und Waggon
const TYP_LABEL = { ein: 'Lieferung', aus: 'Lager → Waggon', verkauf: 'Verkauft' };
const WIRKUNG = {
  ein: { lager: 1, waggon: 0 },      // Lieferung kommt ins Lager
  aus: { lager: -1, waggon: 1 },     // Waggon wird aus dem Lager aufgefüllt
  verkauf: { lager: 0, waggon: -1 }, // im Waggon verkauft/verbraucht
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

const cloudStore = {
  cloud: true,
  async laden() {
    const [artikel, buchungen] = await Promise.all([
      alleZeilen('artikel', 'name'), alleZeilen('buchungen', 'datum'),
    ]);
    state = { artikel: artikel.map(mapArtikel), buchungen: buchungen.map(mapBuchung) };
  },
  async artikelSpeichern(daten, id) {
    const q = id
      ? sb.from('artikel').update(artikelZeile(daten)).eq('id', id)
      : sb.from('artikel').insert(artikelZeile(daten));
    const { data, error } = await q.select().single();
    dbFehler(error);
    await this.laden();
    return mapArtikel(data);
  },
  async artikelLoeschen(id) {
    const { error } = await sb.from('artikel').delete().eq('id', id);
    dbFehler(error);
    await this.laden();
  },
  async buchen(artikelId, typ, menge, person, notiz, { neuLaden = true } = {}) {
    const { error } = await sb.rpc('buchen', {
      p_artikel: artikelId, p_typ: typ, p_menge: menge, p_person: person, p_notiz: notiz,
    });
    dbFehler(error);
    if (neuLaden) await this.laden();
  },
  // Übernimmt Getränke und aktuelle Bestände aus einer Sicherung (z. B. aus dem lokalen Modus).
  // Der alte Buchungsverlauf wird dabei nicht übertragen.
  async importieren(data) {
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
  await store.buchen(artikelId, typ, menge, person.trim(), notiz.trim());
  const n = findArtikel(artikelId);
  if (n && statusLager(n) === 'krit' && vorher.lager !== 'krit') {
    toast(`⚠️ ${a.name}: Mindestbestand im Lager erreicht – bitte nachbestellen!`, 5000);
  } else if (n && statusWaggon(n) === 'krit' && vorher.waggon !== 'krit') {
    toast(`⚠️ ${a.name}: Waggon bitte auffüllen!`, 5000);
  } else {
    const m = `${mengeText(menge, a.einheit)} ${a.name}`;
    toast({ ein: `Lieferung gebucht: ${m}`, aus: `In den Waggon gebracht: ${m}`, verkauf: `Verkauf gebucht: ${m}` }[typ]);
  }
}

// ---------- Ansichten ----------
let aktiveAnsicht = 'bestand';

// Bestand-Umschalter: Übersicht, Lager oder Waggon (wird im Browser gemerkt)
const ORTE = ['uebersicht', 'lager', 'waggon'];
let ort = 'uebersicht';
try {
  const gemerkt = localStorage.getItem('lager-bhf-staben-ansicht');
  if (ORTE.includes(gemerkt)) ort = gemerkt;
} catch { /* ohne Browser-Speicher: Übersicht */ }

function zeigeAnsicht(name) {
  if (['bestand', 'verlauf', 'daten'].includes(name)) aktiveAnsicht = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $('#tabs').hidden = name === 'login' || name === 'laden';
}

function render() {
  renderBestand();
  renderWarnungen();
  renderVerlauf();
  renderDatalists();
}

const badge = (art, s) => `<span class="badge ${s}">${STATUS_LABEL[art][s]}</span>`;

// Spalten je Ansicht: [Kopf, Zelle(a), Zahlenspalte?]
const SPALTEN = {
  lager: [
    ['Im Lager', (a) => esc(lagerText(a)), true],
    ['Mindest', (a) => fmt(a.mindest), true],
    ['Status', (a) => badge('lager', statusLager(a))],
  ],
  waggon: [
    ['Im Waggon', (a) => esc(mengeText(a.waggon, a.einheit)), true],
    ['Mindest', (a) => fmt(a.mindestWaggon), true],
    ['Status', (a) => badge('waggon', statusWaggon(a))],
  ],
  uebersicht: [
    ['Lager', (a) => `${esc(lagerText(a))}${statusLager(a) === 'ok' ? '' : ` ${badge('lager', statusLager(a))}`}`, true],
    ['Waggon', (a) => `${esc(mengeText(a.waggon, a.einheit))}${statusWaggon(a) === 'ok' ? '' : ` ${badge('waggon', statusWaggon(a))}`}`, true],
    ['Gesamt', (a) => esc(mengeText(round(a.bestand + a.waggon), a.einheit)), true],
  ],
};
const KNOEPFE = {
  lager: (a) => `<button class="btn small in" data-buchen="${a.id}" data-typ="ein">+ Lieferung</button>
        <button class="btn small move" data-buchen="${a.id}" data-typ="aus">→ Waggon</button>`,
  waggon: (a) => `<button class="btn small move" data-buchen="${a.id}" data-typ="aus">+ Aus Lager</button>
        <button class="btn small out" data-buchen="${a.id}" data-typ="verkauf">− Verkauft</button>`,
  uebersicht: (a) => `<button class="btn small" data-buchen="${a.id}" data-typ="aus">Buchen</button>`,
};
const istKritisch = (a) => ({
  lager: statusLager(a) === 'krit',
  waggon: statusWaggon(a) === 'krit',
  uebersicht: statusLager(a) === 'krit' || statusWaggon(a) === 'krit',
}[ort]);

function renderBestand() {
  document.querySelectorAll('#ortWahl [data-ort]').forEach((b) => {
    b.classList.toggle('active', b.dataset.ort === ort);
    b.setAttribute('aria-pressed', b.dataset.ort === ort);
  });
  $('#nurKritischText').textContent = { uebersicht: 'nur mit Handlungsbedarf', lager: 'nur nachbestellen', waggon: 'nur auffüllen' }[ort];

  const spalten = SPALTEN[ort];
  $('#bestandKopf').innerHTML = `<tr><th>Getränk</th>${spalten.map(([kopf, , num]) => `<th class="${num ? 'num' : ''}">${kopf}</th>`).join('')}<th class="actions"></th></tr>`;

  const q = $('#suche').value.trim().toLowerCase();
  const nurKrit = $('#nurKritisch').checked;
  const liste = state.artikel
    .filter((a) => !q || [a.name, sorteName(a.sorte)].some((t) => (t || '').toLowerCase().includes(q)))
    .filter((a) => !nurKrit || istKritisch(a));

  const zeile = (a) => `<tr class="${istKritisch(a) ? 'krit' : ''}">
      <td data-k="name"><button class="name-link" data-edit="${a.id}" title="Bearbeiten">${esc(a.name)}</button>
        ${a.notiz ? `<span class="small-note">${esc(a.notiz)}</span>` : ''}</td>
      ${spalten.map(([kopf, zelle, num]) => `<td class="${num ? 'num' : ''}" data-label="${kopf}">${zelle(a)}</td>`).join('')}
      <td class="actions">${KNOEPFE[ort](a)}</td>
    </tr>`;
  // Nach Sorte gruppiert; unbekannte Sorten landen unter "Sonstiges"
  const gruppe = (a) => (SORTEN.includes(a.sorte || '') ? a.sorte || '' : '');
  $('#artikelListe').innerHTML = SORTEN.map((sorte) => {
    const inGruppe = liste.filter((a) => gruppe(a) === sorte).sort(byName);
    if (!inGruppe.length) return '';
    return `<tr class="gruppe"><th colspan="${spalten.length + 2}">${esc(sorteName(sorte))}</th></tr>` + inGruppe.map(zeile).join('');
  }).join('');

  const leer = $('#leer');
  leer.hidden = liste.length > 0;
  leer.innerHTML = state.artikel.length
    ? 'Keine passenden Getränke gefunden.'
    : `Noch keine Getränke angelegt.<br>
       <button class="btn primary" id="btnListe">Getränkeliste anlegen (${GETRAENKELISTE.length} Getränke)</button>
       <span class="small-note">Cola, Calypso, Eistee, Jambo, Holundersirup, Radler, Bier, alkoholfreies Bier,
       Forst, Prosecco und Aperol – Flaschen pro Kiste, Mindest- und Anfangsbestände trägst du danach ein.</span>`;
}

function renderWarnungen() {
  const nachbestellen = ort !== 'waggon' ? state.artikel.filter((a) => statusLager(a) === 'krit').sort(byName) : [];
  const auffuellen = ort !== 'lager' ? state.artikel.filter((a) => statusWaggon(a) === 'krit').sort(byName) : [];
  const box = $('#warnungen');
  box.hidden = !nachbestellen.length && !auffuellen.length;
  const teil = (liste, titel, menge, mindest) => (liste.length ? `<div class="warn-teil">
      <strong>${titel} (${liste.length})</strong>
      <ul>${liste.map((a) => `<li>${esc(a.name)}: ${fmt(menge(a))} von mind. ${esc(mengeText(mindest(a), a.einheit))}</li>`).join('')}</ul>
    </div>` : '');
  box.innerHTML = teil(nachbestellen, '⚠️ Lager: bitte nachbestellen', (a) => a.bestand, (a) => a.mindest)
    + teil(auffuellen, '⚠️ Waggon: bitte auffüllen', (a) => a.waggon, (a) => a.mindestWaggon);
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
    const vorz = { ein: '+', aus: '', verkauf: '−' }[b.typ] ?? '';
    const danach = `Lager ${fmt(b.bestandDanach)}${b.waggonDanach == null ? '' : ` · Waggon ${fmt(b.waggonDanach)}`}`;
    return `<tr>
      <td>${fmtDate(b.datum)}</td>
      <td>${name}</td>
      <td class="typ-${b.typ}">${TYP_LABEL[b.typ] ?? esc(b.typ)}</td>
      <td class="num">${vorz}${esc(mengeText(b.menge, a ? a.einheit : ''))}</td>
      <td class="num">${danach}</td>
      <td>${esc(b.person || '–')}</td>
      <td>${esc(b.notiz || '')}</td>
    </tr>`;
  }).join('');
  $('#verlaufLeer').hidden = liste.length > 0;
}

function renderDatalists() {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'de'));
  $('#personenListe').innerHTML = uniq(state.buchungen.map((b) => b.person))
    .map((p) => `<option value="${esc(p)}">`).join('');
}

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

const BUCHUNG_TITEL = {
  ein: 'Lieferung ins Lager',
  aus: 'Waggon aus dem Lager auffüllen',
  verkauf: 'Verkauf im Waggon',
};

function updateBuchungInfo() {
  const a = findArtikel(buchungId);
  if (!a) return;
  const typ = formBuchung.elements.typ.value;
  $('#dlgBuchungTitel').textContent = BUCHUNG_TITEL[typ];
  $('#dlgBuchungInfo').innerHTML = `<strong>${esc(a.name)}</strong> · Lager: ${esc(lagerText(a))}`
    + ` · Waggon: ${esc(mengeText(a.waggon, a.einheit))}`;
  // Beim Verkauf alternativ den gezählten Rest im Waggon eingeben
  $('#zaehlenBox').hidden = typ !== 'verkauf';
  // Lieferung/Auffüllen wahlweise in Kisten eingeben (nur wenn "pro Kiste" bekannt ist)
  const kisten = typ !== 'verkauf' && a.proKiste > 0;
  $('#eingabeWahl').hidden = !kisten;
  if (!kisten) formBuchung.elements.eingabe.value = 'stueck';
  $('#eingabeStueck').textContent = PLURAL[a.einheit] ?? a.einheit;
  $('#eingabeKiste').textContent = `Kisten à ${fmt(a.proKiste)}`;
  updateUmrechnung();
  formBuchung.elements.gezaehlt.max = a.waggon;
}

// Zeigt bei Kisten-Eingabe, wie viele Einzelstücke gebucht werden
function stueckAusEingabe() {
  const a = findArtikel(buchungId);
  const f = formBuchung.elements;
  const n = Number(f.menge.value) || 0;
  return f.eingabe.value === 'kiste' && a ? round(n * a.proKiste) : n;
}
function updateUmrechnung() {
  const a = findArtikel(buchungId);
  const f = formBuchung.elements;
  const el = $('#umrechnung');
  el.hidden = !(a && f.eingabe.value === 'kiste' && Number(f.menge.value) > 0);
  if (!el.hidden) el.textContent = `= ${mengeText(stueckAusEingabe(), a.einheit)}`;
}

function openBuchung(id, typ) {
  buchungId = id;
  formBuchung.reset();
  formBuchung.elements.typ.value = typ;
  formBuchung.elements.person.value = letztePerson;
  $('#buchungFehler').hidden = true;
  updateBuchungInfo();
  dlgBuchung.showModal();
  formBuchung.elements.menge.focus();
}

formBuchung.addEventListener('change', (e) => {
  if (e.target.name === 'typ') updateBuchungInfo();
  if (e.target.name === 'eingabe') updateUmrechnung();
});
formBuchung.elements.menge.addEventListener('input', updateUmrechnung);

// "Noch im Waggon gezählt" → verkaufte Menge = bisher im Waggon − gezählt
formBuchung.elements.gezaehlt.addEventListener('input', (e) => {
  const a = findArtikel(buchungId);
  if (!a || e.target.value === '') return;
  const verkauft = round(a.waggon - Number(e.target.value));
  formBuchung.elements.menge.value = verkauft > 0 ? verkauft : '';
});

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

$('#ortWahl').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ort]');
  if (!b) return;
  ort = b.dataset.ort;
  try { localStorage.setItem('lager-bhf-staben-ansicht', ort); } catch { /* egal */ }
  renderBestand();
  renderWarnungen();
});

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

// ---------- Start ----------
async function neuLaden() {
  try {
    await store.laden();
    if (store.cloud) setSync(true, 'Verbunden – Daten aktuell');
  } catch (err) {
    setSync(false, err.message);
    toast(err.message, 5000);
  }
  render();
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
  $('#userBox').hidden = false;
  $('#userName').textContent = user.user_metadata?.name || user.email;
  letztePerson ||= user.user_metadata?.name || user.email.split('@')[0];
  zeigeAnsicht('laden');
  await neuLaden();
  zeigeAnsicht(aktiveAnsicht);

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
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.passwort.value });
  btn.disabled = false;
  if (error) {
    fehler.textContent = /invalid/i.test(error.message) ? 'E-Mail oder Passwort falsch.' : error.message;
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
    Cola: [24, 48, 12, 96, 24, 15],
    Calypso: [24, 48, 12, 72, 24, 6],
    Eistee: [24, 48, 12, 96, 24, 8],
    Jambo: [24, 24, 8, 48, 12, 2],
    Holundersirup: [0, 3, 1, 6, 2, 0],
    'Hacker-Pschorr Radler': [20, 40, 10, 80, 20, 6],
    Bier: [20, 60, 15, 120, 40, 32],
    'Alkoholfreies Bier': [20, 20, 6, 40, 10, 2],
    Forst: [20, 40, 10, 100, 20, 5],
    Prosecco: [6, 12, 4, 24, 12, 6],
    Aperol: [0, 2, 1, 6, 2, 0],
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
      const DEMO_VERSION = 3;
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
  const { data } = await sb.auth.getSession();
  if (!data.session && aktiv === null) abgemeldet();

  // Beim Zurückkehren zur App (z. B. Handy entsperrt) Daten auffrischen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && aktiv) spaeterNeuLaden();
  });
}

start();
