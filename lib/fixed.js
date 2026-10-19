// Faste utgifter som brukeren selv har lagt inn. Hver post matches mot banktekster, og vi regner ut hva som er betalt og hva som venter.
import { monthOf, counts, eff } from './analysis.js';
import { shortName, detectSubscriptions } from './subscriptions.js';

const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
export const patternsOf = p => String(p ?? '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
// Normaliserer tekst så «Vipps:Salt» og «Vipps: Salt» er like. Søketekst som starter med = må treffe hele teksten (f.eks. =vipps: salt),
// så «Vipps: Salt» ikke også treffer «Vipps: Salt Bergen» eller «Salt Kafe».
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^vipps:\s*/, 'vipps: ');
export const matchesItem = (item, tx) => { const t = norm(tx.text); return patternsOf(item.pattern).some(p => (p.startsWith('=') ? t === norm(p.slice(1)) : t.includes(norm(p)))); };
export const isGiverCategory = c => /gave|giver/i.test(String(c ?? ''));
export const itemPayments = (item, txs) => txs.filter(t => counts(t) && t.amount < 0 && matchesItem(item, t)).sort((a, b) => b.date.localeCompare(a.date));
const mostCommon = a => Object.entries(a.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {})).sort((x, y) => y[1] - x[1])[0]?.[0];

// status: paid (trukket denne måneden) | upcoming (venter) | late (burde vært trukket) | unknown (ingen betalinger og ingen dag oppgitt)
export function fixedInfo(item, txs, today) {
  const cur = monthOf(today), day = Number(today.slice(8)), pays = itemPayments(item, txs), byMonth = {};
  for (const t of pays) byMonth[monthOf(t.date)] = (byMonth[monthOf(t.date)] || 0) + -t.amount;
  const earlier = Object.keys(byMonth).filter(m => m < cur).sort().slice(-6), paid = byMonth[cur] != null;
  const expected = Number(item.amount) > 0 ? Number(item.amount) : earlier.length ? median(earlier.map(m => byMonth[m])) : (byMonth[cur] ?? 0);
  const days = pays.slice(0, 6).map(t => Number(t.date.slice(8))), dueDay = item.day ? Number(item.day) : days.length ? Math.round(median(days)) : null;
  const status = paid ? 'paid' : dueDay == null ? 'unknown' : dueDay >= day ? 'upcoming' : 'late';
  return { item, payments: pays, paid, status, dueDay, expected, thisMonth: byMonth[cur] || 0, amount: paid ? byMonth[cur] : expected, lastDate: pays[0]?.date ?? null,
    category: item.category || mostCommon(pays.map(t => t.category)) || 'Annet', count: pays.length,
    yearTotal: pays.filter(t => t.date.startsWith(cur.slice(0, 4))).reduce((s, t) => s - t.amount, 0) };
}

// Navn uten «Vipps:» foran. Brukes som standard søketekst.
export const patternFor = label => shortName(label).toLowerCase().split(/\s+/).slice(0, 2).join(' ');

// Forslag fra bankdata: månedlige trekk, men ikke dagligvarer, restaurant osv. (de varierer og er ikke «faste»)
export function suggestFixed(txs, today, { items = [], hidden = new Set(), kind = 'utgift', skip = ['Mat', 'Restaurant', 'Klær', 'Fritid', 'Helse'] } = {}) {
  // gaver og utgifter holdes adskilt: givertjenester foreslås bare for gavekategorier, og utgifter aldri fra dem
  return detectSubscriptions(txs, today, { hidden }).filter(s => (kind === 'giver' ? isGiverCategory(s.category) : !isGiverCategory(s.category) && !skip.includes(s.category)) && !items.some(it => matchesItem(it, { text: s.rawLabel })))   // allerede dekket av en post du har lagt inn
    .map(s => ({ key: s.key, name: s.label, pattern: patternFor(s.label), category: s.category, amount: s.amount, dueDay: s.dueDay })).filter(s => s.pattern);
}

// Hva som er betalt og hva som gjenstår i en kategori denne måneden. Gjenstår beregnes bare for inneværende måned.
export function categoryPlan({ cat, month, today, txs, items, seasonal = [] }) {
  const cur = monthOf(today), paidTx = txs.filter(t => counts(t) && t.amount < 0 && t.category === cat && monthOf(t.date) === month).sort((a, b) => b.date.localeCompare(a.date));
  const paid = paidTx.reduce((s, t) => s - eff(t), 0);
  const infos = items.map(it => fixedInfo(it, txs, today)).filter(x => x.category === cat);
  const remaining = month !== cur ? [] : [
    ...infos.filter(x => x.status === 'upcoming' || x.status === 'late').map(x => ({ name: x.item.name, amount: x.expected, dueDay: x.dueDay, late: x.status === 'late', kind: 'fast' })),
    ...seasonal.filter(i => i.due === month && !i.paid && i.category === cat).map(i => ({ name: i.name, amount: i.amount, dueDay: null, late: false, kind: 'sesong' }))];
  return { paidTx, paid, remaining, remainingSum: remaining.reduce((s, r) => s + r.amount, 0), hasFixed: infos.length > 0 };
}
