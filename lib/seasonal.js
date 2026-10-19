import { ruleKey } from './categorize.js';
import { monthOf, counts } from './analysis.js';

const monthIndex = m => { const [y, mm] = m.split('-').map(Number); return y * 12 + mm - 1; };
const fromIndex = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
export const monthsBetween = (a, b) => monthIndex(b) - monthIndex(a);

// Første måned >= cur med gitt månedsnummer (1-12). Inneværende måned teller.
export function nextDueMonth(mm, cur) {
  const i = monthIndex(cur), diff = (mm - 1 - (i % 12) + 12) % 12;
  return fromIndex(i + diff);
}

// Store poster som forekom for ~12 måneder siden og ellers sjelden → trolig årlig (forsikring, avgifter …)
export function detectAnnual(txs, cur) {
  const groups = {};
  for (const t of txs) {
    if (!counts(t) || t.amount > -500) continue;
    const age = monthsBetween(monthOf(t.date), cur);
    if (age < 0 || age > 14) continue;
    const k = ruleKey(t.text); if (!k) continue;
    (groups[k] ||= []).push({ t, age });
  }
  const out = [];
  for (const [key, list] of Object.entries(groups)) {
    const months = new Set(list.map(x => monthOf(x.t.date)));
    if (months.size > 2 || !list.some(x => x.age >= 11 && x.age <= 13)) continue;
    const last = list.sort((a, b) => b.t.date.localeCompare(a.t.date))[0].t;
    out.push({ key, name: last.text, amount: -last.amount, category: last.category, month: Number(last.date.slice(5, 7)) });
  }
  return out;
}

// Samlet liste over sesongutgifter: egne (manual) + foreslåtte fra historikken.
// manual: rader fra seasonal_items {id,name,amount,month,category,ignore}
export function seasonalItems(txs, manual, today) {
  const cur = monthOf(today);
  const ignored = new Set(manual.filter(m => m.ignore).map(m => m.name));
  const mine = manual.filter(m => !m.ignore).map(m => ({ id: m.id, name: m.name, key: ruleKey(m.name) || m.name.toLowerCase(), amount: Number(m.amount), category: m.category, due: nextDueMonth(m.month, cur), source: 'manual' }));
  const auto = detectAnnual(txs, cur).filter(a => !ignored.has(a.key) && !mine.some(m => m.key === a.key))
    .map(a => ({ id: null, name: a.name, key: a.key, amount: a.amount, category: a.category, due: nextDueMonth(a.month, cur), source: 'auto' }));
  return [...mine, ...auto].map(i => ({ ...i, paid: i.due === cur && txs.some(t => monthOf(t.date) === cur && counts(t) && t.amount < 0 &&
    (ruleKey(t.text) === i.key || (i.category !== 'Annet' && t.category === i.category && -t.amount >= i.amount * 0.5))) }))
    .sort((a, b) => a.due.localeCompare(b.due));
}

// Hvor mye bør settes av hver måned for å dekke det som forfaller de neste 12 månedene
export function setAsidePerMonth(items, today) {
  const cur = monthOf(today);
  return items.filter(i => !i.paid && monthsBetween(cur, i.due) <= 11)
    .reduce((s, i) => s + i.amount / Math.max(1, monthsBetween(cur, i.due)), 0);
}
