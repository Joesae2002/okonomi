import { monthOf } from './analysis.js';

// Hvor mye som er igjen per budsjettpost, med tempo og status. byCat: {kategori: forbruk}
export function budgetStatus({ byCat, budgets, month, today }) {
  const [y, m] = month.split('-').map(Number), dim = new Date(y, m, 0).getDate(), cur = monthOf(today) === month;
  const day = cur ? Number(today.slice(8)) : month < monthOf(today) ? dim : 0, daysLeft = cur ? dim - day + 1 : 0; // inkludert i dag
  const items = Object.entries(budgets).filter(([, b]) => b > 0).map(([cat, budget]) => {
    const spent = byCat[cat] || 0, left = budget - spent, pct = spent / budget;
    const level = pct > 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok', used = pct >= 1;
    const projected = cur && day > 0 ? (spent / day) * dim : spent;
    return { cat, budget, spent, left, pct, level, used, perDay: cur && left > 0 && daysLeft > 0 ? left / daysLeft : null, projected,
      pace: level === 'ok' && cur && day >= 5 && projected > budget * 1.05 };   // ligger an til å sprenge budsjettet
  }).sort((a, b) => b.pct - a.pct);
  const budget = items.reduce((s, i) => s + i.budget, 0), spent = items.reduce((s, i) => s + i.spent, 0);
  return { items, total: { budget, spent, left: budget - spent, pct: budget ? spent / budget : 0 }, daysLeft, cur };
}
