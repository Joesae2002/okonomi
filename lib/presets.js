// Budsjettforslag. Dette er ESTIMATER, ikke offisiell statistikk for par. Se `basis` per linje.
// Kildene er hentet fra søkeresultater (selve sidene var ikke åpne for oss), så bør sjekkes mot originalen.
export const SOURCES = {
  nso: { name: 'NSO Studentbudsjettet 2026 (enslig student 18–30 år, bygger på SIFOs referansebudsjett)', url: 'https://student.no/images/02_dokumenter/Studentbudsjettet/Studentbudsjettet_2026.pdf' },
  nso25: { name: 'NSO Studentbudsjettet 2025/26 (SSB-snitt husleie 1-roms leilighet, klær og sko)', url: 'https://student.no/images/02_dokumenter/Studentbudsjettet/Studentbudsjettet_2025.pdf' },
  sb1: { name: 'SpareBank 1: eksempel studentbudsjett høst 2026 (én person, delt leilighet)', url: 'https://www.sparebank1.no/nb/bank/privat/tips-og-rad/hvordan-sette-opp-et-studentbudsjett.html' },
  sifo: { name: 'SIFO referansebudsjettet (OsloMet)', url: 'https://www.oslomet.no/om/sifo/referansebudsjettet' },
  ssb: { name: 'SSB: Studentbudsjett, analyse av studenters inntekter og levekostnader (Eurostudent)', url: 'https://www.ssb.no/utdanning/hoyere-utdanning/artikler/studentbudsjett-en-analyse-av-studenters-manedlige-inntekter-og-levekostnader' },
};

const per = (kilde, enslig) => ({ enslig, belop: enslig * 2, basis: `${enslig.toLocaleString('nb-NO')} kr per student × 2 personer`, kilde });

export const STUDENT_PAR = {
  navn: 'Student-par (gift, 2 personer, ca. 24 år): estimat',
  merknad: 'Ingen kilde jeg fant har et ferdig budsjett for studentpar. Forslaget er bygget av tall for enslige studenter. Personlige poster er doblet, og husleie er ikke doblet. Poster uten kilde er latt stå tomme. Juster etter egen husleie og strømavtale.',
  linjer: [
    { kategori: 'Mat', ...per('nso', 4695), basis: '4 695 kr per student × 2 (kan bli lavere ved felles innkjøp)' },
    { kategori: 'Transport', ...per('nso', 612) },
    { kategori: 'Klær', ...per('nso25', 1085) },
    { kategori: 'Bolig', belop: 8400, kilde: 'nso25', basis: '8 400 kr, SSB-snitt husleie for 1-roms leilighet, én felles bolig (ikke doblet)' },
    { kategori: 'Strøm', belop: 450, kilde: 'sb1', basis: '450 kr, eksempel for én person i delt leilighet (usikker for to personer)' },
  ],
  ikkeDekket: 'Forsikring, helse, abonnement, fritid, reise, gaver og gebyr er ikke med, fordi jeg ikke fant en kilde med tall for dem. Fyll inn selv.',
};

export const presetTotal = p => p.linjer.reduce((s, l) => s + l.belop, 0);
