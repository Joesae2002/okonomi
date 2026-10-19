import { ruleKey } from './categorize.js';
import { monthOf, counts, eff } from './analysis.js';

const prevMonth = m => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 2, 1)).toISOString().slice(0, 7); };

// «Avtalegiro til GJENSIDIGE FORSIKRING ASA Betalingsdato 15-10-2026» → «GJENSIDIGE FORSIKRING ASA»
export function shortLabel(text) {
  return text.split(' – ')[0].replace(/\s*Betalingsdato.*$/i, '').replace(/^(avtalegiro|nettgiro|straksbetaling|betaling)\s+(til|fra)\s+/i, '')
    .replace(/\s+/g, ' ').trim().slice(0, 38);
}

// Forslag til budsjettpost: utgiftene i kategorien forrige måned, slått sammen per mottaker.
// Hvis forrige måned er tom, brukes siste tidligere måned som har utgifter i kategorien.
export function suggestForCategory(txs, category, today) {
  const cur = monthOf(today);
  const mine = txs.filter(t => counts(t) && t.amount < 0 && t.category === category && monthOf(t.date) < cur);
  if (!mine.length) return { month: null, lines: [] };
  const want = prevMonth(cur);
  const month = mine.some(t => monthOf(t.date) === want) ? want : mine.map(t => monthOf(t.date)).sort().pop();
  const groups = new Map();
  for (const t of mine.filter(t => monthOf(t.date) === month)) {
    const k = ruleKey(t.text) || t.text.toLowerCase();
    const g = groups.get(k) || { key: k, label: shortLabel(t.text), amount: 0 };
    g.amount += -eff(t); groups.set(k, g);
  }
  const lines = [...groups.values()].map(g => ({ ...g, amount: Math.round(g.amount) })).sort((a, b) => b.amount - a.amount);
  return { month, lines };
}
