import { monthOf, eff } from './analysis.js';
import { addMonths } from './charts.js';

// Kjente butikkjeder. Første treff vinner, så spesifikke navn står øverst.
const STORES = [
  ['Rema 1000', /\brema\b/], ['Kiwi', /\bkiwi\b/], ['Meny', /\bmeny\b/], ['Coop', /\bcoop\b|\bobs\b|\bmega\b|\bprix\b|\bextra\b/], ['Spar', /\bspar\b/], ['Bunnpris', /\bbunnpris\b/],
  ['Joker', /\bjoker\b/], ['Oda', /\boda\b/], ['Vinmonopolet', /vinmonopol/], ['Europris', /europris/], ['Matkroken', /matkroken/],
];
const title = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function storeOf(text) {
  const t = String(text || '').toLowerCase().replace(/^(vipps:\s*)+/, '').replace(/\*/g, ' ');
  for (const [name, re] of STORES) if (re.test(t)) return name;
  const w = t.replace(/\b(aer|notanr)\b.*$/, '').replace(/[^a-zæøå0-9 ]/g, ' ').trim().split(/\s+/).filter(x => x && !/^\d+$/.test(x)).slice(0, 2).join(' ');
  return w ? title(w) : 'Andre';
}

// Utgifter i én kategori fordelt på butikk. period: 'month' | '3' | 'year'. Beløp er din andel.
export function storeBreakdown(txs, cat, month, period = 'month') {
  const from = period === 'year' ? month.slice(0, 4) + '-01' : period === '3' ? addMonths(month, -2) : month;
  const by = new Map(); let total = 0;
  for (const t of txs) {
    if (t.category !== cat || t.kind !== 'normal' || !(t.amount < 0)) continue;
    const m = monthOf(t.date); if (m < from || m > month) continue;
    const name = storeOf(t.text), o = by.get(name) || { name, sum: 0, count: 0 }; o.sum += -eff(t); o.count++; total += -eff(t); by.set(name, o);
  }
  const rows = [...by.values()].sort((a, b) => b.sum - a.sum).map(r => ({ ...r, pct: total ? r.sum / total : 0 }));
  return { rows, total, from };
}
