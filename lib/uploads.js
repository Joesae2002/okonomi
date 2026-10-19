// Påminnelse om å laste opp bankloggene hver måned, med status per konto.
import { monthOf } from './analysis.js';
import { addMonths } from './charts.js';

const lastDay = m => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
export const lastDayOf = m => `${m}-${String(lastDay(m)).padStart(2, '0')}`;
const addDays = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// «Ferdig» for en måned når kontoen har poster fra de aller siste dagene av måneden (eller senere), eller du har merket den som ferdig for hånd.
// Konto uten bevegelser på slutten av måneden kan dermed merkes manuelt. Kontoer med remind = false er ikke med.
export function uploadStatus({ accounts, txs, marks = [], month }) {
  const threshold = addDays(lastDayOf(month), -3), maxBy = {};
  for (const t of txs) if (t.account_id && (!maxBy[t.account_id] || t.date > maxBy[t.account_id])) maxBy[t.account_id] = t.date;
  return accounts.filter(a => a.remind !== false).map(a => {
    const dataTo = maxBy[a.id] ?? null, byData = dataTo != null && dataTo >= threshold, marked = marks.some(m => m.account_id === a.id && m.month === month);
    return { account: a, done: byData || marked, via: byData ? 'data' : marked ? 'manuelt' : null, dataTo };
  });
}

// Hvilken måned gjelder påminnelsen nå? Fra nest siste dag i en måned til og med den 15. i neste.
//   snart: nest siste dag · slutt: siste dag · start: 1.–4. · paaminnelse1: 5.–9. · paaminnelse2: 10.–15.
export function reminderWindow(today) {
  const cur = monthOf(today), day = Number(today.slice(8)), ld = lastDay(cur);
  if (day >= ld - 1) return { month: cur, phase: day === ld ? 'slutt' : 'snart' };
  if (day <= 15) return { month: addMonths(cur, -1), phase: day <= 4 ? 'start' : day <= 9 ? 'paaminnelse1' : 'paaminnelse2' };
  return null;
}
