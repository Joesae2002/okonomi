import { monthOf, counts } from './analysis.js';
import { addMonths } from './charts.js';

const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

// Faste, månedlige trekk: samme mottaker i minst 2 av de siste månedene med omtrent samme beløp.
// status: paid (trukket denne måneden) | upcoming (venter) | late (burde vært trukket)
export function detectSubscriptions(txs, today, { hidden = new Set(), window = 5 } = {}) {
  const cur = monthOf(today), from = addMonths(cur, -window), day = Number(today.slice(8)), groups = {};
  for (const t of txs) {
    if (!counts(t) || t.amount >= 0 || -t.amount < 20) continue;
    const m = monthOf(t.date); if (m < from || m > cur) continue;
    const k = subKey(t.text); if (!k || hidden.has(k)) continue;
    const g = (groups[k] ||= { key: k, label: t.text, category: t.category, months: {}, days: [], last: t.date });
    (g.months[m] ||= []).push(t); g.days.push(Number(t.date.slice(8)));
    if (t.date > g.last) { g.last = t.date; g.label = t.text; g.category = t.category; }
  }
  const out = [];
  for (const g of Object.values(groups)) {
    const ms = Object.keys(g.months).sort(); if (ms.length < 2) continue;
    const sums = ms.map(m => g.months[m].reduce((s, t) => s - t.amount, 0)), med = median(sums);
    if (!sums.every(s => Math.abs(s - med) <= med * 0.2)) continue;                         // varierer for mye: ikke en fast utgift
    const span = ms.length ? (Number(ms.at(-1).slice(0, 4)) * 12 + Number(ms.at(-1).slice(5)) - (Number(ms[0].slice(0, 4)) * 12 + Number(ms[0].slice(5)))) + 1 : 1;
    if (ms.length / span < 0.6) continue;                                                   // må dukke opp de fleste månedene
    const dueDay = Math.round(median(g.days)), paid = !!g.months[cur];
    out.push({ key: g.key, label: shortName(g.label), rawLabel: g.label, category: g.category, amount: med, annual: med * 12, dueDay, monthsSeen: ms.length,
      status: paid ? 'paid' : dueDay >= day ? 'upcoming' : 'late', lastDate: g.last, nextDate: paid ? `${addMonths(cur, 1)}-${String(Math.min(dueDay, 28)).padStart(2, '0')}` : `${cur}-${String(Math.min(dueDay, 28)).padStart(2, '0')}` });
  }
  return out.sort((a, b) => a.dueDay - b.dueDay);
}

// Gruppenøkkel: hele den rensede teksten, uten «Betalingsdato …». «Vipps: Salt» og kortkjøpet «Salt» er forskjellige mottakere.
export const subKey = text => String(text ?? '').toLowerCase().split(' – ')[0].replace(/\s*betalingsdato.*$/, '').replace(/\s+/g, ' ').trim().replace(/^vipps:\s*/, 'vipps: ');

// «Avtalegiro til GJENSIDIGE FORSIKRING ASA Betalingsdato 15-10-2026» → «GJENSIDIGE FORSIKRING ASA»
export function shortName(text) {
  return text.split(' – ')[0].replace(/\s*Betalingsdato.*$/i, '').replace(/^vipps:\s*/i, '').replace(/^(avtalegiro|nettgiro|straksbetaling|betaling)\s+(til|fra)\s+/i, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function subscriptionTotals(list) {
  const sum = f => list.filter(f).reduce((s, x) => s + x.amount, 0);
  return { month: sum(() => true), paid: sum(x => x.status === 'paid'), remaining: sum(x => x.status !== 'paid'), annual: sum(() => true) * 12 };
}
