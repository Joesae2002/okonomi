// Trygg kalkulator for budsjettfelt: «250*2», «14 000 + 4 000», «2x250», «(100+50)*2», «1,5*100».
// Ingen eval(): egen liten parser som bare kjenner tall, + - * / og parenteser.
// Returnerer null for tomt felt, NaN for ugyldig uttrykk, ellers tallet.
export function evalExpr(input, digits = 2) {   // digits: antall desimaler i svaret (2 for kroner, flere for andeler)
  let s = String(input ?? '').toLowerCase().replace(/ /g, ' ').replace(/kr\b\.?/g, '').trim();
  if (s === '') return null;
  s = s.replace(/(\d)\s+(?=\d{3}(\D|$))/g, '$1')      // «14 000» → 14000
    .replace(/(\d|\))\s*[x×]\s*(?=[\d(])/g, '$1*')   // «2x250» og «2 × 250»
    .replace(/\s+/g, '').replace(/,/g, '.');
  let i = 0;
  const peek = () => s[i];
  function num() {
    const m = /^\d+(\.\d+)?|^\.\d+/.exec(s.slice(i));
    if (!m) throw 0;
    i += m[0].length; return parseFloat(m[0]);
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw 0; i++; return v; }
    return num();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') { const op = s[i++], r = factor(); v = op === '*' ? v * r : v / r; }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = s[i++], r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  try { const v = expr(); return i === s.length && Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : NaN; } catch { return NaN; }
}

// Er dette et regnestykke (og ikke bare et tall)?
export const isFormula = s => /[-+*/()x×]/.test(String(s ?? '').trim().replace(/^-/, '')) && !/^\d+([.,]\d+)?$/.test(String(s).trim());
