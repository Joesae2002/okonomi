import { ruleKey } from './categorize.js';

export const monthOf = d => d.slice(0, 7);
// Utgifter som teller: ikke interne overføringer, ikke refunderbare utlegg
export const counts = t => t.kind === 'normal';
// Din andel av en post. share = 1 (standard) betyr hele beløpet; 0,5 betyr at du bare betaler halvparten (resten skal andre betale).
export const eff = t => (t.share == null || Number(t.share) === 1 ? t.amount : t.amount * Number(t.share));
// Hva andre skylder deg for denne posten: hele beløpet for utlegg, ellers den delen som ikke er din andel
export const owed = t => (t.reimbursed ? 0 : t.kind === 'reimbursable' ? -t.amount : t.kind === 'normal' && t.amount < 0 && t.share != null && Number(t.share) < 1 ? -t.amount * (1 - Number(t.share)) : 0);

export function monthSummary(txs, month) {
  const m = txs.filter(t => monthOf(t.date) === month && counts(t));
  const byCat = {};
  let income = 0, spent = 0;
  for (const t of m) {
    const a = eff(t);
    if (a > 0) income += a;
    else { spent += -a; byCat[t.category] = (byCat[t.category] || 0) + -a; }
  }
  const outstanding = txs.reduce((s, t) => s + owed(t), 0);
  return { income, spent, byCat, net: income - spent, outstanding };
}

const addMonths = (month, n) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

// Faste utgifter: samme nøkkel i minst 2 av 3 foregående måneder med omtrent samme beløp
export function detectRecurring(txs, month) {
  const prev = [1, 2, 3].map(n => addMonths(month, -n));
  const groups = {};
  for (const t of txs) {
    if (!counts(t) || eff(t) >= 0 || !prev.includes(monthOf(t.date))) continue;
    const k = ruleKey(t.text); if (!k) continue;
    (groups[k] ||= []).push(t);
  }
  const out = [];
  for (const [key, list] of Object.entries(groups)) {
    const months = new Set(list.map(t => monthOf(t.date)));
    if (months.size < 2) continue;
    const amts = list.map(t => -eff(t)), avg = amts.reduce((a, b) => a + b, 0) / amts.length;
    if (amts.every(a => Math.abs(a - avg) <= avg * 0.15)) {
      const days = list.map(t => Number(t.date.slice(8)));
      out.push({ key, text: list[0].text, amount: avg, day: Math.round(days.reduce((a, b) => a + b, 0) / days.length), category: list[0].category });
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// Prognose for en måned. today = 'YYYY-MM-DD'
export function forecast(txs, month, today, seasonal = [], plannedIncome = 0) {
  const sum = monthSummary(txs, month);
  const [y, m] = month.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const day = monthOf(today) === month ? Number(today.slice(8)) : monthOf(today) > month ? dim : 0;
  const recurring = detectRecurring(txs, month);
  const seen = new Set(txs.filter(t => monthOf(t.date) === month).map(t => ruleKey(t.text)));
  const pendingFixed = recurring.filter(r => !seen.has(r.key));
  const pendingFixedSum = pendingFixed.reduce((s, r) => s + r.amount, 0);
  const seasonalDue = seasonal.filter(i => i.due === month && !i.paid);
  const seasonalSum = seasonalDue.reduce((s, i) => s + i.amount, 0);
  const fixedKeys = new Set([...recurring.map(r => r.key), ...seasonal.map(i => i.key)]);
  const varSoFar = txs.filter(t => monthOf(t.date) === month && counts(t) && t.amount < 0 && !fixedKeys.has(ruleKey(t.text))).reduce((s, t) => s - eff(t), 0);
  const remaining = Math.max(dim - day, 0);
  const varRest = day > 0 ? (varSoFar / day) * remaining : 0;
  // Forventet inntekt: lønn fra forrige måned hvis ikke kommet enda
  const prevIncome = monthSummary(txs, addMonths(month, -1)).income;
  const expectedIncomeRest = Math.max((plannedIncome > 0 ? plannedIncome : prevIncome) - sum.income, 0) * (remaining > 0 ? 1 : 0);   // planlagt inntekt går foran forrige måned
  const projectedSpent = sum.spent + pendingFixedSum + varRest + seasonalSum;
  const projectedIncome = sum.income + expectedIncomeRest;
  return { ...sum, pendingFixed, seasonalDue, projectedSpent, projectedIncome, projectedNet: projectedIncome - projectedSpent, daysLeft: remaining };
}

export function budgetAlerts(byCat, budgets) {
  return Object.entries(budgets).filter(([, b]) => b > 0).map(([cat, b]) => {
    const spent = byCat[cat] || 0, pct = spent / b;
    return { cat, spent, budget: b, pct, level: pct > 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok' };
  }).sort((a, b) => b.pct - a.pct);
}

const MONTHS = { januar: 1, februar: 2, mars: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, desember: 12 };
const SEASONS = { vinter: [12, 1, 2], vår: [3, 4, 5], var: [3, 4, 5], sommer: [6, 7, 8], høst: [9, 10, 11], host: [9, 10, 11] };

// «hva brukte vi på restaurant i sommer?» → filter
export function naturalSearch(q, txs, categories) {
  const s = q.toLowerCase(); let months = null; const rest = [];
  const yr = (s.match(/\b(20\d\d)\b/) || [])[1];
  for (const w of s.replace(/[?.,]/g, '').split(/\s+/)) {
    if (MONTHS[w]) months = [MONTHS[w]];
    else if (SEASONS[w]) months = SEASONS[w];
    else rest.push(w);
  }
  const cat = categories.find(c => s.includes(c.toLowerCase()));
  const stop = new Set(['hva', 'brukte', 'vi', 'jeg', 'på', 'i', 'til', 'av', 'for', 'sommer', 'vinter', 'fikk', 'betalte', 'hvor', 'mye', 'penger', 'er', 'det', 'en', 'et', 'den', 'dette', 'året', 'i fjor', yr]);
  const words = rest.filter(w => !stop.has(w) && w.length > 2 && !(cat && w === cat.toLowerCase()));
  const hit = txs.filter(t => counts(t) &&
    (!months || months.includes(Number(t.date.slice(5, 7)))) && (!yr || t.date.startsWith(yr)) &&
    (!cat || t.category === cat) && words.every(w => t.text.toLowerCase().includes(w)));
  return { hits: hit, total: hit.reduce((a, t) => a + eff(t), 0) };
}
