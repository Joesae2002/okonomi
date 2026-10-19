// «Din andel» av en post: 1/2, 25 %, 220 kr, eller en av knappene. Returnerer en andel mellom 0 og 1, eller NaN hvis teksten er ugyldig.
import { evalExpr } from './calc.js';

export function parseShare(text, absAmount) {
  const s = String(text ?? '').trim().toLowerCase();
  if (s === '') return 1;
  if (/%$/.test(s)) { const v = evalExpr(s.slice(0, -1), 6); return v > 0 && v <= 100 ? round(v / 100) : NaN; }
  if (/kr\.?$/.test(s)) { const v = evalExpr(s.replace(/kr\.?$/, ''), 2); return v > 0 && absAmount > 0 && v <= absAmount ? round(v / absAmount) : NaN; }    // beløp du selv betaler
  const v = evalExpr(s, 6);
  if (v == null || Number.isNaN(v)) return NaN;
  if (/\//.test(s)) return v > 0 && v <= 1 ? round(v) : NaN;                                                                          // brøk, f.eks. 1/4
  if (v > 0 && v <= 1) return round(v);                                                                                                // 0,5
  return v > 1 && absAmount > 0 && v <= absAmount ? round(v / absAmount) : NaN;                                                         // 440 → beløp
}
const round = x => Math.round(x * 100000) / 100000;

// Lesbar tekst for en andel: 1/2, 1/3, 1/4, ellers prosent
export function shareText(share) {
  const s = Number(share ?? 1);
  for (const n of [2, 3, 4, 5, 6, 8, 10]) if (Math.abs(s - 1 / n) < 0.0005) return `1/${n}`;
  if (Math.abs(s - 2 / 3) < 0.0005) return '2/3'; if (Math.abs(s - 3 / 4) < 0.0005) return '3/4';
  return `${String(Math.round(s * 1000) / 10).replace('.', ',')} %`;
}
