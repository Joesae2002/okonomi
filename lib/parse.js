// Parser bankutskrifter (CSV/Excel-rader) fra Nidaros Sparebank og Sbanken til felles format.

// «Nok 589,00 Scandinavian Airli» → «Scandinavian Airli» (beløpet står i egen kolonne), «Vipps:Vipps:X» → «Vipps: X»
export function cleanText(t) {
  let s = String(t ?? '').trim().replace(/\s+/g, ' ');
  const m = s.match(/^nok\s+(?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:,\d{1,2})?\s+(\S.*)$/i); if (m) s = m[1];   // 589,00 · 85 · 1 234,50
  return s.replace(/^(vipps:\s*)+/i, 'Vipps: ');
}

export function parseNumber(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  let s = String(v).replace(/\s| |kr/gi, '').replace('−', '-');
  if (s === '') return NaN;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  return Number(s);
}

export function parseDate(v) {
  if (v instanceof Date) return iso(new Date(v.getTime() + 12 * 3600e3)); // +12 t så tidssone ikke flytter dagen
  if (typeof v === 'number') return iso(new Date(Math.round((v - 25569) * 86400000))); // Excel-serial
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const iso = d => d.toISOString().slice(0, 10);

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [';', '\t', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-zæøå]/g, '');
const COLS = {
  date: ['dato', 'bokforingsdato', 'bokfortdato', 'transaksjonsdato', 'utfortdato', 'rentedato'],
  text: ['beskrivelse', 'tekst', 'forklaring', 'transaksjonstekst', 'melding'],
  amount: ['belop', 'beloep', 'sum'],
  in: ['inn', 'innpakonto', 'innkonto', 'innbetalt'],
  out: ['ut', 'utfrakonto', 'utavkonto', 'utkonto', 'utbetalt'],
};
const fold = s => norm(s).replace(/ø/g, 'o').replace(/å/g, 'a').replace(/æ/g, 'ae');

// rows: array av arrays (første rad(er) kan være støy før overskriften)
export function parseRows(rows, bank = 'ukjent') {
  let h = -1, idx = {};
  for (let i = 0; i < Math.min(rows.length, 30) && h < 0; i++) {
    const heads = rows[i].map(fold), f = {};
    for (const [k, names] of Object.entries(COLS)) {
      const j = heads.findIndex(x => names.includes(x));
      if (j >= 0) f[k] = j;
    }
    if (f.in == null) { const j = heads.findIndex(x => /^inn/.test(x) && /konto/.test(x)); if (j >= 0) f.in = j; }   // «Inn på/til konto» i ulike former
    if (f.out == null) { const j = heads.findIndex(x => /^ut/.test(x) && /konto/.test(x)); if (j >= 0) f.out = j; }  // «Ut av/fra konto»
    if (f.date != null && (f.amount != null || f.in != null || f.out != null)) { h = i; idx = f; }
  }
  if (h < 0) {
    const pos = parsePositional(rows, bank);
    if (pos.length) return pos;
    const peek = rows.slice(0, 2).map(r => r.slice(0, 6).join(' | ')).join(' ⏎ ');
    throw new Error(`Fant ikke kolonner for dato og beløp i filen. Første rader: ${peek}`);
  }
  if (idx.amount == null && (idx.in == null) !== (idx.out == null)) // bare én av kolonnene funnet: beløpene ville blitt feil
    throw new Error(`Fant bare én av kolonnene for inn/ut i filen (overskrifter: ${rows[h].join(' | ')}). Send meg overskriftene så legger jeg dem til.`);
  if (idx.text == null) { // fall tilbake til første kolonne som ikke er dato/beløp
    const used = new Set(Object.values(idx));
    idx.text = rows[h].findIndex((_, j) => !used.has(j));
  }
  const seen = new Map(), seenOld = new Map(), out = [];
  for (const r of rows.slice(h + 1)) {
    const date = parseDate(r[idx.date]);
    if (!date) continue;
    let amount;
    if (idx.amount != null) amount = parseNumber(r[idx.amount]);
    else { const i = parseNumber(r[idx.in]), u = parseNumber(r[idx.out]); amount = (isNaN(i) ? 0 : i) - Math.abs(isNaN(u) ? 0 : u); }
    if (isNaN(amount)) continue;
    const text = cleanText(r[idx.text]);
    const base = `${bank}|${date}|${text}|${amount.toFixed(2)}`;
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    // Eldre importer lagret teksten urørt. legacyHash gjør at disse postene gjenkjennes og ikke importeres en gang til.
    const raw = String(r[idx.text] ?? '').trim(), oldBase = `${bank}|${date}|${raw}|${amount.toFixed(2)}`, on = (seenOld.get(oldBase) || 0) + 1; seenOld.set(oldBase, on);
    out.push({ date, text, amount, bank, hash: `${base}|${n}`, legacyHash: raw !== text ? `${oldBase}|${on}` : null });
  }
  return out;
}

// ---- Filer uten overskriftsrad (Nidaros-eksport) ----
// Kolonnene gjenkjennes på innhold: [kommentar] [tekst] [fra-konto] [til-konto] [beløp] … [dato ×3] [referanse]
const DATE_RE = /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}$|^\d{4}-\d{2}-\d{2}$/;
const isDateCell = c => c instanceof Date || (typeof c === 'string' && DATE_RE.test(c.trim()));
const ACC_RE = /^\d{4}\.\d{2}\.\d{5}$/;
const AMOUNT_RE = /^-?[\d\s\u00a0.]*\d,\d{2}$/;
const isAmountCell = c => (typeof c === 'number' && !(c instanceof Date)) || (typeof c === 'string' && AMOUNT_RE.test(c.trim()));

export function parsePositional(rows, bank) {
  const seen = new Map(), out = [];
  for (const r of rows) {
    const text = String(r[1] ?? '').trim();
    if (!text || isDateCell(r[1]) || isAmountCell(r[1])) continue; // tom linje eller sammendragslinje
    const ai = [2, 3, 4, 5, 6].find(i => r[i] !== '' && r[i] != null && isAmountCell(r[i]));
    if (ai == null) continue;
    const amount = parseNumber(r[ai]);
    const dates = r.slice(ai + 1).filter(isDateCell);
    if (!dates.length) continue;
    const date = parseDate(dates[2] ?? dates[dates.length - 1]); // tredje dato = faktisk transaksjonsdato
    if (!date) continue;
    const ref = String(r.slice(ai + 1).filter(c => c !== '' && !isDateCell(c)).pop() ?? '').trim();
    const comment = String(r[0] ?? '').trim();
    const full = comment ? `${text} – ${comment}` : text;
    const base = `${bank}|${date}|${full}|${amount.toFixed(2)}|${ref}`;
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    out.push({ date, text: full, amount, bank, hash: `${base}|${n}`, from: accOf(r[2]), to: accOf(r[3]) });
  }
  // Sammendragslinjen øverst i Nidaros-eksporten starter med filens egen kontonummer
  const head = rows.find(r => ACC_RE.test(String(r[0] ?? '').trim()) && isDateCell(r[1]));
  out.meta = { accountNumber: head ? String(head[0]).trim() : null };
  return out;
}
const accOf = c => (ACC_RE.test(String(c ?? '').trim()) ? String(c).trim() : '');
