import { monthSummary, budgetAlerts, monthOf } from './analysis.js';
import { seasonalItems, monthsBetween } from './seasonal.js';
import { monthLabel } from './charts.js';
import { uploadStatus, reminderWindow } from './uploads.js';

const kr = n => Math.round(n).toLocaleString('nb-NO').replace(/ /g, ' ') + ' kr';

// Rene regler for hvilke varsler som skal sendes. `sent` = nøkler som allerede er sendt (hindrer dobbelvarsling).
export function planNotifications({ txs, budgets, manual, today, sent = new Set(), accounts = [], marks = [] }) {
  const month = monthOf(today), out = [];
  const add = (key, title, body) => { if (!sent.has(key)) out.push({ key, title, body }); };

  const { byCat } = monthSummary(txs, month);
  for (const a of budgetAlerts(byCat, budgets)) {
    if (a.level === 'over') add(`${month}:budget:${a.cat}:over`, `Over budsjett: ${a.cat}`, `${kr(a.spent)} brukt av ${kr(a.budget)} denne måneden.`);
    else if (a.level === 'warn' && !sent.has(`${month}:budget:${a.cat}:over`)) add(`${month}:budget:${a.cat}:warn`, `${a.cat}: ${Math.round(a.pct * 100)} % av budsjettet`, `${kr(a.spent)} av ${kr(a.budget)} er brukt.`);
  }

  for (const i of seasonalItems(txs, manual, today)) {
    const ahead = monthsBetween(month, i.due);
    if (!i.paid && ahead <= 1) add(`${i.due}:season:${i.key}`, ahead === 0 ? `Sesongutgift denne måneden: ${i.name}` : `Sesongutgift neste måned: ${i.name}`, `Ca. ${kr(i.amount)} forfaller.`);
  }

  // Månedlig påminnelse om å laste opp bankloggene (heads-up siste dag, så den 1., 5. og 10. til alt er lastet opp)
  const w = reminderWindow(today);
  if (w && w.phase !== 'snart' && accounts.length) {
    const st = uploadStatus({ accounts, txs, marks, month: w.month }), name = monthLabel(w.month).split(' ')[0];
    if (st.some(x => !x.done)) add(`${w.month}:upload:${w.phase}`, w.phase === 'slutt' ? `I morgen er ${name} over` : `Last opp bankloggene for ${name}`,
      (w.phase === 'slutt' ? 'Husk å laste opp bankloggene i morgen. ' : '') + st.map(x => `${x.done ? '✅' : '⬜'} ${x.account.name}`).join(' · '));
  }

  const unc = txs.filter(t => t.status === 'uncertain').length;
  if (unc >= 5) add(`${month}:sort:${Math.floor(Number(today.slice(8)) / 7)}`, 'Poster venter på sortering', `${unc} poster trenger kategori.`);
  return out;
}
