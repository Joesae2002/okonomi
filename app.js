const { createClient } = window.supabase; // vendor/supabase.js (lastes i index.html)
window.__build = '2026-10-23-c';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';
import { parseCSV, parseRows } from './lib/parse.js';
import { CATEGORIES, compileRules, categorize, ruleKey } from './lib/categorize.js';
import { monthSummary, forecast, budgetAlerts, naturalSearch, monthOf, eff } from './lib/analysis.js';
import { parseShare, shareText } from './lib/share.js';
import { uploadStatus, reminderWindow } from './lib/uploads.js';
import { seasonalItems, setAsidePerMonth, monthsBetween } from './lib/seasonal.js';
import { evalExpr, isFormula } from './lib/calc.js';
import { suggestForCategory } from './lib/budgetsuggest.js';
import { salaryByPerson, salarySources } from './lib/salary.js';
import { beregn, projiser, samleKilder, kilderFraRad, rulesFor, SOURCES as TAX_SOURCES } from './lib/tax.js';
import { lastMonths, addMonths, monthTotals, cumulativeSpend, yearAverages, categoryTotals, lineChartSvg, columnsSvg, miniColumnsSvg, monthLabel, monthShort, fmtKr, fmtK } from './lib/charts.js';
import { budgetStatus } from './lib/dynbudget.js';
import { fixedInfo, itemPayments, suggestFixed, categoryPlan } from './lib/fixed.js';
import { domainFor, logoUrl, initials, avatarHue } from './lib/logos.js';
import { plansForMonth, plannedIncome, plannedSeries, monthlyAmount, periodText, PER_MONTH } from './lib/income.js';
import { storeBreakdown } from './lib/stores.js';
import { avgNet, projectGoal } from './lib/goals.js';
import { STUDENT_PAR, SOURCES, presetTotal } from './lib/presets.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kr = n => Math.round(n).toLocaleString('nb-NO').replace(/ /g, ' ') + ' kr';
const today = () => new Date().toISOString().slice(0, 10);

const S = { user: null, hh: null, members: [], txs: [], budgets: {}, budgetMeta: {}, rules: [], seasonalRaw: [], customCats: [], accounts: [], account: 'all', year: Number(today().slice(0, 4)), taxInputs: [], goals: [], marks: [], plans: [], fixed: [], openFixed: new Set(), openCats: new Set(), hiddenSubs: new Set(), chartA: null, chartB: null, chartCat: 'all', chartMetric: 'spent', view: 'home', month: monthOf(today()), q: '', msg: '' };
const cats = () => [...CATEGORIES, ...S.customCats.filter(c => !CATEGORIES.includes(c))];
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* privat modus */ } } };
S.storePeriod = ['3', 'year'].includes(store.get('okonomi.storePeriod')) ? store.get('okonomi.storePeriod') : 'month'; S.logos = store.get('okonomi.logos') !== '0'; S.fixedKind = store.get('okonomi.fixedKind') === 'giver' ? 'giver' : 'utgift';
const applyTheme = () => {   // «Ellinor-modus» (lys, pastell rosa) lagres per enhet
  const on = store.get('okonomi.theme') === 'ellinor'; if (on) document.documentElement.dataset.theme = 'ellinor'; else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', on ? '#fdf0f4' : '#1f6feb');
};
applyTheme();
const accName = id => S.accounts.find(a => a.id === id)?.name || '';
const visible = () => S.account === 'all' ? S.txs : S.txs.filter(t => t.account_id === S.account);
const accountPicker = () => `<select id="acc" aria-label="Velg konto"><option value="all">Alle kontoer (totalt)</option>${S.accounts.map(a => `<option value="${a.id}" ${S.account === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
function bindAccount() { const el = $('#acc'); if (el) el.onchange = () => { S.account = el.value; store.set('okonomi.account', S.account); render(); }; }
const seasonal = () => seasonalItems(S.txs, S.seasonalRaw, today());
const nameOf = id => S.members.find(m => m.user_id === id)?.display_name || '?';

// ---------- data ----------
let loadSeq = 0;
async function loadAll() {
  const my = ++loadSeq;   // bare den nyeste innlastingen får lagre. Overlappende innlastinger ga før doble poster.
  const { data: mem } = await sb.from('members').select('household_id, user_id, display_name');
  if (my !== loadSeq) return;
  if (!mem?.length) { S.hh = null; return; }
  const hid = mem.find(m => m.user_id === S.user.id).household_id;
  const [{ data: hh }, { data: bu }, { data: ru }, { data: se }, { data: ca }, { data: ac }, { data: ta }, { data: go }, { data: hs }, { data: fi }, { data: um }, { data: ip }] = await Promise.all([
    sb.from('households').select('*').eq('id', hid).single(),
    sb.from('budgets').select('*'), sb.from('rules').select('*'), sb.from('seasonal_items').select('*'), sb.from('categories').select('name'), sb.from('accounts').select('*').order('name'), sb.from('tax_inputs').select('*'), sb.from('goals').select('*').order('created_at'), sb.from('hidden_subs').select('key'), sb.from('fixed_items').select('*').order('created_at'), sb.from('upload_marks').select('*'), sb.from('income_plans').select('*').order('created_at')]);
  // paginer forbi Supabase sin grense på 1000 rader. Fast sortering (dato, id), ellers kan sidene overlappe når mange poster har samme dato.
  const byId = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('transactions').select('*').order('date', { ascending: false }).order('id').range(from, from + 999);
    if (error) throw error;
    for (const t of data) byId.set(t.id, { ...t, amount: Number(t.amount), share: t.share == null ? 1 : Number(t.share) });
    if (data.length < 1000) break;
  }
  if (my !== loadSeq) return;   // en nyere innlasting har overtatt
  S.members = mem.filter(m => m.household_id === hid);
  S.hh = hh; S.budgets = Object.fromEntries((bu || []).map(b => [b.category, Number(b.amount)])); S.budgetMeta = Object.fromEntries((bu || []).map(b => [b.category, { note: b.note || '', formula: b.formula || '' }])); S.rules = ru || []; S.seasonalRaw = se || []; S.customCats = (ca || []).map(c => c.name); // null hvis tabellen ikke finnes ennå
  S.goals = (go || []).map(g => ({ ...g, target: Number(g.target), saved: Number(g.saved), monthly: g.monthly == null ? 0 : Number(g.monthly) })); S.hiddenSubs = new Set((hs || []).map(h => h.key)); S.fixed = (fi || []).map(f => ({ ...f, kind: f.kind || 'utgift', amount: f.amount == null ? null : Number(f.amount) }));
  S.marks = um || []; S.plans = (ip || []).map(p => ({ ...p, amount: Number(p.amount), times: Number(p.times) })); S.taxInputs = ta || []; S.accounts = ac || [];
  const saved = store.get('okonomi.account'); S.account = saved && S.accounts.some(a => a.id === saved) ? saved : 'all';
  S.txs = [...byId.values()];
}
const patch = async (id, fields) => {
  const { error } = await sb.from('transactions').update(fields).eq('id', id);
  if (error) return alert(error.message);
  Object.assign(S.txs.find(t => t.id === id), fields);
};

// ---------- visning ----------
const NAV = [['home', '🏠', 'Oversikt'], ['tx', '🧾', 'Poster'], ['charts', '📊', 'Grafer'], ['subs', '🔁', 'Faste'], ['more', '☰', 'Mer']];
const NAV_FOR = { home: 'home', tx: 'tx', sort: 'tx', charts: 'charts', subs: 'subs', more: 'more', lonn: 'more', reimb: 'more', goals: 'more', settings: 'more' };
const back = to => `<button class="back" data-go="${to}">‹ ${to === 'more' ? 'Mer' : 'Poster'}</button>`;
function render() {
  const nav = $('#nav');
  if (!S.user) return authView();
  if (!S.hh) { nav.hidden = true; return householdView(); }
  const unc = S.txs.filter(t => t.status === 'uncertain').length;
  nav.hidden = false;
  nav.innerHTML = NAV.map(([k, ic, l]) => `<button data-v="${k}" class="${NAV_FOR[S.view] === k ? 'on' : ''}"><span class="ni">${ic}${k === 'tx' && unc ? `<i class="nb">${unc > 99 ? '99+' : unc}</i>` : ''}</span>${l}</button>`).join('');
  nav.onclick = e => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) { S.view = v; S.msg = ''; render(); window.scrollTo(0, 0); } };
  ({ home: homeView, tx: txView, charts: chartsView, subs: subsView, more: moreHub, sort: sortView, lonn: lonnView, reimb: reimbView, goals: goalsView, settings: settingsView })[S.view]();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { S.view = b.dataset.go; S.msg = ''; render(); window.scrollTo(0, 0); } });

// Husk hvilke kort som er åpne, så de ikke lukkes når siden tegnes på nytt
document.addEventListener('toggle', e => { const el = e.target;
  if (el.matches?.('details.catd')) el.open ? S.openCats.add(el.dataset.cat) : S.openCats.delete(el.dataset.cat);
  if (el.matches?.('details.fx')) el.open ? S.openFixed.add(el.dataset.id) : S.openFixed.delete(el.dataset.id); }, true);

// Tooltip for diagrammer: samme innhold ved hover, trykk og tastaturfokus
const tipEl = Object.assign(document.createElement('div'), { id: 'tip', hidden: true }); document.body.append(tipEl);
const showTip = (el, x, y) => { tipEl.textContent = el.dataset.tip.replace(/ · /g, '\n'); tipEl.hidden = false;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight; tipEl.style.left = `${Math.min(Math.max(x - w / 2, 8), innerWidth - w - 8)}px`; tipEl.style.top = `${y - h - 14 < 8 ? y + 18 : y - h - 14}px`; };
['pointermove', 'pointerdown'].forEach(ev => document.addEventListener(ev, e => { const h = e.target.closest?.('[data-tip]'); if (h) showTip(h, e.clientX, e.clientY); else tipEl.hidden = true; }));
document.addEventListener('focusin', e => { const h = e.target.closest?.('[data-tip]'); if (h) { const r = h.getBoundingClientRect(); showTip(h, r.left + r.width / 2, r.top); } });
document.addEventListener('focusout', () => { tipEl.hidden = true; });
const app = html => { $('#app').innerHTML = html; };

function authView(err = '') {
  $('#nav').hidden = true;
  app(`<h1>Økonomi</h1><div class="card stack"><input id="em" type="email" placeholder="E-post" autocomplete="email"><input id="pw" type="password" placeholder="Passord (min. 6 tegn)" autocomplete="current-password">
  <div class="flex"><button class="pri" id="in">Logg inn</button><button id="up">Opprett bruker</button></div><div class="over">${esc(err)}</div></div>`);
  const go = fn => async () => { const { error } = await fn({ email: $('#em').value, password: $('#pw').value }); if (error) authView(error.message); };
  $('#in').onclick = go(c => sb.auth.signInWithPassword(c));
  $('#up').onclick = go(async c => { const r = await sb.auth.signUp(c); if (!r.error && !r.data.session) authView('Bekreft e-posten din, logg så inn.'); return r; });
}

function householdView() {
  app(`<h1>Velkommen</h1><div class="card stack"><h2>Ditt navn</h2><input id="dn" placeholder="F.eks. Jørgen">
  <h2>Ny husholdning</h2><input id="hn" placeholder="Navn, f.eks. Vår økonomi"><button class="pri" id="mk">Opprett</button>
  <h2>Eller bli med (kona)</h2><input id="code" placeholder="Invitasjonskode"><button id="jn">Bli med</button></div>`);
  const run = async (fn, args) => { const { error } = await sb.rpc(fn, args); if (error) return alert(error.message); await loadAll(); render(); };
  $('#mk').onclick = () => run('create_household', { hname: $('#hn').value || 'Vår økonomi', dname: $('#dn').value || 'Meg' });
  $('#jn').onclick = () => run('join_household', { code: $('#code').value, dname: $('#dn').value || 'Meg' });
}

const monthPicker = () => `<div class="flex"><button class="sm" data-m="-1">‹</button><b>${new Date(S.month + '-01').toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })}</b><button class="sm" data-m="1">›</button></div>`;
function bindMonth() {
  document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    const d = new Date(S.month + '-01'); d.setMonth(d.getMonth() + Number(b.dataset.m)); S.month = d.toISOString().slice(0, 7); render();
  });
}

const ICON = { Mat: '🛒', Restaurant: '🍽️', Transport: '🚗', Bolig: '🏠', Strøm: '💡', Forsikring: '🛡️', Abonnement: '🔁', Helse: '💊', Klær: '👕', Barn: '🧸', Fritid: '🎮', Gaver: '🎁', Reise: '✈️', Gebyr: '🏦', Annet: '🏷️', Lønn: '💼', 'Inntekt annet': '💰' };
const icon = c => ICON[c] || '📌';
const uncBanner = () => { const n = S.txs.filter(t => t.status === 'uncertain').length; return n ? `<button class="banner" data-go="sort">🔀 <b>${n}</b> poster venter på sortering <span>›</span></button>` : ''; };
function ringSvg(pct) {
  const r = 34, c = 2 * Math.PI * r, p = Math.min(Math.max(pct, 0), 1);
  return `<svg class="ring" viewBox="0 0 90 90" role="img" aria-label="${Math.round(pct * 100)} prosent brukt"><circle cx="45" cy="45" r="${r}" class="ring-t"/><circle cx="45" cy="45" r="${r}" class="ring-p" stroke-dasharray="${(p * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 45 45)"/><text x="45" y="50" text-anchor="middle">${Math.round(pct * 100)} %</text></svg>`;
}
const shortDate = d => `${Number(d.slice(8))}. ${monthShort(d)}`;
// Mat: hvor mye som er brukt i hver butikk (din andel)
function storeCard(cat) {
  if (cat !== 'Mat') return '';
  const pe = S.storePeriod, bd = storeBreakdown(visible(), cat, S.month, pe), lbl = { month: monthLabel(S.month), 3: 'siste 3 måneder', year: `hittil i ${S.month.slice(0, 4)}` }[pe];
  if (!bd.rows.length) return '';
  const max = bd.rows[0].sum || 1;
  return `<div class="cb-h"><b>Per butikk</b><span>${kr(bd.total)}</span></div>
    <div class="seg" role="group" aria-label="Periode">${[['month', 'Måned'], ['3', '3 mnd'], ['year', 'I år']].map(([k, l]) => `<button type="button" class="${pe === k ? 'on' : ''}" data-sp="${k}">${l}</button>`).join('')}</div>
    <small class="mut">${esc(lbl)}</small>
    ${bd.rows.map(r => `<div class="srow"><div class="row"><span>${esc(r.name)}<small>${r.count} ${r.count === 1 ? 'kjøp' : 'kjøp'} · ${Math.round(r.pct * 100)} %</small></span><span class="amt">${kr(r.sum)}</span></div><div class="sbar"><i style="width:${(r.sum / max * 100).toFixed(1)}%"></i></div></div>`).join('')}`;
}
// Hva som er betalt og hva som gjenstår i en kategori denne måneden
function catBody(cat, seasonalItems) {
  const pl = categoryPlan({ cat, month: S.month, today: today(), txs: visible(), items: S.fixed, seasonal: seasonalItems }), cur = monthOf(today());
  const remaining = pl.remaining.length ? pl.remaining.map(r => `<div class="row"><span>${esc(r.name)}<small>${r.kind === 'sesong' ? 'sesongutgift denne måneden' : r.late ? `⏳ ventet ca. den ${r.dueDay}.` : `ca. den ${r.dueDay}.`}</small></span><span class="amt mut">${r.amount > 0 ? kr(r.amount) : '–'}</span></div>`).join('')
    : pl.hasFixed ? '<div class="mut">✅ Alle faste utgifter i kategorien er betalt.</div>' : '<div class="mut">Ingen faste utgifter er lagt inn for denne kategorien. <button class="sm" data-go="subs">Legg til under Faste</button></div>';
  return `${storeCard(cat)}<div class="cb-h"><b>Betalt</b><span>${kr(pl.paid)} · ${pl.paidTx.length} ${pl.paidTx.length === 1 ? 'post' : 'poster'}</span></div>
    ${pl.paidTx.map(t => `<div class="row"><span>${shortDate(t.date)}<small>${esc(t.text)}${t.share < 1 ? ` · din andel ${shareText(t.share)} av ${kr(-t.amount)}` : ''}${t.comment ? ' · 💬 ' + esc(t.comment) : ''}</small></span><span class="flex" style="flex-wrap:nowrap"><span class="amt">${kr(-eff(t))}</span><button class="sm" data-e="${t.id}" aria-label="Rediger">✎</button></span></div>`).join('') || '<div class="mut">Ingen poster denne måneden.</div>'}
    ${S.month === cur ? `<div class="cb-h"><b>Gjenstår</b><span>${pl.remaining.length ? kr(pl.remainingSum) : ''}</span></div>${remaining}` : ''}`;
}
function budgetCard(i, note, seasonalItems) {
  const msg = i.level === 'over' ? `<div class="chip bad">⛔ ${kr(-i.left)} over budsjett</div>` : i.used ? '<div class="chip warn">⚠️ Budsjettet er brukt opp</div>' : i.level === 'warn' ? '<div class="chip warn">⚠️ Nesten på grensa</div>'
    : i.pace ? `<div class="chip warn">📈 Ligger an til ca. ${kr(i.projected)}, over budsjettet</div>` : '';
  return `<details class="bcard catd" data-cat="${esc(i.cat)}" ${S.openCats.has(i.cat) ? 'open' : ''}><summary><div class="bc-top"><span class="ico">${icon(i.cat)}</span><div class="bc-name"><b>${esc(i.cat)}</b>
    <small>${i.left >= 0 ? `${kr(i.left)} igjen` : `${kr(-i.left)} over`}${i.perDay ? ` · ca. ${kr(i.perDay)}/dag` : ''}</small></div>
    <div class="bc-amt"><b>${kr(i.spent)}</b><small>av ${kr(i.budget)}</small></div><span class="chev">›</span></div>
    <div class="meter" role="progressbar" aria-valuenow="${Math.round(i.pct * 100)}" aria-valuemin="0" aria-valuemax="100"><i class="${i.level}" style="width:${Math.min(i.pct, 1) * 100}%"></i></div>
    ${msg}${note ? `<small class="mut bc-note">${esc(note)}</small>` : ''}</summary><div class="cat-body">${catBody(i.cat, seasonalItems)}</div></details>`;
}
// Påminnelse om å laste opp bankloggene, med grønn hake per konto som er ferdig
function uploadCard() {
  const w = reminderWindow(today()); if (!w) return '';
  const st = uploadStatus({ accounts: S.accounts, txs: S.txs, marks: S.marks, month: w.month }); if (!st.length) return '';
  const name = monthLabel(w.month).split(' ')[0], all = st.every(x => x.done);
  const title = all ? `✅ Alle bankloggene for ${name} er lastet opp` : w.phase === 'snart' || w.phase === 'slutt' ? `Snart månedsskifte: last opp bankloggene for ${name}` : `Last opp bankloggene for ${name}`;
  return `<div class="card upl ${all ? 'done' : ''}"><b>${title}</b>${st.map(x => `<div class="row"><span>${x.done ? '✅' : '⬜'} ${esc(x.account.name)}<small>${x.done ? (x.via === 'manuelt' ? 'merket som ferdig' : `poster til ${shortDate(x.dataTo)}`) : x.dataTo ? `siste post ${shortDate(x.dataTo)}` : 'ingen poster ennå'}</small></span>
    ${x.done ? (x.via === 'manuelt' ? `<button class="sm" data-unmark="${x.account.id}|${w.month}">Angre</button>` : '') : `<span class="flex" style="flex-wrap:nowrap"><button class="sm pri" data-upl="${x.account.id}">Importer</button><button class="sm" data-mark="${x.account.id}|${w.month}" title="Kontoen har ingen flere poster denne måneden">Ferdig</button></span>`}</div>`).join('')}</div>`;
}
function bindUploads() {
  document.querySelectorAll('[data-upl]').forEach(b => b.onclick = () => { store.set('okonomi.importAcc', b.dataset.upl); S.view = 'settings'; render(); window.scrollTo(0, 0); });
  document.querySelectorAll('[data-mark]').forEach(b => b.onclick = async () => {
    const [account_id, month] = b.dataset.mark.split('|'), row = { household_id: S.hh.id, account_id, month };
    const { error } = await sb.from('upload_marks').upsert(row, { onConflict: 'household_id,account_id,month' }); if (error) return alert(error.message + '\n(Har du kjørt oppdatering 010 i Supabase?)');
    S.marks = [...S.marks.filter(m => !(m.account_id === account_id && m.month === month)), row]; render();
  });
  document.querySelectorAll('[data-unmark]').forEach(b => b.onclick = async () => {
    const [account_id, month] = b.dataset.unmark.split('|');
    const { error } = await sb.from('upload_marks').delete().eq('household_id', S.hh.id).eq('account_id', account_id).eq('month', month); if (error) return alert(error.message);
    S.marks = S.marks.filter(m => !(m.account_id === account_id && m.month === month)); render();
  });
}
// Status for de siste tre månedene (under Innstillinger)
function uploadMatrixCard() {
  const cur = monthOf(today()), months = [1, 2, 3].map(n => addMonths(cur, -n));
  return `<div class="card stack"><h2 style="margin:0">Opplastingsstatus</h2><div class="mut">✅ = bankloggen er lastet opp (poster helt frem til månedsslutt) eller merket ferdig. Trykk på en ⬜ for å merke en konto uten flere poster som ferdig. Du får påminnelse i slutten av hver måned.</div>
  ${months.map(m => `<div><b>${esc(monthLabel(m))}</b><div class="flex" style="margin-top:4px">${uploadStatus({ accounts: S.accounts, txs: S.txs, marks: S.marks, month: m }).map(x => `<button class="sm chipbtn ${x.done ? 'ok' : ''}" ${x.done ? (x.via === 'manuelt' ? `data-unmark="${x.account.id}|${m}" title="Trykk for å angre"` : 'disabled') : `data-mark="${x.account.id}|${m}"`}>${x.done ? '✅' : '⬜'} ${esc(x.account.name)}</button>`).join('') || '<span class="mut">Ingen kontoer med påminnelse.</span>'}</div></div>`).join('')}</div>`;
}

// Planlagt inntekt mot budsjett for valgt måned
function incomeCard(t) {
  const act = plansForMonth(S.plans, S.month); if (!act.length) return '';
  const pl = plannedIncome(S.plans, S.month), bud = t.budget || 0, left = pl - bud;
  return `<div class="card inc"><div class="row"><b>Planlagt inntekt</b><b>${kr(pl)}</b></div>
    ${bud ? `<div class="row"><span>Budsjett</span><span>${kr(bud)}</span></div><div class="row"><span>${left >= 0 ? 'Til overs etter budsjett' : 'Budsjettet er høyere enn inntekten med'}</span><b class="${left >= 0 ? 'ok' : 'over'}">${kr(Math.abs(left))}</b></div>` : ''}
    <small class="mut">${act.map(p => esc(p.name)).join(' · ')}</small></div>`;
}
function homeView() {
  const total = S.account === 'all', budgets = total ? S.budgets : {};  // budsjettet gjelder hele husholdningen
  const items = seasonal(), f = forecast(visible(), S.month, today(), items, total ? plannedIncome(S.plans, S.month) : 0);
  const bs = budgetStatus({ byCat: f.byCat, budgets, month: S.month, today: today() });
  const free = Object.entries(f.byCat).filter(([c]) => !(budgets[c] > 0)).sort((a, b) => b[1] - a[1]);
  const t = bs.total, hasB = bs.items.length > 0, dateLbl = new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
  app(`<div class="hd"><div><div class="eyebrow">${esc(dateLbl)}</div><h1>Min økonomi</h1></div>${accountPicker()}</div>
  ${monthPicker()}${uncBanner()}${uploadCard()}
  <div class="hero">${hasB ? `<div class="hero-top"><div><div class="hero-l">${t.left >= 0 ? 'Igjen av budsjettet' : 'Over budsjettet med'}</div><div class="hero-big">${kr(Math.abs(t.left))}</div>
      <div class="hero-s">av ${kr(t.budget)} · ${Math.round(t.pct * 100)} % brukt${bs.cur ? ` · ${bs.daysLeft} dager igjen` : ''}</div></div>${ringSvg(t.pct)}</div>`
    : `<div class="hero-l">Utgifter ${bs.cur ? 'hittil' : 'i måneden'}</div><div class="hero-big">${kr(f.spent)}</div><div class="hero-s">${total ? 'Sett opp budsjett under Mer › Innstillinger for å se hvor mye som er igjen.' : 'Velg «Alle kontoer» for å se budsjettet.'}</div>`}
    <div class="hero-row"><div><span>Inntekter</span><b>${kr(f.income)}</b></div><div><span>Utgifter</span><b>${kr(f.spent)}</b></div><div><span>Differanse</span><b>${f.income - f.spent < 0 ? '−' : ''}${kr(Math.abs(f.income - f.spent))}</b></div></div></div>
  ${total ? incomeCard(t) : ''}
  ${hasB ? `<h2>Budsjett</h2>${bs.items.map(i => budgetCard(i, S.budgetMeta[i.cat]?.note, items)).join('')}` : ''}
  ${free.length ? `<h2>${hasB ? 'Uten budsjett' : 'Per kategori'}</h2><div class="card">${free.map(([c, v]) => `<details class="catd free" data-cat="${esc(c)}" ${S.openCats.has(c) ? 'open' : ''}><summary class="row"><span><span class="ico sm">${icon(c)}</span> ${esc(c)}</span><span class="flex" style="flex-wrap:nowrap"><span class="amt">${kr(v)}</span><span class="chev">›</span></span></summary><div class="cat-body">${catBody(c, items)}</div></details>`).join('')}</div>` : (!hasB ? '<div class="card mut">Ingen utgifter denne måneden.</div>' : '')}
  <h2>Prognose</h2><div class="card"><div class="mut">Månedsresultat${total ? '' : ' · ' + esc(accName(S.account))}</div><div class="big ${f.projectedNet < 0 ? 'over' : 'ok'}">${f.projectedNet < 0 ? '−' : ''}${kr(Math.abs(f.projectedNet))}</div>
  <small class="mut">Forventet ut resten av måneden: ${kr(f.projectedSpent - f.spent)} (${f.pendingFixed.length} faste poster venter).</small></div>
  ${f.outstanding ? `<div class="card">↩️ Utestående utlegg: <b>${kr(f.outstanding)}</b> til gode</div>` : ''}
  ${seasonalCard(items)}
  ${f.pendingFixed.length ? `<h2>Ventende faste utgifter</h2><div class="card">${f.pendingFixed.map(r => `<div class="row"><span>${esc(r.text)}<small>ca. den ${r.day}.</small></span><span class="amt">${kr(r.amount)}</span></div>`).join('')}</div>` : ''}
  ${total ? '' : '<p class="mut">Budsjett og varsler vises bare under «Alle kontoer».</p>'}`);
  bindMonth(); bindAccount();
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); editTx(S.txs.find(x => x.id === b.dataset.e)); });
  bindUploads();
  document.querySelectorAll('[data-sp]').forEach(b => b.onclick = ev => { ev.preventDefault(); S.storePeriod = b.dataset.sp; store.set('okonomi.storePeriod', S.storePeriod); render(); });
}

const monthName = m => new Date(m + '-01').toLocaleDateString('nb-NO', { month: 'long' });
function seasonalCard(items) {
  const cur = monthOf(today()), soon = items.filter(i => !i.paid && i.due <= nextMonths(cur, 3));
  if (!soon.length) return '';
  return `<h2>Sesongutgifter</h2><div class="card">${soon.map(i => `<div class="row"><span>${esc(i.name)}<small>${monthName(i.due)}${i.source === 'auto' ? ' · foreslått' : ''}</small></span><span class="amt">${kr(i.amount)}</span></div>`).join('')}
  <small class="mut">Sett av ca. <b>${kr(setAsidePerMonth(items, today()))}</b> i måneden for å dekke alt som forfaller det neste året.</small></div>`;
}
const nextMonths = (m, n) => { const d = new Date(m + '-01'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };

const catSelect = (sel, attrs = '') => {
  const list = cats().includes(sel) ? cats() : [...cats(), sel];
  return `<select data-cat data-orig="${esc(sel)}" ${attrs}>${list.map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">+ Ny kategori…</option></select>`;
};
// «+ Ny kategori…» i en hvilken som helst kategorivelger
document.addEventListener('change', async e => {
  const el = e.target; if (!el.matches?.('select[data-cat]') || el.value !== '__new') return;
  const name = (prompt('Navn på ny kategori:') || '').trim();
  if (!name) { el.value = el.dataset.orig; return; }
  let final = cats().find(c => c.toLowerCase() === name.toLowerCase());
  if (!final) {
    const { error } = await sb.from('categories').upsert({ household_id: S.hh.id, name }, { onConflict: 'household_id,name' });
    if (error) { alert(error.message + '\n(Har du kjørt oppdateringen i supabase/migrations?)'); el.value = el.dataset.orig; return; }
    S.customCats.push(name); final = name;
  }
  document.querySelectorAll('select[data-cat]').forEach(x => { if (![...x.options].some(o => o.value === final)) x.add(new Option(final, final), x.options[x.options.length - 1]); });
  el.value = final;
});
const KIND_LABEL = { internal: 'intern', reimbursable: 'utlegg', ignored: 'ignorert' };
const txRow = (t, extra = '') => `<div class="row" ${t.kind === 'ignored' ? 'style="opacity:.55"' : ''}><span>${esc(t.text)}<small>${[t.date, esc(nameOf(t.owner_id)), esc(accName(t.account_id)), esc(t.category)].filter(Boolean).join(' · ')}${t.kind !== 'normal' ? ` · <span class="badge">${KIND_LABEL[t.kind]}</span>` : ''}${t.share < 1 ? ` · <span class="badge">din andel ${kr(-eff(t))}</span>` : ''}</small>${t.comment ? `<details class="cm"><summary>💬 Kommentar</summary><div>${esc(t.comment)}</div></details>` : ''}</span><span class="amt ${t.amount > 0 ? 'pos' : ''}">${kr(t.amount)}${extra}</span></div>`;

// Redigeringsdialog for én post
function editTx(t) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="stack" style="min-width:min(82vw,340px)"><b>${esc(t.text)}</b><div class="mut">${t.date} · ${kr(t.amount)} · ${esc(nameOf(t.owner_id))}</div>
  <label class="stack">Type<select id="ek"><option value="normal">Vanlig post</option><option value="internal">Intern overføring (teller ikke)</option><option value="reimbursable">Utlegg (skal refunderes)</option><option value="ignored">Ignorer, f.eks. feilbetaling (teller ikke)</option></select></label>
  <label class="stack" id="ecw">Kategori ${catSelect(t.category)}</label>
  <div class="stack" id="esw"><div class="mut" style="font-size:.9rem">Min andel</div>
    <div class="flex"><button type="button" class="sm" data-sh="">Hele</button><button type="button" class="sm" data-sh="1/2">1/2</button><button type="button" class="sm" data-sh="1/3">1/3</button><button type="button" class="sm" data-sh="1/4">1/4</button></div>
    <input id="esi" value="${t.share < 1 ? shareText(t.share) : ''}" placeholder="Tom = hele beløpet. F.eks. 1/4, 25 % eller 220 kr" aria-label="Din andel"><div class="hint" id="eshint"></div></div>
  <label class="stack" id="erw" hidden><span id="erl">Utlegg for hvem/hva?</span><input id="er" value="${esc(t.reimb_for || '')}" placeholder="F.eks. Opplett"></label>
  <label class="stack">Kommentar (valgfritt)<input id="ecm" value="${esc(t.comment || '')}" placeholder="F.eks. gave til mamma"></label>
  <label id="elw"><input type="checkbox" id="el"> husk kategorien for lignende poster</label>
  <div class="flex"><button class="pri" id="esv">Lagre</button><button id="ecn">Avbryt</button><button class="sm over" id="edl" style="margin-left:auto">Slett helt</button></div></div>`;
  document.body.append(d); d.showModal();
  const $d = q => d.querySelector(q), kind = $d('#ek');
  kind.value = t.kind;
  const abs = -t.amount, canShare = () => kind.value === 'normal' && t.amount < 0;
  const shareNow = () => (canShare() ? parseShare($d('#esi').value, abs) : 1);
  const sync = () => {
    $d('#ecw').hidden = $d('#elw').hidden = kind.value !== 'normal'; $d('#esw').hidden = !canShare();
    const sh = shareNow(), partial = canShare() && sh < 1;
    $d('#erw').hidden = !(kind.value === 'reimbursable' || partial); $d('#erl').textContent = partial ? 'Hvem skal betale resten?' : 'Utlegg for hvem/hva?';
    $d('#eshint').textContent = Number.isNaN(sh) ? '⚠️ Kan ikke tolke andelen. Skriv for eksempel 1/4, 25 % eller 220 kr.' : sh < 1 ? `Du betaler ${kr(abs * sh)} av ${kr(abs)}. Resten, ${kr(abs * (1 - sh))}, skal andre betale og vises under Utlegg.` : '';
  };
  kind.onchange = sync; $d('#esi').addEventListener('input', sync); sync();
  d.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { $d('#esi').value = b.dataset.sh; sync(); });
  const done = () => { d.close(); d.remove(); render(); };
  d.onclose = () => d.remove();
  $d('#ecn').onclick = () => { d.close(); };
  $d('#esv').onclick = async () => {
    const k = kind.value, f = { kind: k, status: 'manual', comment: $d('#ecm').value.trim() || null, share: 1 };
    if (k === 'normal') f.category = $d('#ecw select').value;
    if (canShare()) { const sh = shareNow(); if (Number.isNaN(sh)) return sync(); f.share = sh; if (sh < 1 && (t.share == null || t.share === 1)) f.reimbursed = false; }
    if (k === 'reimbursable' || f.share < 1) f.reimb_for = $d('#er').value.trim();
    await patch(t.id, f);
    if (k === 'normal' && $d('#el').checked) await learn(t, f.category);
    done();
  };
  $d('#edl').onclick = async () => {
    if (!confirm('Slette posten for godt?\n\nFinnes den i en bankfil du importerer på nytt, kommer den tilbake. «Ignorer» unngår det.')) return;
    const { error } = await sb.from('transactions').delete().eq('id', t.id);
    if (error) return alert(error.message);
    S.txs = S.txs.filter(x => x.id !== t.id); done();
  };
}

function sortView() {
  const list = S.txs.filter(t => t.status === 'uncertain').slice(0, 30);
  const totalUnc = S.txs.filter(t => t.status === 'uncertain').length;
  app(`${back('tx')}<div class="flex" style="justify-content:space-between;margin-bottom:8px"><h1 style="margin:0">Sorter usikre poster</h1>${totalUnc ? '<button class="sm" id="clr">Tøm listen…</button>' : ''}</div>${totalUnc > 30 ? `<p class="mut">Viser 30 av ${totalUnc}.</p>` : ''}${list.length ? list.map(t => `<div class="card" data-id="${t.id}"><b>${esc(t.text)}</b><div class="mut">${[t.date, kr(t.amount), esc(nameOf(t.owner_id)), esc(accName(t.account_id))].filter(Boolean).join(' · ')}</div>
  <div class="flex" style="margin-top:8px">${catSelect(t.category)}<label><input type="checkbox" class="learn" checked> husk for lignende</label></div>
  <input class="cmt" placeholder="Kommentar (valgfritt), f.eks. gave til mamma" value="${esc(t.comment || '')}" style="width:100%;margin-top:8px">
  <div class="flex" style="margin-top:8px"><button class="pri sm ok-b">Lagre</button><button class="sm int">Intern overføring</button><button class="sm rei">Utlegg</button><button class="sm ign">Ignorer</button><button class="sm mor">Andel og mer…</button></div></div>`).join('') : '<div class="card">Alt er sortert 🎉</div>'}`);
  if ($('#clr')) $('#clr').onclick = clearSortDialog;
  document.querySelectorAll('[data-id]').forEach(el => {
    const id = el.dataset.id, t = S.txs.find(x => x.id === id), cm = () => ({ comment: el.querySelector('.cmt').value.trim() || null });
    el.querySelector('.ok-b').onclick = async () => {
      const category = el.querySelector('select').value;
      await patch(id, { category, status: 'manual', ...cm() });
      if (el.querySelector('.learn').checked) await learn(t, category);
      render();
    };
    el.querySelector('.int').onclick = async () => { await patch(id, { kind: 'internal', status: 'manual', ...cm() }); render(); };
    el.querySelector('.mor').onclick = () => editTx(t);
    el.querySelector('.ign').onclick = async () => { await patch(id, { kind: 'ignored', status: 'manual', ...cm() }); render(); };
    el.querySelector('.rei').onclick = async () => { const w = prompt('Utlegg for hvem/hva? (f.eks. Opplett)'); if (w == null) return; await patch(id, { kind: 'reimbursable', reimb_for: w, status: 'manual', ...cm() }); render(); };
  });
}
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
function clearSortDialog() {
  const unc = S.txs.filter(t => t.status === 'uncertain'), d = document.createElement('dialog');
  d.innerHTML = `<div class="stack" style="min-width:min(82vw,360px)"><b>Tøm sorteringslisten</b><div class="mut">${unc.length} usorterte poster.</div>
  <label class="stack">Slett usorterte poster eldre enn<input type="date" id="cd" value="${daysAgo(30)}"></label>
  <div class="mut" id="cn"></div><button class="sm over" id="cdel">Slett disse</button>
  <hr style="border:0;border-top:1px solid var(--line);width:100%"><div class="mut">Eller behold alle og godta forslagene slik de er:</div>
  <button class="sm" id="cok">Godta alle ${unc.length} som foreslått</button><button id="ccl">Avbryt</button></div>`;
  document.body.append(d); d.showModal(); d.onclose = () => d.remove();
  const q = x => d.querySelector(x), older = () => unc.filter(t => t.date < q('#cd').value);
  const prev = () => { q('#cn').textContent = `${older().length} av ${unc.length} er eldre enn datoen og slettes.`; q('#cdel').disabled = !older().length; };
  q('#cd').oninput = prev; prev(); q('#ccl').onclick = () => d.close();
  q('#cdel').onclick = async () => {
    const date = q('#cd').value, n = older().length;
    if (!date || !confirm(`Slette ${n} usorterte poster eldre enn ${date} for godt?`)) return;
    const { error } = await sb.from('transactions').delete().eq('household_id', S.hh.id).eq('status', 'uncertain').lt('date', date);
    if (error) return alert(error.message);
    S.txs = S.txs.filter(t => !(t.status === 'uncertain' && t.date < date)); d.close(); render();
  };
  q('#cok').onclick = async () => {
    if (!confirm(`Godta alle ${unc.length} poster som foreslått? De forsvinner fra sorteringslisten.`)) return;
    const { error } = await sb.from('transactions').update({ status: 'manual' }).eq('household_id', S.hh.id).eq('status', 'uncertain');
    if (error) return alert(error.message);
    S.txs.forEach(t => { if (t.status === 'uncertain') t.status = 'manual'; }); d.close(); render();
  };
}

async function learn(t, category) {
  const pattern = ruleKey(t.text); if (!pattern) return;
  await sb.from('rules').upsert({ household_id: S.hh.id, pattern, category }, { onConflict: 'household_id,pattern' });
  S.rules = [...S.rules.filter(r => r.pattern !== pattern), { pattern, category }];
  const re = compileRules([{ pattern, category }])[0].re; // bruk på andre usikre poster
  for (const o of S.txs.filter(x => x.status === 'uncertain' && x.id !== t.id && re.test(x.text))) await patch(o.id, { category, status: 'auto' });
}

function txView() {
  const nl = S.q.trim() && naturalSearch(S.q, visible(), cats());
  const list = nl ? nl.hits : visible().filter(t => monthOf(t.date) === S.month);
  app(`<h1>Poster</h1>${uncBanner()}<div style="margin-bottom:8px">${accountPicker()}</div><input id="q" style="width:100%;margin-bottom:10px" placeholder="Søk, f.eks. «restaurant i sommer»" value="${esc(S.q)}">
  ${nl ? `<div class="card"><b>${nl.hits.length} treff</b> · sum ${kr(nl.total)}</div>` : monthPicker()}
  <div class="card">${list.slice(0, 200).map(t => txRow(t, ` <button class="sm" data-e="${t.id}">✎</button>`)).join('') || '<span class="mut">Ingen poster.</span>'}</div>`);
  let timer; $('#q').oninput = e => { S.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => { txView(); const q = $('#q'); q.focus(); q.setSelectionRange(99, 99); }, 350); };
  bindMonth(); bindAccount();
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => editTx(S.txs.find(x => x.id === b.dataset.e)));
}


// ---------- Grafer ----------
const tableHtml = (head, rows) => `<details class="tbl"><summary>Vis som tabell</summary><div class="tscroll"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
const METRICS = { spent: ['Utgifter', 'spent'], income: ['Inntekt', 'income'], net: ['Overskudd', 'net'] };
function chartsView() {
  const cur = monthOf(today()), months = lastMonths(today(), 12);
  S.chartA ||= cur; S.chartB ||= addMonths(S.chartA, -1);
  const A = S.chartA, B = S.chartB, catF = S.chartCat, metric = catF === 'all' ? S.chartMetric : 'spent';
  const base = visible(), tx = catF === 'all' ? base : base.filter(t => t.category === catF);
  const ya = yearAverages(tx, today()), nM = ya.months.length;
  const opt = (sel) => [...months].reverse().map(m => `<option value="${m}" ${m === sel ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');

  // 1) valgt måned mot sammenligning, akkumulert
  const a = cumulativeSpend(tx, A, today()), b = cumulativeSpend(tx, B, today());
  const dayA = a.lastDay || a.dim, bAt = b.values[Math.min(dayA, b.dim) - 1] ?? b.total, diff = a.total - bAt, pctD = bAt ? Math.round((Math.abs(diff) / bAt) * 100) : null;
  const sameDay = a.lastDay && a.lastDay < a.dim ? 'samme dag' : 'hele måneden';
  const line = lineChartSvg({ a: { label: monthLabel(A), values: a.values }, b: { label: monthLabel(B), values: b.values }, dim: Math.max(a.dim, b.dim), title: `Akkumulert forbruk ${monthLabel(A)} mot ${monthLabel(B)}` });
  const card1 = `<div class="card"><div class="mut">Utgifter ${a.lastDay && a.lastDay < a.dim ? 'hittil' : 'i måneden'}${catF === 'all' ? '' : ' · ' + esc(catF)}</div><div class="hero-fig">${kr(a.total)}</div>
    <div class="delta ${diff <= 0 ? 'ok' : 'warn'}">${diff <= 0 ? '▼' : '▲'} ${kr(Math.abs(diff))}${pctD != null ? ` (${pctD} %)` : ''} ${diff <= 0 ? 'lavere' : 'høyere'} enn ${esc(monthLabel(B))}, ${sameDay}</div>
    <div class="legend"><span><i class="key a"></i>${esc(monthLabel(A))}</span><span><i class="key b"></i>${esc(monthLabel(B))}</span></div>${line}
    ${tableHtml(['Dag', monthLabel(A), monthLabel(B)], Array.from({ length: Math.max(a.dim, b.dim) }, (_, i) => [`${i + 1}.`, a.values[i] == null ? '–' : fmtKr(a.values[i]), b.values[i] == null ? '–' : fmtKr(b.values[i])]))}</div>`;

  // 2) siste 12 måneder med snitt
  const tot = monthTotals(tx, months), mv = m => Math.max(tot[m][METRICS[metric][1]], 0), avgV = { spent: ya.avgSpent, income: ya.avgIncome, net: ya.avgNet }[metric];
  const cols = columnsSvg({ items: months.map(m => ({ label: monthShort(m), value: mv(m), hi: m === A, tip: `${monthLabel(m)}${m === cur ? ' (hittil)' : ''}\n${METRICS[metric][0]}: ${fmtKr(tot[m][METRICS[metric][1]])}` })), avg: avgV > 0 ? avgV : null, title: `${METRICS[metric][0]} per måned, siste 12 måneder` });
  const card2 = `<div class="card"><div class="card-h"><b>Siste 12 måneder</b>${catF === 'all' ? `<div class="seg">${Object.entries(METRICS).map(([k, [l]]) => `<button data-metric="${k}" class="${k === metric ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}</div>
    <div class="legend"><span><i class="key a"></i>${esc(monthLabel(A))}</span><span><i class="key b"></i>Andre måneder</span>${avgV > 0 ? '<span><i class="key avg"></i>Snitt</span>' : ''}</div>${cols}
    <small class="mut">${nM ? `Snittet gjelder ${nM} fulle måneder${nM < 12 ? ' (så mange har dere data for)' : ''}. Inneværende måned er ikke med.` : 'Ingen fulle måneder med data ennå.'}${metric === 'net' ? ' Negativt overskudd vises som 0 i grafen.' : ''}</small>
    ${tableHtml(['Måned', METRICS[metric][0]], months.map(m => [monthLabel(m) + (m === cur ? ' (hittil)' : ''), fmtKr(tot[m][METRICS[metric][1]])]))}</div>`;

  // 3) kategorier: valgt måned mot snitt
  const ca = categoryTotals(base, A), cats = [...new Set([...Object.keys(ca), ...Object.keys(ya.byCat)])].filter(c => (ca[c] || 0) > 0 || (ya.byCat[c] || 0) > 0)
    .sort((x, y) => (ca[y] || 0) - (ca[x] || 0)).slice(0, 12), maxC = Math.max(...cats.map(c => Math.max(ca[c] || 0, ya.byCat[c] || 0)), 1);
  const ya0 = yearAverages(base, today());
  const rows = cats.map(c => { const v = ca[c] || 0, av = ya0.byCat[c] || 0, d = av ? Math.round(((v - av) / av) * 100) : null;
    return `<div class="hb" tabindex="0" data-tip="${esc(`${c}\n${monthLabel(A)}: ${fmtKr(v)}\nSnitt: ${fmtKr(av)}`)}"><div class="hb-l"><span class="ico sm">${icon(c)}</span>${esc(c)}</div>
      <div class="hb-t"><i style="width:${(v / maxC) * 100}%"></i>${av ? `<b class="tick" style="left:${(av / maxC) * 100}%"></b>` : ''}</div>
      <div class="hb-v">${kr(v)}${d != null ? `<small class="${d <= 0 ? 'ok' : 'warn'}">${d <= 0 ? '▼' : '▲'} ${Math.abs(d)} %</small>` : ''}</div></div>`; }).join('');
  const card3 = `<div class="card"><div class="card-h"><b>Kategorier: ${esc(monthLabel(A))} mot snitt</b></div>
    <div class="legend"><span><i class="key a"></i>${esc(monthLabel(A))}</span><span><i class="key tickk"></i>Snitt siste 12 mnd</span></div>${rows || '<span class="mut">Ingen utgifter å vise.</span>'}
    ${cats.length ? tableHtml(['Kategori', monthLabel(A), 'Snitt per måned'], cats.map(c => [c, fmtKr(ca[c] || 0), fmtKr(ya0.byCat[c] || 0)])) : ''}</div>`;

  // 4) alle kategorier siste 12 måneder (small multiples)
  const byMonthCat = Object.fromEntries(months.map(m => [m, categoryTotals(base, m)]));
  const topCats = Object.entries(ya0.byCat).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([c]) => c);
  const mini = topCats.map(c => { const vals = months.map(m => byMonthCat[m][c] || 0);
    return `<div class="sm"><div class="sm-h"><span><span class="ico sm">${icon(c)}</span> ${esc(c)}</span><b>${fmtK(ya0.byCat[c])}</b></div>${miniColumnsSvg({ values: vals, hiIndex: months.indexOf(A), tips: months.map((m, i) => `${c} · ${monthLabel(m)}\n${fmtKr(vals[i])}`), title: `${c} siste 12 måneder` })}<small class="mut">snitt per måned</small></div>`; }).join('');
  const card4 = topCats.length ? `<div class="card"><div class="card-h"><b>Alle kategorier siste 12 måneder</b></div><div class="legend"><span><i class="key a"></i>${esc(monthLabel(A))}</span><span><i class="key b"></i>Andre måneder</span></div><div class="smgrid">${mini}</div>
    ${tableHtml(['Kategori', ...months.map(monthShort)], topCats.map(c => [c, ...months.map(m => fmtK(byMonthCat[m][c] || 0))]))}</div>` : '';

  app(`<div class="hd"><h1>Grafer</h1>${accountPicker()}</div>
  <div class="filters"><label>Sammenlign<select id="ca">${opt(A)}</select></label><label>med<select id="cb">${opt(B)}</select></label>
    <label>Kategori<select id="cc"><option value="all">Alle</option>${cats0().map(c => `<option ${c === catF ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label></div>
  <div class="kpis"><div class="kpi"><span>Snitt utgifter</span><b>${kr(ya.avgSpent)}</b><small>per måned</small></div>${catF === 'all' ? `<div class="kpi"><span>Snitt inntekt</span><b>${kr(ya.avgIncome)}</b><small>per måned</small></div><div class="kpi"><span>Snitt overskudd</span><b>${ya.avgNet < 0 ? '−' : ''}${kr(Math.abs(ya.avgNet))}</b><small>per måned</small></div>` : ''}</div>
  ${nM ? '' : '<div class="card mut">Ingen fulle måneder med data ennå, så snittene er tomme. Importer flere måneder for å se utviklingen.</div>'}
  ${card1}${card2}${card3}${card4}`);
  $('#ca').onchange = e => { S.chartA = e.target.value; render(); };
  $('#cb').onchange = e => { S.chartB = e.target.value; render(); };
  $('#cc').onchange = e => { S.chartCat = e.target.value; render(); };
  document.querySelectorAll('[data-metric]').forEach(bn => bn.onclick = () => { S.chartMetric = bn.dataset.metric; render(); });
  bindAccount();
}
const cats0 = () => cats().filter(c => !['Lønn', 'Inntekt annet'].includes(c));

// ---------- Faste utgifter ----------
function logoHtml(label, domain) {
  const av = `<span class="av" style="--h:${avatarHue(label)}" aria-hidden="true">${esc(initials(label))}</span>`;
  return domain && S.logos ? `<span class="logo" data-av="${esc(av)}"><img src="${logoUrl(domain)}" alt="" width="40" height="40" loading="lazy"></span>` : `<span class="logo">${av}</span>`;
}
const longDate = d => `${Number(d.slice(8))}. ${monthShort(d)} ${d.slice(0, 4)}`;
const FK = {
  utgift: { title: 'Faste utgifter', paid: 'Betalt denne måneden', verb: 'Betalt', none: 'Ingen betalinger funnet', noun: 'betalinger', one: 'betaling', nothing: 'Ingen betalinger funnet ennå', add: 'Ny fast utgift',
    empty: 'Du har ikke lagt inn noen faste utgifter ennå. Trykk «+ Ny», eller velg fra forslagene under.', sugHint: 'Månedlige trekk med omtrent likt beløp. Dagligvarer og restaurant foreslås ikke.', ph: 'F.eks. Mova', cat: '' },
  giver: { title: 'Faste givertjenester', paid: 'Gitt denne måneden', verb: 'Gitt', none: 'Ingen gaver funnet', noun: 'gaver', one: 'gave', nothing: 'Ingen gaver funnet ennå', add: 'Ny givertjeneste',
    empty: 'Du har ikke lagt inn noen givertjenester ennå. Trykk «+ Ny», eller velg fra forslagene under.', sugHint: 'Månedlige gaver med omtrent likt beløp, fra kategoriene Gaver og Givertjeneste.', ph: 'F.eks. Krik', cat: 'Givertjeneste' },
};
function fixedRow(x, cur) {
  const K = FK[S.fixedKind], it = x.item, domain = domainFor(it.name) || domainFor(it.pattern), paidDate = x.payments.find(t => monthOf(t.date) === cur)?.date;
  const when = x.status === 'paid' ? `${K.verb} ${shortDate(paidDate)}` : x.status === 'upcoming' ? `Trekkes ca. den ${x.dueDay}.` : x.status === 'late' ? `⏳ Ikke trukket ennå (ventet ca. den ${x.dueDay}.)` : K.nothing;
  return `<details class="fx" data-id="${it.id}" ${S.openFixed.has(it.id) ? 'open' : ''}><summary class="srow">${logoHtml(it.name, domain)}<div class="sr-t"><b>${esc(it.name)}</b><small>${esc(when)} · ${esc(x.category)}</small></div><div class="sr-a"><b>${x.amount > 0 ? kr(x.amount) : '–'}</b><span class="chev">›</span></div></summary>
    <div class="fx-body">${x.payments.length ? `<div class="fx-sum">${x.count} ${K.noun} · ${kr(x.yearTotal)} hittil i år</div>
      ${x.payments.slice(0, 36).map(t => `<div class="row"><span>${esc(longDate(t.date))}<small>${esc(accName(t.account_id))} · ${esc(t.text)}</small></span><span class="amt">${kr(-t.amount)}</span></div>`).join('')}
      ${x.payments.length > 36 ? `<small class="mut">…og ${x.payments.length - 36} eldre</small>` : ''}` : `<div class="mut">Ingen ${K.noun} inneholder «${esc(it.pattern)}» ennå. Rediger søketeksten hvis den er feil.</div>`}
      <div class="flex" style="margin-top:8px"><button class="sm" data-fedit="${it.id}">Rediger</button><button class="sm" data-fdel="${it.id}">Fjern</button></div></div></details>`;
}
function subsView() {
  const K = FK[S.fixedKind], cur = monthOf(today()), mine = S.fixed.filter(f => f.kind === S.fixedKind), infos = mine.map(it => fixedInfo(it, S.txs, today()));
  const up = infos.filter(x => x.status === 'upcoming' || x.status === 'late').sort((a, b) => (a.status === 'late') - (b.status === 'late') || a.dueDay - b.dueDay);
  const paid = infos.filter(x => x.status === 'paid').sort((a, b) => b.lastDate.localeCompare(a.lastDate)), unk = infos.filter(x => x.status === 'unknown');
  const paidSum = paid.reduce((s, x) => s + x.amount, 0), remSum = up.reduce((s, x) => s + x.expected, 0), yearSum = infos.reduce((s, x) => s + x.yearTotal, 0);
  const sug = suggestFixed(S.txs, today(), { items: S.fixed, hidden: S.hiddenSubs, kind: S.fixedKind });
  app(`<div class="hd"><h1>${K.title}</h1><button class="pri sm" id="fnew">+ Ny</button></div>
  <div class="seg wide" role="tablist" aria-label="Velg type"><button data-fk="utgift" class="${S.fixedKind === 'utgift' ? 'on' : ''}" role="tab" aria-selected="${S.fixedKind === 'utgift'}">Utgifter</button><button data-fk="giver" class="${S.fixedKind === 'giver' ? 'on' : ''}" role="tab" aria-selected="${S.fixedKind === 'giver'}">Givertjenester</button></div>
  <div class="hero" style="margin-top:12px"><div class="hero-l">${esc(monthLabel(cur))}</div><div class="hero-big">${kr(paidSum + remSum)}</div><div class="hero-s">${kr(paidSum)} ${K.verb.toLowerCase()} · ${kr(remSum)} igjen denne måneden</div>
    <div class="hero-row"><div><span>Per måned</span><b>${kr(paidSum + remSum)}</b></div><div><span>Hittil i år</span><b>${kr(yearSum)}</b></div><div><span>Per år</span><b>${kr((paidSum + remSum) * 12)}</b></div></div></div>
  ${S.fixedKind === 'giver' ? '<div class="card mut" style="font-size:.88rem">💡 Gaver til godkjente frivillige organisasjoner kan gi skattefradrag. Sjekk at organisasjonen er godkjent, og at gaven er registrert på riktig fødselsnummer.</div>' : ''}
  ${mine.length ? '' : `<div class="card mut">${K.empty}</div>`}
  ${up.length ? `<h2>Kommende</h2><div class="card">${up.map(x => fixedRow(x, cur)).join('')}</div>` : ''}
  ${paid.length ? `<h2>${K.paid}</h2><div class="card">${paid.map(x => fixedRow(x, cur)).join('')}</div>` : ''}
  ${unk.length ? `<h2>${K.none}</h2><div class="card">${unk.map(x => fixedRow(x, cur)).join('')}</div>` : ''}
  <details class="preset" ${mine.length ? '' : 'open'}><summary><b>Forslag fra bankdata (${sug.length})</b></summary><div class="stack" style="margin-top:8px"><small class="mut">${K.sugHint}</small>
    ${sug.map((x, i) => `<div class="srow">${logoHtml(x.name, domainFor(x.name))}<div class="sr-t"><b>${esc(x.name)}</b><small>ca. den ${x.dueDay}. · ${esc(x.category)}</small></div><div class="sr-a"><b>${kr(x.amount)}</b><button class="sm pri" data-sadd="${i}">+ Legg til</button><button class="x" data-shide="${esc(x.key)}" aria-label="Skjul forslag">✕</button></div></div>`).join('') || '<div class="mut">Ingen forslag akkurat nå.</div>'}</div></details>
  <div class="card stack"><label class="chk"><input type="checkbox" id="logos" ${S.logos ? 'checked' : ''}> Vis logoer</label>
  <small class="mut">Logoene hentes fra Googles favikon-tjeneste, som da ser hvilke tjenester dere har. Skru av for å unngå det; da vises initialer i stedet.</small>
  ${S.hiddenSubs.size ? `<button class="sm" id="unhide">Vis ${S.hiddenSubs.size} skjulte forslag igjen</button>` : ''}</div>`);
  document.querySelectorAll('.logo img').forEach(img => img.addEventListener('error', () => { img.parentElement.innerHTML = img.parentElement.dataset.av; }));
  document.querySelectorAll('[data-fk]').forEach(b => b.onclick = () => { S.fixedKind = b.dataset.fk; store.set('okonomi.fixedKind', S.fixedKind); render(); });
  $('#fnew').onclick = () => fixedDialog(null, S.fixedKind);
  document.querySelectorAll('[data-fedit]').forEach(b => b.onclick = () => { const f = S.fixed.find(x => x.id === b.dataset.fedit); fixedDialog(f, f.kind); });
  document.querySelectorAll('[data-fdel]').forEach(b => b.onclick = async () => {
    const f = S.fixed.find(x => x.id === b.dataset.fdel); if (!confirm(`Fjerne «${f.name}»? Betalingene i banken beholdes.`)) return;
    const { error } = await sb.from('fixed_items').delete().eq('id', f.id); if (error) return alert(error.message); S.fixed = S.fixed.filter(x => x.id !== f.id); render();
  });
  document.querySelectorAll('[data-sadd]').forEach(b => b.onclick = async () => {
    const x = sug[Number(b.dataset.sadd)], row = { id: crypto.randomUUID(), household_id: S.hh.id, name: x.name, pattern: x.pattern, category: x.category, amount: null, day: null, kind: S.fixedKind };
    const { error } = await sb.from('fixed_items').upsert(row); if (error) return alert(error.message + '\n(Har du kjørt oppdatering 008 og 009 i Supabase?)'); S.fixed = [...S.fixed, row]; render();
  });
  document.querySelectorAll('[data-shide]').forEach(b => b.onclick = async () => {
    const { error } = await sb.from('hidden_subs').upsert({ household_id: S.hh.id, key: b.dataset.shide }, { onConflict: 'household_id,key' }); if (error) return alert(error.message); S.hiddenSubs.add(b.dataset.shide); render();
  });
  $('#logos').onchange = e => { S.logos = e.target.checked; store.set('okonomi.logos', S.logos ? '1' : '0'); render(); };
  if ($('#unhide')) $('#unhide').onclick = async () => { const { error } = await sb.from('hidden_subs').delete().eq('household_id', S.hh.id); if (error) return alert(error.message); S.hiddenSubs = new Set(); render(); };
}

function fixedDialog(f, kind) {
  const K = FK[f?.kind || kind || 'utgift'], d = document.createElement('dialog'), defCat = f ? f.category : K.cat;
  d.innerHTML = `<div class="stack" style="min-width:min(82vw,340px)"><b>${f ? 'Rediger' : K.add}</b>
  <label class="stack">Navn<input id="fn" value="${esc(f?.name || '')}" placeholder="${esc(K.ph)}"></label>
  <label class="stack">Tekst i banktrekket<input id="fp" value="${esc(f?.pattern || '')}" placeholder="F.eks. mova. Flere: claude, anthropic"></label>
  <small class="mut" style="margin-top:-6px">Start med <b>=</b> for å treffe hele teksten, f.eks. <b>=vipps: salt</b> (da telles ikke «Vipps: Salt Bergen»).</small>
  <div class="hint" id="fhint"></div>
  <label class="stack">Kategori<select id="fc"><option value="">Automatisk fra betalingene</option>${[...new Set([...cats(), ...(defCat ? [defCat] : [])])].map(c => `<option ${c === defCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
  <label class="stack">Forventet beløp (valgfritt)<input id="fa" value="${f?.amount ?? ''}" placeholder="Tom = typisk beløp fra tidligere betalinger"></label>
  <label class="stack">Forventet trekkdag (valgfritt)<input id="fd" inputmode="numeric" value="${f?.day ?? ''}" placeholder="1–31. Tom = som tidligere"></label>
  <div class="over" id="ferr"></div><div class="flex"><button class="pri" id="fsv">Lagre</button><button id="fcn">Avbryt</button></div></div>`;
  document.body.append(d); d.showModal(); d.onclose = () => d.remove();
  const q = x => d.querySelector(x); q('#fcn').onclick = () => d.close();
  const hint = () => {   // viser hva søketeksten treffer, mens du skriver
    const pays = itemPayments({ pattern: q('#fp').value }, S.txs), el = q('#fhint');
    el.innerHTML = !q('#fp').value.trim() ? 'Skriv teksten som står i banktrekket (store/små bokstaver spiller ingen rolle).' : pays.length
      ? `Fant <b>${pays.length}</b> ${pays.length === 1 ? K.one : K.noun}. Siste: ${esc(longDate(pays[0].date))}, ${kr(-pays[0].amount)} (${esc(pays[0].text.slice(0, 30))})` : '⚠️ Ingen betalinger inneholder denne teksten ennå. Du kan likevel lagre.';
  };
  q('#fp').addEventListener('input', hint); hint();
  q('#fn').addEventListener('input', () => { if (!f && !q('#fp').dataset.t) { q('#fp').value = q('#fn').value.toLowerCase(); hint(); } });   // søketekst følger navnet til du skriver egen
  q('#fp').addEventListener('keydown', () => { q('#fp').dataset.t = '1'; });
  q('#fsv').onclick = async () => {
    const name = q('#fn').value.trim(), pattern = q('#fp').value.trim(), amount = evalExpr(q('#fa').value), day = q('#fd').value.trim() === '' ? null : Number(q('#fd').value);
    if (!name) return q('#ferr').textContent = 'Gi den et navn.'; if (!pattern) return q('#ferr').textContent = 'Skriv teksten som står i banktrekket.';
    if (Number.isNaN(amount)) return q('#ferr').textContent = 'Kan ikke regne ut beløpet.'; if (day != null && !(day >= 1 && day <= 31)) return q('#ferr').textContent = 'Dagen må være mellom 1 og 31.';
    const row = { id: f?.id || crypto.randomUUID(), household_id: S.hh.id, name, pattern, category: q('#fc').value || null, amount: amount || null, day, kind: f?.kind || kind || 'utgift' };
    const { error } = await sb.from('fixed_items').upsert(row); if (error) return q('#ferr').textContent = error.message + ' (Har du kjørt oppdatering 008 og 009?)';
    S.fixed = f ? S.fixed.map(x => (x.id === f.id ? { ...x, ...row } : x)) : [...S.fixed, row]; d.close(); render();
  };
}

// ---------- Sparemål ----------
const fmtDate = d => new Date(d).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
function goalDialog(g) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="stack" style="min-width:min(82vw,340px)"><b>${g ? 'Rediger sparemål' : 'Nytt sparemål'}</b>
  <label class="stack">Navn<input id="gn" value="${esc(g?.name || '')}" placeholder="F.eks. Ferie, buffer, depositum"></label>
  <label class="stack">Målbeløp<input id="gt" value="${g ? g.target : ''}" placeholder="50 000"></label>
  <label class="stack">Spart så langt<input id="gs" value="${g ? g.saved : ''}" placeholder="0"></label>
  <label class="stack">Frist (valgfri)<input id="gd" type="date" value="${g?.deadline || ''}"></label>
  <label class="stack">Egen sparing per måned (valgfri)<input id="gm" value="${g?.monthly || ''}" placeholder="Tom = beregnes automatisk"></label>
  <div class="hint" id="ghint"></div><div class="over" id="gerr"></div>
  <div class="flex"><button class="pri" id="gsv">Lagre</button><button id="gcn">Avbryt</button></div></div>`;
  document.body.append(d); d.showModal(); d.onclose = () => d.remove();
  const q = x => d.querySelector(x); q('#gcn').onclick = () => d.close();
  const hint = () => {   // viser beløpet per måned mens du skriver
    const t = evalExpr(q('#gt').value), sv = evalExpr(q('#gs').value) || 0, m = evalExpr(q('#gm').value), dl = q('#gd').value, el = q('#ghint');
    if (!(t > 0) || Number.isNaN(sv)) { el.textContent = ''; return; }
    const p = projectGoal({ target: t, saved: sv, monthly: Number.isNaN(m) ? 0 : m || 0, fallbackRate: avgNet(S.txs, today()).avg, deadline: dl, today: today() });
    el.innerHTML = p.done ? '🎉 Målet er allerede nådd.' : p.source === 'frist' ? `Med frist ${esc(fmtDate(dl))} blir det <b>${kr(p.rate)} per måned</b> (${kr(p.remaining)} ÷ ${p.monthsLeft} ${p.monthsLeft === 1 ? 'måned' : 'måneder'}).`
      : p.source === 'plan' ? `Med ${kr(p.rate)} per måned nås målet ${p.eta ? 'ca. ' + esc(monthLabel(p.eta)) : 'aldri'}${dl && !p.onTrack ? `, men fristen krever ${kr(p.neededPerMonth)} per måned` : ''}.`
      : p.eta ? `Uten frist brukes snittet av overskuddet (${kr(p.rate)} per måned): målet nås ca. ${esc(monthLabel(p.eta))}.` : 'Legg inn en frist eller en egen sparing for å få en dato.';
  };
  ['#gt', '#gs', '#gm', '#gd'].forEach(x => q(x).addEventListener('input', hint)); hint();
  q('#gsv').onclick = async () => {
    const name = q('#gn').value.trim(), target = evalExpr(q('#gt').value), saved = evalExpr(q('#gs').value), monthly = evalExpr(q('#gm').value);
    if (!name) return q('#gerr').textContent = 'Gi målet et navn.';
    if (!(target > 0)) return q('#gerr').textContent = 'Målbeløpet må være et tall over 0.';
    if ([saved, monthly].some(Number.isNaN)) return q('#gerr').textContent = 'Kan ikke regne ut et av beløpene.';
    const row = { id: g?.id || crypto.randomUUID(), household_id: S.hh.id, name, target, saved: saved || 0, monthly: monthly || null, deadline: q('#gd').value || null };
    const { error } = await sb.from('goals').upsert(row); if (error) return q('#gerr').textContent = error.message + ' (Har du kjørt oppdatering 006?)';
    const full = { ...row, monthly: row.monthly || 0 }; S.goals = g ? S.goals.map(x => (x.id === g.id ? { ...x, ...full } : x)) : [...S.goals, full]; d.close(); render();
  };
}
function goalCard(g, avg, cuts) {
  const p = projectGoal({ target: g.target, saved: g.saved, monthly: g.monthly, fallbackRate: avg, deadline: g.deadline || '', today: today() });
  const eta = p.done ? '🎉 Målet er nådd!' : p.eta ? `Nås ca. <b>${esc(monthLabel(p.eta))}</b> (om ${p.months} ${p.months === 1 ? 'måned' : 'måneder'})` : 'Kan ikke beregne dato: det er ingen positiv sparing per måned. Legg inn en planlagt sparing.';
  return `<div class="card goal" data-g="${g.id}"><div class="bc-top"><span class="ico">🎯</span><div class="bc-name"><b>${esc(g.name)}</b><small>${kr(g.saved)} av ${kr(g.target)} · ${Math.round(p.pct * 100)} %</small></div>
    <div class="flex" style="flex-wrap:nowrap"><button class="sm" data-ge="${g.id}" aria-label="Rediger">✎</button><button class="sm" data-gd="${g.id}" aria-label="Slett">✕</button></div></div>
    <div class="meter" role="progressbar" aria-valuenow="${Math.round(p.pct * 100)}" aria-valuemin="0" aria-valuemax="100"><i class="ok" style="width:${p.pct * 100}%"></i></div>
    <div class="goal-l">${eta}</div>
    ${p.done ? '' : `<small class="mut">Sparing per måned: <b>${kr(p.rate)}</b> ${p.source === 'frist' ? `(beregnet: ${kr(p.remaining)} igjen ÷ ${p.monthsLeft} ${p.monthsLeft === 1 ? 'måned' : 'måneder'} til fristen)` : p.source === 'plan' ? '(din plan)' : '(snittet av overskuddet de siste månedene)'}</small>`}
    ${g.deadline && !p.done ? `<div class="chip ${p.onTrack ? 'good' : 'warn'}">${p.onTrack ? `✅ I rute til fristen ${esc(fmtDate(g.deadline))}` : `⚠️ Trenger ${kr(p.neededPerMonth)} per måned for å nå fristen ${esc(fmtDate(g.deadline))}`}</div>${p.source === 'frist' && avg > 0 && p.rate > avg ? `<div class="chip warn">⚠️ Det er mer enn overskuddet ditt (snitt ${kr(avg)} per måned)</div>` : ''}` : ''}
    ${p.done ? '' : `<div class="flex" style="margin-top:8px"><button class="sm pri" data-gadd="${g.id}">+ Legg til sparing</button></div>
    <details class="cm"><summary>Hva om jeg sparer mer?</summary><div class="stack" style="margin-top:6px"><div class="flex"><select data-wc>${cuts.map(([c, v]) => `<option value="${v}">Kutt i ${esc(c)} (bruker snitt ${Math.round(v).toLocaleString('nb-NO')} kr)</option>`).join('')}<option value="">Ekstra sparing</option></select>
      <input data-wa value="500" inputmode="text" style="width:100px" aria-label="Beløp per måned"><span class="mut">kr/mnd</span></div><div class="wres mut"></div></div></details>`}</div>`;
}
function goalsView() {
  const { avg, months } = avgNet(S.txs, today()), ya = yearAverages(S.txs, today());
  const cuts = Object.entries(ya.byCat).filter(([c]) => !['Lønn', 'Inntekt annet', 'Bolig'].includes(c)).sort((a, b) => b[1] - a[1]).slice(0, 6);
  app(`${back('more')}<div class="hd"><h1>Sparemål</h1><button class="pri sm" id="gnew">+ Nytt mål</button></div>
  <div class="card"><div class="mut">Overskudd per måned (snitt siste ${months || 0} fulle måneder)</div><div class="big ${avg < 0 ? 'over' : 'ok'}">${avg < 0 ? '−' : ''}${kr(Math.abs(avg))}</div>
  <small class="mut">Brukes når du ikke har lagt inn en planlagt sparing. Appen regner ut hvor mye som må spares, og når målet nås.</small></div>
  ${S.goals.map(g => goalCard(g, avg, cuts)).join('') || '<div class="card mut">Ingen sparemål ennå. Trykk «+ Nytt mål» for å lage det første, for eksempel ferie eller buffer.</div>'}`);
  $('#gnew').onclick = () => goalDialog(null);
  document.querySelectorAll('[data-ge]').forEach(b => b.onclick = () => goalDialog(S.goals.find(g => g.id === b.dataset.ge)));
  document.querySelectorAll('[data-gd]').forEach(b => b.onclick = async () => {
    const g = S.goals.find(x => x.id === b.dataset.gd); if (!confirm(`Slette sparemålet «${g.name}»?`)) return;
    const { error } = await sb.from('goals').delete().eq('id', g.id); if (error) return alert(error.message); S.goals = S.goals.filter(x => x.id !== g.id); render();
  });
  document.querySelectorAll('[data-gadd]').forEach(b => b.onclick = async () => {
    const g = S.goals.find(x => x.id === b.dataset.gadd), v = evalExpr(prompt(`Hvor mye sparte du til «${g.name}»? (regnestykker går fint)`, '') ?? '');
    if (v == null || Number.isNaN(v) || v <= 0) return;
    const saved = g.saved + v, { error } = await sb.from('goals').update({ saved }).eq('id', g.id); if (error) return alert(error.message); g.saved = saved; render();
  });
  document.querySelectorAll('.goal').forEach(card => {
    const g = S.goals.find(x => x.id === card.dataset.g), sel = card.querySelector('[data-wc]'), amt = card.querySelector('[data-wa]'), out = card.querySelector('.wres'); if (!sel) return;
    const run = () => {
      let extra = evalExpr(amt.value); if (extra == null || Number.isNaN(extra) || extra <= 0) { out.textContent = 'Skriv inn et beløp per måned.'; return; }
      const cap = Number(sel.value), note = cap && extra > cap ? ` (kuttet til snittforbruket på ${kr(cap)})` : ''; if (cap) extra = Math.min(extra, cap);
      const input = { target: g.target, saved: g.saved, monthly: g.monthly, fallbackRate: avg, deadline: g.deadline || '', today: today() };
      const b = projectGoal(input), n = projectGoal({ ...input, extra });
      out.innerHTML = !Number.isFinite(n.months) ? 'Selv med ekstra sparing er det ingen positiv sparing per måned.' : !Number.isFinite(b.months)
        ? `Med ${kr(extra)} ekstra per måned nås målet ca. <b>${esc(monthLabel(n.eta))}</b>${esc(note)}.` : n.months < b.months
        ? `Med ${kr(extra)} ekstra per måned nås målet <b>${b.months - n.months} ${b.months - n.months === 1 ? 'måned' : 'måneder'} raskere</b>: ca. <b>${esc(monthLabel(n.eta))}</b> i stedet for ${esc(monthLabel(b.eta))}${esc(note)}.` : `Ingen forskjell i dato (${esc(monthLabel(n.eta))}).`;
    };
    sel.onchange = run; amt.oninput = run; run();
  });
}

// ---------- Lønn og skatt ----------
const people = () => {
  const set = new Set(), me = S.members.find(m => m.user_id === S.user.id)?.display_name;
  if (me) set.add(me); S.accounts.forEach(a => a.person && set.add(a.person)); S.members.forEach(m => set.add(m.display_name));
  return [...set];
};
const SRC_FIELDS = [
  ['brutto_hittil', 'Brutto hittil i år', 'fra lønnsslippen'], ['skatt_hittil', 'Skatt trukket hittil i år', 'fra lønnsslippen'],
  ['maaneder', 'Antall måneder lønnsslippen dekker', 'f.eks. 10 hvis den er fra oktober. For en jobb du startet i mars: måneder siden start'],
  ['brutto_aar', 'Brutto årslønn (valgfri)', 'overstyrer utregningen fra lønnsslippen, f.eks. hvis jobben slutter'], ['trekk_pct', 'Forskuddstrekk i % (valgfri)', 'fra skattekortet, brukes hvis lønnsslipptall mangler'],
];
const DED_FIELDS = [
  ['renter', 'Renter på lån, hele året', 'trekkes fra i alminnelig inntekt'], ['fagforening', 'Fagforeningskontingent', 'fradrag opptil 8 700 kr'], ['reise', 'Reisefradrag', 'beløpet over bunnfradraget'],
  ['annet', 'Andre fradrag', ''], ['bsu', 'BSU-sparing i året', '10 % skattefradrag, maks 27 500 kr. Gjelder ikke om du eier bolig'],
];
const monthNow = () => Number(today().slice(5, 7));

// Utkast til skatteskjemaet: lagrede kilder + forslag fra bankdata (lønn gruppert per arbeidsgiver)
function taxDraft(names, by, year) {
  const draft = {};
  for (const n of names) {
    const row = S.taxInputs.find(r => r.person === n && r.year === year) || {}, auto = salarySources(by[n]?.payments || [], year, today());
    const kilder = kilderFraRad(row).map(k => ({ ...k }));
    for (const a of auto) if (!kilder.some(k => k.key === a.key)) kilder.push({ key: a.key, navn: a.navn, maaneder: year === Number(today().slice(0, 4)) ? monthNow() : 12 });
    kilder.forEach(k => { k.bank = auto.find(a => a.key === k.key) || null; });
    draft[n] = { kilder, ded: Object.fromEntries(DED_FIELDS.map(([f]) => [f, row[f]])) };
  }
  return draft;
}

// Planlagt inntekt: jobber, perioder og helgevakter. Budsjettet kan dekkes av summen.
function plansSection() {
  const cur = monthOf(today()), ser = plannedSeries(S.plans, cur, 12), tot = ser[0].total, names = [...new Set([...people(), ...S.plans.map(p => p.person)])];
  const chart = S.plans.length ? columnsSvg({ items: ser.map(x => ({ label: monthShort(x.month), value: x.total, hi: x.month === cur, tip: `${monthLabel(x.month)}\nPlanlagt: ${fmtKr(x.total)}` })), title: 'Planlagt inntekt per måned, neste 12 måneder' }) : '';
  const row = p => `<div class="row"><span>${esc(p.name)}<small>${esc(periodText(p, monthLabel))}${p.times !== 1 ? ` · ${kr(p.amount)} × ${String(Math.round(p.times * 100) / 100).replace('.', ',')} i måneden` : ''}</small></span><span class="flex" style="flex-wrap:nowrap"><span class="amt">${kr(monthlyAmount(p))}<small>/mnd</small></span><button class="sm" data-pe="${p.id}" aria-label="Rediger">✎</button></span></div>`;
  return `<h2>Planlagt inntekt</h2><div class="card stack"><div class="mut">Legg inn jobbene og lønnen fra hver (netto, utbetalt). Da kan budsjettet tas fra den samlede inntekten, og prognosen vet hva som kommer.</div>
  ${S.plans.length ? `<div><div class="mut">Denne måneden (${esc(monthLabel(cur))})</div><div class="big">${kr(tot)}</div></div>${chart}<details class="tbl"><summary>Tabell</summary>${ser.map(x => `<div class="row"><span>${esc(monthLabel(x.month))}</span><span class="amt">${kr(x.total)}</span></div>`).join('')}</details>` : ''}
  ${names.map(n => { const ps = S.plans.filter(p => p.person === n); return ps.length ? `<div><b>${esc(n)}</b>${ps.map(row).join('')}</div>` : ''; }).join('')}
  <button class="sm pri" id="penew">+ Legg til inntekt</button></div>`;
}
function bindPlans() {
  const nb = $('#penew'); if (nb) nb.onclick = () => planDialog(null);
  document.querySelectorAll('[data-pe]').forEach(b => b.onclick = () => planDialog(S.plans.find(p => p.id === b.dataset.pe)));
}
function planDialog(p) {
  const d = document.createElement('dialog'), names = people(), cur = monthOf(today()), preset = String(Math.round((p?.times ?? 1) * 1000) / 1000).replace('.', ',');
  d.innerHTML = `<div class="stack" style="min-width:min(82vw,340px)"><b>${p ? 'Rediger inntekt' : 'Ny planlagt inntekt'}</b>
  <label class="stack">Hvem<select id="pp">${[...new Set([...names, ...(p ? [p.person] : [])])].map(n => `<option ${n === (p?.person || names[0]) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
  <label class="stack">Navn<input id="pn" value="${esc(p?.name || '')}" placeholder="F.eks. Krik, Støttekontakt, Internship"></label>
  <label class="stack">Utbetalt per gang (netto)<input id="pa" inputmode="text" value="${p ? p.amount : ''}" placeholder="F.eks. 18000 eller 1200"></label>
  <div class="stack"><div class="mut">Hvor mange ganger i måneden?</div><div class="flex"><button type="button" class="sm" data-pt="1">1 gang (fast)</button><button type="button" class="sm" data-pt="26/12">Annenhver helg</button><button type="button" class="sm" data-pt="52/12">Hver helg</button></div>
  <input id="pt" inputmode="text" value="${preset}" placeholder="1"><small class="mut">Annenhver helg er 26 ÷ 12 ≈ 2,17 vakter i måneden. Du kan skrive egne regnestykker, f.eks. 3*2.</small></div>
  <div class="flex" style="flex-wrap:nowrap"><label class="stack" style="flex:1">Fra måned<input id="ps" type="month" value="${p?.start_month || cur}"></label><label class="stack" style="flex:1">Til og med<input id="pe" type="month" value="${p?.end_month || ''}"></label></div>
  <small class="mut" style="margin-top:-6px">La «Til og med» stå tom hvis inntekten ikke har noen sluttdato.</small>
  <div class="hint" id="phint"></div><div class="over" id="perr"></div>
  <div class="flex"><button class="pri" id="psv">Lagre</button><button id="pcn">Avbryt</button>${p ? '<button id="pdel" class="danger">Slett</button>' : ''}</div></div>`;
  document.body.append(d); d.showModal(); d.onclose = () => d.remove();
  const q = x => d.querySelector(x); q('#pcn').onclick = () => d.close();
  const val = () => ({ amount: evalExpr(q('#pa').value), times: evalExpr(q('#pt').value, 4) || 1, s: q('#ps').value, e: q('#pe').value });
  const hint = () => {
    const v = val(), el = q('#phint'); if (!(v.amount > 0)) { el.textContent = ''; return; }
    const m = Math.round(v.amount * v.times), n = v.s && v.e ? monthsBetween(v.s, v.e) + 1 : 0;
    el.innerHTML = `Dette gir <b>${kr(m)} i måneden</b>${n > 0 ? `, totalt ${kr(m * n)} over ${n} ${n === 1 ? 'måned' : 'måneder'}` : v.e ? '' : ', løpende'}.`;
  };
  d.querySelectorAll('[data-pt]').forEach(b => b.onclick = () => { q('#pt').value = b.dataset.pt === '1' ? '1' : String(Math.round(evalExpr(b.dataset.pt, 4) * 1000) / 1000).replace('.', ','); hint(); });
  ['#pa', '#pt', '#ps', '#pe'].forEach(x => q(x).addEventListener('input', hint)); hint();
  q('#psv').onclick = async () => {
    const v = val(), name = q('#pn').value.trim();
    if (!name) return q('#perr').textContent = 'Gi inntekten et navn.';
    if (Number.isNaN(v.amount) || !(v.amount >= 0) || q('#pa').value.trim() === '') return q('#perr').textContent = 'Beløpet må være et tall.';
    if (Number.isNaN(v.times) || v.times <= 0) return q('#perr').textContent = 'Antall ganger må være over 0.';
    if (!v.s) return q('#perr').textContent = 'Velg hvilken måned inntekten starter.';
    if (v.e && v.e < v.s) return q('#perr').textContent = 'Sluttmåneden kan ikke være før startmåneden.';
    const row = { id: p?.id || crypto.randomUUID(), household_id: S.hh.id, person: q('#pp').value, name, amount: v.amount, times: Math.round(v.times * 1000) / 1000, start_month: v.s, end_month: v.e || null };
    const { error } = await sb.from('income_plans').upsert(row); if (error) return q('#perr').textContent = error.message + ' (Har du kjørt oppdatering 011?)';
    S.plans = p ? S.plans.map(x => (x.id === p.id ? row : x)) : [...S.plans, row]; d.close(); render();
  };
  if (p) q('#pdel').onclick = async () => { if (!confirm(`Slette «${p.name}»?`)) return; const { error } = await sb.from('income_plans').delete().eq('id', p.id); if (error) return alert(error.message); S.plans = S.plans.filter(x => x.id !== p.id); d.close(); render(); };
}
function lonnView() {
  const year = S.year, by = salaryByPerson(S.txs, year, S.accounts, S.members, today()), names = [...new Set([...people(), ...Object.keys(by)])];
  const sum = names.reduce((s, n) => s + (by[n]?.ytd || 0), 0), ppl = names;
  const draft = taxDraft(names, by, year);
  const srcHtml = (n, k) => `<div class="src" data-key="${esc(k.key)}"><div class="src-h"><input data-sf="navn" value="${esc(k.navn || '')}" placeholder="Navn, f.eks. arbeidsgiver" aria-label="Navn på inntektskilde"><button class="x" data-rm="${esc(k.key)}" data-p="${esc(n)}" aria-label="Fjern inntektskilde" title="Fjern">✕</button></div>
    ${k.bank ? `<small class="mut">Fra banken hittil i år: ${kr(k.bank.netto)} netto (${k.bank.count} utbetalinger)</small>` : '<small class="mut">Ikke funnet i banken (f.eks. lagt inn for hånd)</small>'}
    <div class="stack" style="margin-top:6px">${SRC_FIELDS.map(([f, l, h]) => `<label class="stack">${l}<input data-sf="${f}" inputmode="text" placeholder="${esc(h)}" value="${esc(k[f] ?? '')}"></label>`).join('')}</div></div>`;
  const taxForm = () => names.map(n => `<details class="preset tp" data-person="${esc(n)}" open><summary><b>${esc(n)}</b> · ${draft[n].kilder.filter(k => !k.skjult).length} inntektskilde(r)</summary><div class="stack" style="margin-top:8px">
      ${draft[n].kilder.filter(k => !k.skjult).map(k => srcHtml(n, k)).join('') || '<div class="mut">Ingen inntektskilder funnet. Legg til en under.</div>'}
      <button class="sm" data-add="${esc(n)}">+ Legg til inntektskilde</button>
      <div class="mut" style="margin-top:6px"><b>Fradrag for ${esc(n)}</b> (gjelder samlet for alle kildene)</div>
      ${DED_FIELDS.map(([f, l, h]) => `<label class="stack">${l}<input data-df="${f}" inputmode="text" placeholder="${esc(h || '0')}" value="${esc(draft[n].ded[f] ?? '')}"></label>`).join('')}</div></details>`).join('');
  app(`${back('more')}<div class="flex" style="justify-content:space-between;margin-bottom:8px"><h1 style="margin:0">Lønn</h1><div class="flex"><button class="sm" data-y="-1">‹</button><b>${year}</b><button class="sm" data-y="1">›</button></div></div>
  ${plansSection()}
  <h2>Utbetalt hittil</h2>
  <div class="card"><div class="mut">Utbetalt lønn ${year} (netto, inn på kontoene)</div><div class="big">${kr(sum)}</div></div>
  ${names.map(n => { const o = by[n]; return `<div class="card"><b>${esc(n)}</b>${o ? `<div class="big">${kr(o.ytd)}</div>
    <small class="mut">${o.payments.length} utbetalinger i ${o.monthsFound} måneder${year === Number(today().slice(0, 4)) ? ` · tilsvarer ca. ${kr(o.projected)} for hele året` : ''}</small>
    ${o.incomplete ? `<div class="mut" style="margin-top:4px">⚠️ Fant lønn i ${o.monthsFound} av ${o.elapsed} måneder. Har du importert alle? Ellers blir tallene for lave.</div>` : ''}
    <details class="cm"><summary>Se utbetalingene</summary>${o.payments.map(t => `<div class="row"><span>${esc(t.text)}<small>${t.date} · ${esc(accName(t.account_id))}</small></span><span class="flex" style="flex-wrap:nowrap"><span class="amt">${kr(t.amount)}</span>
      <select class="sp" data-t="${t.id}" title="Hvem tilhører lønnen?">${ppl.map(p => `<option ${p === n ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></span></div>`).join('')}</details>`
    : `<div class="mut">Ingen lønnsutbetalinger funnet i ${year}.</div>`}</div>`; }).join('')}
  <p class="mut">Mangler en lønn? Sett kategorien til «Lønn» på posten (Poster → ✎). Lønnen leses fra bankutskriftene dere importerer.</p>
  <h2>Skattekalkulator ${year}</h2>
  <details class="preset" id="taxinfo"><summary><b>Slik regnes det med flere inntektskilder</b></summary><div class="stack" style="margin-top:8px"><small class="mut">
    • Alle inntektene til <b>samme person</b> legges sammen, og skatten regnes på summen. Trinnskatt og trygdeavgift gjelder totalen, og <b>minstefradraget</b> (46 %, maks 95 700 kr) gis bare <b>én gang</b>, ikke per arbeidsgiver.<br>
    • Hver arbeidsgiver trekker skatt for seg etter skattekortet. Bijobber trekkes ofte for lavt, så flere kilder gir oftere restskatt.<br>
    • Dere to regnes hver for seg, men negativ alminnelig inntekt (for eksempel fra lånerenter) kan overføres til den andre (avkrysningen under).<br>
    • Lønnskilder fra banken foreslås automatisk, gruppert på hvem som betaler. Fyll inn tall fra lønnsslippen for hver kilde. Studielån og stipend fra Lånekassen er ikke skattepliktig lønn, og skal ikke legges inn.</small></div></details>
  <div class="card stack"><div class="mut">Fyll inn tallene fra <b>siste lønnsslipp for hver inntektskilde</b> («Brutto hittil i år» og «Skatt hittil i år»). Du kan skrive regnestykker.</div>
  <div id="taxform">${taxForm()}</div>
  <label><input type="checkbox" id="gift" ${S.taxInputs.find(r => r.year === year)?.gift === false ? '' : 'checked'}> Gift: underskudd i alminnelig inntekt (f.eks. fra lånerenter) overføres til ektefellen</label>
  <button class="pri" id="taxsave">Lagre tallene</button></div>
  <div id="taxres"></div>`);
  document.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { S.year += Number(b.dataset.y); render(); });
  bindPlans();
  document.querySelectorAll('select.sp').forEach(sel => sel.onchange = async () => { await patch(sel.dataset.t, { person: sel.value }); render(); });
  const num = x => (x == null || Number.isNaN(x) ? 0 : x), ev = v => evalExpr(v == null ? '' : String(v));
  const list = () => names.map(n => {
    const ks = draft[n].kilder.filter(k => !k.skjult).map(k => ({ navn: k.navn || 'Uten navn', bruttoHittil: num(ev(k.brutto_hittil)), skattHittil: num(ev(k.skatt_hittil)), maaneder: num(ev(k.maaneder)),
      bruttoAar: num(ev(k.brutto_aar)), trekkPct: num(ev(k.trekk_pct)), nettoAar: k.bank?.projected || 0 }));
    const sk = samleKilder(ks), d = Object.fromEntries(DED_FIELDS.map(([f]) => [f, num(ev(draft[n].ded[f]))]));
    return { person: n, brutto: sk.brutto, betalt: sk.betalt, kilder: sk.rader, mangler: sk.mangler, manglerSkatt: sk.manglerSkatt, ...d };
  });
  const calc = () => { const res = beregn(list(), { gift: $('#gift').checked, year }); $('#taxres').innerHTML = taxResultHtml(res, $('#gift').checked, year); };
  const bind = () => {
    document.querySelectorAll('.tp').forEach(box => {
      const n = box.dataset.person;
      box.querySelectorAll('.src').forEach(el => { const k = draft[n].kilder.find(x => x.key === el.dataset.key);
        el.querySelectorAll('[data-sf]').forEach(i => i.addEventListener('input', () => { k[i.dataset.sf] = i.value; if (i.dataset.sf !== 'navn') i.style.borderColor = Number.isNaN(ev(i.value)) ? 'var(--bad)' : ''; calc(); })); });
      box.querySelectorAll('[data-df]').forEach(i => i.addEventListener('input', () => { draft[n].ded[i.dataset.df] = i.value; i.style.borderColor = Number.isNaN(ev(i.value)) ? 'var(--bad)' : ''; calc(); }));
      box.querySelector('[data-add]').onclick = () => { draft[n].kilder.push({ key: 'm' + Date.now(), navn: '', maaneder: year === Number(today().slice(0, 4)) ? monthNow() : 12, bank: null }); redraw(); };
      box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const k = draft[n].kilder.find(x => x.key === b.dataset.rm); if (k.bank || k.key === 'legacy') k.skjult = true; else draft[n].kilder = draft[n].kilder.filter(x => x !== k); redraw(); });
    });
  };
  const redraw = () => { $('#taxform').innerHTML = taxForm(); bind(); calc(); };
  $('#gift').onchange = calc; bind(); calc();
  $('#taxsave').onclick = async () => {
    const bad = names.flatMap(n => [...draft[n].kilder.flatMap(k => SRC_FIELDS.map(([f]) => ev(k[f]))), ...DED_FIELDS.map(([f]) => ev(draft[n].ded[f]))]).some(Number.isNaN);
    if (bad) return alert('Et av tallene er ugyldig (markert rødt). Bruk bare tall og + - * / ( ).');
    const out = names.map(n => ({ household_id: S.hh.id, person: n, year, gift: $('#gift').checked,
      kilder: draft[n].kilder.map(k => ({ key: k.key, navn: k.navn || 'Uten navn', skjult: !!k.skjult, ...Object.fromEntries(SRC_FIELDS.map(([f]) => [f, ev(k[f])])) })),
      brutto_hittil: null, skatt_hittil: null, maaneder: null, brutto_aar: null, trekk_pct: null, ...Object.fromEntries(DED_FIELDS.map(([f]) => [f, ev(draft[n].ded[f])])) }));
    const { error } = await sb.from('tax_inputs').upsert(out, { onConflict: 'household_id,person,year' }); if (error) return alert(error.message + '\n(Har du kjørt oppdatering 005 og 007 i Supabase?)');
    S.taxInputs = [...S.taxInputs.filter(r => r.year !== year || !names.includes(r.person)), ...out]; $('#taxsave').textContent = 'Lagret ✓'; setTimeout(() => { const b = $('#taxsave'); if (b) b.textContent = 'Lagre tallene'; }, 1500);
  };
}
function taxResultHtml(res, gift, year) {
  const r = rulesFor(year), ukjentAar = !Object.keys({ 2026: 1 }).includes(String(year));
  const miss = res.rader.flatMap(x => [...(x.mangler || []).map(m => `${x.person}: brutto for «${m}» (bare netto fra banken er kjent)`), ...(x.manglerSkatt || []).map(m => `${x.person}: skatt trukket for «${m}»`)]);
  const verdict = !res.komplett ? `<div class="mut">Fyll inn tallene som mangler for å se om dere får igjen:${miss.length ? `<ul class="miss">${miss.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : ' <b>brutto</b> og <b>skatt trukket</b> (eller trekk-prosent) for begge.'}Har du en kilde som ikke er lønn, fjerner du den med ✕.</div>`
    : res.differanse >= 0 ? `<div class="big ok">Får igjen ca. ${kr(res.differanse)}</div>` : `<div class="big over">Må betale inn ca. ${kr(-res.differanse)}</div>`;
  return `<h2>Resultat</h2><div class="card">${verdict}
    ${res.komplett ? `<small class="mut">Beregnet skatt til sammen ${kr(res.sumSkatt)} mot ${kr(res.sumBetalt)} i forventet forskuddstrekk for hele året.</small>` : ''}</div>
  ${res.rader.map(x => `<details class="preset"><summary><b>${esc(x.person)}</b>${x.differanse == null ? '' : ` · <span class="${x.differanse >= 0 ? 'ok' : 'over'}">${x.differanse >= 0 ? 'igjen' : 'å betale'} ${kr(Math.abs(x.differanse))}</span>`}</summary>
    ${x.brutto ? `<div class="stack" style="margin-top:8px">${[
      ...(x.kilder || []).filter(k => k.brutto != null).map(k => [`Kilde: ${k.navn}`, k.brutto, `skatt trukket ${k.betalt == null ? 'ukjent' : kr(k.betalt)} · ${k.kilde}`]),
      [(x.kilder || []).filter(k => k.brutto != null).length > 1 ? 'Brutto, alle kilder samlet' : 'Brutto lønn, hele året', x.brutto], ['− Minstefradrag (46 %, maks 95 700)', -x.minste], ['− Øvrige fradrag (renter, fagforening m.m.)', -x.ovrige],
      ...(x.overfort ? [['+ Underskudd overført fra ektefelle', x.overfort]] : []), ...(x.overfortBort ? [['− Underskudd overført til ektefelle', -x.overfortBort]] : []),
      ['− Personfradrag', -Math.min(Math.max(x.almForPf, 0), r.personfradrag)], ['= Alminnelig inntekt', x.almInntekt],
      ['Skatt på alminnelig inntekt (22 %)', x.skattAlm], ['Trinnskatt', x.trinn], ['Trygdeavgift (7,6 %)', x.trygd], ...(x.bsuFradrag ? [['− BSU skattefradrag', -x.bsuFradrag]] : []),
      ['Beregnet skatt for året', x.skatt], ['Forventet skatt trukket', x.betalt]].map(([l, v, h]) => `<div class="row"><span>${l}${h ? `<small>${esc(h)}</small>` : ''}</span><span class="amt">${v == null ? '–' : kr(v)}</span></div>`).join('')}</div>`
      : '<div class="mut" style="margin-top:8px">Mangler brutto lønn.</div>'}</details>`).join('')}
  <div class="card" style="margin-top:12px"><b>Dette er et forenklet estimat, ikke skatteoppgjøret.</b>
    <small class="mut" style="display:block;margin-top:4px">Skatten regnes med klasse 1-satser for ${ukjentAar ? 'siste kjente år (2026)' : year}. Trekket i juni (feriepenger) og desember (halv skatt) fordeles ikke riktig av en enkel «× 12», så anslaget kan bomme med noen tusen kroner. Sjekk alltid mot skatteetaten.no/skattekalkulator og skattemeldingen din. Kilder:
    ${TAX_SOURCES.map(s => `<a href="${s.url}" target="_blank" rel="noopener" style="color:var(--pri)">${esc(s.name)}</a>`).join(' · ')}.
    BSU- og fagforeningstallene kommer fra sekundærkilder, og reisefradrag må du fylle inn selv.</small></div>`;
}

function reimbView() {
  const owedOpen = t => (t.kind === 'reimbursable' ? -t.amount : -t.amount * (1 - t.share));
  const list = S.txs.filter(t => t.kind === 'reimbursable' || (t.kind === 'normal' && t.amount < 0 && t.share < 1));
  const open = list.filter(t => !t.reimbursed), total = open.reduce((s, t) => s + owedOpen(t), 0);
  const groups = {}; open.forEach(t => (groups[t.reimb_for || 'Ukjent'] ||= []).push(t));
  const row = (t, btn) => `<div class="row"><span>${esc(t.text)}<small>${t.date} · ${t.kind === 'reimbursable' ? `utlegg ${kr(-t.amount)}` : `lagt ut ${kr(-t.amount)}, din andel ${kr(-eff(t))} (${shareText(t.share)})`}${t.comment ? ' · 💬 ' + esc(t.comment) : ''}</small></span>
    <span class="flex" style="flex-wrap:nowrap"><span class="amt">${kr(owedOpen(t))}</span>${btn}<button class="sm" data-e="${t.id}" aria-label="Rediger">✎</button></span></div>`;
  app(`${back('more')}<h1>Utlegg og delte poster</h1><div class="card"><div class="mut">Til gode totalt</div><div class="big">${kr(total)}</div></div>
  ${Object.entries(groups).map(([w, ts]) => `<h2>${esc(w)} · ${kr(ts.reduce((s, t) => s + owedOpen(t), 0))}</h2><div class="card">${ts.map(t => row(t, `<button class="sm" data-r="${t.id}">Betalt</button>`)).join('')}</div>`).join('')}
  ${list.some(t => t.reimbursed) ? `<h2>Oppgjort</h2><div class="card">${list.filter(t => t.reimbursed).map(t => row(t, '')).join('')}</div>` : ''}
  <p class="mut">Slik gjør du: åpne en post (✎), velg «Min andel» (f.eks. 1/2 eller 1/4) og skriv hvem som skal betale resten. Eller velg type «Utlegg» hvis du ikke skal betale noe selv. Budsjett og grafer teller bare din andel.</p>`);
  document.querySelectorAll('[data-r]').forEach(b => b.onclick = async () => { await patch(b.dataset.r, { reimbursed: true }); render(); });
  document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => editTx(S.txs.find(x => x.id === b.dataset.e)));
}

function moreHub() {
  const unc = S.txs.filter(t => t.status === 'uncertain').length;
  const tiles = [['sort', '🔀', 'Sorter', unc ? `${unc} venter` : 'Alt sortert'], ['lonn', '💼', 'Lønn og skatt', 'Planlagt inntekt, skatt'], ['reimb', '↩️', 'Utlegg og delte', 'Til gode fra andre'], ['goals', '🎯', 'Sparemål', `${S.goals.length} mål`], ['settings', '⚙️', 'Innstillinger', 'Import, budsjett, kontoer']];
  app(`<h1>Mer</h1><div class="tiles">${tiles.map(([v, ic, t, sub]) => `<button class="tile" data-go="${v}"><span class="ico">${ic}</span><b>${t}</b><small>${sub}</small></button>`).join('')}</div>
  <button class="tile wide ${store.get('okonomi.theme') === 'ellinor' ? 'on' : ''}" id="theme">🌸 Ellinor-modus: ${store.get('okonomi.theme') === 'ellinor' ? 'på (trykk for vanlig)' : 'av'}</button>
  <button class="tile wide" id="out2">Logg ut</button>`);
  $('#theme').onclick = () => { store.set('okonomi.theme', store.get('okonomi.theme') === 'ellinor' ? '' : 'ellinor'); applyTheme(); render(); };
  $('#out2').onclick = () => sb.auth.signOut();
}

function settingsView() {
  app(`${back('more')}<h1>Innstillinger</h1>${S.msg ? `<div class="card">${S.msg}</div>` : ''}
  <div class="card stack"><h2 style="margin:0">Importer kontoutskrift</h2>${S.accounts.length ? `<div class="flex"><select id="acct">${S.accounts.map(a => `<option value="${a.id}" ${a.id === store.get('okonomi.importAcc') ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
  <input type="file" id="file" accept=".csv,.xlsx,.xls,.txt"></div>
  <div class="flex"><label class="mut">Importer poster fra:</label><select id="ifrom">${[['all', 'Alle poster i filen'], ['30', 'Siste måned (30 dager)'], ['90', 'Siste 3 måneder'], ['year', 'Hele dette året'], ['custom', 'Fra dato…']].map(([k, l]) => `<option value="${k}" ${k === (store.get('okonomi.importFrom') || '30') ? 'selected' : ''}>${l}</option>`).join('')}</select><input type="date" id="idate" ${(store.get('okonomi.importFrom') || '30') === 'custom' ? '' : 'hidden'} value="${store.get('okonomi.importDate') || ''}"></div>
  <div class="mut">Velg kontoen filen kommer fra. Poster du allerede har importert, og poster eldre enn datoen, hoppes over.</div>` : '<div class="over">Ingen kontoer funnet. Kjør oppdateringen 003 i Supabase (se SETUP.md) eller legg til en konto under «Kontoer».</div>'}</div>
  <div class="card stack"><h2 style="margin:0">Budsjett per måned</h2>${presetPanel()}
  <div class="mut">Du kan skrive regnestykker, f.eks. <b>250*2</b> eller <b>14000+4000</b>. Notatet viser du under posten på oversikten.</div>
  ${cats().filter(c => !['Lønn', 'Inntekt annet'].includes(c)).map(budgetRow).join('')}<div class="over" id="berr"></div><button class="pri" id="sb">Lagre budsjett</button></div>
  ${uploadMatrixCard()}
  ${cleanupCard()}
  ${accAdmin()}
  ${catAdmin()}
  ${seasonalAdmin()}
  ${dataCheckCard()}
  <div class="card stack"><h2 style="margin:0">Varsler</h2><div class="mut">${pushStatus()}</div>
  <div class="flex"><button class="pri" id="push">Slå på varsler på denne enheten</button></div></div>
  <div class="card stack"><h2 style="margin:0">Husholdning</h2><div>Medlemmer: ${S.members.map(m => esc(m.display_name)).join(', ')}</div>
  <div>Invitasjonskode til kona: <b>${esc(S.hh.invite_code)}</b></div><button id="out">Logg ut</button></div>`);
  if ($('#ifrom')) $('#ifrom').onchange = () => { store.set('okonomi.importFrom', $('#ifrom').value); $('#idate').hidden = $('#ifrom').value !== 'custom'; };
  if ($('#idate')) $('#idate').onchange = () => store.set('okonomi.importDate', $('#idate').value);
  $('#file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const acc = S.accounts.find(a => a.id === $('#acct').value); store.set('okonomi.importAcc', acc.id);
    try { S.msg = await importFile(f, acc, importFrom()); } catch (err) { S.msg = `<span class="over">${esc(err.message)}</span>`; }
    render();
  };
  $('#sb').onclick = async () => {
    const rows = [], bad = [];
    document.querySelectorAll('.brow').forEach(r => {
      const cat = r.dataset.cat, expr = r.querySelector('.bx').value.trim(), note = r.querySelector('.bn').value.trim() || null, v = evalExpr(expr);
      if (Number.isNaN(v)) return bad.push(cat);
      rows.push({ household_id: S.hh.id, category: cat, amount: Math.max(v ?? 0, 0), formula: expr && isFormula(expr) ? expr : null, note });
    });
    if (bad.length) { $('#berr').textContent = `Kan ikke regne ut: ${bad.join(', ')}. Bruk bare tall og + - * / ( ).`; return; }
    const { error } = await sb.from('budgets').upsert(rows); if (error) return alert(error.message + '\n(Har du kjørt oppdatering 004 i Supabase?)');
    rows.forEach(r => { S.budgets[r.category] = r.amount; S.budgetMeta[r.category] = { note: r.note || '', formula: r.formula || '' }; });
    S.msg = 'Budsjett lagret.'; render();
  };
  $('#out').onclick = () => sb.auth.signOut();
  $('#push').onclick = enablePush;
  bindSeasonal(); bindCats(); bindAcc(); bindPreset(); bindBudget(); bindCleanup(); bindDataCheck(); bindUploads();
}

const budgetRow = c => {
  const m = S.budgetMeta[c] || {}, v = m.formula || (S.budgets[c] ? String(S.budgets[c]) : '');
  return `<div class="brow" data-cat="${esc(c)}"><div class="row" style="border:0;padding:6px 0 0"><span>${esc(c)}</span>
    <span class="flex" style="flex-wrap:nowrap"><span class="res mut"></span><input class="bx" data-b="${esc(c)}" value="${esc(v)}" placeholder="0" style="width:120px"></span></div>
  <input class="bn" data-n="${esc(c)}" value="${esc(m.note || '')}" placeholder="Notat: hva hører hjemme her? F.eks. Mova*2, Claude*2" style="width:100%;margin-top:4px">
  <div style="margin-top:4px"><button class="sm" data-sug="${esc(c)}">💡 Forslag fra forrige måned</button></div><div class="sugbox" hidden></div></div>`;
};
function updateRes(inp) {
  const res = inp.closest('.brow').querySelector('.res'), v = evalExpr(inp.value);
  inp.style.borderColor = Number.isNaN(v) ? 'var(--bad)' : '';
  res.textContent = v != null && !Number.isNaN(v) && isFormula(inp.value) ? `= ${kr(v)}` : '';
}
function bindBudget() {
  document.querySelectorAll('.bx').forEach(i => { i.addEventListener('input', () => updateRes(i)); updateRes(i); });
  document.querySelectorAll('[data-sug]').forEach(btn => btn.onclick = () => {
    const row = btn.closest('.brow'), box = row.querySelector('.sugbox'), cat = btn.dataset.sug;
    if (!box.hidden) { box.hidden = true; return; }
    const sg = suggestForCategory(S.txs, cat, today());
    box.hidden = false;
    if (!sg.lines.length) { box.innerHTML = '<small class="mut">Ingen utgifter i denne kategorien ennå, så det finnes ikke noe å foreslå.</small>'; return; }
    box.innerHTML = `<small class="mut">Dette brukte dere i ${monthName(sg.month)}. Fjern haken ved det som ikke skal med:</small>
      ${sg.lines.map((l, i) => `<label class="sugline"><input type="checkbox" data-i="${i}" checked><span>${esc(l.label)}</span><b>${kr(l.amount)}</b></label>`).join('')}
      <button class="pri sm" data-use></button>`;
    const use = box.querySelector('[data-use]'), picked = () => sg.lines.filter((_, i) => box.querySelector(`[data-i="${i}"]`).checked);
    const refresh = () => { const p = picked(); use.textContent = `Bruk valgte (= ${kr(p.reduce((s, l) => s + l.amount, 0))})`; use.disabled = !p.length; };
    box.onchange = refresh; refresh();
    use.onclick = () => {
      const p = picked(), inp = row.querySelector('.bx'), note = row.querySelector('.bn');
      inp.value = p.map(l => l.amount).join('+'); updateRes(inp);
      if (!note.value.trim()) note.value = p.map(l => l.label).join(' + ');
      box.hidden = true;
    };
  });
}

function presetPanel() {
  const p = STUDENT_PAR;
  return `<details class="preset"><summary><b>Bruk gjennomsnittsbudsjett: student-par</b></summary><div class="stack" style="margin-top:8px">
  <div class="card" style="margin:0"><b>Estimat, ikke offisiell parstatistikk.</b> ${esc(p.merknad)}</div>
  ${p.linjer.map(l => `<div class="row"><span>${esc(l.kategori)}<small>${esc(l.basis)} · <a href="${SOURCES[l.kilde].url}" target="_blank" rel="noopener">${esc(SOURCES[l.kilde].name)}</a></small></span><span class="amt">${kr(l.belop)}</span></div>`).join('')}
  <div class="row"><b>Sum av postene over</b><b>${kr(presetTotal(p))}</b></div>
  <small class="mut">${esc(p.ikkeDekket)}</small>
  <button class="pri" id="usepreset">Fyll inn forslaget</button><small class="mut">Fylles bare inn i feltene. Det lagres først når du trykker «Lagre budsjett».</small></div></details>`;
}
function bindPreset() {
  const b = $('#usepreset'); if (!b) return;
  b.onclick = () => { STUDENT_PAR.linjer.forEach(l => { const i = document.querySelector(`[data-b="${l.kategori}"]`); if (i) { i.value = l.belop; updateRes(i); } }); b.textContent = 'Fylt inn ✓ husk «Lagre budsjett» nederst'; };
}

function dataCheckCard() {
  const zero = S.txs.filter(t => t.amount === 0).length;
  return `<div class="card stack"><h2 style="margin:0">Datakontroll</h2><div class="mut" id="dcheck">Teller…</div>
  ${zero ? `<div class="chip warn">⚠️ ${zero} poster har beløp 0 kr (feil fra en tidlig import)</div><button class="sm over" id="zdel">Slett de ${zero} postene</button>` : '<div class="mut">✅ Ingen poster med 0 kr.</div>'}</div>`;
}
async function bindDataCheck() {
  if ($('#zdel')) $('#zdel').onclick = async () => {
    const n = S.txs.filter(t => t.amount === 0).length; if (!confirm(`Slette ${n} poster med 0 kr? De er feil og kan ikke angres.`)) return;
    const { error } = await sb.from('transactions').delete().eq('household_id', S.hh.id).eq('amount', 0); if (error) return alert(error.message);
    S.txs = S.txs.filter(t => t.amount !== 0); S.msg = `Slettet ${n} poster med 0 kr.`; render();
  };
  const { count } = await sb.from('transactions').select('id', { count: 'exact', head: true }), el = $('#dcheck'); if (!el) return;
  el.textContent = count == null ? `Poster i appen: ${S.txs.length}` : `Poster i appen: ${S.txs.length} · i databasen: ${count} ${count === S.txs.length ? '✅ like' : '⚠️ ikke like: last siden på nytt (⇧⌘R)'}`;
}

function importFrom() {
  const k = $('#ifrom').value;
  return k === 'all' ? '' : k === 'custom' ? $('#idate').value : k === 'year' ? `${today().slice(0, 4)}-01-01` : daysAgo(Number(k));
}

function cleanupCard() {
  return `<div class="card stack"><h2 style="margin:0">Rydd opp i poster</h2><div class="mut">Slett gamle poster, for eksempel etter en for stor import.</div>
  <div class="flex"><select id="cacc"><option value="all">Alle kontoer</option>${S.accounts.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
  <label class="mut">Eldre enn <input type="date" id="cdate" value="${daysAgo(30)}"></label></div>
  <div class="flex"><button class="sm" data-cd="30">30 dager</button><button class="sm" data-cd="90">3 måneder</button><button class="sm" data-cd="0">Alt</button></div>
  <div class="mut" id="cprev"></div><button class="sm over" id="cgo">Slett</button></div>`;
}
function bindCleanup() {
  const hit = () => S.txs.filter(t => ($('#cacc').value === 'all' || t.account_id === $('#cacc').value) && t.date < $('#cdate').value);
  const prev = () => { const n = hit().length; $('#cprev').textContent = `${n} poster slettes.`; $('#cgo').disabled = !n; };
  ['#cacc', '#cdate'].forEach(x => $(x).oninput = prev); prev();
  document.querySelectorAll('[data-cd]').forEach(b => b.onclick = () => { $('#cdate').value = b.dataset.cd === '0' ? daysAgo(-1) : daysAgo(Number(b.dataset.cd)); prev(); });
  $('#cgo').onclick = async () => {
    const n = hit().length, date = $('#cdate').value, acc = $('#cacc').value, label = acc === 'all' ? 'alle kontoer' : accName(acc);
    if (!n || !confirm(`Slette ${n} poster eldre enn ${date} (${label}) for godt?\n\nDette kan ikke angres.`)) return;
    let q = sb.from('transactions').delete().eq('household_id', S.hh.id).lt('date', date); if (acc !== 'all') q = q.eq('account_id', acc);
    const { error } = await q; if (error) return alert(error.message);
    S.txs = S.txs.filter(t => !((acc === 'all' || t.account_id === acc) && t.date < date)); S.msg = `Slettet ${n} poster.`; render();
  };
}

function accAdmin() {
  return `<div class="card stack"><h2 style="margin:0">Kontoer</h2>
  ${S.accounts.map(a => `<div class="row"><span>${esc(a.name)}<small>${a.bank === 'sbanken' ? 'Sbanken' : 'Nidaros'} · ${a.person ? esc(a.person) : 'felles'} · ${a.number ? esc(a.number) : 'kontonummer læres ved første import'}</small></span><span class="flex"><button class="sm" data-rem="${a.id}" title="Påminnelse om å laste opp bankloggen: ${a.remind === false ? 'av' : 'på'}" aria-label="Påminnelse ${a.remind === false ? 'av' : 'på'}">${a.remind === false ? '🔕' : '🔔'}</button><button class="sm" data-ae="${a.id}">✎</button><button class="sm" data-ad="${a.id}">✕</button></span></div>`).join('') || '<span class="mut">Ingen ennå.</span>'}
  <div class="flex"><input id="an" placeholder="Ny konto, f.eks. Sparekonto" style="flex:1 1 150px"><select id="ab"><option value="nidaros">Nidaros</option><option value="sbanken">Sbanken</option></select><button class="pri" id="aadd">Legg til</button></div></div>`;
}
function bindAcc() {
  const reload = async () => { const { data } = await sb.from('accounts').select('*').order('name'); S.accounts = data || []; render(); };
  $('#aadd').onclick = async () => {
    const name = $('#an').value.trim(); if (!name) return;
    const { error } = await sb.from('accounts').upsert({ household_id: S.hh.id, name, bank: $('#ab').value }, { onConflict: 'household_id,name' });
    if (error) return alert(error.message); reload();
  };
  document.querySelectorAll('[data-rem]').forEach(b => b.onclick = async () => {
    const a = S.accounts.find(x => x.id === b.dataset.rem), remind = a.remind === false;
    const { error } = await sb.from('accounts').update({ remind }).eq('id', a.id); if (error) return alert(error.message + '\n(Har du kjørt oppdatering 010 i Supabase?)'); a.remind = remind; render();
  });
  document.querySelectorAll('[data-ae]').forEach(b => b.onclick = async () => {
    const a = S.accounts.find(x => x.id === b.dataset.ae);
    const name = prompt('Navn på konto:', a.name); if (!name) return;
    const number = prompt('Kontonummer (valgfritt, brukes til å kjenne igjen overføringer mellom egne kontoer):', a.number || '');
    if (number === null) return;
    const person = prompt('Hvem eier kontoen? (f.eks. Jørgen eller Ellinor. La stå tomt for felles konto.) Brukes til å fordele lønn.', a.person || ''); if (person === null) return;
    const { error } = await sb.from('accounts').update({ name: name.trim(), number: number.trim() || null, person: person.trim() || null }).eq('id', a.id);
    if (error) return alert(error.message); reload();
  });
  document.querySelectorAll('[data-ad]').forEach(b => b.onclick = async () => {
    const a = S.accounts.find(x => x.id === b.dataset.ad);
    if (!confirm(`Fjerne kontoen «${a.name}»? Postene beholdes, men uten konto.`)) return;
    const { error } = await sb.from('accounts').delete().eq('id', a.id);
    if (error) return alert(error.message); await loadAll(); render();
  });
}

function catAdmin() {
  return `<div class="card stack"><h2 style="margin:0">Egne kategorier</h2>
  ${S.customCats.map(c => `<div class="row"><span>${esc(c)}</span><button class="sm" data-cd="${esc(c)}">✕</button></div>`).join('') || '<span class="mut">Ingen ennå. Du kan også velge «+ Ny kategori…» i alle kategorilister.</span>'}
  <div class="flex"><input id="cn" placeholder="Ny kategori, f.eks. Kjæledyr" style="flex:1 1 160px"><button class="pri" id="cadd">Legg til</button></div></div>`;
}
function bindCats() {
  $('#cadd').onclick = async () => {
    const name = $('#cn').value.trim(); if (!name || cats().some(c => c.toLowerCase() === name.toLowerCase())) return;
    const { error } = await sb.from('categories').upsert({ household_id: S.hh.id, name }, { onConflict: 'household_id,name' });
    if (error) return alert(error.message); S.customCats.push(name); render();
  };
  document.querySelectorAll('[data-cd]').forEach(b => b.onclick = async () => {
    if (!confirm(`Fjerne kategorien «${b.dataset.cd}»? Poster som allerede har den beholder navnet.`)) return;
    const { error } = await sb.from('categories').delete().eq('name', b.dataset.cd).eq('household_id', S.hh.id);
    if (error) return alert(error.message); S.customCats = S.customCats.filter(c => c !== b.dataset.cd); render();
  });
}

function seasonalAdmin() {
  const items = seasonal();
  return `<div class="card stack"><h2 style="margin:0">Sesongutgifter</h2>
  <div class="mut">Årlige utgifter som forsikring, avgifter og julegaver. Appen foreslår noen ut fra fjorårets poster.</div>
  ${items.map(i => `<div class="row"><span>${esc(i.name)}<small>${monthName(i.due)} · ${esc(i.category)}${i.source === 'auto' ? ' · foreslått' : ''}</small></span>
    <span class="amt">${kr(i.amount)} ${i.source === 'auto' ? `<button class="sm" data-sa="ok" data-k="${esc(i.key)}">Behold</button><button class="sm" data-sa="hide" data-k="${esc(i.key)}">Skjul</button>` : `<button class="sm" data-sa="del" data-id="${i.id}">✕</button>`}</span></div>`).join('') || '<span class="mut">Ingen ennå.</span>'}
  <div class="flex"><input id="sn" placeholder="Navn, f.eks. Julegaver" style="flex:1 1 140px"><input id="sa" type="number" inputmode="numeric" placeholder="Beløp" style="width:90px">
  <select id="sm">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${monthName('2026-' + String(i + 1).padStart(2, '0'))}</option>`).join('')}</select>${catSelect('Gaver', 'id="sc"')}<button class="pri" id="sadd">Legg til</button></div></div>`;
}
function bindSeasonal() {
  const reload = async () => { const { data } = await sb.from('seasonal_items').select('*'); S.seasonalRaw = data || []; render(); };
  $('#sadd').onclick = async () => {
    const name = $('#sn').value.trim(); if (!name) return;
    const { error } = await sb.from('seasonal_items').upsert({ household_id: S.hh.id, name, amount: Number($('#sa').value) || 0, month: Number($('#sm').value), category: $('#sc').value }, { onConflict: 'household_id,name' });
    if (error) return alert(error.message); reload();
  };
  document.querySelectorAll('[data-sa]').forEach(b => b.onclick = async () => {
    const it = seasonal().find(i => (b.dataset.id ? i.id === b.dataset.id : i.key === b.dataset.k));
    const op = b.dataset.sa;
    const q = op === 'del' ? sb.from('seasonal_items').delete().eq('id', it.id)
      : op === 'hide' ? sb.from('seasonal_items').upsert({ household_id: S.hh.id, name: it.key, ignore: true, amount: 0 }, { onConflict: 'household_id,name' })
      : sb.from('seasonal_items').upsert({ household_id: S.hh.id, name: it.name, amount: it.amount, month: Number(it.due.slice(5)), category: it.category }, { onConflict: 'household_id,name' });
    const { error } = await q; if (error) return alert(error.message); reload();
  });
}

// ---------- push ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function pushStatus() {
  if (!pushSupported()) return 'Denne nettleseren støtter ikke push. På iPhone må appen først legges på Hjem-skjerm (Del → Legg til på Hjem-skjerm) og åpnes derfra.';
  return Notification.permission === 'granted' ? 'Varsler er tillatt på denne enheten. Du får beskjed om budsjettoverskridelser, sesongutgifter og poster som venter på sortering.' : Notification.permission === 'denied' ? 'Varsler er blokkert i enhetens innstillinger.' : 'Få beskjed om budsjettoverskridelser, sesongutgifter og poster som venter på sortering.';
}
const b64 = s => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function enablePush() {
  try {
    if (!pushSupported()) throw new Error(pushStatus());
    if (await Notification.requestPermission() !== 'granted') throw new Error('Varsler ble ikke tillatt.');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: S.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth });
    if (error) throw error;
    await reg.showNotification('Varsler er på ✅', { body: 'Du får beskjed når noe krever oppmerksomhet.', icon: 'icons/icon.svg' });
    S.msg = 'Varsler er slått på på denne enheten.';
  } catch (e) { S.msg = `<span class="over">${esc(e.message)}</span>`; }
  render();
}
const notifyServer = () => sb.functions.invoke('notify').catch(() => {}); // stille feil hvis funksjonen ikke er satt opp

async function reclassifyInternal() {
  const own = new Set(S.accounts.map(a => a.number).filter(Boolean));
  const todo = S.txs.filter(t => t.kind === 'normal' && t.status !== 'manual' && t.from_acc && t.to_acc && own.has(t.from_acc) && own.has(t.to_acc));
  await Promise.all(todo.map(t => patch(t.id, { kind: 'internal', status: 'auto' })));
  return todo.length;
}

async function importFile(file, acc, from = '') {
  let rows;
  if (/\.xlsx?$/i.test(file.name)) {
    if (!window.XLSX) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('Kunne ikke laste Excel-leser.')); document.head.append(s); });
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  } else rows = parseCSV(await file.text());
  const all = parseRows(rows, acc.bank), parsed = from ? all.filter(t => t.date >= from) : all;
  parsed.meta = all.meta;

  // Vern mot feil konto, og lær kontonummeret første gang
  const fileNo = parsed.meta?.accountNumber;
  if (fileNo) {
    if (acc.number && acc.number !== fileNo) throw new Error(`Filen er fra konto ${fileNo}, men «${acc.name}» har kontonummer ${acc.number}. Velg riktig konto og prøv igjen.`);
    if (!acc.number) {
      const other = S.accounts.find(a => a.number === fileNo && a.id !== acc.id);
      if (other) throw new Error(`Filen er fra konto ${fileNo}, som allerede er «${other.name}». Velg den kontoen.`);
      const { error } = await sb.from('accounts').update({ number: fileNo }).eq('id', acc.id); if (error) throw error;
      acc.number = fileNo;
    }
  }
  // Poster med 0 kr er aldri riktige: de kommer fra en tidlig import som ikke leste «Ut av konto». Fjernes før ny import.
  const zero = S.txs.filter(t => t.account_id === acc.id && t.amount === 0);
  if (zero.length) {
    const { error } = await sb.from('transactions').delete().eq('household_id', S.hh.id).eq('account_id', acc.id).eq('amount', 0); if (error) throw error;
    S.txs = S.txs.filter(t => !(t.account_id === acc.id && t.amount === 0));
  }
  const mine = S.txs.filter(t => t.account_id === acc.id), have = new Map(mine.map(t => [t.hash, t])), known = t => have.has(t.hash) || (t.legacyHash && have.has(t.legacyHash));
  const rules = compileRules(S.rules), names = people(), ownNumbers = new Set(S.accounts.map(a => a.number).filter(Boolean));
  const fresh = parsed.filter(t => !known(t)).map(t => {
    const c = categorize(t, rules, names, ownNumbers);
    return { household_id: S.hh.id, owner_id: S.user.id, account_id: acc.id, bank: t.bank, date: t.date, text: t.text, amount: t.amount, hash: t.hash,
      category: c.category, status: c.status, kind: c.kind, from_acc: t.from || null, to_acc: t.to || null };
  });
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await sb.from('transactions').upsert(fresh.slice(i, i + 500), { onConflict: 'household_id,account_id,hash', ignoreDuplicates: true });
    if (error) throw error;
  }
  // Eldre poster mangler avsender/mottakerkonto: fyll inn fra filen
  const fill = parsed.filter(t => have.has(t.hash) && (t.from || t.to) && !have.get(t.hash).from_acc);
  await Promise.all(fill.map(t => sb.from('transactions').update({ from_acc: t.from || null, to_acc: t.to || null }).eq('id', have.get(t.hash).id)));
  await loadAll();
  const internal = await reclassifyInternal();
  notifyServer();
  const unc = fresh.filter(t => t.status === 'uncertain').length;
  return `${zero.length ? `Fjernet <b>${zero.length}</b> feilaktige poster med 0 kr fra en tidligere import. ` : ''}Importerte <b>${fresh.length}</b> nye poster til «${esc(acc.name)}» (${parsed.length - fresh.length} fantes fra før${all.length > parsed.length ? `, ${all.length - parsed.length} eldre enn ${from} hoppet over` : ''}). <b>${unc}</b> trenger sortering under «Sorter».${internal ? ` ${internal} overføringer mellom egne kontoer ble merket som interne.` : ''}`;
}

// ---------- start ----------
// Viktig: ingen databasekall rett i selve callbacken – supabase-js holder en lås der, og kallene ville ventet på den for alltid.
// setTimeout slipper låsen først.
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
  const user = session?.user ?? null;
  // Ved sidelasting med lagret innlogging sender Supabase både SIGNED_IN og INITIAL_SESSION, og SIGNED_IN igjen når fanen får fokus.
  if (user && S.user?.id === user.id && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) return;
  S.user = user;
  setTimeout(async () => {
    try { if (S.user) await loadAll(); else S.hh = null; } catch (e) { $('#app').textContent = 'Feil: ' + e.message; return; }
    render();
  }, 0);
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
