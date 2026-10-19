// Forenklet skatteberegning for lønnstakere (klasse 1). ESTIMAT, ikke skatteoppgjør.
// Satser 2026: Regjeringen «Skattesatser 2026» og Skatteetaten «Forskuddsutskrivingen 2026».
// BSU (10 %, maks 27 500) og fagforeningsfradrag (maks 8 700) er fra sekundærkilder og bør bekreftes.
export const RULES = {
  2026: {
    personfradrag: 114540, minstefradragPct: 0.46, minstefradragMax: 95700, almSats: 0.22,
    trygd: 0.076, trygdNedre: 99650, trygdOpptrapping: 0.25,
    trinn: [[226100, 0.017], [318300, 0.04], [725050, 0.137], [980100, 0.168], [1467200, 0.178]],
    bsuMaks: 27500, bsuPct: 0.10, fagforeningMaks: 8700,
  },
};
export const rulesFor = year => RULES[year] || RULES[Math.max(...Object.keys(RULES).map(Number))]; // ukjent år → siste kjente satser
export const SOURCES = [
  { name: 'Regjeringen: Skattesatser 2026', url: 'https://www.regjeringen.no/no/tema/okonomi-og-budsjett/skatter-og-avgifter/skatte-og-avgiftssatser/skattesatser-2026/id3121978/' },
  { name: 'Skatteetaten: Forskuddsutskrivingen 2026', url: 'https://www.skatteetaten.no/en/rettskilder/type/uttalelser/uttalelser/forskuddsutskrivingen-2026/' },
  { name: 'Bytt.no: BSU-regler 2026 (sekundærkilde)', url: 'https://www.bytt.no/bank/sparekonto/a-vxg/bsu-regler-og-sparing-fordeler-og-ulemper' },
  { name: 'Sticos: fradragssatser (sekundærkilde)', url: 'https://www.sticos.no/satser/fradragssatser' },
];

export function trinnskatt(inntekt, trinn) {
  let sum = 0;
  trinn.forEach(([grense, sats], i) => { const til = trinn[i + 1]?.[0] ?? Infinity; if (inntekt > grense) sum += (Math.min(inntekt, til) - grense) * sats; });
  return sum;
}
export function trygdeavgift(brutto, r) {
  if (brutto <= r.trygdNedre) return 0;
  return Math.min(brutto * r.trygd, (brutto - r.trygdNedre) * r.trygdOpptrapping);   // 25 %-regelen
}

// Brutto og forventet skatt trukket for hele året, ut fra det brukeren har fylt inn.
// Returnerer null for det som ikke kan beregnes.
export function projiser({ bruttoHittil, skattHittil, maaneder, bruttoAar, trekkPct, nettoAar }) {
  const m = maaneder > 0 ? Math.min(maaneder, 12) : 0;
  let brutto = null, kilde = null;
  if (bruttoAar > 0) { brutto = bruttoAar; kilde = 'brutto årslønn du la inn'; }
  else if (bruttoHittil > 0 && m) { brutto = bruttoHittil / m * 12; kilde = `lønnsslipp (brutto hittil ÷ ${m} måneder × 12)`; }
  else if (nettoAar > 0 && trekkPct > 0 && trekkPct < 100) { brutto = nettoAar / (1 - trekkPct / 100); kilde = `estimert fra netto utbetalt og trekk-prosent ${trekkPct} %`; }
  let betalt = null;
  if (skattHittil > 0 && m) betalt = skattHittil / m * 12;
  else if (brutto && trekkPct > 0) betalt = brutto * trekkPct / 100;
  return { brutto, betalt, kilde };
}

// p: { brutto, renter, fagforening, reise, annet, bsu, betalt }. opts: { gift, year }
export function beregn(personer, { gift = false, year = 2026 } = {}) {
  const r = rulesFor(year);
  const rader = personer.map(p => {
    const brutto = p.brutto || 0;
    const minste = Math.min(brutto * r.minstefradragPct, r.minstefradragMax);
    const fagf = Math.min(p.fagforening || 0, r.fagforeningMaks);
    const ovrige = (p.renter || 0) + fagf + (p.reise || 0) + (p.annet || 0);
    return { ...p, brutto, minste, fagf, ovrige, almForPf: brutto - minste - ovrige, overfort: 0 };
  });
  // Underskudd i alminnelig inntekt kan trekkes fra ektefellens inntekt
  if (gift && rader.length === 2) {
    const [a, b] = rader;
    if (a.almForPf < 0 && b.almForPf > 0) { const t = Math.min(-a.almForPf, b.almForPf); b.almForPf -= t; b.overfort = t; a.overfortBort = t; }
    else if (b.almForPf < 0 && a.almForPf > 0) { const t = Math.min(-b.almForPf, a.almForPf); a.almForPf -= t; a.overfort = t; b.overfortBort = t; }
  }
  for (const x of rader) {
    x.almInntekt = Math.max(0, x.almForPf - r.personfradrag);
    x.skattAlm = x.almInntekt * r.almSats;
    x.trinn = trinnskatt(x.brutto, r.trinn);
    x.trygd = trygdeavgift(x.brutto, r);
    const bsuFradrag = Math.min(x.bsu || 0, r.bsuMaks) * r.bsuPct;
    x.bsuFradrag = Math.min(bsuFradrag, x.skattAlm + x.trinn + x.trygd);
    x.skatt = x.skattAlm + x.trinn + x.trygd - x.bsuFradrag;
    x.differanse = x.betalt == null ? null : x.betalt - x.skatt;   // positivt = får igjen
  }
  const komplett = rader.every(x => x.differanse != null && x.brutto > 0);
  return { rader, sumSkatt: rader.reduce((s, x) => s + x.skatt, 0), sumBetalt: komplett ? rader.reduce((s, x) => s + x.betalt, 0) : null,
    differanse: komplett ? rader.reduce((s, x) => s + x.differanse, 0) : null, komplett };
}

// ---- Flere inntektskilder per person ----
// Skatten regnes på SUMMEN av alle kilder: trinnskatt og trygdeavgift på totalen, og minstefradraget gis bare én gang (ikke per arbeidsgiver).
// kilder: [{ navn, bruttoHittil, skattHittil, maaneder, bruttoAar, trekkPct, nettoAar }]
export function samleKilder(kilder) {
  const rader = [], mangler = [], manglerSkatt = []; let brutto = 0, betalt = 0;
  for (const k of kilder) {
    const harTall = [k.bruttoHittil, k.skattHittil, k.bruttoAar, k.trekkPct].some(v => v > 0);
    if (!harTall && !(k.nettoAar > 0)) continue;                                  // tom kilde
    const pr = projiser(k);
    if (!pr.brutto) { mangler.push(k.navn); rader.push({ navn: k.navn, brutto: null, betalt: null, kilde: null }); continue; }   // kjenner bare netto fra banken
    brutto += pr.brutto;
    if (pr.betalt == null) manglerSkatt.push(k.navn); else betalt += pr.betalt;
    rader.push({ navn: k.navn, brutto: pr.brutto, betalt: pr.betalt, kilde: pr.kilde });
  }
  const komplett = brutto > 0 && !mangler.length && !manglerSkatt.length;
  return { brutto, betalt: komplett ? betalt : null, rader, mangler, manglerSkatt, komplett };
}

// Eldre lagringer hadde ett sett tall per person. Disse blir én inntektskilde.
export function kilderFraRad(row) {
  if (Array.isArray(row?.kilder) && row.kilder.length) return row.kilder;
  const gammel = ['brutto_hittil', 'skatt_hittil', 'brutto_aar', 'trekk_pct'].some(f => Number(row?.[f]) > 0);
  return gammel ? [{ key: 'legacy', navn: 'Lønn', brutto_hittil: row.brutto_hittil, skatt_hittil: row.skatt_hittil, maaneder: row.maaneder, brutto_aar: row.brutto_aar, trekk_pct: row.trekk_pct }] : [];
}
