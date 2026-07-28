// Claude API -integraatio.
//
// Kutsu tehdään suoraan selaimesta ilman välipalvelinta. Se vaatii otsakkeen
// anthropic-dangerous-direct-browser-access, joka sallii CORS-kutsun. Nimensä
// mukaisesti se tarkoittaa myös, että API-avain on laitteella luettavissa —
// avain syötetään vain asetuksissa, sitä ei koskaan kirjoiteta lähdekoodiin.

import {
  TILAT, LOMAKEOSIOT,
  osioMaaritys, osioNimi, osioJarjestys,
  yksikonNimi, laitteenNimi,
} from '../data/tarkastuskohdat.js';
import { haeKohteenKuvat } from './db.js';
import { skaalaa, base64, AI_LEVEYS, AI_LAATU } from './kuva.js';
import { osiollaSisaltoa } from './vienti.js';

const OSOITE = 'https://api.anthropic.com/v1/messages';
const API_VERSIO = '2023-06-01';
const MAX_TOKENIT = 32000;

const TILA_NIMI = Object.fromEntries(TILAT.map((t) => [t.id, t.nimi]));

// Hinnat $/miljoona tokenia. Käytetään vain kustannusarvion näyttämiseen.
export const HINNAT = {
  'claude-opus-5':   { sisaan: 5,  ulos: 25 },
  'claude-sonnet-5': { sisaan: 3,  ulos: 15 },
  'claude-haiku-4-5':{ sisaan: 1,  ulos: 5 },
};

export const MALLIT = [
  { id: 'claude-opus-5',   nimi: 'Claude Opus 5 (paras laatu)' },
  { id: 'claude-sonnet-5', nimi: 'Claude Sonnet 5 (edullisempi)' },
];

// --- Kehotteet ---------------------------------------------------------------

const JARJESTELMAKEHOTE = `Olet kokenut suomalainen rakennusalan kuntotarkastaja ja
kirjoitat kuntotarkastusraporttia asuntokauppaa varten (KH 90-00394 / suoritusohje).

Saat kentällä kirjatut tiedot: lähtötiedot, rakennustekniset tiedot ja jokaisen
rakennusosan tarkastuskohdat tiloineen (Kunnossa / Osittain / Ei kunnossa / Ei koske)
sekä tarkastajan huomautukset. Tehtäväsi on kirjoittaa jokaiselle osiolle kolme
tekstiä raporttipohjaan sekä kuvatekstit.

TEKSTIEN SISÄLTÖ
- Yleiskuvaus: mitä rakennusosa on — rakenne, materiaalit, ikä, näkyvät ratkaisut.
  Perustuu rakennusteknisiin tietoihin ja kuviin. 1–3 virkettä.
- Havainnot: mitä tarkastuksessa havaittiin. Kirjoita kaikki "Ei kunnossa"- ja
  "Osittain"-merkinnät huomautuksineen selkeäksi asiatekstiksi. Jos puutteita ei
  ollut, kirjoita että osiossa ei havaittu merkittäviä puutteita, ja mainitse
  mahdollinen riskirakenteiden puuttuminen jos se on rastitettu. Jos osiossa on
  mittauksia, mainitse mittauspaikat ja lukemat tekstissä — mutta älä tulkitse
  lukemia äläkä vertaa niitä raja-arvoihin, koska Gannin pintakosteudenosoitin
  antaa vain suhteellisen lukeman.
- Toimenpide-ehdotukset: konkreettiset korjaus- tai seurantatoimet vain niistä
  havainnoista, jotka on kirjattu. Jos ei ole korjattavaa, kirjoita että osio ei
  edellytä toimenpiteitä.
- Kuvatekstit: lyhyt kuvaava teksti jokaiselle kuvalle, esim.
  "Etelän julkisivu, rappauksen halkeama sokkelin yläpuolella". Älä numeroi —
  numerointi lisätään raporttiin automaattisesti.

EHDOTTOMAT SÄÄNNÖT
- Älä keksi havaintoja, mittausarvoja, kuntoluokkia, ikiä tai korjausehdotuksia,
  joille ei ole perustetta annetuissa tiedoissa tai kuvissa.
- Jos jokin kohta jäi kentällä kirjaamatta ja se on olennainen, kirjoita tekstiin
  näkyvästi TÄYDENNETTÄVÄ ja kerro mitä puuttuu. Älä täytä aukkoa arvauksella.
- Älä arvioi kustannuksia.
- Kirjoita asiallista, neutraalia suomen yleiskieltä passiivissa tai kolmannessa
  persoonassa ("julkisivussa havaittiin", ei "näin julkisivussa"). Ei markkinointia,
  ei liioittelua, ei dramatisointia.
- Älä käytä listamuotoilua, otsikoita tai markdownia — pelkkää leipätekstiä.
- Kirjoita täsmälleen ne osiot jotka syötteessä on, samoilla osio_id-arvoilla.
- Kuvatekstejä tulee tasan yhtä monta kuin osiolla on kuvia (0 jos ei kuvia).

Kirjoita myös tiivistelmä: kokonaisarvio kohteen kunnosta ja tärkeimmät havainnot
ja toimenpiteet, 1–2 kappaletta.`;

function skeema(osiotunnukset) {
  return {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: {
        tiivistelma: { type: 'string' },
        osiot: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              osio_id: { type: 'string', enum: osiotunnukset },
              yleiskuvaus: { type: 'string' },
              havainnot: { type: 'string' },
              toimenpide_ehdotukset: { type: 'string' },
              kuvatekstit: { type: 'array', items: { type: 'string' } },
            },
            required: ['osio_id', 'yleiskuvaus', 'havainnot', 'toimenpide_ehdotukset', 'kuvatekstit'],
            additionalProperties: false,
          },
        },
      },
      required: ['tiivistelma', 'osiot'],
      additionalProperties: false,
    },
  };
}

// --- Syötteen kokoaminen -----------------------------------------------------

function lomakeTiedot(kohde) {
  const tulos = {};
  for (const m of LOMAKEOSIOT) {
    const arvot = kohde.lomake?.[m.id] || {};
    const lohko = {};
    for (const k of m.kentat) {
      const arvo = (arvot[k.id] || '').trim();
      if (arvo) lohko[k.nimi] = arvo;
    }
    if (Object.keys(lohko).length) tulos[m.nimi] = lohko;
  }
  return tulos;
}

/** Osiot, joille AI kirjoittaa tekstit (tyhjät jätetään pois raportista). */
export function mukanaOlevatOsiot(kohde) {
  return osioJarjestys(kohde).filter((id) => osiollaSisaltoa(kohde, id));
}

function osioSyote(kohde, osioId) {
  const m = osioMaaritys(osioId);
  const o = kohde.osiot?.[osioId] || {};
  const kohdat = [];
  m.kohdat.forEach((teksti, i) => {
    const tila = o.tilat?.[i];
    if (!tila) return;
    const rivi = { kohta: teksti, tila: TILA_NIMI[tila] };
    const huom = (o.huomautukset?.[i] || '').trim();
    if (huom) rivi.huomautus = huom;
    kohdat.push(rivi);
  });

  const syote = {
    osio_id: osioId,
    otsikko: osioNimi(osioId),
    kuvia: (o.kuvat || []).length,
    tarkastuskohdat: kohdat,
  };
  if (o.muuta?.trim()) syote.muuta_huomioitavaa = o.muuta.trim();

  const mittaukset = o.mittaukset || [];
  if (mittaukset.length) {
    syote.mittaukset = mittaukset.map((m) => ({
      paikka: m.paikka || '',
      lukema: m.lukema,
      yksikko: yksikonNimi(m.yksikko),
      laite: laitteenNimi(m.laite),
      huomautus: m.huom?.trim() || undefined,
    }));
  }

  const omatTekstit = (o.kuvat || [])
    .map((k, i) => (k.teksti?.trim() ? `kuva ${i + 1}: ${k.teksti.trim()}` : null))
    .filter(Boolean);
  if (omatTekstit.length) syote.tarkastajan_kuvatekstit = omatTekstit;

  return syote;
}

export function teeSyote(kohde) {
  const osiot = mukanaOlevatOsiot(kohde);
  return {
    kohde: kohde.nimi || '',
    lahtotiedot: lomakeTiedot(kohde),
    rajoittavat_tekijat: (kohde.rajoitukset || '').trim() || null,
    tarkastajan_tiivistelmaluonnos: (kohde.tiivistelma || '').trim() || null,
    osiot: osiot.map((id) => osioSyote(kohde, id)),
  };
}

/** Kokoaa viestin sisältölohkot; kuvat liitetään osioittain otsikoituna. */
async function viestinSisalto(kohde, laheteKuvat, edistyminen) {
  const syote = teeSyote(kohde);
  const lohkot = [{
    type: 'text',
    text: 'Kentällä kirjatut tiedot JSON-muodossa:\n\n```json\n'
      + JSON.stringify(syote, null, 1)
      + '\n```\n\nKirjoita raporttitekstit näille osioille.',
  }];

  if (!laheteKuvat) return { lohkot, kuviaMukana: 0 };

  const blobit = await haeKohteenKuvat(kohde.id);
  let kuviaMukana = 0;
  const kaikki = mukanaOlevatOsiot(kohde)
    .flatMap((id) => (kohde.osiot?.[id]?.kuvat || []).map((k, i) => ({ id, kuva: k, i })));

  for (const { id, kuva, i } of kaikki) {
    const blob = blobit[kuva.avain];
    if (!blob) continue;
    edistyminen?.(`Valmistellaan kuvia (${kuviaMukana + 1}/${kaikki.length})…`);
    const pieni = await skaalaa(blob, AI_LEVEYS, AI_LAATU);
    lohkot.push({ type: 'text', text: `Osio ${id}, kuva ${i + 1}:` });
    lohkot.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: await base64(pieni) },
    });
    kuviaMukana++;
  }

  return { lohkot, kuviaMukana };
}

// --- Kustannusarvio ----------------------------------------------------------

/** Karkea arvio ennen lähetystä; todellinen kulutus luetaan vastauksen usage-kentästä. */
export function kustannusarvio(kohde, asetukset) {
  const teksti = JSON.stringify(teeSyote(kohde));
  const tekstiTokenit = Math.ceil(teksti.length / 3.2) + Math.ceil(JARJESTELMAKEHOTE.length / 3.2);

  const kuvia = asetukset.laheteKuvat
    ? mukanaOlevatOsiot(kohde).reduce((s, id) => s + (kohde.osiot?.[id]?.kuvat || []).length, 0)
    : 0;
  const kuvaTokenit = kuvia * 1600;   // ~1100 px pitkä sivu

  const osioita = mukanaOlevatOsiot(kohde).length;
  const ulosTokenit = 600 + osioita * 450;   // tiivistelmä + 3 tekstiä/osio + ajattelu

  const hinta = HINNAT[asetukset.malli] || HINNAT['claude-opus-5'];
  const sisaan = tekstiTokenit + kuvaTokenit;
  return {
    sisaanTokenit: sisaan,
    ulosTokenit,
    kuvia,
    osioita,
    dollaria: (sisaan / 1e6) * hinta.sisaan + (ulosTokenit / 1e6) * hinta.ulos,
  };
}

export function todellinenHinta(usage, malli) {
  if (!usage) return null;
  const h = HINNAT[malli] || HINNAT['claude-opus-5'];
  const sisaan = (usage.input_tokens || 0)
    + (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0);
  return (sisaan / 1e6) * h.sisaan + ((usage.output_tokens || 0) / 1e6) * h.ulos;
}

// --- Kutsu -------------------------------------------------------------------

/**
 * Lähettää kohteen Claude API:lle ja palauttaa jäsennellyn tuloksen.
 * @param {object} kohde
 * @param {object} asetukset { apiAvain, malli, laheteKuvat }
 * @param {(viesti: string, valmis?: number) => void} edistyminen
 * @param {AbortSignal} [signaali]
 */
export async function luoTekstit(kohde, asetukset, edistyminen, signaali) {
  if (!asetukset.apiAvain) throw new Error('API-avain puuttuu. Lisää se asetuksissa.');
  const osiotunnukset = mukanaOlevatOsiot(kohde);
  if (!osiotunnukset.length) {
    throw new Error('Yhdessäkään osiossa ei ole kirjauksia. Täytä ensin tarkastuskohtia.');
  }

  edistyminen('Valmistellaan syötettä…');
  const { lohkot, kuviaMukana } = await viestinSisalto(kohde, asetukset.laheteKuvat, edistyminen);

  edistyminen(`Lähetetään (${osiotunnukset.length} osiota, ${kuviaMukana} kuvaa)…`);

  const vastaus = await fetch(OSOITE, {
    method: 'POST',
    signal: signaali,
    headers: {
      'content-type': 'application/json',
      'x-api-key': asetukset.apiAvain,
      'anthropic-version': API_VERSIO,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: asetukset.malli,
      max_tokens: MAX_TOKENIT,
      stream: true,
      system: JARJESTELMAKEHOTE,
      output_config: { effort: 'high', format: skeema(osiotunnukset) },
      messages: [{ role: 'user', content: lohkot }],
    }),
  });

  if (!vastaus.ok) {
    let viesti = `HTTP ${vastaus.status}`;
    try {
      const virhe = await vastaus.json();
      viesti = virhe?.error?.message || viesti;
    } catch { /* runko ei ollut JSONia */ }
    throw new Error(`Claude API: ${viesti}`);
  }

  const { teksti, usage, stopReason } = await lueVirta(vastaus.body, edistyminen, signaali);

  if (stopReason === 'refusal') {
    throw new Error('Claude kieltäytyi vastaamasta tähän pyyntöön.');
  }
  if (stopReason === 'max_tokens') {
    throw new Error('Vastaus katkesi tokenirajaan. Kokeile pienemmällä määrällä osioita.');
  }

  let tulos;
  try {
    tulos = JSON.parse(teksti);
  } catch {
    throw new Error('Vastaus ei ollut kelvollista JSONia. Kokeile uudelleen.');
  }

  return { tulos, usage, kuviaMukana };
}

/** Lukee SSE-virran ja kerää tekstilohkojen sisällön. */
async function lueVirta(runko, edistyminen, signaali) {
  const lukija = runko.getReader();
  const purkain = new TextDecoder();
  let puskuri = '';
  let teksti = '';
  let usage = null;
  let stopReason = null;
  const lohkotyypit = {};   // sisältölohkon indeksi -> tyyppi

  try {
    for (;;) {
      if (signaali?.aborted) throw new DOMException('Peruttu', 'AbortError');
      const { done, value } = await lukija.read();
      if (done) break;
      puskuri += purkain.decode(value, { stream: true });

      let raja;
      while ((raja = puskuri.indexOf('\n\n')) !== -1) {
        const pala = puskuri.slice(0, raja);
        puskuri = puskuri.slice(raja + 2);

        for (const rivi of pala.split('\n')) {
          if (!rivi.startsWith('data:')) continue;
          const json = rivi.slice(5).trim();
          if (!json || json === '[DONE]') continue;

          let e;
          try { e = JSON.parse(json); } catch { continue; }

          switch (e.type) {
            case 'message_start':
              usage = e.message?.usage || null;
              edistyminen('Claude lukee aineistoa…');
              break;
            case 'content_block_start':
              lohkotyypit[e.index] = e.content_block?.type;
              if (e.content_block?.type === 'thinking') edistyminen('Claude miettii…');
              if (e.content_block?.type === 'text') edistyminen('Kirjoittaa tekstejä…');
              break;
            case 'content_block_delta':
              if (lohkotyypit[e.index] === 'text' && e.delta?.type === 'text_delta') {
                teksti += e.delta.text;
                edistyminen(`Kirjoittaa tekstejä… ${Math.round(teksti.length / 100) / 10} k merkkiä`);
              }
              break;
            case 'message_delta':
              if (e.delta?.stop_reason) stopReason = e.delta.stop_reason;
              if (e.usage) usage = { ...(usage || {}), ...e.usage };
              break;
            case 'error':
              throw new Error(e.error?.message || 'Tuntematon virhe virrassa');
            default:
              break;
          }
        }
      }
    }
  } finally {
    lukija.releaseLock?.();
  }

  if (!teksti.trim()) throw new Error('Claude ei palauttanut tekstiä.');
  return { teksti, usage, stopReason };
}

/** Kevyt testikutsu, jolla varmistetaan avain ja CORS ennen koko ajoa. */
export async function testaaYhteys(asetukset) {
  const vastaus = await fetch(OSOITE, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': asetukset.apiAvain,
      'anthropic-version': API_VERSIO,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: asetukset.malli,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Vastaa yhdellä sanalla: toimii' }],
    }),
  });
  if (!vastaus.ok) {
    const virhe = await vastaus.json().catch(() => null);
    throw new Error(virhe?.error?.message || `HTTP ${vastaus.status}`);
  }
  return true;
}
