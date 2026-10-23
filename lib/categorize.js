export const CATEGORIES = ['Mat', 'Restaurant', 'Transport', 'Bolig', 'Strøm', 'Forsikring', 'Abonnement', 'Helse', 'Klær', 'Barn', 'Fritid', 'Gaver', 'Reise', 'Gebyr', 'Lønn', 'Inntekt annet', 'Annet'];

const DEFAULT_RULES = [
  ['Bolig', 'obs bygg|byggmakker|maxbo|jernia|montér|monter '],
  ['Mat', 'rema|kiwi|coop|meny|spar |bunnpris|joker|extra|oda|matkroken|vinmonopol'],
  ['Restaurant', 'mcd|mcdonalds|burger king|max burger|dominos|subway|kebab|restaurant|pizza|burger|cafe|kafe|kaffe|starbucks|espresso|sushi|peppes|mcdonald|foodora|wolt|bakeri'],
  ['Transport', '\\bvoi\\b|voitechnolo|\\bryde\\b|\\blime\\b|skyss|kolumbus|flybussen|circle k|esso|shell|uno-x|st1|bensin|ruter|atb|vy |flytog|parkering|easypark|bompenger|autopass|fjellinjen|taxi'],
  ['Strøm', 'strøm|tibber|fjordkraft|trønderenergi|tronderenergi|nettleie|elvia|tensio'],
  ['Forsikring', 'forsikring|gjensidige|tryg|if skade|fremtind|sparebank 1 forsikring'],
  ['Abonnement', 'overleaf|mova|chatgpt|openai|claude\\.ai|anthropic|dropbox|github|notion|canva|nordvpn|netflix|spotify|hbo|max |viaplay|disney|apple\\.com|google|youtube|storytel|tv 2|nrk|telenor|telia|ice\\.net|icloud|microsoft'],
  ['Bolig', 'husleie|felleskostnad|kommunale|renovasjon|lån|lan |avdrag|boliglån|ikea|jysk|byggmakker|biltema|obs bygg'],
  ['Helse', 'apotek|lege|tannlege|fysio|legesenter|vitusapotek|boots'],
  ['Klær', 'lyko|h&m|hm |zara|cubus|dressmann|bik bok|lindex|kappahl|intersport|xxl|zalando'],
  ['Barn', 'barnehage|sfo|babyshop|jollyroom|leker|toys'],
  ['Fritid', 'badeland|vitensenter|kino|sats|treningssenter|fitness|steam|playstation|nintendo|bowling|svømmehall'],
  ['Reise', 'scandinavian airl|sas |norwegian|booking\\.com|airbnb|hotel|widerøe|wideroe|ryanair'],
  ['Gaver', 'vipps\\*salt|krik |krik$|gaver og medle|frelsesarmeen|røde kors|redd barna|unicef|kreftforeningen'],
  ['Gebyr', 'cash in norway|gebyr|kortavgift|årsavgift|månedspris|rente'],
  ['Lønn', 'lønn|lonn|salary'],
];

const INTERNAL = /^(felles )?(regningskonto|sparekonto|brukskonto|felleskonto|bsu)$|overføring mellom egne|overforing mellom egne|egen konto|mellom egne kontoer|til sparekonto|fra sparekonto|intern overf|bufferspar/i;

export function compileRules(userRules = []) {
  return [...userRules.map(r => [r.category, r.pattern, true]), ...DEFAULT_RULES.map(r => [...r, false])]
    .map(([c, p, user]) => ({ category: c, user, re: user ? new RegExp(escapeRe(p), 'i') : new RegExp(p, 'i') }));
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Returnerer { category, status: 'auto'|'uncertain', kind }
// «Jørgen Sæter Hangerhagen», «Sæter Jørgen», «Vipps: Ellinor …»: en beskrivelse som bare er et navn der fornavnet er en av oss
export function isHouseholdPerson(text, ownNames) {
  const t = text.split(' – ')[0].replace(/^vipps:\s*/i, '').trim();
  if (!ownNames.length || !/^[\p{L}.\- ]{3,60}$/u.test(t)) return false;
  const words = t.toLowerCase().split(/\s+/);
  return ownNames.some(n => n && words.includes(n.toLowerCase()));
}

export function categorize(tx, rules, ownNames = [], ownNumbers = new Set()) {
  // Begge kontonumrene er våre egne kontoer → overføring mellom egne kontoer
  if (tx.from && tx.to && ownNumbers.has(tx.from) && ownNumbers.has(tx.to)) return { category: 'Annet', status: 'auto', kind: 'internal' };
  if (INTERNAL.test(tx.text) || ownNames.some(n => n && tx.text.toLowerCase().includes(n.toLowerCase()) && /overf|betaling til|fra /i.test(tx.text)))
    return { category: 'Annet', status: 'auto', kind: 'internal' };
  for (const r of rules) if (r.user && r.re.test(tx.text)) return { category: r.category, status: 'auto', kind: 'normal' };        // egne regler vinner
  if (isHouseholdPerson(tx.text, ownNames)) return { category: 'Annet', status: 'auto', kind: 'internal' };                          // overføring mellom oss
  for (const r of rules) if (!r.user && r.re.test(tx.text)) return { category: r.category, status: 'auto', kind: 'normal' };
  if (tx.amount > 0) return { category: 'Inntekt annet', status: 'uncertain', kind: 'normal' };
  return { category: 'Annet', status: 'uncertain', kind: 'normal' };
}

// Nøkkel som gjør «REMA 1000 GRUENERL» og «REMA 1000 MAJORSTUEN» like nok til å lære regel.
// Generelle ord foran (Avtalegiro til, Straksbetaling fra …) hoppes over så selve motparten blir nøkkelen.
const FILLER = new Set(['avtalegiro', 'nettgiro', 'straksbetaling', 'betaling', 'kjøp', 'kortkjøp', 'vipps', 'til', 'fra', 'overføring', 'iflg', 'melding', 'nr', 'e', 'faktura']);
export function ruleKey(text) {
  const words = text.toLowerCase().split(' – ')[0].replace(/\d{2}\.\d{2}|\d+/g, ' ').replace(/[^a-zæøå ]/g, ' ').trim().split(/\s+/);
  const rest = words.filter((w, i) => !(FILLER.has(w) && words.slice(0, i).every(x => FILLER.has(x))));
  return rest.slice(0, 2).join(' ');
}
