import assert from 'node:assert/strict';
import { parseCSV, parseRows, parseNumber, parseDate } from '../lib/parse.js';
import { compileRules, categorize, ruleKey, isHouseholdPerson } from '../lib/categorize.js';
import { seasonalItems, setAsidePerMonth, nextDueMonth, detectAnnual } from '../lib/seasonal.js';
import { planNotifications } from '../lib/notify.js';
import { monthSummary, forecast, detectRecurring, budgetAlerts, naturalSearch } from '../lib/analysis.js';

assert.equal(parseNumber('-1 234,50'), -1234.5);
assert.equal(parseNumber('1.234,50'), 1234.5);
assert.equal(parseDate('05.10.2026'), '2026-10-05');

// Nidaros-lignende (semikolon, Inn/Ut-kolonner, støy over overskrift)
const nid = `Konto 1234.56.78901;;;\nDato;Beskrivelse;Rentedato;Ut fra konto;Inn på konto\n01.10.2026;REMA 1000 MAJORSTUEN;01.10.2026;"1 234,50";\n02.10.2026;Lønn Opplett AS;02.10.2026;;45000,00\n02.10.2026;Overføring mellom egne kontoer;02.10.2026;5000,00;\n03.10.2026;Ukjent Butikk;03.10.2026;100,00;\n03.10.2026;Ukjent Butikk;03.10.2026;100,00;`;
const a = parseRows(parseCSV(nid), 'nidaros');
assert.equal(a.length, 5);
assert.equal(a[0].amount, -1234.5);
assert.notEqual(a[3].hash, a[4].hash); // like poster beholdes
// Sbanken-lignende
const sb = `Transaksjonsdato;Beskrivelse;Beløp\n2026-10-04;Netflix;-129,00`;
assert.equal(parseRows(parseCSV(sb), 'sbanken')[0].amount, -129);

const rules = compileRules([{ pattern: 'ukjent butikk', category: 'Fritid' }]);
const c = a.map(t => ({ ...t, ...categorize(t, rules) }));
assert.equal(c[0].category, 'Mat'); assert.equal(c[1].category, 'Lønn');
assert.equal(c[2].kind, 'internal'); assert.equal(c[3].category, 'Fritid');
assert.equal(categorize({ text: 'Zzz', amount: -5 }, compileRules()).status, 'uncertain');

// Prognose med fast utgift
const mk = (date, text, amount, category = 'Annet', kind = 'normal') => ({ date, text, amount, category, kind });
const txs = [
  mk('2026-08-05', 'Netflix', -129, 'Abonnement'), mk('2026-09-05', 'Netflix', -129, 'Abonnement'),
  mk('2026-08-25', 'Lønn', 40000, 'Lønn'), mk('2026-09-25', 'Lønn', 40000, 'Lønn'),
  mk('2026-10-02', 'REMA 1000', -600, 'Mat'), mk('2026-10-03', 'Utlegg aktivitet', -500, 'Fritid', 'reimbursable'),
];
assert.equal(detectRecurring(txs, '2026-10').some(r => r.key === 'netflix'), true);
const f = forecast(txs, '2026-10', '2026-10-10');
assert.equal(f.spent, 600); assert.equal(f.outstanding, 500);
assert.ok(f.pendingFixed.some(r => r.key === 'netflix'));
assert.ok(f.projectedIncome === 40000);
assert.equal(budgetAlerts({ Mat: 900 }, { Mat: 1000 })[0].level, 'warn');
assert.equal(naturalSearch('hva brukte vi på mat i august', txs, ['Mat', 'Fritid']).hits.length, 0);


// --- Sesongutgifter ---
assert.equal(nextDueMonth(12, '2026-10'), '2026-12');
assert.equal(nextDueMonth(3, '2026-10'), '2027-03');
assert.equal(nextDueMonth(10, '2026-10'), '2026-10');
const yr = [mk('2025-11-15', 'Gjensidige Forsikring bil', -8400, 'Forsikring'), mk('2026-05-02', 'Stor engangskjøp', -3000, 'Annet'),
  mk('2025-12-10', 'Julegaver Kid', -2000, 'Gaver')];
assert.deepEqual(detectAnnual(yr, '2026-10').map(a => a.key), ['gjensidige forsikring']); // engangskjøp 5 mnd siden og julegave 10 mnd siden er ikke årlige
let items = seasonalItems(yr, [{ id: 'x', name: 'Julegaver', amount: 6000, month: 12, category: 'Gaver' }], '2026-10-17');
assert.equal(items.length, 2);
assert.equal(items.find(i => i.name === 'Julegaver').due, '2026-12');
assert.equal(items.find(i => i.source === 'auto').due, '2026-11');
// Skjul foreslått
items = seasonalItems(yr, [{ name: 'gjensidige forsikring', ignore: true }], '2026-10-17');
assert.equal(items.length, 0);
// Sett av: 8400/1 + 6000/2
items = seasonalItems(yr, [{ id: 'x', name: 'Julegaver', amount: 6000, month: 12, category: 'Gaver' }], '2026-10-17');
assert.equal(Math.round(setAsidePerMonth(items, '2026-10-17')), 8400 / 1 + 3000);
// Prognose inkluderer ubetalt sesongutgift, men ikke betalt
const sj = [{ name: 'Forsikring', key: 'forsikring', amount: 5000, category: 'Forsikring', due: '2026-10', paid: false }];
assert.equal(forecast(txs, '2026-10', '2026-10-10', sj).projectedSpent - forecast(txs, '2026-10', '2026-10-10').projectedSpent, 5000);
assert.equal(forecast(txs, '2026-10', '2026-10-10', [{ ...sj[0], paid: true }]).seasonalDue.length, 0);
// Betalt-detektering via kategori
const paidTx = [...yr, mk('2026-10-05', 'Tryg', -4800, 'Forsikring')];
assert.equal(seasonalItems(paidTx, [{ id: 'f', name: 'Bilforsikring', amount: 5000, month: 10, category: 'Forsikring' }], '2026-10-17')[0].paid, true);

// --- Varsler ---
const nt = [mk('2026-10-02', 'REMA', -900, 'Mat'), mk('2026-10-03', 'Kiwi', -300, 'Mat')];
let plan = planNotifications({ txs: nt, budgets: { Mat: 1000 }, manual: [], today: '2026-10-10' });
assert.equal(plan.length, 1); assert.match(plan[0].title, /over budsjett/i);
// Allerede sendt → ingen dobbelvarsel
assert.equal(planNotifications({ txs: nt, budgets: { Mat: 1000 }, manual: [], today: '2026-10-10', sent: new Set([plan[0].key]) }).length, 0);
// 80 %-varsel, ikke når 100 % allerede er sendt
const w = planNotifications({ txs: [mk('2026-10-02', 'REMA', -850, 'Mat')], budgets: { Mat: 1000 }, manual: [], today: '2026-10-10' });
assert.match(w[0].key, /warn$/);
// Sesongvarsel måneden før
plan = planNotifications({ txs: [], budgets: {}, manual: [{ id: 'x', name: 'Julegaver', amount: 6000, month: 11, category: 'Gaver' }], today: '2026-10-17' });
assert.match(plan[0].title, /neste måned: Julegaver/);
// Nytt budsjettvarsel neste måned → ny nøkkel
assert.notEqual(planNotifications({ txs: [mk('2026-11-02', 'REMA', -1200, 'Mat')], budgets: { Mat: 1000 }, manual: [], today: '2026-11-05' })[0].key, planNotifications({ txs: nt, budgets: { Mat: 1000 }, manual: [], today: '2026-10-10' })[0].key);
console.log('alle tester OK');

// --- Nidaros uten overskrift (utdrag av ekte eksport, navn/kontonumre byttet ut) ---
const T = '\t';
const nidaros = [
  ['1111.11.11111', '17/10/2026', '26/10/2026', '-40,23', '-40,23', '', '', '', '', ''],
  ['', 'REMA 1000 NATTLAND ', '1111.11.11111', '', '-441,71', '', '', '14/10/2026', '15/10/2026', '14/10/2026', '3288888865'],
  ['', 'Avtalegiro til GJENSIDIGE FORSIKRING ASA Betalingsdato 15-10-2026', '1111.11.11111', '6005.06.08460', '-166,00', '', '', '30/09/2026', '15/10/2026', '15/10/2026', '3143102345'],
  ['', 'Avtalegiro til TELENOR ASA Betalingsdato 15-10-2026', '1111.11.11111', '6005.06.08461', '-239,00', '', '', '30/09/2026', '15/10/2026', '15/10/2026', '3143016792'],
  ['', 'Overføring  Iflg. melding nr. Ola Nordmann Betalingsdato', '1111.11.22222', '1111.11.11111', '1 000,00', '', '', '14/10/2026', '14/10/2026', '14/10/2026', '6254195603'],
  ['Vipps', 'Straksbetaling fra Kari Hansen', '', '1111.11.11111', '142,00', '', '', '13/10/2026', '13/10/2026', '13/10/2026', 'NX20257949'],
  ['', 'COOP OBS BYGG MIDTUN 6639 ', '1111.11.11111', '', '-1 838,50', '', '', '10/10/2026', '13/10/2026', '10/10/2026', '7285070540'],
  ['', 'ALLTID OPPLETT ', '1111.11.11111', '', '-135,00', '', '', '06/10/2026', '07/10/2026', '06/10/2026', '0020065744'],
  ['', 'ALLTID OPPLETT ', '1111.11.11111', '', '-135,00', '', '', '06/10/2026', '07/10/2026', '06/10/2026', '0020065715'],
];
for (const rows of [nidaros, parseCSV(nidaros.map(r => r.join(T)).join('\n'))]) { // som matrise (Excel) og som tab-CSV
  const n = parseRows(rows, 'nidaros');
  assert.equal(n.length, 8, 'sammendragslinjen skal hoppes over');
  assert.equal(n[0].amount, -441.71); assert.equal(n[0].date, '2026-10-14');
  assert.equal(n[1].date, '2026-10-15');                       // transaksjonsdato, ikke forfall
  assert.equal(n[3].amount, 1000);                             // «1 000,00»
  assert.equal(n[4].text, 'Straksbetaling fra Kari Hansen – Vipps');
  assert.equal(n[5].amount, -1838.5);
  assert.notEqual(n[6].hash, n[7].hash);                       // to like utgifter samme dag beholdes
  const cat = n.map(t => ({ ...t, ...categorize(t, compileRules(), ['Ola']) }));
  assert.equal(cat[0].category, 'Mat'); assert.equal(cat[1].category, 'Forsikring');
  assert.equal(cat[3].kind, 'internal');                       // overføring fra egen konto
  assert.equal(cat[5].category, 'Bolig');                      // OBS Bygg er ikke mat
}
// Excel-datoer som Date-objekter havner på riktig dag selv med tidssoneforskyvning
assert.equal(parseDate(new Date(Date.UTC(2026, 9, 14, 22, 0, 0))), '2026-10-15');
assert.equal(parseDate(new Date(Date.UTC(2026, 9, 14, 0, 0, 0))), '2026-10-14');
// Nøkler: avtalegiro til ulike mottakere skal ikke bli samme faste post
assert.notEqual(ruleKey('Avtalegiro til GJENSIDIGE FORSIKRING ASA Betalingsdato 15-10-2026'), ruleKey('Avtalegiro til TELENOR ASA Betalingsdato 15-10-2026'));
assert.equal(ruleKey('Straksbetaling fra Kari Hansen – Vipps'), 'kari hansen');
console.log('Nidaros-format OK');

// --- Ignorerte poster teller ikke ---
const ig = [mk('2026-10-02', 'Vipps feil', 142, 'Inntekt annet', 'ignored'), mk('2026-10-03', 'Rema', -100, 'Mat')];
assert.equal(monthSummary(ig, '2026-10').income, 0); assert.equal(monthSummary(ig, '2026-10').spent, 100);
console.log('ignorering OK');

// --- Kontonummer, interne overføringer mellom egne kontoer, budsjettforslag ---
import { STUDENT_PAR, presetTotal, SOURCES } from '../lib/presets.js';
const nn = parseRows(nidaros, 'nidaros');
assert.equal(nn.meta.accountNumber, '1111.11.11111');
assert.equal(nn[3].from, '1111.11.22222'); assert.equal(nn[3].to, '1111.11.11111');
const own = new Set(['1111.11.11111', '1111.11.22222']);
assert.equal(categorize(nn[3], compileRules(), [], own).kind, 'internal');       // begge kontoer er våre
assert.notEqual(categorize(nn[3], compileRules(), [], new Set(['1111.11.11111'])).kind, 'internal'); // ukjent avsenderkonto
assert.equal(categorize(nn[2], compileRules(), [], own).kind, 'normal');         // avtalegiro til ekstern konto
assert.equal(STUDENT_PAR.linjer.find(l => l.kategori === 'Mat').belop, 9390);
assert.ok(STUDENT_PAR.linjer.every(l => SOURCES[l.kilde]?.url.startsWith('https://')));
assert.equal(presetTotal(STUDENT_PAR), 9390 + 1224 + 2170 + 8400 + 450);
console.log('kontoer/forslag OK');

// --- Kalkulator i budsjettfelt ---
import { evalExpr, isFormula } from '../lib/calc.js';
import { suggestForCategory, shortLabel } from '../lib/budgetsuggest.js';
const ev = [['250*2', 500], ['250 + 250', 500], ['14 000+4 000', 18000], ['2x250', 500], ['2 × 250', 500], ['(100+50)*2', 300], ['1,5*100', 150],
  ['10/4', 2.5], ['-5+10', 5], ['250 kr * 2', 500], ['1 234,50', 1234.5], ['4000', 4000], ['2*(3+4)*5', 70]];
for (const [e, v] of ev) assert.equal(evalExpr(e), v, e);
assert.equal(evalExpr(''), null); assert.equal(evalExpr('   '), null);
for (const bad of ['abc', '5+', '(2', '2**3', '1/0', 'alert(1)', '5%']) assert.ok(Number.isNaN(evalExpr(bad)), bad);
assert.ok(isFormula('250*2') && isFormula('250 + 250') && !isFormula('4000') && !isFormula('1 234,50') && !isFormula('-500'));

// --- Forslag fra forrige måneds trekk ---
const bo = [mk('2026-09-05', 'Nidaros Boliglån renter', -14000, 'Bolig'), mk('2026-09-10', 'Felleskostnader Sameiet', -4000, 'Bolig'),
  mk('2026-09-12', 'Rema', -900, 'Mat'), mk('2026-08-05', 'Nidaros Boliglån renter', -13800, 'Bolig'), mk('2026-10-02', 'Husleie ny', -100, 'Bolig'),
  mk('2026-09-20', 'Overføring', -5000, 'Bolig', 'internal')];
let sg = suggestForCategory(bo, 'Bolig', '2026-10-18');
assert.equal(sg.month, '2026-09'); assert.deepEqual(sg.lines.map(l => l.amount), [14000, 4000]);
assert.equal(sg.lines.reduce((s, l) => s + l.amount, 0), 18000);          // internt og inneværende måned teller ikke
assert.equal(suggestForCategory(bo, 'Bolig', '2026-11-18').month, '2026-10');
assert.equal(suggestForCategory([bo[3]], 'Bolig', '2026-10-18').month, '2026-08'); // faller tilbake til siste måned med data
assert.equal(suggestForCategory(bo, 'Reise', '2026-10-18').lines.length, 0);
assert.equal(shortLabel('Avtalegiro til GJENSIDIGE FORSIKRING ASA Betalingsdato 15-10-2026'), 'GJENSIDIGE FORSIKRING ASA');
console.log('kalkulator/forslag OK');

// --- Skatt (håndregnet) ---
import { beregn, projiser, trinnskatt, trygdeavgift, rulesFor } from '../lib/tax.js';
import { salaryByPerson, isSalary, personOf } from '../lib/salary.js';
const R = rulesFor(2026), near = (a, b, d = 1) => assert.ok(Math.abs(a - b) <= d, `${a} ≈ ${b}`);
near(trinnskatt(400000, R.trinn), 92200 * 0.017 + 81700 * 0.04);           // 4 835,4
near(trinnskatt(200000, R.trinn), 0);
near(trinnskatt(1000000, R.trinn), 92200 * .017 + (725050 - 318300) * .04 + (980100 - 725050) * .137 + (1000000 - 980100) * .168);
near(trygdeavgift(400000, R), 30400); near(trygdeavgift(120000, R), (120000 - 99650) * 0.25); near(trygdeavgift(90000, R), 0);
// 400 000 i brutto, ingen fradrag: minstefradrag 95 700 (tak), alm. inntekt 189 760
let b = beregn([{ brutto: 400000, betalt: 90000 }], { year: 2026 }).rader[0];
near(b.minste, 95700); near(b.almInntekt, 400000 - 95700 - 114540); near(b.skattAlm, 189760 * 0.22);
near(b.skatt, 189760 * 0.22 + 30400 + 4835.4); near(b.differanse, 90000 - b.skatt);
// Student med 150 000: ingen skatt på alminnelig inntekt, bare trygdeavgift 11 400. Trukket 30 000 → får igjen
b = beregn([{ brutto: 150000, betalt: 30000 }]).rader[0];
near(b.skattAlm, 0); near(b.trygd, 11400); near(b.skatt, 11400); near(b.differanse, 18600);
// Renter gir underskudd; overføres til ektefelle når gift
let h = beregn([{ brutto: 300000, renter: 400000, betalt: 0 }, { brutto: 500000, betalt: 0 }], { gift: true });
const [a1, a2] = h.rader; assert.ok(a1.almForPf < 0);
const utenGift = beregn([{ brutto: 300000, renter: 400000, betalt: 0 }, { brutto: 500000, betalt: 0 }], { gift: false });
assert.ok(h.sumSkatt < utenGift.sumSkatt, 'gift: lavere samlet skatt når underskuddet overføres');
// håndregnet: a1 = 300 000 − 95 700 − 400 000 = −195 700. a2 = 500 000 − 95 700 = 404 300 → 208 600 etter overføring
near(a1.almForPf, -195700); near(a2.overfort, 195700); near(a2.almForPf, 208600); near(a1.overfortBort, 195700);
near(h.rader[1].almInntekt, 208600 - 114540);
// BSU: 10 % av maks 27 500 = 2 750
b = beregn([{ brutto: 400000, bsu: 50000, betalt: 0 }]).rader[0]; near(b.bsuFradrag, 2750);
// Fagforening kappes til 8 700
b = beregn([{ brutto: 400000, fagforening: 12000 }]).rader[0]; near(b.fagf, 8700);
// Projisering fra lønnsslipp: 300 000 brutto etter 10 mnd = 360 000 /år; trukket 60 000 → 72 000
let pr = projiser({ bruttoHittil: 300000, skattHittil: 60000, maaneder: 10 }); near(pr.brutto, 360000); near(pr.betalt, 72000);
pr = projiser({ nettoAar: 300000, trekkPct: 25 }); near(pr.brutto, 400000); near(pr.betalt, 100000);
pr = projiser({}); assert.equal(pr.brutto, null); assert.equal(pr.betalt, null);
assert.equal(beregn([{ brutto: 0, betalt: null }]).komplett, false);

// --- Lønn per person ---
const acc = [{ id: 'A1', person: 'Jørgen' }, { id: 'A2', person: 'Ellinor' }, { id: 'A3', person: null }];
const mem = [{ user_id: 'u1', display_name: 'Jørgen' }];
const L = (id, date, amt, accId, extra = {}) => ({ id, date, text: 'Lønn', amount: amt, category: 'Lønn', kind: 'normal', account_id: accId, owner_id: 'u1', ...extra });
const sal = [L('1', '2026-08-25', 30000, 'A1'), L('2', '2026-09-25', 31000, 'A1'), L('3', '2026-09-26', 20000, 'A2'), L('4', '2026-09-27', 5000, 'A3', { person: 'Ellinor' }),
  { ...L('5', '2026-09-20', 900, 'A1'), category: 'Mat' }, { ...L('6', '2026-09-21', -500, 'A1') }, L('7', '2025-12-20', 99, 'A1')];
assert.equal(isSalary(sal[4]), false); assert.equal(isSalary(sal[5]), false);
assert.equal(personOf(sal[3], acc, mem), 'Ellinor');
const sp = salaryByPerson(sal, 2026, acc, mem, '2026-10-18');
assert.equal(sp.Jørgen.ytd, 61000); assert.equal(sp.Jørgen.monthsFound, 2); near(sp.Jørgen.projected, 61000 / 2 * 12);
assert.equal(sp.Ellinor.ytd, 25000); assert.equal(sp.Jørgen.incomplete, true); assert.equal(salaryByPerson(sal, 2025, acc, mem, '2026-10-18').Jørgen.ytd, 99);
console.log('skatt/lønn OK');

// ===== Grafer, dynamisk budsjett, faste utgifter, logoer, sparemål =====
import { lastMonths, addMonths, monthTotals, cumulativeSpend, yearAverages, categoryTotals, niceMax, lineChartSvg, columnsSvg, miniColumnsSvg, fmtK, monthLabel } from '../lib/charts.js';
import { budgetStatus } from '../lib/dynbudget.js';
import { detectSubscriptions, subscriptionTotals, shortName } from '../lib/subscriptions.js';
import { domainFor, initials, logoUrl } from '../lib/logos.js';
import { avgNet, projectGoal } from '../lib/goals.js';

const lm = lastMonths('2026-10-18', 12);
assert.equal(lm.length, 12); assert.equal(lm[0], '2025-11'); assert.equal(lm[11], '2026-10');
assert.equal(addMonths('2026-01', -1), '2025-12'); assert.equal(monthLabel('2026-03'), 'mars 2026');
const gx = [mk('2026-09-03', 'Rema', -1000, 'Mat'), mk('2026-09-20', 'Kiwi', -500, 'Mat'), mk('2026-09-25', 'Lønn', 30000, 'Lønn'), mk('2026-09-26', 'Overf', -9999, 'Annet', 'internal'),
  mk('2026-10-02', 'Rema', -700, 'Mat'), mk('2026-10-10', 'Kino', -300, 'Fritid'), mk('2026-08-05', 'Rema', -2000, 'Mat'), mk('2026-08-25', 'Lønn', 30000, 'Lønn')];
const mt = monthTotals(gx, ['2026-08', '2026-09', '2026-10']);
assert.equal(mt['2026-09'].spent, 1500); assert.equal(mt['2026-09'].income, 30000); assert.equal(mt['2026-09'].net, 28500); // internt teller ikke
const cs = cumulativeSpend(gx, '2026-10', '2026-10-18');
assert.equal(cs.dim, 31); assert.equal(cs.lastDay, 18); assert.equal(cs.values[0], 0); assert.equal(cs.values[1], 700); assert.equal(cs.values[9], 1000); assert.equal(cs.values[17], 1000); assert.equal(cs.values[18], null);
assert.equal(cumulativeSpend(gx, '2026-09', '2026-10-18').values[29], 1500);               // ferdig måned: ingen null
assert.equal(cumulativeSpend(gx, '2026-11', '2026-10-18').lastDay, 0);
const ya = yearAverages(gx, '2026-10-18'); assert.deepEqual(ya.months, ['2026-08', '2026-09']);       // inneværende måned teller ikke
near(ya.avgSpent, (2000 + 1500) / 2); near(ya.avgIncome, 30000); near(ya.byCat.Mat, 1750);
assert.deepEqual(niceMax(0).ticks, [0, 1]); assert.deepEqual(niceMax(4200).ticks, [0, 2000, 4000, 6000]); assert.ok(niceMax(18400).top >= 18400);
assert.equal(fmtK(18400), '18,4k'); assert.equal(fmtK(950), '950');
// SVG: strukturen er riktig og tekst escapes
const sv = lineChartSvg({ a: { label: 'Okt <b>', values: cs.values }, b: { label: 'Sep', values: cumulativeSpend(gx, '2026-09', '2026-10-18').values }, dim: 31, title: 'Test' });
assert.equal((sv.match(/<svg/g) || []).length, 1); assert.equal((sv.match(/class="hit"/g) || []).length, 31); assert.ok(sv.includes('Okt &lt;b&gt;') && !sv.includes('Okt <b>'));
assert.equal((sv.match(/class="dot"/g) || []).length, 1);
const cv = columnsSvg({ items: lm.map((m, i) => ({ label: m.slice(5), value: i * 1000, tip: 't', hi: i === 11 })), avg: 5000 });
assert.equal((cv.match(/class="bar-a"/g) || []).length, 1); assert.equal((cv.match(/class="bar-b"/g) || []).length, 10); // første søyle er 0 og tegnes ikke
assert.ok(cv.includes('Snitt 5k'));
assert.ok(miniColumnsSvg({ values: [1, 2, 3], hiIndex: 2 }).includes('bar-a'));

// Dynamisk budsjett
let bs = budgetStatus({ byCat: { Mat: 900, Bolig: 500, Fritid: 50 }, budgets: { Mat: 1000, Bolig: 4000, Fritid: 40, Reise: 0 }, month: '2026-10', today: '2026-10-18' });
assert.deepEqual(bs.items.map(i => [i.cat, i.level]), [['Fritid', 'over'], ['Mat', 'warn'], ['Bolig', 'ok']]);   // Reise (0) er ikke med
near(bs.items.find(i => i.cat === 'Mat').left, 100); near(bs.items.find(i => i.cat === 'Mat').perDay, 100 / 14); assert.equal(bs.daysLeft, 14);
assert.equal(bs.items.find(i => i.cat === 'Bolig').pace, false);          // 500 på 18 dager → ~861 av 4000
near(bs.total.budget, 5040); near(bs.total.spent, 1450); near(bs.total.left, 3590);
bs = budgetStatus({ byCat: { Mat: 700 }, budgets: { Mat: 1000 }, month: '2026-10', today: '2026-10-10' });
assert.equal(bs.items[0].pace, true, '700 på 10 dager → ~2170 > 1000: ligger an til å sprenge'); assert.equal(bs.items[0].level, 'ok');
bs = budgetStatus({ byCat: { Mat: 1000 }, budgets: { Mat: 1000 }, month: '2026-10', today: '2026-10-18' });
assert.equal(bs.items[0].level, 'warn'); assert.equal(bs.items[0].used, true, 'akkurat brukt opp er ikke «over»');
assert.equal(budgetStatus({ byCat: { Mat: 1000.5 }, budgets: { Mat: 1000 }, month: '2026-10', today: '2026-10-18' }).items[0].level, 'over');
assert.equal(budgetAlerts({ Mat: 1000 }, { Mat: 1000 })[0].level, 'warn');
assert.equal(budgetStatus({ byCat: { Mat: 700 }, budgets: { Mat: 1000 }, month: '2026-09', today: '2026-10-10' }).items[0].perDay, null); // gammel måned: ingen dagsrate
assert.equal(budgetStatus({ byCat: { Mat: 700 }, budgets: { Mat: 1000 }, month: '2026-10', today: '2026-10-03' }).items[0].pace, false, 'for tidlig i måneden til å si noe');

// Faste utgifter
const fx = [];
for (const m of ['2026-07', '2026-08', '2026-09', '2026-10']) { fx.push(mk(`${m}-05`, 'NETFLIX.COM', -129, 'Abonnement')); fx.push(mk(`${m}-0${m === '2026-10' ? 3 : 4}`, 'REMA 1000 X', -(300 + (m.slice(6) * 97) % 400), 'Mat')); }
for (const m of ['2026-07', '2026-08', '2026-09']) { fx.push(mk(`${m}-25`, 'Avtalegiro til TELENOR ASA Betalingsdato 25-09-2026', -599, 'Abonnement')); fx.push(mk(`${m}-10`, 'Fjordkraft', -(800 + Number(m.slice(6)) * 10), 'Strøm')); }
fx.push(mk('2026-09-12', 'Engangs ting', -5000, 'Annet'), mk('2026-10-01', 'Gratis liten', -10, 'Annet'));
const subs = detectSubscriptions(fx, '2026-10-18'), by = Object.fromEntries(subs.map(s => [s.key, s]));
assert.ok(subs.some(s => /netflix/i.test(s.label)), 'netflix funnet'); const nf = subs.find(s => /netflix/i.test(s.label));
assert.equal(nf.status, 'paid'); assert.equal(nf.amount, 129); assert.equal(nf.annual, 1548);
const tn = subs.find(s => /telenor/i.test(s.label)); assert.equal(tn.label, 'TELENOR ASA'); assert.equal(tn.status, 'upcoming'); assert.equal(tn.dueDay, 25);
const fk = subs.find(s => /fjordkraft/i.test(s.label)); assert.equal(fk.status, 'late');            // ventet den 10., ikke sett i oktober
assert.ok(!subs.some(s => /rema|engangs|gratis/i.test(s.label)), 'varierende, engangs og småbeløp er ikke faste');
assert.equal(detectSubscriptions(fx, '2026-10-18', { hidden: new Set([nf.key]) }).some(s => /netflix/i.test(s.label)), false);
const tot = subscriptionTotals(subs); near(tot.paid, 129); near(tot.month, tot.paid + tot.remaining); near(tot.annual, tot.month * 12);
assert.equal(shortName('Avtalegiro til GJENSIDIGE FORSIKRING ASA Betalingsdato 15-10-2026'), 'GJENSIDIGE FORSIKRING ASA');

// Logoer
assert.equal(domainFor('NETFLIX.COM'), 'netflix.com'); assert.equal(domainFor('Claude.ai subscription'), 'claude.ai'); assert.equal(domainFor('MOVA AS'), 'mova.no');
assert.equal(domainFor('MAX BURGER OSLO'), null, 'Max Burger er ikke HBO Max'); assert.equal(domainFor('HBO Max'), 'max.com'); assert.equal(domainFor('Ukjent Butikk AS'), null);
assert.equal(initials('Ukjent Butikk AS'), 'UB'); assert.equal(initials('æøå'), 'Æ'); assert.ok(logoUrl('netflix.com').includes('domain=netflix.com'));

// Sparemål
const net = [mk('2026-07-25', 'Lønn', 30000, 'Lønn'), mk('2026-07-10', 'x', -26000, 'Mat'), mk('2026-08-25', 'Lønn', 30000, 'Lønn'), mk('2026-08-10', 'x', -24000, 'Mat'), mk('2026-09-25', 'Lønn', 30000, 'Lønn'), mk('2026-09-10', 'x', -22000, 'Mat'), mk('2026-10-01', 'Lønn', 99999, 'Lønn')];
const an = avgNet(net, '2026-10-18'); near(an.avg, (4000 + 6000 + 8000) / 3); assert.equal(an.months, 3);   // oktober er ikke ferdig
let g = projectGoal({ target: 50000, saved: 10000, monthly: 2000, today: '2026-10-18' });
assert.equal(g.remaining, 40000); assert.equal(g.months, 20); assert.equal(g.eta, '2028-06'); assert.equal(g.usesFallback, false); near(g.pct, 0.2);
g = projectGoal({ target: 50000, saved: 10000, monthly: 0, fallbackRate: 6000, today: '2026-10-18' }); assert.equal(g.months, 7); assert.equal(g.usesFallback, true); assert.equal(g.eta, '2027-05');
const fast = projectGoal({ target: 50000, saved: 10000, monthly: 0, fallbackRate: 6000, extra: 2000, today: '2026-10-18' }); assert.equal(fast.months, 5);   // 40000/8000
assert.equal(g.months - fast.months, 2);
g = projectGoal({ target: 50000, saved: 0, monthly: 0, fallbackRate: -500, today: '2026-10-18' }); assert.equal(g.months, Infinity); assert.equal(g.eta, null);
g = projectGoal({ target: 50000, saved: 50000, today: '2026-10-18' }); assert.equal(g.done, true);
g = projectGoal({ target: 12000, saved: 0, monthly: 1000, deadline: '2027-04-01', today: '2026-10-18' });
assert.equal(g.neededPerMonth, 2000); assert.equal(g.onTrack, false);   // 6 måneder igjen, trenger 2000/mnd, sparer 1000
assert.equal(projectGoal({ target: 12000, saved: 0, monthly: 2000, deadline: '2027-04-01', today: '2026-10-18' }).onTrack, true);
// Frist uten egen plan: målbeløpet deles på måneder til fristen, og oppdateres av seg selv
g = projectGoal({ target: 50000, saved: 0, deadline: '2027-09-09', today: '2026-10-19' });
assert.equal(g.source, 'frist'); assert.equal(g.monthsLeft, 11); near(g.rate, 50000 / 11); assert.equal(g.months, 11); assert.equal(g.eta, '2027-09'); assert.equal(g.onTrack, true);
g = projectGoal({ target: 50000, saved: 12000, deadline: '2027-09-09', today: '2027-03-05' });                // seks måneder senere, 12 000 spart
assert.equal(g.monthsLeft, 6); near(g.rate, 38000 / 6); assert.equal(g.eta, '2027-09');
assert.equal(projectGoal({ target: 50000, saved: 0, monthly: 1000, deadline: '2027-09-09', today: '2026-10-19' }).source, 'plan', 'egen plan går foran fristen');
assert.equal(projectGoal({ target: 50000, saved: 0, fallbackRate: 4000, today: '2026-10-19' }).source, 'snitt');
assert.equal(projectGoal({ target: 6000, saved: 0, deadline: '2026-10-25', today: '2026-10-19' }).monthsLeft, 1, 'frist denne måneden: minst 1 måned');
const fx2 = projectGoal({ target: 50000, saved: 0, deadline: '2027-09-09', today: '2026-10-19', extra: 1000 }); assert.ok(fx2.months < 11, 'ekstra sparing gir tidligere dato');
console.log('grafer/budsjett/faste/logoer/mål OK');

// ===== Sbanken (format fra ekte eksport, innhold anonymisert) =====
import { cleanText } from '../lib/parse.js';
const sbCsv = '﻿Transaksjonsdato;Kontonummer;Beskrivelse;Ut av konto;Inn på konto;Valuta\r\n' + [
  '2026-10-15;********;Cash In Norway;29;;NOK', '2026-10-15;********;Vipps:Vipps:Kari K Nordmann;;440;NOK', '2026-10-14;********;Vipps:Ryde Technology As;40;;NOK',
  '2026-10-12;********;Nok 589,00 Scandinavian Airli;589;;NOK', '2026-10-12;********;Nok 24,00 Apple.Com/bill;24;;NOK', '2026-10-11;********;Matkroken bleke;52,95;;NOK',
  '2026-10-10;********;Mcdonalds 57800115;137;;NOK', '2026-10-09;********;Ola Nordmann Hansen;;5000;NOK', '2026-10-09;********;Hansen Ola;800;;NOK',
  '2026-10-08;********;Eva Testesen Hansen;3000;;NOK', '2026-10-07;********;Berit Gustad Testerud;955;;NOK', '2026-10-06;********;Krik Gaver Og Medle;100;;NOK',
  '2026-10-05;********;Voi No;9;;NOK', '2026-10-04;********;Mobil Overføring;;1,34;NOK', '2026-10-03;********;Overleaf Sharelatex;85;;NOK'].join('\r\n') + '\r\n';
const sbRows = parseRows(parseCSV(sbCsv), 'sbanken');
assert.equal(sbRows.length, 15);
assert.equal(sbRows[0].amount, -29, 'utgifter fra «Ut av konto» blir negative');       // dette var feilen: beløpet ble 0
assert.equal(sbRows[1].amount, 440); assert.equal(sbRows[1].text, 'Vipps: Kari K Nordmann');
assert.equal(sbRows[3].text, 'Scandinavian Airli'); assert.equal(sbRows[3].amount, -589);
assert.equal(sbRows[5].amount, -52.95); assert.equal(sbRows[13].amount, 1.34);
assert.ok(sbRows.every(r => r.amount !== 0), 'ingen poster med 0 kr');
assert.equal(cleanText('Nok 1 234,50 Elkjøp Lagunen'), 'Elkjøp Lagunen'); assert.equal(cleanText('Nokia Store'), 'Nokia Store'); assert.equal(cleanText('Nok 85 Overleaf'), 'Overleaf'); assert.equal(cleanText('Nok 12 345,00 Kjøp AS'), 'Kjøp AS'); assert.equal(cleanText('Nok 589,00'), 'Nok 589,00');
const household = ['Ola', 'Eva'], r0 = compileRules();
const sbCl = sbRows.map(t => ({ t: t.text, ...categorize(t, r0, household) })), sc = Object.fromEntries(sbCl.map(x => [x.t, x]));
assert.equal(sc['Scandinavian Airli'].category, 'Reise'); assert.equal(sc['Apple.Com/bill'].category, 'Abonnement'); assert.equal(sc['Matkroken bleke'].category, 'Mat');
assert.equal(sc['Mcdonalds 57800115'].category, 'Restaurant'); assert.equal(sc['Cash In Norway'].category, 'Gebyr'); assert.equal(sc['Krik Gaver Og Medle'].category, 'Gaver');
assert.equal(sc['Vipps: Ryde Technology As'].category, 'Transport'); assert.equal(sc['Voi No'].category, 'Transport'); assert.equal(sc['Overleaf Sharelatex'].category, 'Abonnement');
assert.equal(sc['Ola Nordmann Hansen'].kind, 'internal', 'eget navn = overføring mellom egne kontoer'); assert.equal(sc['Hansen Ola'].kind, 'internal', 'etternavn først');
assert.equal(sc['Eva Testesen Hansen'].kind, 'internal', 'overføring til ektefelle');
assert.equal(sc['Berit Gustad Testerud'].status, 'uncertain', 'andre personer må sorteres av deg'); assert.equal(sc['Berit Gustad Testerud'].kind, 'normal');
assert.equal(sc['Vipps: Kari K Nordmann'].status, 'uncertain');
// egne regler vinner over «navn = intern»
assert.equal(categorize({ text: 'Eva Testesen Hansen', amount: -3000 }, compileRules([{ pattern: 'eva testesen', category: 'Gaver' }]), household).category, 'Gaver');
assert.equal(isHouseholdPerson('Kiwi Eva', household), true, 'kjent svakhet: butikknavn som inneholder fornavn og bare bokstaver'); // dokumenterer grensen
assert.equal(isHouseholdPerson('Eva 1000 kafe', household), false); assert.equal(isHouseholdPerson('Mcdonalds', household), false);
// manglende ut-kolonne gir tydelig feil i stedet for 0 kr
assert.throws(() => parseRows(parseCSV('Transaksjonsdato;Beskrivelse;Inn på konto\n2026-10-01;X;100'), 'sbanken'), /én av kolonnene/);
assert.equal(categorize({ text: 'Regningskonto', amount: -7000 }, r0, household).kind, 'internal'); assert.equal(categorize({ text: 'Felles Regningskonto', amount: -7000 }, r0, household).kind, 'internal');
assert.equal(categorize({ text: 'Regningskonto Gjensidige', amount: -7000 }, r0, household).kind, 'normal');
console.log('Sbanken-format OK');

// Gamle importer: samme post med uren tekst gjenkjennes via legacyHash
assert.ok(sbRows[1].legacyHash && sbRows[1].legacyHash.includes('Vipps:Vipps:Kari K Nordmann') && sbRows[1].legacyHash.endsWith('|1'));
assert.equal(sbRows[5].legacyHash, null, 'rene tekster trenger ingen egen legacy-hash');   // Matkroken bleke
assert.ok(sbRows[3].legacyHash.includes('Nok 589,00 Scandinavian Airli'));
console.log('legacy-hash OK');

// ===== Flere inntektskilder =====
import { samleKilder, kilderFraRad } from '../lib/tax.js';
import { salarySources } from '../lib/salary.js';
// To kilder: hovedjobb 300 000 etter 10 mnd (=360 000/år, trukket 72 000) og bijobb 50 000 etter 5 mnd (=120 000/år, trukket 12 000)
let sk = samleKilder([{ navn: 'Hovedjobb', bruttoHittil: 300000, skattHittil: 60000, maaneder: 10 }, { navn: 'Bijobb', bruttoHittil: 50000, skattHittil: 5000, maaneder: 5 }]);
near(sk.brutto, 480000); near(sk.betalt, 84000); assert.equal(sk.komplett, true); assert.equal(sk.rader.length, 2);
const samlet = beregn([{ brutto: sk.brutto, betalt: sk.betalt }]).rader[0];
const hver = beregn([{ brutto: 360000, betalt: 72000 }]).rader[0].skatt + beregn([{ brutto: 120000, betalt: 12000 }]).rader[0].skatt;
assert.ok(samlet.skatt > hver + 3000, `å regne hver kilde for seg gir for lav skatt (${Math.round(hver)} mot ${Math.round(samlet.skatt)})`);   // minstefradrag-tak og trinnskatt
near(samlet.minste, 95700, 1);                                                            // minstefradraget gis bare én gang
// håndregnet for 480 000: minste 95 700 → alm. 269 760 × 22 % = 59 347,2 · trygd 36 480 · trinn: 92 200×1,7 % + 161 700×4 % = 8 034,4
near(samlet.skatt, 269760 * 0.22 + 36480 + (92200 * 0.017 + 161700 * 0.04));
// manglende data gir ikke et falskt svar
sk = samleKilder([{ navn: 'Hovedjobb', bruttoHittil: 300000, skattHittil: 60000, maaneder: 10 }, { navn: 'Bank-lønn uten slipp', nettoAar: 80000 }]);
assert.equal(sk.komplett, false); assert.deepEqual(sk.mangler, ['Bank-lønn uten slipp']); assert.equal(sk.betalt, null);
sk = samleKilder([{ navn: 'A', bruttoHittil: 100000, maaneder: 5 }]); assert.deepEqual(sk.manglerSkatt, ['A']); assert.equal(sk.komplett, false);
sk = samleKilder([{ navn: 'A', bruttoHittil: 100000, maaneder: 5, trekkPct: 25 }]); near(sk.betalt, 60000, 1); assert.equal(sk.komplett, true);     // trekk-prosent som reserve
assert.equal(samleKilder([{ navn: 'Tom' }]).brutto, 0); assert.equal(samleKilder([]).komplett, false);
// eldre lagring blir én kilde
assert.deepEqual(kilderFraRad({ brutto_hittil: 300000, skatt_hittil: 60000, maaneder: 10 }).map(k => k.navn), ['Lønn']); assert.equal(kilderFraRad({}).length, 0);
assert.equal(kilderFraRad({ kilder: [{ key: 'a', navn: 'X' }], brutto_hittil: 5 })[0].navn, 'X', 'nye kilder går foran eldre felt');
// kilder fra bankdata
const lp = [L('1', '2026-08-25', 30000, 'A1', { text: 'Bergen Kommune' }), L('2', '2026-09-25', 31000, 'A1', { text: 'Bergen Kommune' }), L('3', '2026-09-20', 8000, 'A1', { text: 'Opplett AS lønn' })];
const src = salarySources(lp, 2026, '2026-10-19'); assert.equal(src.length, 2); assert.equal(src[0].navn, 'Bergen Kommune'); assert.equal(src[0].netto, 61000); assert.equal(src[0].count, 2); near(src[0].projected, 61000 / 2 * 12);
assert.equal(src[1].navn, 'Opplett AS lønn'); assert.equal(salarySources(lp, 2025, '2026-10-19')[0].projected, 61000);
console.log('inntektskilder OK');

// ===== Faste utgifter (brukerstyrt) og betalt/gjenstår per kategori =====
import { fixedInfo, itemPayments, matchesItem, patternsOf, patternFor, suggestFixed, categoryPlan } from '../lib/fixed.js';
const fxs = [];
for (const m of ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
  fxs.push(mk(`${m}-15`, 'Vipps: Coffeo', -439, 'Abonnement'), mk(`${m}-07`, `Overleaf Sharelatex`, m === '2026-10' ? -85 : -73, 'Abonnement'));
  fxs.push(mk(`${m}-0${m.slice(6) % 5 + 1}`, 'REMA 1000 NATTLAND', -(500 + (m.slice(6) * 130) % 700), 'Mat'), mk(`${m}-13`, 'Meny Sletten', -(150 + (m.slice(6) * 57) % 300), 'Mat'));
}
fxs.push(mk('2026-10-03', 'Nidaros Boliglån renter', -14000, 'Bolig'), mk('2026-09-03', 'Nidaros Boliglån renter', -13900, 'Bolig'), mk('2026-08-03', 'Nidaros Boliglån renter', -13800, 'Bolig'));
fxs.push(mk('2026-10-05', 'Felleskostnader Sameiet', -4000, 'Bolig'), mk('2026-09-05', 'Felleskostnader Sameiet', -4000, 'Bolig'), mk('2026-08-05', 'Felleskostnader Sameiet', -4000, 'Bolig'));
fxs.push(mk('2026-09-20', 'Kommunale avgifter Bergen', -1200, 'Bolig'), mk('2026-08-20', 'Kommunale avgifter Bergen', -1200, 'Bolig'), mk('2026-07-20', 'Kommunale avgifter Bergen', -1200, 'Bolig'));
assert.deepEqual(patternsOf(' Claude , Anthropic ,'), ['claude', 'anthropic']);
assert.ok(matchesItem({ pattern: 'claude, anthropic' }, { text: 'ANTHROPIC SAN FRANCISCO' })); assert.ok(!matchesItem({ pattern: 'mova' }, { text: 'Rema 1000' })); assert.ok(!matchesItem({ pattern: '' }, { text: 'x' }));
const fCoffeo = fixedInfo({ name: 'Coffeo', pattern: 'coffeo' }, fxs, '2026-10-19');
assert.equal(fCoffeo.status, 'paid'); assert.equal(fCoffeo.amount, 439); assert.equal(fCoffeo.dueDay, 15); assert.equal(fCoffeo.count, 5); assert.equal(fCoffeo.payments[0].date, '2026-10-15'); assert.equal(fCoffeo.category, 'Abonnement');
const fOv = fixedInfo({ name: 'Overleaf', pattern: 'overleaf' }, fxs, '2026-10-19'); assert.equal(fOv.amount, 85, 'viser det som faktisk ble trukket (prisøkning 73 → 85)'); assert.equal(fOv.dueDay, 7);
const fKom = fixedInfo({ name: 'Kommunale avgifter', pattern: 'kommunale' }, fxs, '2026-10-21');
assert.equal(fKom.status, 'late', 'forventet den 20., ikke trukket innen den 21.'); assert.equal(fixedInfo({ name: 'K', pattern: 'kommunale' }, fxs, '2026-10-19').status, 'upcoming', 'den 19. venter den fortsatt'); const fKom2 = fixedInfo({ name: 'Kommunale avgifter', pattern: 'kommunale' }, fxs, '2026-10-12'); assert.equal(fKom2.status, 'upcoming'); assert.equal(fKom.expected, 1200);
assert.equal(fixedInfo({ name: 'Mova', pattern: 'mova' }, fxs, '2026-10-19').status, 'unknown');
assert.equal(fixedInfo({ name: 'Mova', pattern: 'mova', day: 25, amount: 299 }, fxs, '2026-10-19').status, 'upcoming', 'dag og beløp kan oppgis for hånd');
assert.equal(fixedInfo({ name: 'Mova', pattern: 'mova', day: 25, amount: 299 }, fxs, '2026-10-19').expected, 299);
assert.equal(itemPayments({ pattern: 'rema' }, fxs).length, 5);
// forslag: ikke dagligvarer, og ikke det som allerede er lagt inn
const fSug = suggestFixed(fxs, '2026-10-19'); const sn = fSug.map(s => s.pattern);
assert.ok(!sn.some(x => /rema|meny/.test(x)), 'Rema og Meny foreslås ikke som faste'); assert.ok(sn.includes('coffeo') && sn.includes('overleaf sharelatex'), 'Coffeo og Overleaf foreslås: ' + sn);
assert.ok(!suggestFixed(fxs, '2026-10-19', { items: [{ pattern: 'coffeo' }] }).some(s => s.pattern === 'coffeo'), 'allerede lagt inn foreslås ikke igjen');
const bl = suggestFixed(fxs, '2026-10-19').map(s => s.pattern); assert.ok(bl.some(x => /boliglån/.test(x)), 'boliglån foreslås når den ikke er lagt inn: ' + bl);
assert.ok(!suggestFixed(fxs, '2026-10-19', { items: [{ pattern: 'boliglån renter' }] }).some(s => /boliglån/.test(s.pattern)), 'dekkes av «boliglån renter» selv om forslagets tekst er en annen');
assert.equal(patternFor('Vipps: Coffeo'), 'coffeo'); assert.equal(patternFor('Avtalegiro til TELENOR ASA Betalingsdato 25-10-2026'), 'telenor asa');
// betalt / gjenstår i kategorien Bolig i oktober
const fixedItems = [{ name: 'Renter', pattern: 'boliglån renter', category: 'Bolig' }, { name: 'Felleskostnader', pattern: 'felleskostnader', category: 'Bolig' }, { name: 'Kommunale avgifter', pattern: 'kommunale', category: 'Bolig' }, { name: 'Coffeo', pattern: 'coffeo' }];
const katPlan = categoryPlan({ cat: 'Bolig', month: '2026-10', today: '2026-10-21', txs: fxs, items: fixedItems });
assert.equal(katPlan.paidTx.length, 2); assert.equal(katPlan.paid, 18000); assert.deepEqual(katPlan.remaining.map(r => r.name), ['Kommunale avgifter']); assert.equal(katPlan.remaining[0].late, true); assert.equal(katPlan.remainingSum, 1200); assert.equal(katPlan.hasFixed, true);
assert.equal(categoryPlan({ cat: 'Bolig', month: '2026-09', today: '2026-10-19', txs: fxs, items: fixedItems }).remaining.length, 0, 'gamle måneder har ingenting som gjenstår');
assert.equal(categoryPlan({ cat: 'Abonnement', month: '2026-10', today: '2026-10-19', txs: fxs, items: fixedItems }).remaining.length, 0, 'Coffeo og Overleaf er betalt');
const fSea = categoryPlan({ cat: 'Forsikring', month: '2026-10', today: '2026-10-19', txs: fxs, items: [], seasonal: [{ name: 'Bilforsikring', due: '2026-10', paid: false, category: 'Forsikring', amount: 8400 }] });
assert.deepEqual(fSea.remaining.map(r => [r.name, r.kind]), [['Bilforsikring', 'sesong']]); assert.equal(fSea.hasFixed, false);
console.log('faste utgifter/kategoriplan OK');

// ===== Givertjenester: nøyaktig treff, så Krik Kafe / Salt Bergen ikke telles som gaver =====
import { isGiverCategory } from '../lib/fixed.js';
const giveTx = [];
for (const m of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
  giveTx.push(mk(`${m}-15`, 'Vipps: Salt', -300, 'Givertjeneste'));
  if (m !== '2026-10') giveTx.push(mk(`${m}-28`, 'Vipps: Krik Gaver Og Medle', -350, 'Gaver'), mk(`${m}-20`, 'Vipps: Https //nasjonalfor', -50, 'Givertjeneste'));   // 28. og 20. oktober er ikke kommet ennå
}
giveTx.push(mk('2026-09-12', 'Vipps: Salt Kafe Og Boksal', -45, 'Restaurant'), mk('2026-08-03', 'Salt Kafe Og Boksal', -52, 'Restaurant'), mk('2026-07-07', 'Salt', -85, 'Annet'), mk('2026-06-18', 'Vipps: Salt Bergen', -120, 'Annet'),
  mk('2026-09-03', 'Krik Kafe', -60, 'Restaurant'), mk('2026-08-21', 'Vipps: Krik Leirkontor', -200, 'Fritid'), mk('2026-07-30', 'Krik Idrett Krysser', -90, 'Fritid'), mk('2026-06-02', 'Krik Butikk', -150, 'Klær'), mk('2026-05-28', 'Krik Giver Og Medle', -350, 'Gaver'));
const giveItems = [{ name: 'Krik', pattern: 'krik gaver, krik giver' }, { name: 'Salt', pattern: '=vipps: salt' }, { name: 'Nasjonalforeningen', pattern: 'nasjonalfor' }];
assert.equal(itemPayments(giveItems[0], giveTx).length, 6, 'Krik: 5 «Gaver og Medle» + 1 «Giver og Medle», ikke kafé, butikk, leirkontor eller idrett');
assert.equal(itemPayments(giveItems[1], giveTx).length, 6, 'Salt: bare nøyaktig «Vipps: Salt», ikke Salt Bergen, Salt Kafe eller kortkjøp «Salt»');
assert.equal(itemPayments(giveItems[2], giveTx).length, 5);
assert.ok(matchesItem({ pattern: '=vipps: salt' }, { text: 'Vipps:Salt' }), 'urørt tekst fra eldre import treffer også'); assert.ok(matchesItem({ pattern: '=vipps: salt' }, { text: '  VIPPS:   SALT ' }));
assert.ok(!matchesItem({ pattern: '=vipps: salt' }, { text: 'Vipps: Salt Bergen' })); assert.ok(!matchesItem({ pattern: '=salt' }, { text: 'Salt Kafe Og Boksal' })); assert.ok(matchesItem({ pattern: '=salt' }, { text: 'SALT' }));
const giveInfo = giveItems.map(i => fixedInfo(i, giveTx, '2026-10-19'));
assert.deepEqual(giveInfo.map(x => [x.amount, x.dueDay, x.status]), [[350, 28, 'upcoming'], [300, 15, 'paid'], [50, 20, 'upcoming']]); assert.equal(giveInfo[1].yearTotal, 1800);
// forslag: gaver og utgifter holdes adskilt
const giveSug = suggestFixed(giveTx, '2026-10-19', { kind: 'giver' }).map(s => s.pattern);
assert.ok(giveSug.some(x => /krik gaver/.test(x)) && giveSug.some(x => /salt/.test(x)) && giveSug.some(x => /nasjonalfor/.test(x)), 'givertjenester foreslås: ' + giveSug);
assert.equal(suggestFixed(giveTx, '2026-10-19', { kind: 'utgift' }).length, 0, 'gaver foreslås ikke som faste utgifter');
assert.ok(isGiverCategory('Givertjeneste') && isGiverCategory('Gaver') && !isGiverCategory('Mat'));
assert.equal(domainFor('Krik'), 'krik.no'); assert.equal(domainFor('Krik Kafe'), 'krik.no'); assert.equal(domainFor('Nasjonalforeningen (demensforskning)'), 'nasjonalforeningen.no');
console.log('givertjenester OK');

// ===== Din andel av en post =====
import { eff, owed } from '../lib/analysis.js';
import { parseShare, shareText } from '../lib/share.js';
const sh = (date, text, amount, cat, share, extra = {}) => ({ ...mk(date, text, amount, cat), share, ...extra });
near(parseShare('1/4', 880), 0.25); near(parseShare('1/2', 880), 0.5); near(parseShare('25 %', 880), 0.25); near(parseShare('25%', 880), 0.25); near(parseShare('220 kr', 880), 0.25);
near(parseShare('440', 880), 0.5); near(parseShare('0,5', 880), 0.5); near(parseShare('1/3', 900), 1 / 3, 1e-4); near(parseShare('', 880), 1); near(parseShare('100 %', 880), 1); near(parseShare('1', 880), 1);
for (const bad of ['abc', '0', '0 %', '150 %', '2/1', '900 kr', '1000', '1/0', '-1/2']) assert.ok(Number.isNaN(parseShare(bad, 880)), 'ugyldig andel: ' + bad);
assert.equal(shareText(0.5), '1/2'); assert.equal(shareText(0.25), '1/4'); assert.equal(shareText(1 / 3), '1/3'); assert.equal(shareText(0.4), '40 %'); assert.equal(shareText(0.125), '1/8'); assert.equal(shareText(0.375), '37,5 %');
assert.equal(eff({ amount: -880 }), -880); assert.equal(eff({ amount: -880, share: 1 }), -880); assert.equal(eff({ amount: -880, share: 0.5 }), -440); assert.equal(eff({ amount: -880, share: '0.25' }), -220);
assert.equal(owed({ kind: 'normal', amount: -880, share: 0.5 }), 440); assert.equal(owed({ kind: 'normal', amount: -880, share: 0.5, reimbursed: true }), 0);
assert.equal(owed({ kind: 'reimbursable', amount: -300 }), 300); assert.equal(owed({ kind: 'normal', amount: -880 }), 0); assert.equal(owed({ kind: 'normal', amount: 500, share: 0.5 }), 0);
// gave: 880 kr, halvparten betales av andre. Padel: 1 200 kr lagt ut, du betaler 1/4
const shx = [sh('2026-10-14', 'FINNSteelseries Arcti', -880, 'Gaver', 0.5, { reimb_for: 'Mamma' }), sh('2026-10-10', 'Padel Bergen', -1200, 'Fritid', 0.25, { reimb_for: 'Vennene' }), mk('2026-10-02', 'REMA', -500, 'Mat')];
const sms = monthSummary(shx, '2026-10'); near(sms.spent, 440 + 300 + 500); near(sms.byCat.Gaver, 440); near(sms.byCat.Fritid, 300); near(sms.outstanding, 440 + 900);
assert.equal(monthSummary(shx.map((t, i) => (i === 0 ? { ...t, reimbursed: true } : t)), '2026-10').outstanding, 900, 'gaven er gjort opp, padel gjenstår');
near(monthTotals(shx, ['2026-10'])['2026-10'].spent, 1240); near(categoryTotals(shx, '2026-10').Gaver, 440); near(cumulativeSpend(shx, '2026-10', '2026-10-18').values[13], 500 + 300 + 440);
near(naturalSearch('gaver', shx, ['Gaver']).total, -440);
near(categoryPlan({ cat: 'Gaver', month: '2026-10', today: '2026-10-19', txs: shx, items: [] }).paid, 440);
const lagre = budgetStatus({ byCat: sms.byCat, budgets: { Gaver: 600 }, month: '2026-10', today: '2026-10-19' }).items[0]; near(lagre.spent, 440); near(lagre.left, 160);   // 440 av 600, ikke 880
console.log('andel OK');

// ===== Månedlig påminnelse om bankloggene =====
import { uploadStatus, reminderWindow, lastDayOf } from '../lib/uploads.js';
const ua = [{ id: 'A1', name: 'Jørgens Brukskonto' }, { id: 'A2', name: 'Ellinors Konto' }, { id: 'A3', name: 'Felles Regningskonto' }, { id: 'A4', name: 'Jørgens Sbanken' }];
const utx = (acc, date) => ({ account_id: acc, date, text: 'x', amount: -10, category: 'Mat', kind: 'normal' });
assert.equal(lastDayOf('2026-10'), '2026-10-31'); assert.equal(lastDayOf('2026-02'), '2026-02-28'); assert.equal(lastDayOf('2028-02'), '2028-02-29');
assert.equal(reminderWindow('2026-10-29'), null, 'den 29. er for tidlig'); assert.deepEqual(reminderWindow('2026-10-30'), { month: '2026-10', phase: 'snart' }); assert.deepEqual(reminderWindow('2026-10-31'), { month: '2026-10', phase: 'slutt' });
assert.deepEqual(reminderWindow('2026-11-01'), { month: '2026-10', phase: 'start' }); assert.deepEqual(reminderWindow('2026-11-04'), { month: '2026-10', phase: 'start' });
assert.deepEqual(reminderWindow('2026-11-05'), { month: '2026-10', phase: 'paaminnelse1' }); assert.deepEqual(reminderWindow('2026-11-10'), { month: '2026-10', phase: 'paaminnelse2' });
assert.equal(reminderWindow('2026-11-16'), null); assert.equal(reminderWindow('2026-11-20'), null); assert.deepEqual(reminderWindow('2027-01-02'), { month: '2026-12', phase: 'start' });
assert.deepEqual(reminderWindow('2026-02-27'), { month: '2026-02', phase: 'snart' }, 'februar har 28 dager');
// status: A1 og A4 er lastet opp til slutten av oktober, A2 bare til midten, A3 har ingen poster
let ust = uploadStatus({ accounts: ua, txs: [utx('A1', '2026-10-30'), utx('A2', '2026-10-15'), utx('A4', '2026-11-02')], month: '2026-10' });
assert.deepEqual(ust.map(x => x.done), [true, false, false, true]); assert.equal(ust[0].via, 'data'); assert.equal(ust[2].dataTo, null);
assert.equal(uploadStatus({ accounts: ua, txs: [utx('A1', '2026-10-28')], month: '2026-10' })[0].done, true, 'poster til og med 3 dager før månedsslutt (28.) holder');
assert.equal(uploadStatus({ accounts: ua, txs: [utx('A1', '2026-10-28')], month: '2026-10' })[0].dataTo, '2026-10-28'); assert.equal(uploadStatus({ accounts: ua, txs: [utx('A1', '2026-10-27')], month: '2026-10' })[0].done, false, 'den 27. er for tidlig');
ust = uploadStatus({ accounts: ua, txs: [utx('A2', '2026-10-15')], marks: [{ account_id: 'A2', month: '2026-10' }, { account_id: 'A3', month: '2026-09' }], month: '2026-10' });
assert.equal(ust[1].done, true); assert.equal(ust[1].via, 'manuelt'); assert.equal(ust[2].done, false, 'merket for en annen måned teller ikke');
assert.equal(uploadStatus({ accounts: [...ua.slice(0, 3), { ...ua[3], remind: false }], txs: [], month: '2026-10' }).length, 3, 'konto med remind = false er ikke med');
// varsler på riktige dager
const un = (today, o = {}) => planNotifications({ txs: [], budgets: {}, manual: [], today, accounts: ua, ...o }).filter(n => /:upload:/.test(n.key));
assert.equal(un('2026-10-20').length, 0, 'ingen varsel midt i måneden'); assert.equal(un('2026-10-30').length, 0, 'nest siste dag: bare banner i appen');
let un31 = un('2026-10-31'); assert.equal(un31.length, 1); assert.match(un31[0].title, /I morgen er oktober over/); assert.equal(un31[0].key, '2026-10:upload:slutt');
const un1 = un('2026-11-01', { txs: [utx('A1', '2026-10-31')] })[0]; assert.match(un1.title, /Last opp bankloggene for oktober/); assert.equal(un1.key, '2026-10:upload:start');
assert.equal(un1.body, '✅ Jørgens Brukskonto · ⬜ Ellinors Konto · ⬜ Felles Regningskonto · ⬜ Jørgens Sbanken');
assert.equal(un('2026-11-03')[0].key, '2026-10:upload:start', 'samme fase hele 1.–4.: sendes bare én gang p.g.a. nøkkelen');
assert.equal(un('2026-11-01', { sent: new Set(['2026-10:upload:start']) }).length, 0, 'allerede sendt');
assert.equal(un('2026-11-06')[0].key, '2026-10:upload:paaminnelse1'); assert.equal(un('2026-11-12')[0].key, '2026-10:upload:paaminnelse2'); assert.equal(un('2026-11-16').length, 0);
assert.equal(un('2026-11-06', { txs: ua.map(a => utx(a.id, '2026-10-31')) }).length, 0, 'alt lastet opp: ingen påminnelse');
assert.equal(un('2026-11-06', { txs: ua.slice(0, 3).map(a => utx(a.id, '2026-10-31')), marks: [{ account_id: 'A4', month: '2026-10' }] }).length, 0, 'manuell markering teller');
assert.equal(planNotifications({ txs: [], budgets: {}, manual: [], today: '2026-11-01' }).filter(n => /upload/.test(n.key)).length, 0, 'uten kontoer: ingen opplastingsvarsel');
console.log('opplastingspåminnelse OK');
{
  const { monthlyAmount, plannedIncome, plannedSeries, periodText, PER_MONTH } = await import('../lib/income.js');
  const plans = [
    { person: 'Jørgen', name: 'Krik', amount: 18000, times: 1, start_month: '2026-01', end_month: '2027-03' },
    { person: 'Jørgen', name: 'Støttekontakt', amount: 3000, times: 1, start_month: '2026-01', end_month: '2026-11' },
    { person: 'Jørgen', name: 'Avlastning', amount: 1200, times: PER_MONTH.annenhver, start_month: '2026-01', end_month: null },
    { person: 'Ellinor', name: 'Internship', amount: 25000, times: 1, start_month: '2027-01', end_month: '2027-02' }];
  assert.equal(monthlyAmount(plans[2]), 2600, 'annenhver helg 1200 × 2,17 ≈ 2600');
  assert.equal(plannedIncome(plans, '2026-10'), 18000 + 3000 + 2600); assert.equal(plannedIncome(plans, '2026-12'), 18000 + 2600, 'støttekontakt slutter etter november');
  assert.equal(plannedIncome(plans, '2027-01'), 18000 + 2600 + 25000); assert.equal(plannedIncome(plans, '2027-01', 'Ellinor'), 25000);
  assert.equal(plannedIncome(plans, '2027-04'), 2600, 'Krik slutter etter mars'); assert.equal(plannedSeries(plans, '2026-11', 3).map(x => x.total).join(), '23600,20600,45600');
  const lb = m => m; assert.equal(periodText(plans[0], lb), '2026-01 – 2027-03'); assert.equal(periodText(plans[2], lb), 'fra 2026-01, løpende'); assert.equal(periodText({ end_month: '2026-11' }, lb), 'til og med 2026-11');
  console.log('planlagt inntekt OK');
}
{
  const csv = '23.10.2026;Vipps*Ryde Technology AS/Oslo/;-30,90;NOK\n21.10.2026;Q*LYKO.NO Notanr 74541096294106583922710;-1.572,00;NOK\n21.10.2026;Fra Bufferspar;1.000,00;NOK\n05.10.2026;" CANVA* I05023-14807410";-200,00;NOK\n';
  const tx = parseRows(parseCSV(csv), 'nidaros'); assert.equal(tx.length, 4, 'fil uten overskrift: dato;tekst;beløp;valuta');
  assert.equal(tx[1].amount, -1572); assert.equal(tx[1].text, 'Q*LYKO.NO'); assert.equal(tx[2].amount, 1000); assert.equal(tx[3].text, 'CANVA* I05023-14807410');
  const r = compileRules([]); assert.equal(categorize(tx[2], r).kind, 'internal', 'Fra Bufferspar er intern overføring'); assert.equal(categorize({ text: 'Avtalegiro til MOVA AS', amount: -399 }, r).category, 'Abonnement');
  console.log('fil uten overskrift OK');
}
