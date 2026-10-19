import { monthOf, } from './analysis.js';
import { addMonths, monthTotals, lastMonths } from './charts.js';
import { monthsBetween } from './seasonal.js';

// Snittet av månedlig overskudd (inntekt − utgift) de siste n fulle månedene som har data
export function avgNet(txs, today, n = 3) {
  const cur = monthOf(today), tot = monthTotals(txs, lastMonths(today, n + 1).filter(m => m < cur));
  const months = Object.entries(tot).filter(([, v]) => v.spent > 0 || v.income > 0);
  return { avg: months.length ? months.reduce((s, [, v]) => s + v.net, 0) / months.length : 0, months: months.length };
}

// Når nås målet?
//  - egen plan (monthly > 0) brukes alltid hvis den er satt
//  - ellers, med frist: resten delt på antall måneder til fristen (oppdateres av seg selv når tiden går)
//  - ellers: snittet av overskuddet (fallbackRate)
// extra = ekstra sparing per måned (hva-om).
export function projectGoal({ target, saved = 0, monthly = 0, fallbackRate = 0, deadline = '', today, extra = 0 }) {
  const cur = monthOf(today), remaining = Math.max(0, target - saved);
  const monthsLeft = deadline ? Math.max(1, monthsBetween(cur, monthOf(deadline))) : null;
  const source = monthly > 0 ? 'plan' : deadline ? 'frist' : 'snitt';
  const base = source === 'plan' ? monthly : source === 'frist' ? remaining / monthsLeft : Math.max(fallbackRate, 0), rate = base + extra;
  const months = remaining === 0 ? 0 : rate > 0 ? Math.ceil(remaining / rate - 1e-9) : Infinity;
  const eta = Number.isFinite(months) ? addMonths(cur, months) : null;
  return { remaining, rate, source, usesFallback: source === 'snitt', months, eta, done: remaining === 0, pct: target > 0 ? Math.min(saved / target, 1) : 0, monthsLeft,
    neededPerMonth: deadline && remaining > 0 ? remaining / monthsLeft : null, onTrack: deadline ? (remaining === 0 || (eta != null && eta <= monthOf(deadline))) : null };
}
