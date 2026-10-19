import { addMonths } from './charts.js';

// Planlagt inntekt: hver post har beløp per utbetaling, antall ganger per måned og en periode.
// Eksempel: Krik 18 000 × 1 til 2027-03. Avlastning 1 200 × 2,17 (annenhver helg), uten sluttdato.
export const PER_MONTH = { fast: 1, annenhver: 26 / 12, hver: 52 / 12 };

export const monthlyAmount = p => Math.round(Number(p.amount) * (Number(p.times) || 1));
export const isActive = (p, month) => (!p.start_month || p.start_month <= month) && (!p.end_month || month <= p.end_month);
export const plansForMonth = (plans, month, person = null) => plans.filter(p => isActive(p, month) && (!person || p.person === person));
export const plannedIncome = (plans, month, person = null) => plansForMonth(plans, month, person).reduce((s, p) => s + monthlyAmount(p), 0);

// Sum per måned for n måneder fra og med `from`
export function plannedSeries(plans, from, n = 12) {
  return Array.from({ length: n }, (_, i) => { const month = addMonths(from, i); return { month, total: plannedIncome(plans, month) }; });
}

// Hvor mye er igjen av inntekten når budsjettet er trukket fra?
export const room = (plans, month, budgetTotal) => { const planned = plannedIncome(plans, month); return { planned, budget: budgetTotal, room: planned - budgetTotal }; };

// Beskrivelse av perioden på norsk: «jan 2027 – mars 2027» / «fra nov 2026» / «til nov 2026»
export function periodText(p, label) {
  if (p.start_month && p.end_month) return p.start_month === p.end_month ? label(p.start_month) : `${label(p.start_month)} – ${label(p.end_month)}`;
  if (p.end_month) return `til og med ${label(p.end_month)}`;
  return p.start_month ? `fra ${label(p.start_month)}, løpende` : 'løpende';
}
