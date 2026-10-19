// Logoer for faste utgifter. Domene slås opp fra navnet; ukjente får en bokstav-avatar.
const DOMAINS = [
  [/netflix/, 'netflix.com'], [/spotify/, 'spotify.com'], [/hbo ?max|\bhbo\b|max\.com/, 'max.com'], [/viaplay/, 'viaplay.no'], [/disney/, 'disneyplus.com'],
  [/apple\.com|\bapple\b|itunes/, 'apple.com'], [/icloud/, 'icloud.com'], [/youtube/, 'youtube.com'], [/google/, 'google.com'], [/storytel/, 'storytel.com'],
  [/tv ?2/, 'tv2.no'], [/\bnrk\b/, 'nrk.no'], [/telenor/, 'telenor.no'], [/telia/, 'telia.no'], [/\bice\b/, 'ice.no'], [/\bmova\b/, 'mova.no'],
  [/claude|anthropic/, 'claude.ai'], [/openai|chatgpt/, 'openai.com'], [/microsoft|office 365|xbox/, 'microsoft.com'], [/adobe/, 'adobe.com'], [/dropbox/, 'dropbox.com'],
  [/prime video|amazon/, 'amazon.com'], [/\bsats\b/, 'sats.no'], [/gjensidige/, 'gjensidige.no'], [/\btryg\b/, 'tryg.no'], [/fremtind/, 'fremtind.no'], [/\bif skade|\bif forsikring/, 'if.no'],
  [/tibber/, 'tibber.com'], [/fjordkraft/, 'fjordkraft.no'], [/tr[øo]nderenergi/, 'tronderenergi.no'], [/vipps/, 'vipps.no'], [/sbanken/, 'sbanken.no'],
  [/strava/, 'strava.com'], [/linkedin/, 'linkedin.com'], [/github/, 'github.com'], [/audible/, 'audible.com'], [/paramount/, 'paramountplus.com'], [/dazn/, 'dazn.com'],
  [/aftenposten/, 'aftenposten.no'], [/\bkrik\b/, 'krik.no'], [/nasjonalfor/, 'nasjonalforeningen.no'], [/adresseavisen|adressa/, 'adressa.no'], [/\bvg\b/, 'vg.no'], [/dn\.no|dagens n/, 'dn.no'], [/ruter/, 'ruter.no'], [/\batb\b/, 'atb.no'],
];
export const domainFor = label => { const l = String(label).toLowerCase(); const hit = DOMAINS.find(([re]) => re.test(l)); return hit ? hit[1] : null; };
export const logoUrl = domain => `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(domain)}`;
export const initials = label => String(label).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
export const avatarHue = label => [...String(label)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
