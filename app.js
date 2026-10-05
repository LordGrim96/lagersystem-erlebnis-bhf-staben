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

let state = { artikel: [], buchungen: [] };
const findArtikel = (id) => state.artikel.find((a) => a.id === id);

// Status: "krit" = Mindestbestand erreicht/unterschritten, "warn" = knapp darüber
function status(a) {
  if (a.mindest > 0 && a.bestand <= a.mindest) return 'krit';
  if (a.mindest > 0 && a.bestand <= a.mindest * 1.25) return 'warn';
  return 'ok';
}
// Menge mit Einheit, im Plural wo nötig: "1 Kiste", "3 Kisten"
const PLURAL = { Kiste: 'Kisten', Flasche: 'Flaschen', Dose: 'Dosen', Fass: 'Fässer', Karton: 'Kartons' };
const mengeText = (n, einheit = '') => `${fmt(n)} ${Number(n) === 1 ? einheit : PLURAL[einheit] ?? einheit}`.trim();

const STATUS_LABEL = { ok: 'OK', warn: 'knapp', krit: 'nachbestellen' };

// Sorten in Anzeige-Reihenfolge ('' = Sonstiges)
const SORTEN = ['Alkoholfrei', 'Bier & Radler', 'Wein & Prosecco', 'Spirituosen', ''];
const sorteName = (s) => s || 'Sonstiges';

// Getränkeliste des Erlebnisbahnhofs: [Name, Sorte, Einheit]
const GETRAENKELISTE = [
  ['Cola', 'Alkoholfrei', 'Kiste'],
  ['Calypso', 'Alkoholfrei', 'Kiste'],
  ['Eistee', 'Alkoholfrei', 'Kiste'],
  ['Jambo', 'Alkoholfrei', 'Kiste'],
  ['Holundersirup', 'Alkoholfrei', 'Flasche'],
  ['Hacker-Pschorr Radler', 'Bier & Radler', 'Kiste'],
  ['Bier', 'Bier & Radler', 'Kiste'],
  ['Alkoholfreies Bier', 'Bier & Radler', 'Kiste'],
  ['Forst', 'Bier & Radler', 'Kiste'],
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
        // Ältere Buchungen ohne Artikelnamen ergänzen
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
    const a = { id: uid(), ...daten, bestand: 0, angelegt: new Date().toISOString() };
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
    a.bestand = round(a.bestand + (typ === 'ein' ? menge : -menge));
    state.buchungen.push({
      id: uid(), artikelId, artikelName: a.name, typ, menge, bestandDanach: a.bestand,
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
  id: r.id, name: r.name, sorte: r.sorte ?? '', ort: r.ort, einheit: r.einheit, notiz: r.notiz,
  mindest: Number(r.mindest), bestand: Number(r.bestand), angelegt: r.angelegt,
});
const mapBuchung = (r) => ({
  id: r.id, artikelId: r.artikel_id, artikelName: r.artikel_name, typ: r.typ,
  menge: Number(r.menge), bestandDanach: Number(r.bestand_danach),
  person: r.person, notiz: r.notiz, datum: r.datum,
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
      ? sb.from('artikel').update(daten).eq('id', id)
      : sb.from('artikel').insert(daten);
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
  async buchen(artikelId, typ, menge, person, notiz) {
    const { error } = await sb.rpc('buchen', {
      p_artikel: artikelId, p_typ: typ, p_menge: menge, p_person: person, p_notiz: notiz,
    });
    dbFehler(error);
    await this.laden();
  },
  // Übernimmt Artikel und aktuelle Bestände aus einer Sicherung (z. B. aus dem lokalen Modus).
  // Der alte Buchungsverlauf wird dabei nicht übertragen.
  async importieren(data) {
    for (const a of data.artikel) {
      const { data: neu, error } = await sb.from('artikel').insert({
        name: a.name, sorte: a.sorte || '', ort: a.ort || '', einheit: a.einheit || 'Kiste',
        mindest: Number(a.mindest) || 0, notiz: a.notiz || '',
      }).select().single();
      dbFehler(error);
      const bestand = Number(a.bestand) || 0;
      if (bestand > 0) {
        const r = await sb.rpc('buchen', {
          p_artikel: neu.id, p_typ: 'ein', p_menge: bestand, p_person: '', p_notiz: 'Übernahme aus Sicherung',
        });
        dbFehler(r.error);
      }
    }
    await this.laden();
  },
};

let store = localStore;

// ---------- Fachlogik ----------
async function buchen(artikelId, typ, menge, person, notiz) {
  const a = findArtikel(artikelId);
  if (!a) throw new Error('Getränk nicht gefunden.');
  menge = round(Number(menge));
  if (!(menge > 0)) throw new Error('Bitte eine Menge größer 0 eingeben.');
  if (typ === 'aus' && menge > a.bestand) {
    throw new Error(`Nicht genug auf Lager – verfügbar: ${mengeText(a.bestand, a.einheit)}.`);
  }
  const vorher = status(a);
  await store.buchen(artikelId, typ, menge, person.trim(), notiz.trim());
  const nachher = findArtikel(artikelId);
  if (nachher && status(nachher) === 'krit' && vorher !== 'krit') {
    toast(`⚠️ ${a.name}: Mindestbestand erreicht – bitte nachbestellen!`, 5000);
  } else {
    toast(`${typ === 'ein' ? 'Eingang' : 'Ausgang'} gebucht: ${mengeText(menge, a.einheit)} ${a.name}`);
  }
}

// ---------- Ansichten ----------
let aktiveAnsicht = 'bestand';

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

function renderBestand() {
  const q = $('#suche').value.trim().toLowerCase();
  const nurKrit = $('#nurKritisch').checked;
  const liste = state.artikel
    .filter((a) => !q || [a.name, a.ort, sorteName(a.sorte)].some((t) => (t || '').toLowerCase().includes(q)))
    .filter((a) => !nurKrit || status(a) === 'krit');

  const zeile = (a) => {
    const s = status(a);
    return `<tr class="${s === 'krit' ? 'krit' : ''}">
      <td data-k="name"><button class="name-link" data-edit="${a.id}" title="Bearbeiten">${esc(a.name)}</button>
        ${a.notiz ? `<span class="small-note">${esc(a.notiz)}</span>` : ''}</td>
      <td data-k="ort">${esc(a.ort || '–')}</td>
      <td data-k="bestand" class="num">${esc(mengeText(a.bestand, a.einheit))}</td>
      <td data-k="mindest" class="num">${fmt(a.mindest)}</td>
      <td data-k="status"><span class="badge ${s}">${STATUS_LABEL[s]}</span></td>
      <td class="actions">
        <button class="btn small in" data-buchen="${a.id}" data-typ="ein">+ Eingang</button>
        <button class="btn small out" data-buchen="${a.id}" data-typ="aus">− Ausgang</button>
      </td>
    </tr>`;
  };
  // Nach Sorte gruppiert; unbekannte Sorten landen unter "Sonstiges"
  const gruppe = (a) => (SORTEN.includes(a.sorte || '') ? a.sorte || '' : '');
  $('#artikelListe').innerHTML = SORTEN.map((sorte) => {
    const inGruppe = liste.filter((a) => gruppe(a) === sorte).sort(byName);
    if (!inGruppe.length) return '';
    return `<tr class="gruppe"><th colspan="6">${esc(sorteName(sorte))}</th></tr>` + inGruppe.map(zeile).join('');
  }).join('');

  const leer = $('#leer');
  leer.hidden = liste.length > 0;
  leer.innerHTML = state.artikel.length
    ? 'Keine passenden Getränke gefunden.'
    : `Noch keine Getränke im Lager.<br>
       <button class="btn primary" id="btnListe">Getränkeliste anlegen (${GETRAENKELISTE.length} Getränke)</button>
       <span class="small-note">Cola, Calypso, Eistee, Jambo, Holundersirup, Radler, Bier, alkoholfreies Bier,
       Forst, Prosecco und Aperol – Bestand und Mindestbestand trägst du danach ein.</span>`;
}

function renderWarnungen() {
  const krit = state.artikel.filter((a) => status(a) === 'krit').sort(byName);
  const box = $('#warnungen');
  box.hidden = krit.length === 0;
  if (!krit.length) return;
  box.innerHTML = `<strong>⚠️ ${krit.length} ${krit.length === 1 ? 'Getränk' : 'Getränke'} am oder unter Mindestbestand – bitte nachbestellen:</strong>
    <ul>${krit.map((a) => `<li>${esc(a.name)}${a.ort ? ` (${esc(a.ort)})` : ''}: ${fmt(a.bestand)} von mind. ${esc(mengeText(a.mindest, a.einheit))}</li>`).join('')}</ul>`;
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
    return `<tr>
      <td>${fmtDate(b.datum)}</td>
      <td>${name}</td>
      <td class="typ-${b.typ}">${b.typ === 'ein' ? 'Eingang' : 'Ausgang'}</td>
      <td class="num">${b.typ === 'ein' ? '+' : '−'}${esc(mengeText(b.menge, a ? a.einheit : ''))}</td>
      <td class="num">${fmt(b.bestandDanach)}</td>
      <td>${esc(b.person || '–')}</td>
      <td>${esc(b.notiz || '')}</td>
    </tr>`;
  }).join('');
  $('#verlaufLeer').hidden = liste.length > 0;
}

function renderDatalists() {
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'de'));
  $('#orteListe').innerHTML = uniq(state.artikel.map((a) => a.ort))
    .map((o) => `<option value="${esc(o)}">`).join('');
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

// ---------- Artikel-Dialog ----------
const dlgArtikel = $('#dlgArtikel');
const formArtikel = $('#formArtikel');
let editId = null;

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
    f.ort.value = a.ort;
    f.einheit.value = a.einheit;
    f.mindest.value = a.mindest;
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
    ort: f.ort.value.trim(),
    einheit: f.einheit.value.trim() || 'Kiste',
    mindest: Math.max(0, round(Number(f.mindest.value) || 0)),
    notiz: f.notiz.value.trim(),
  };
  if (!daten.name) return;
  const doppelt = state.artikel.find((a) => a.id !== editId
    && a.name.toLowerCase() === daten.name.toLowerCase()
    && (a.ort || '').toLowerCase() === daten.ort.toLowerCase());
  if (doppelt && !(await frage('Getränk doppelt?', `„${daten.name}“ gibt es an diesem Lagerort schon. Trotzdem speichern?`, { ok: 'Trotzdem speichern' }))) return;

  const id = editId;
  const anfang = round(Number(f.anfang.value) || 0);
  ausfuehren(formArtikel, $('#artikelFehler'), async () => {
    const a = await store.artikelSpeichern(daten, id);
    if (!id && anfang > 0) await store.buchen(a.id, 'ein', anfang, '', 'Anfangsbestand');
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

function updateBuchungInfo() {
  const a = findArtikel(buchungId);
  if (!a) return;
  const typ = formBuchung.elements.typ.value;
  $('#dlgBuchungTitel').textContent = `${typ === 'ein' ? 'Eingang' : 'Ausgang'} buchen`;
  $('#dlgBuchungInfo').textContent = `${a.name} · aktuell ${mengeText(a.bestand, a.einheit)}`
    + (a.mindest > 0 ? ` · Mindestbestand ${fmt(a.mindest)}` : '');
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
});

formBuchung.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = formBuchung.elements;
  ausfuehren(formBuchung, $('#buchungFehler'), async () => {
    await buchen(buchungId, f.typ.value, f.menge.value, f.person.value, f.notiz.value);
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
  const zeilen = [['Getränk', 'Sorte', 'Lagerort', 'Bestand', 'Einheit', 'Mindestbestand', 'Status', 'Notiz']]
    .concat([...state.artikel].sort(byName).map((a) => [
      a.name, sorteName(a.sorte), a.ort, fmt(a.bestand), a.einheit, fmt(a.mindest), STATUS_LABEL[status(a)], a.notiz,
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
      await store.artikelSpeichern({ name, sorte, ort: '', einheit, mindest: 0, notiz: '' });
    }
    render();
    toast('Getränkeliste angelegt – jetzt Bestände einbuchen und Mindestbestände eintragen');
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
  // [Lagerort, Mindestbestand, Anfangsbestand, Buchungen]
  const beispiel = {
    Cola: ['Kühlraum', 5, 12, [['aus', 4, 'Kiosk aufgefüllt']]],
    Calypso: ['Kühlraum', 4, 6, [['aus', 3, 'Sommerfest']]],
    Eistee: ['Kühlraum', 4, 9, []],
    Jambo: ['Kühlraum', 3, 5, [['aus', 2, 'Kiosk aufgefüllt']]],
    Holundersirup: ['Kiosk', 3, 8, []],
    'Hacker-Pschorr Radler': ['Keller', 4, 10, [['aus', 3, 'Draisinen-Gruppe']]],
    Bier: ['Keller', 6, 15, [['aus', 5, 'Sommerfest'], ['ein', 6, 'Lieferung Getränkehandel']]],
    'Alkoholfreies Bier': ['Keller', 3, 4, []],
    Forst: ['Keller', 5, 12, [['aus', 4, 'Vereinsabend']]],
    Prosecco: ['Kiosk', 6, 12, [['aus', 6, 'Hochzeitsfahrt']]],
    Aperol: ['Kiosk', 2, 4, []],
  };
  for (const [name, sorte, einheit] of GETRAENKELISTE) {
    const [ort, mindest, anfang, buchungen] = beispiel[name];
    const a = await store.artikelSpeichern({ name, sorte, ort, einheit, mindest, notiz: '' });
    await store.buchen(a.id, 'ein', anfang, '', 'Anfangsbestand');
    for (const [typ, menge, notiz] of buchungen) await store.buchen(a.id, typ, menge, 'Beispiel', notiz);
  }
}

async function start() {
  if (!(CFG.supabaseUrl && CFG.supabaseAnonKey)) {
    $('#lokalHinweis').hidden = false;
    if (CFG.demo) {
      $('#lokalHinweis').innerHTML = '<strong>Testversion:</strong> Bestände und Buchungen sind Beispielzahlen. '
        + 'Alles, was du hier änderst, bleibt nur in deinem Browser.';
      await store.laden();
      if (!state.artikel.length) await beispielDatenAnlegen();
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
