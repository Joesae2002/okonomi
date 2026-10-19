import { monthOf } from './analysis.js';
import { ruleKey } from './categorize.js';
import { shortName } from './subscriptions.js';

export const isSalary = t => t.kind === 'normal' && t.amount > 0 && t.category === 'Lønn';

// Hvem lønnen tilhører: valgt person på posten → kontoens eier → den som importerte
export const personOf = (t, accounts, members) =>
  t.person || accounts.find(a => a.id === t.account_id)?.person || members.find(m => m.user_id === t.owner_id)?.display_name || 'Ukjent';

// Lønn per person i et år. today brukes til å vite hvor mange måneder som har gått.
export function salaryByPerson(txs, year, accounts, members, today) {
  const out = {}, cy = Number(today.slice(0, 4)), elapsed = year < cy ? 12 : year > cy ? 0 : Number(today.slice(5, 7));
  for (const t of txs.filter(t => isSalary(t) && t.date.startsWith(String(year)))) {
    const p = personOf(t, accounts, members);
    const o = (out[p] ||= { person: p, payments: [], ytd: 0, months: new Set() });
    o.payments.push(t); o.ytd += t.amount; o.months.add(monthOf(t.date));
  }
  for (const o of Object.values(out)) {
    o.payments.sort((a, b) => b.date.localeCompare(a.date));
    o.monthsFound = o.months.size; o.elapsed = elapsed;
    o.projected = year < cy ? o.ytd : o.monthsFound ? o.ytd / o.monthsFound * 12 : 0;
    o.incomplete = o.monthsFound < elapsed;     // mangler utbetalinger fra måneder som har gått
  }
  return out;
}

// Lønnsutbetalinger gruppert etter hvem som betaler (arbeidsgiver). Brukes som forslag til inntektskilder i skattekalkulatoren.
export function salarySources(payments, year, today) {
  const cy = Number(today.slice(0, 4)), groups = {};
  for (const t of payments) {
    const key = ruleKey(t.text) || t.text.toLowerCase(), g = (groups[key] ||= { key, navn: shortName(t.text), netto: 0, count: 0, months: new Set() });
    g.netto += t.amount; g.count++; g.months.add(monthOf(t.date));
  }
  return Object.values(groups).map(g => ({ key: g.key, navn: g.navn, netto: g.netto, count: g.count, monthsFound: g.months.size,
    projected: year < cy ? g.netto : g.netto / g.months.size * 12 })).sort((a, b) => b.netto - a.netto);
}
