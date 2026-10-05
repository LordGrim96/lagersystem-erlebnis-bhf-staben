'use strict';

// ---------- Datenhaltung ----------
const STORAGE_KEY = 'lager-bhf-staben-v1';

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.artikel) && Array.isArray(data.buchungen)) return data;
    }
  } catch (e) {
    console.warn('Daten konnten nicht geladen werden', e);
  }
  return { artikel: [], buchungen: [] };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Speichern fehlgeschlagen! Bitte Sicherung herunterladen.');
  }
}

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

const findArtikel = (id) => state.artikel.find((a) => a.id === id);

// Status: "krit" = Mindestbestand erreicht/unterschritten, "warn" = knapp darüber
function status(a) {
  if (a.mindest > 0 && a.bestand <= a.mindest) return 'krit';
  if (a.mindest > 0 && a.bestand <= a.mindest * 1.25) return 'warn';
  return 'ok';
}
const STATUS_LABEL = { ok: 'OK', warn: 'knapp', krit: 'nachbestellen' };

// ---------- Fachlogik ----------
function buchen(artikelId, typ, menge, person, notiz) {
  const a = findArtikel(artikelId);
  if (!a) throw new Error('Artikel nicht gefunden.');
  menge = round(Number(menge));
  if (!(menge > 0)) throw new Error('Bitte eine Menge größer 0 eingeben.');
  if (typ === 'aus' && menge > a.bestand) {
    throw new Error(`Nicht genug auf Lager – verfügbar: ${fmt(a.bestand)} ${a.einheit}.`);
  }
  const vorher = status(a);
  a.bestand = round(a.bestand + (typ === 'ein' ? menge : -menge));
  state.buchungen.push({
    id: uid(), artikelId, typ, menge, bestandDanach: a.bestand,
    person: person.trim(), notiz: notiz.trim(), datum: new Date().toISOString(),
  });
  save();
  const nachher = status(a);
  if (nachher === 'krit' && vorher !== 'krit') {
    toast(`⚠️ ${a.name}: Mindestbestand erreicht – bitte nachbestellen!`, 5000);
  } else {
    toast(`${typ === 'ein' ? 'Eingang' : 'Ausgang'} gebucht: ${fmt(menge)} ${a.einheit} ${a.name}`);
  }
}

// ---------- Rendering ----------
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
    .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.ort || '').toLowerCase().includes(q))
    .filter((a) => !nurKrit || status(a) === 'krit')
    .sort((x, y) => x.name.localeCompare(y.name, 'de'));

  $('#artikelListe').innerHTML = liste.map((a) => {
    const s = status(a);
    return `<tr class="${s === 'krit' ? 'krit' : ''}">
      <td data-k="name"><button class="name-link" data-edit="${a.id}" title="Bearbeiten">${esc(a.name)}</button>
        ${a.notiz ? `<span class="small-note">${esc(a.notiz)}</span>` : ''}</td>
      <td data-k="ort">${esc(a.ort || '–')}</td>
      <td data-k="bestand" class="num">${fmt(a.bestand)} ${esc(a.einheit)}</td>
      <td data-k="mindest" class="num">${fmt(a.mindest)}</td>
      <td data-k="status"><span class="badge ${s}">${STATUS_LABEL[s]}</span></td>
      <td class="actions">
        <button class="btn small in" data-buchen="${a.id}" data-typ="ein">+ Eingang</button>
        <button class="btn small out" data-buchen="${a.id}" data-typ="aus">− Ausgang</button>
      </td>
    </tr>`;
  }).join('');

  const leer = $('#leer');
  leer.hidden = liste.length > 0;
  leer.textContent = state.artikel.length
    ? 'Keine passenden Artikel gefunden.'
    : 'Noch keine Artikel. Lege mit „+ Neuer Artikel“ den ersten an.';
}

function renderWarnungen() {
  const krit = state.artikel.filter((a) => status(a) === 'krit')
    .sort((x, y) => x.name.localeCompare(y.name, 'de'));
  const box = $('#warnungen');
  box.hidden = krit.length === 0;
  if (!krit.length) return;
  box.innerHTML = `<strong>⚠️ ${krit.length} Artikel am oder unter Mindestbestand – bitte nachbestellen:</strong>
    <ul>${krit.map((a) => `<li>${esc(a.name)}${a.ort ? ` (${esc(a.ort)})` : ''}: ${fmt(a.bestand)} von mind. ${fmt(a.mindest)} ${esc(a.einheit)}</li>`).join('')}</ul>`;
}

function renderVerlauf() {
  const sel = $('#verlaufFilter');
  const aktuell = sel.value;
  sel.innerHTML = '<option value="">Alle Artikel</option>' + [...state.artikel]
    .sort((x, y) => x.name.localeCompare(y.name, 'de'))
    .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  sel.value = findArtikel(aktuell) ? aktuell : '';

  const typ = $('#verlaufTyp').value;
  const liste = state.buchungen
    .filter((b) => !sel.value || b.artikelId === sel.value)
    .filter((b) => !typ || b.typ === typ)
    .slice().reverse();

  $('#verlaufListe').innerHTML = liste.map((b) => {
    const a = findArtikel(b.artikelId);
    const einheit = a ? a.einheit : '';
    return `<tr>
      <td>${fmtDate(b.datum)}</td>
      <td>${a ? esc(a.name) : '<em>(gelöscht)</em>'}</td>
      <td class="typ-${b.typ}">${b.typ === 'ein' ? 'Eingang' : 'Ausgang'}</td>
      <td class="num">${b.typ === 'ein' ? '+' : '−'}${fmt(b.menge)} ${esc(einheit)}</td>
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

// ---------- Artikel-Dialog ----------
const dlgArtikel = $('#dlgArtikel');
const formArtikel = $('#formArtikel');
let editId = null;

function openArtikel(id = null) {
  editId = id;
  formArtikel.reset();
  const a = id ? findArtikel(id) : null;
  $('#dlgArtikelTitel').textContent = a ? 'Artikel bearbeiten' : 'Neuer Artikel';
  $('#btnArtikelLoeschen').hidden = !a;
  formArtikel.querySelector('.only-new').hidden = !!a;
  if (a) {
    formArtikel.name.value = a.name;
    formArtikel.ort.value = a.ort;
    formArtikel.einheit.value = a.einheit;
    formArtikel.mindest.value = a.mindest;
    formArtikel.notiz.value = a.notiz;
  }
  dlgArtikel.showModal();
}

formArtikel.addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  const f = formArtikel;
  const daten = {
    name: f.name.value.trim(),
    ort: f.ort.value.trim(),
    einheit: f.einheit.value.trim() || 'Stück',
    mindest: Math.max(0, round(Number(f.mindest.value) || 0)),
    notiz: f.notiz.value.trim(),
  };
  if (!daten.name) { e.preventDefault(); return; }
  const doppelt = state.artikel.find((a) => a.id !== editId
    && a.name.toLowerCase() === daten.name.toLowerCase()
    && (a.ort || '').toLowerCase() === daten.ort.toLowerCase());
  if (doppelt && !confirm(`„${daten.name}“ gibt es an diesem Lagerort schon. Trotzdem speichern?`)) {
    e.preventDefault();
    return;
  }

  if (editId) {
    Object.assign(findArtikel(editId), daten);
    toast('Artikel gespeichert');
  } else {
    const a = { id: uid(), ...daten, bestand: 0, angelegt: new Date().toISOString() };
    state.artikel.push(a);
    const anfang = round(Number(f.anfang.value) || 0);
    if (anfang > 0) buchen(a.id, 'ein', anfang, '', 'Anfangsbestand');
    toast(`Artikel „${a.name}“ angelegt`);
  }
  save();
  render();
});

$('#btnArtikelLoeschen').addEventListener('click', () => {
  const a = findArtikel(editId);
  if (!a || !confirm(`„${a.name}“ wirklich löschen? Die Buchungen bleiben im Verlauf erhalten.`)) return;
  state.artikel = state.artikel.filter((x) => x.id !== editId);
  save();
  dlgArtikel.close();
  render();
  toast('Artikel gelöscht');
});

// ---------- Buchungs-Dialog ----------
const dlgBuchung = $('#dlgBuchung');
const formBuchung = $('#formBuchung');
let buchungId = null;
let letztePerson = '';

function updateBuchungInfo() {
  const a = findArtikel(buchungId);
  if (!a) return;
  const typ = formBuchung.typ.value;
  $('#dlgBuchungTitel').textContent = `${typ === 'ein' ? 'Eingang' : 'Ausgang'} buchen`;
  $('#dlgBuchungInfo').textContent = `${a.name} · aktuell ${fmt(a.bestand)} ${a.einheit}`
    + (a.mindest > 0 ? ` · Mindestbestand ${fmt(a.mindest)}` : '');
}

function openBuchung(id, typ) {
  buchungId = id;
  formBuchung.reset();
  formBuchung.typ.value = typ;
  formBuchung.person.value = letztePerson;
  $('#buchungFehler').hidden = true;
  updateBuchungInfo();
  dlgBuchung.showModal();
  formBuchung.menge.focus();
}

formBuchung.addEventListener('change', (e) => {
  if (e.target.name === 'typ') updateBuchungInfo();
});

formBuchung.addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  try {
    const f = formBuchung;
    buchen(buchungId, f.typ.value, f.menge.value, f.person.value, f.notiz.value);
    letztePerson = f.person.value.trim();
    render();
  } catch (err) {
    e.preventDefault();
    const p = $('#buchungFehler');
    p.textContent = err.message;
    p.hidden = false;
  }
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
  const zeilen = [['Artikel', 'Lagerort', 'Bestand', 'Einheit', 'Mindestbestand', 'Status', 'Notiz']]
    .concat([...state.artikel].sort((x, y) => x.name.localeCompare(y.name, 'de')).map((a) => [
      a.name, a.ort, fmt(a.bestand), a.einheit, fmt(a.mindest), STATUS_LABEL[status(a)], a.notiz,
    ]));
  // BOM + Semikolon, damit Excel (deutsch) die Datei direkt richtig öffnet
  download(`bestand-bhf-staben-${heute()}.csv`,
    '﻿' + zeilen.map((z) => z.map(zelle).join(';')).join('\r\n'), 'text/csv');
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.artikel) || !Array.isArray(data.buchungen)) throw new Error();
    if (!confirm(`Sicherung mit ${data.artikel.length} Artikeln und ${data.buchungen.length} Buchungen einspielen?\nDie aktuellen Daten in diesem Browser werden ersetzt.`)) return;
    state = data;
    save();
    render();
    toast('Sicherung eingespielt');
  } catch {
    alert('Die Datei ist keine gültige Sicherung.');
  }
});

$('#btnReset').addEventListener('click', () => {
  if (!confirm('Wirklich ALLE Artikel und Buchungen löschen?')) return;
  if (prompt('Zur Bestätigung bitte LÖSCHEN eintippen:') !== 'LÖSCHEN') return;
  state = { artikel: [], buchungen: [] };
  save();
  render();
  toast('Alle Daten gelöscht');
});

// ---------- Allgemeine Events ----------
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab.dataset.view}`));
}));

$('#btnNeu').addEventListener('click', () => openArtikel());
$('#suche').addEventListener('input', renderBestand);
$('#nurKritisch').addEventListener('change', renderBestand);
$('#verlaufFilter').addEventListener('change', renderVerlauf);
$('#verlaufTyp').addEventListener('change', renderVerlauf);

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

render();
