// Kuntotarkastuksen rakenne.
//
// Osionumerot vastaavat raporttipohjaa (Pohja/KUNTOTARKASTUS RAPORTTIPOHJA 2026.dotx),
// tarkastuskohtien listat työmaakirjaa (Pohja/KUNTOTARKASTUS TYÖMAAKIRJA.pdf).
// Tämä tiedosto ajaa koko käyttöliittymän — uusi tarkastuskohta = uusi rivi listaan.

export const TILAT = [
  { id: 'kunnossa',    lyhyt: 'OK',       nimi: 'Kunnossa',        huomautus: false },
  { id: 'osittain',    lyhyt: 'Osittain', nimi: 'Osittain',        huomautus: true  },
  { id: 'ei_kunnossa', lyhyt: 'Ei',       nimi: 'Ei kunnossa',     huomautus: true  },
  { id: 'ei_koske',    lyhyt: '–',        nimi: 'Ei koske',        huomautus: false },
];

export const KUVIA_PER_OSIO = 4;

// --- Mittaukset --------------------------------------------------------------
//
// Rakenneosakohtaiset kosteusmittaukset. Gannin pallopääanturi on
// pintakosteudenosoitin: se antaa suhteellisen lukeman ilman yksikköä, joten
// sen oletusyksikkö on tyhjä. Sovellus ei tulkitse lukemia eikä tunne
// raja-arvoja — arvion tekee tarkastaja.

export const MITTALAITTEET = [
  { id: 'gann',    nimi: 'Gann HYDROMETTE Compact B', yksikko: '' },
  { id: 'vaisala', nimi: 'Vaisala HM-40',             yksikko: 'RH %' },
  { id: 'muu',     nimi: 'Muu',                       yksikko: '' },
];

export const MITTAYKSIKOT = ['', 'RH %', '°C', 'g/m³', 'paino-%'];

/** Yksikön näyttömuoto: tyhjä yksikkö tarkoittaa suhteellista lukemaa. */
export function yksikonNimi(yksikko) {
  return yksikko || '–';
}

export function laitteenNimi(laiteId) {
  return MITTALAITTEET.find((l) => l.id === laiteId)?.nimi || laiteId || '';
}

// --- Lomakeosiot (raportin osiot 2, 3, 5, 6 + rajoitukset + päiväys) ---------

export const LAHTOTIEDOT = {
  id: 'lahtotiedot',
  nro: '2',
  nimi: 'Lähtötiedot',
  kentat: [
    { id: 'katuosoite',     nimi: 'Tarkastuskohteen katuosoite' },
    { id: 'asiakas',        nimi: 'Asiakas' },
    { id: 'puhelin',        nimi: 'Asiakkaan puh.', tyyppi: 'tel' },
    { id: 'sahkoposti',     nimi: 'Asiakkaan sähköposti', tyyppi: 'email' },
    { id: 'tyyppi',         nimi: 'Tyyppi', vihje: 'omakotitalo / rivitalo / paritalo' },
    { id: 'kayttotarkoitus',nimi: 'Käyttötarkoitus' },
    { id: 'kerrosala',      nimi: 'Kerrosala (kem²)' },
    { id: 'tilavuus',       nimi: 'Tilavuus' },
    { id: 'huoneistoala',   nimi: 'Huoneistoala' },
    { id: 'rakennusvuosi',  nimi: 'Rakennusvuosi' },
    { id: 'tarkastajat',    nimi: 'Tarkastaja(t)' },
    { id: 'lasnaolijat',    nimi: 'Läsnäolijat' },
    { id: 'tarkoitus',      nimi: 'Tarkastuksen tarkoitus', rivit: 2 },
    { id: 'ajankohta',      nimi: 'Tarkastuksen ajankohta' },
  ],
};

export const OLOSUHTEET = {
  id: 'olosuhteet',
  nro: '3',
  nimi: 'Tarkastushetken olosuhteet',
  kentat: [
    { id: 'sisa_rh',  nimi: 'Sisäilma RH %',   tyyppi: 'number' },
    { id: 'sisa_c',   nimi: 'Sisäilma °C',     tyyppi: 'number' },
    { id: 'sisa_g',   nimi: 'Sisäilma g/m³',   tyyppi: 'number' },
    { id: 'ulko_rh',  nimi: 'Ulkoilma RH %',   tyyppi: 'number' },
    { id: 'ulko_c',   nimi: 'Ulkoilma °C',     tyyppi: 'number' },
    { id: 'ulko_g',   nimi: 'Ulkoilma g/m³',   tyyppi: 'number' },
    { id: 'saa',      nimi: 'Sää / muut olosuhteet', rivit: 2 },
  ],
};

export const RAKENNUSTIEDOT = {
  id: 'rakennustiedot',
  nro: '5',
  nimi: 'Rakennusteknisiä tietoja',
  kentat: [
    { id: 'rakennustapa',      nimi: 'Kohteen pääasiallinen rakennustapa' },
    { id: 'perustukset',       nimi: 'Perustukset' },
    { id: 'alapohja',          nimi: 'Alapohjarakenteet' },
    { id: 'runko',             nimi: 'Runko- ja ulkoseinärakenteet' },
    { id: 'valiseinat',        nimi: 'Väliseinät' },
    { id: 'ylapohja',          nimi: 'Yläpohja' },
    { id: 'valipohja',         nimi: 'Välipohja' },
    { id: 'vesikate',          nimi: 'Vesikate ja kattomuoto' },
    { id: 'markatilat',        nimi: 'Märkätilojen runkorakenne ja pintamateriaalit' },
    { id: 'lammitys',          nimi: 'Lämmitysjärjestelmä' },
    { id: 'lammonjako',        nimi: 'Lämmönjako' },
    { id: 'oljysailio',        nimi: 'Öljysäiliö' },
    { id: 'vesi_viemari',      nimi: 'Vesi- ja viemärijärjestelmät' },
    { id: 'sahko',             nimi: 'Sähköjärjestelmät' },
    { id: 'ilmanvaihto',       nimi: 'Ilmanvaihtojärjestelmät' },
    { id: 'tulisijat',         nimi: 'Tulisijojen laatu ja toimivuustiedot' },
    { id: 'erityistilat',      nimi: 'Erityistilat' },
    { id: 'tehdyt_korjaukset', nimi: 'Tehdyt korjaus- ja muutostyöt', rivit: 2 },
    { id: 'suunnitellut',      nimi: 'Suunnitellut korjaukset', rivit: 2 },
  ],
};

export const LOMAKEOSIOT = [LAHTOTIEDOT, OLOSUHTEET, RAKENNUSTIEDOT];

// --- Tarkastusosiot (raportin osiot 7–23) -----------------------------------
//
// nro      = osion numero raporttipohjassa (kuvatiedostojen etuliite)
// kuvia    = kuvapaikkoja pohjassa (0 = LVIS-osiot, ei kuvia)
// kohdat   = työmaakirjan tarkastuskohdat
// monista  = osion voi kloonata (esim. toinen WC)

export const OSIOT = [
  {
    id: 'julkisivut', nro: '7', nimi: 'Julkisivut', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Julkisivuverhouksen ja pinnoitteen kunto',
      'Pielilistoitukset ja pellitykset',
      'Rakenteellisesti merkittävät halkeamat',
      'Tuuletuksen toimintaedellytykset',
      'Kosteusvauriot ja -jäljet, veden valumajäljet',
      'Räystäät',
      'Rakenteiden vaaka- ja pystysuoruus',
      'Ulkoseinärungon sisäpuoliset havainnot',
      'Ulkoseinärakenteessa ei havaittu riskirakenteita',
    ],
  },
  {
    id: 'ulkopuoli', nro: '8', nimi: 'Vierusta, salaojat ja sadevedet', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Korkeusasemat suhteessa maan tasoon',
      'Maanpintojen kallistus, pintakerros ja kosteusrasitukset',
      'Kasvillisuuden ja juuristojen aiheuttamat haitat salaojiin, perustuksiin ja US-rakenteisiin',
      'Sadevesien poistojärjestelmä',
      'Salaojajärjestelmän toimintaedellytykset',
      'Salaoja- ja sadevesijärjestelmien olemassaolo ja toimintaedellytykset',
      'Salaojaputkien korkeusasema salaojien tarkastuskaivosta',
      'Kaivojen puhtaus',
      'Ei havaittu riskirakenteita',
    ],
  },
  {
    id: 'ikkunat_ovet', nro: '9', nimi: 'Ikkunat ja ovet', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Ikkunoiden kunto',
      'Ovien käynti, tiivistys, lukitus',
      'Vesi- ja kynnyspeltien kallistukset ja niiden tiiveys',
      'Umpiolasielementtien harmaantuminen ja kosteuden sisäänpääsy',
      'Kattoikkunat ja niitä ympäröivät rakenteet',
      'Hätäpoistumistienä olevien ikkunoiden tai parvekeovien toimivuus ja palotikkaiden asianmukaisuus',
    ],
  },
  {
    id: 'rakenneosat', nro: '10', nimi: 'Julkisivun rakenneosat', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Rakenneosien liitosrakenteiden kiinnitykset, tiiveydet, läpiviennit ja pellitykset',
      'Rakenneosien alapintojen verhoilut ja tuulettuvuus',
      'Veden ja kosteuden poistumisen toimintaedellytykset ja kaivot',
    ],
  },
  {
    id: 'ylapohja', nro: '11', nimi: 'Yläpohja ja ullakko', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Ilmakanavien ja putkistojen eristykset',
      'Viemärien tuuletusputkien ja muiden putkien läpiviennit katolle',
      'Yläpohjatilaan päättyvät ilmakanavat tai viemärien tuuletusputket',
      'Aluskate ja sen ulottuvuus räystäälle ja läpiviennit',
      'Yläpohjan lämmöneristys',
      'Yläpohjan tuulettuvuuden toimintaedellytykset',
      'Palokatkot',
      'Näkyvät laho- ja mikrobivauriot sekä kosteusjäljet',
      'Kantavat rakenteet, niiden tuennat ja painumat',
      'Kulkusillat',
    ],
  },
  {
    id: 'vesikate', nro: '12', nimi: 'Vesikate, räystäät ja varusteet', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Vesikatteen kunto',
      'Läpiviennit ja niiden tiiveys',
      'Kulkusillat, talotikkaat ja lapetikkaat',
      'Räystäät, vesikourut, kattokaivot ja ulosheittäjät',
      'Lumiesteet',
    ],
  },
  {
    id: 'valiseinat', nro: '13', nimi: 'Sisäkatto ja väliseinät', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Rakenteellisesti merkittävät halkeamat ja painumat',
      'Kosteusvauriot ja -jäljet, vedenvalumajäljet',
      'Suoruuspoikkeamat',
      'Väliseinissä ei havaittu riskirakenteita',
    ],
  },
  {
    id: 'keittio', nro: '14', nimi: 'Keittiö', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Kosteuskartoitus vesipisteiden läheisyydessä',
      'Laatoituksen kopokartoitus',
      'Vesi- ja viemärilaitteiden kunto ja tiiveys',
      'Vesi- ja viemäriputkien kiinnitys',
      'Allaskaapin vuotovedenpitävyys',
      'Astianpesukoneen vuotovedenpitävyys',
      'Astiankuivauskaappi',
      'Silikoni- ja laattasaumat',
      'Lieden kaatumiseste',
      'Liesituuletin',
      'Kylmälaitteiden valumasuoja',
    ],
  },
  {
    id: 'pesuhuone', nro: '15', nimi: 'Pesuhuone', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Kosteuskartoitus',
      'Lattiakaivo',
      'Vedeneristys',
      'Lattian kallistukset',
      'Silikoni- ja lattiasaumat',
    ],
  },
  {
    // Kodinhoitohuone ei ole raporttipohjassa omana osionaan — se lisätään
    // raporttiin heti pesuhuoneen jälkeen ja osiot numeroidaan uudelleen.
    id: 'khh', nro: '15b', nimi: 'Kodinhoitohuone', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Kosteuskartoitus',
      'Lattiakaivo',
      'Vedeneristys',
    ],
  },
  {
    id: 'sauna', nro: '16', nimi: 'Sauna', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Kosteuskartoitus',
      'Lattiakaivo',
      'Vedeneristys',
      'Lattian kallistukset',
      'Silikoni- ja lattiasaumat',
      'Paneloinnin tuuletusrako ja kosteussulku',
      'Lauteet',
      'Turvallisuus',
    ],
  },
  {
    id: 'wc', nro: '17', nimi: 'WC', kuvia: KUVIA_PER_OSIO, monista: true,
    kohdat: [
      'Kosteuskartoitus',
      'Lattiakaivo',
      'Vedeneristys',
      'Lattian kallistukset',
      'Silikoni- ja lattiasaumat',
    ],
  },
  {
    id: 'tulisija', nro: '18', nimi: 'Tulisija', kuvia: KUVIA_PER_OSIO,
    kohdat: [
      'Tulisijan ulkopinnan kunto',
      'Tulipesän kunto',
      'Hormin ulkopinnan kunto',
      'Paloetäisyydet rakenteisiin',
      'Lattian palosuojaus',
      'Peltien toiminta',
    ],
  },
  {
    // Työmaakirjassa ei ole kellarille tarkastuskohtia — vapaa teksti + kuvat.
    id: 'kellari', nro: '19', nimi: 'Kellari', kuvia: KUVIA_PER_OSIO,
    kohdat: [],
  },
  {
    id: 'ilmanvaihto', nro: '20', nimi: 'Ilmanvaihtojärjestelmä', kuvia: 0,
    kohdat: [
      'Ilmanvaihtojärjestelmän tyyppi',
      'Sisäilman laatu',
    ],
  },
  {
    id: 'lammitys', nro: '21', nimi: 'Lämmitysjärjestelmä', kuvia: 0,
    kohdat: [
      'Lämmöntuottomenetelmä',
      'Lämmönjakojärjestelmä',
    ],
  },
  {
    id: 'sahko', nro: '22', nimi: 'Sähköjärjestelmä', kuvia: 0,
    kohdat: [
      'Yleistä sähköjärjestelmästä (tekniset käyttöiät, sulaketaulu, sähkömittari)',
      'Sähkökalusteet (kunto, asianmukaisuus, suojaukset)',
      'Palovaroittimet',
    ],
  },
  {
    id: 'vesi_viemari', nro: '23', nimi: 'Vesi ja viemäri', kuvia: 0,
    kohdat: [
      'Käyttövesiputkiston runko',
      'Viemäriputkiston kunto',
      'Käyttöveden laatu',
      'Vesijohdot ja vesimittari',
      'Lämminvesivaraaja',
    ],
  },
];

// --- Apufunktiot -------------------------------------------------------------

/** Osion perustiedot id:n perusteella. Kloonatut osiot ('wc#2') osaavat myös. */
export function osioMaaritys(osioId) {
  const perusId = osioId.split('#')[0];
  return OSIOT.find((o) => o.id === perusId) || null;
}

/** Näyttönimi, joka huomioi kloonit: 'wc#2' -> '2. WC'. */
export function osioNimi(osioId) {
  const m = osioMaaritys(osioId);
  if (!m) return osioId;
  const klooni = osioId.split('#')[1];
  return klooni ? `${klooni}. ${m.nimi}` : m.nimi;
}

/** Kuvatiedoston etuliite: 'julkisivut' -> '07-julkisivut', 'wc#2' -> '17b-wc'. */
export function kuvaEtuliite(osioId) {
  const m = osioMaaritys(osioId);
  if (!m) return osioId;
  const klooni = osioId.split('#')[1];
  const kirjain = klooni ? String.fromCharCode(96 + Number(klooni)) : ''; // 2 -> 'b'
  const nro = /^\d+$/.test(m.nro) ? m.nro.padStart(2, '0') : m.nro;
  return `${nro}${kirjain}-${m.id.split('#')[0]}`;
}

/** Kaikki osiotunnukset kohteessa, raportin järjestyksessä (kloonit mukana). */
export function osioJarjestys(kohde) {
  const tulos = [];
  for (const m of OSIOT) {
    tulos.push(m.id);
    if (!m.monista) continue;
    const kloonit = Object.keys(kohde.osiot || {})
      .filter((id) => id.startsWith(`${m.id}#`))
      .sort((a, b) => Number(a.split('#')[1]) - Number(b.split('#')[1]));
    tulos.push(...kloonit);
  }
  return tulos;
}
