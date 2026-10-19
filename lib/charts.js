// Datagrunnlag og SVG for grafene. Rene funksjoner uten DOM, så de kan testes.
import { monthOf, counts, eff } from './analysis.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
const MONTH_LONG = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
export const monthShort = m => MONTH_SHORT[Number(m.slice(5, 7)) - 1];
export const monthLabel = m => `${MONTH_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const addMonths = (m, n) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7); };
export const fmtKr = n => `${Math.round(n).toLocaleString('nb-NO').replace(/ /g, ' ')} kr`;
export const fmtK = n => (n >= 1000 ? `${String(Math.round(n / 100) / 10).replace('.', ',')}k` : String(Math.round(n)));
const daysIn = m => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();

// De n siste månedene, eldst først, med inneværende måned sist
export const lastMonths = (today, n = 12) => Array.from({ length: n }, (_, i) => addMonths(monthOf(today), i - (n - 1)));

export function monthTotals(txs, months) {
  const out = Object.fromEntries(months.map(m => [m, { spent: 0, income: 0, net: 0 }]));
  for (const t of txs) {
    const o = out[monthOf(t.date)]; if (!o || !counts(t)) continue;
    const a = eff(t); if (a < 0) o.spent += -a; else o.income += a;
  }
  for (const o of Object.values(out)) o.net = o.income - o.spent;
  return out;
}

export const categoryTotals = (txs, month) => {
  const out = {};
  for (const t of txs) if (counts(t) && t.amount < 0 && monthOf(t.date) === month) out[t.category] = (out[t.category] || 0) + -eff(t);
  return out;
};

// Akkumulert forbruk per dag. Dager etter «i dag» er null i inneværende måned.
export function cumulativeSpend(txs, month, today) {
  const dim = daysIn(month), lastDay = monthOf(today) === month ? Number(today.slice(8)) : month < monthOf(today) ? dim : 0;
  const perDay = new Array(dim).fill(0);
  for (const t of txs) if (counts(t) && t.amount < 0 && monthOf(t.date) === month) perDay[Number(t.date.slice(8)) - 1] += -eff(t);
  let sum = 0;
  const values = perDay.map((v, i) => { if (i >= lastDay) return null; sum += v; return sum; });
  return { dim, lastDay, values, total: sum };
}

// Snitt over de siste n FULLE månedene som har data (inneværende måned er ikke ferdig og teller ikke)
export function yearAverages(txs, today, n = 12) {
  const cur = monthOf(today), all = lastMonths(today, n + 1).filter(m => m < cur), tot = monthTotals(txs, all);
  const months = all.filter(m => tot[m].spent > 0 || tot[m].income > 0), k = months.length || 1;
  const byCat = {};
  for (const m of months) for (const [c, v] of Object.entries(categoryTotals(txs, m))) byCat[c] = (byCat[c] || 0) + v / k;
  const sum = f => months.reduce((s, m) => s + tot[m][f], 0) / k;
  return { months, avgSpent: sum('spent'), avgIncome: sum('income'), avgNet: sum('net'), byCat };
}

// ---------- SVG ----------
export function niceMax(max) {
  if (max <= 0) return { top: 1, step: 1, ticks: [0, 1] };
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw);
  const top = Math.ceil(max / step) * step;
  return { top, step, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}
const W = 360, ML = 34, MR = 12, MT = 10, MB = 22;

// To linjer (valgt måned mot sammenligning). a/b: { label, values[] (null = ingen data), cls }
export function lineChartSvg({ a, b, dim, height = 200, title = '' }) {
  const max = Math.max(...a.values.filter(v => v != null), ...b.values.filter(v => v != null), 0), { top, ticks } = niceMax(max);
  const pw = W - ML - MR, ph = height - MT - MB, x = d => ML + (dim === 1 ? 0 : (d - 1) / (dim - 1)) * pw, y = v => MT + ph - (v / top) * ph;
  const path = vals => vals.map((v, i) => (v == null ? null : `${i === 0 || vals[i - 1] == null ? 'M' : 'L'}${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  const lastA = a.values.reduce((l, v, i) => (v == null ? l : i), -1);
  const xs = [...new Set([1, Math.round(dim / 4), Math.round(dim / 2), Math.round((dim * 3) / 4), dim])];
  const area = lastA >= 0 ? `${path(a.values.slice(0, lastA + 1))} L${x(lastA + 1).toFixed(1)} ${y(0)} L${x(1).toFixed(1)} ${y(0)} Z` : '';
  const hits = Array.from({ length: dim }, (_, i) => {
    const d = i + 1, va = a.values[i], vb = b.values[i];
    const tip = `Dag ${d}: ${a.label} ${va == null ? '–' : fmtKr(va)} · ${b.label} ${vb == null ? '–' : fmtKr(vb)}`;
    const w = pw / dim;
    return `<g class="hit" tabindex="0" data-tip="${esc(tip)}"><rect x="${(x(d) - w / 2).toFixed(1)}" y="${MT}" width="${w.toFixed(1)}" height="${ph}" fill="transparent"/><line class="xh" x1="${x(d).toFixed(1)}" x2="${x(d).toFixed(1)}" y1="${MT}" y2="${MT + ph}"/>${va != null ? `<circle class="xd" cx="${x(d).toFixed(1)}" cy="${y(va).toFixed(1)}" r="4"/>` : ''}</g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title)}">
  ${ticks.map(t => `<line class="grid" x1="${ML}" x2="${W - MR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${ML - 6}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${fmtK(t)}</text>`).join('')}
  ${xs.map(d => `<text class="ax" x="${x(d).toFixed(1)}" y="${height - 6}" text-anchor="${d === 1 ? 'start' : d === dim ? 'end' : 'middle'}">${d}.</text>`).join('')}
  ${area ? `<path class="area" d="${area}"/>` : ''}
  <path class="ln-b" d="${path(b.values)}"/><path class="ln-a" d="${path(a.values)}"/>
  ${lastA >= 0 ? `<circle class="dot" cx="${x(lastA + 1).toFixed(1)}" cy="${y(a.values[lastA]).toFixed(1)}" r="4"/><text class="lbl" x="${Math.min(x(lastA + 1), W - MR - 2).toFixed(1)}" y="${Math.max(y(a.values[lastA]) - 9, 9).toFixed(1)}" text-anchor="${lastA + 1 > dim * 0.8 ? 'end' : 'middle'}">${fmtKr(a.values[lastA])}</text>` : ''}
  ${hits}</svg>`;
}

// Søyler per måned. items: [{ label, value, tip, hi }], avg: tall eller null
export function columnsSvg({ items, avg = null, height = 190, title = '', avgLabel = 'Snitt' }) {
  const max = Math.max(...items.map(i => i.value), avg || 0, 0), { top, ticks } = niceMax(max);
  const pw = W - ML - MR, ph = height - MT - MB, slot = pw / items.length, bw = Math.min(22, slot * 0.62), y = v => MT + ph - (v / top) * ph;
  const bars = items.map((it, i) => {
    const cx = ML + slot * i + slot / 2, x0 = cx - bw / 2, y0 = y(it.value), h = Math.max(ph - (y0 - MT), 0), r = Math.min(4, bw / 2, h);
    const d = h <= 0.5 ? '' : `M${x0.toFixed(1)} ${(MT + ph).toFixed(1)} V${(y0 + r).toFixed(1)} Q${x0.toFixed(1)} ${y0.toFixed(1)} ${(x0 + r).toFixed(1)} ${y0.toFixed(1)} H${(x0 + bw - r).toFixed(1)} Q${(x0 + bw).toFixed(1)} ${y0.toFixed(1)} ${(x0 + bw).toFixed(1)} ${(y0 + r).toFixed(1)} V${(MT + ph).toFixed(1)} Z`;
    return `<g class="hit" tabindex="0" data-tip="${esc(it.tip)}">${d ? `<path class="${it.hi ? 'bar-a' : 'bar-b'}" d="${d}"/>` : ''}<rect x="${(cx - slot / 2).toFixed(1)}" y="${MT}" width="${slot.toFixed(1)}" height="${ph + MB}" fill="transparent"/>
      <text class="ax${it.hi ? ' ax-hi' : ''}" x="${cx.toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(it.label)}</text>${it.hi && it.value > 0 ? `<text class="lbl" x="${cx.toFixed(1)}" y="${(y0 - 5).toFixed(1)}" text-anchor="middle">${fmtK(it.value)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(title)}">
  ${ticks.map(t => `<line class="grid" x1="${ML}" x2="${W - MR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="ax" x="${ML - 6}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end">${fmtK(t)}</text>`).join('')}
  ${bars}
  ${avg != null && avg > 0 ? `<line class="avg" x1="${ML}" x2="${W - MR}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}"/><text class="avg-l" x="${W - MR}" y="${(y(avg) - 4).toFixed(1)}" text-anchor="end">${esc(avgLabel)} ${fmtK(avg)}</text>` : ''}</svg>`;
}

// Liten søylegraf for «small multiples»
export function miniColumnsSvg({ values, hiIndex = -1, tips = [], title = '' }) {
  const w = 120, h = 44, max = Math.max(...values, 1), slot = w / values.length, bw = Math.min(6, slot * 0.6);
  const bars = values.map((v, i) => { const bh = Math.max((v / max) * (h - 4), v > 0 ? 1.5 : 0), x = i * slot + (slot - bw) / 2;
    return `<g class="hit" tabindex="0" data-tip="${esc(tips[i] || '')}"><rect class="${i === hiIndex ? 'bar-a' : 'bar-b'}" x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"/><rect x="${(i * slot).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${h}" fill="transparent"/></g>`; }).join('');
  return `<svg class="chart mini" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><line class="grid" x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}"/>${bars}</svg>`;
}
