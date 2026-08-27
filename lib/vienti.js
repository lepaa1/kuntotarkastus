// Kohteen vienti ZIP-paketiksi, joka puretaan sellaisenaan Kohteet/-kansioon.
//
// Sisältö:
//   muistiinpanot.md   Kohteet/_MALLI-kohde/muistiinpanot.md -rungon mukainen,
//                      AI:n täyttämät tekstit jos AI-vaihe on ajettu
//   tyomaakirja.md     tarkastuskohtien rastit ja huomautukset taulukkona
//   tarkastus.json     koko raakadata (uudelleenajoa ja varmuuskopiointia varten)
//   kuvat/             07-julkisivut-1.jpg jne.

import {
  LOMAKEOSIOT, TILAT,
  osioMaaritys, osioNimi, kuvaEtuliite, osioJarjestys,
  yksikonNimi, laitteenNimi,
} from '../data/tarkastuskohdat.js';
import { haeKohteenKuvat, haeKohteenLiitteet } from './db.js';
import { teeZip } from './zip.js';

const TILA_NIMI = Object.fromEntries(TILAT.map((t) => [t.id, t.nimi]));

// Windowsissa tiedostonimissä kielletyt merkit. Välilyönnit säilytetään,
// koska Kohteet/-kansiossa on jo esim. "Poikkikuja 3".
const KIELLETYT_MERKIT = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

export function kansionNimi(kohde) {
  const nimi = (kohde.nimi || 'Tuntematon kohde').trim();
  const puhdistettu = Array.from(nimi)
    .map((merkki) => {
      if (KIELLETYT_MERKIT.includes(merkki)) return '-';
      return merkki.codePointAt(0) < 32 ? '' : merkki;
    })
    .join('')
    .replace(/\.+$/, '')      // Windows ei salli loppupistettä
    .trim();
  return puhdistettu || 'Kohde';
}

/** Onko osiossa mitään kirjattua? Tyhjät osiot jätetään raportista pois. */
export function osiollaSisaltoa(kohde, osioId) {
  const o = kohde.osiot?.[osioId];
  if (!o || o.poissa) return false;
  const tiloja = Object.values(o.tilat || {}).some((t) => t && t !== 'ei_koske');
  const kohtakuvia = Object.values(o.kohtakuvat || {}).some((k) => (k || []).length);
  return Boolean(tiloja || o.muuta?.trim() || (o.kuvat || []).length
    || (o.mittaukset || []).length || kohtakuvia);
}

/** Mittausrivin tekstimuoto: "Lattia suihkun edessä: 78 (Gann ...)". */
function mittausRivi(m) {
  const yksikko = m.yksikko ? ` ${m.yksikko}` : '';
  const laite = m.laite ? ` (${laitteenNimi(m.laite)})` : '';
  const huom = m.huom?.trim() ? ` — ${m.huom.trim()}` : '';
  return `${m.paikka || 'Mittauspiste'}: ${m.lukema}${yksikko}${laite}${huom}`;
}

/** Kuvan tiedostonimi paketissa. Tuonti käyttää samaa sääntöä käänteisesti. */
export function kuvatiedostonNimi(osioId, jarjestys) {
  return `${kuvaEtuliite(osioId)}-${jarjestys + 1}.jpg`;
}

/**
 * Tarkastuskohdan lähikuvan tiedostonimi: osion etuliite, k + kohdan numero,
 * juokseva numero. Esim. 07-julkisivut-k4-1.jpg = osion 7 neljännen
 * tarkastuskohdan ensimmäinen kuva. Nimi lajittuu osion omien kuvien perään.
 */
export function kohtaKuvatiedostonNimi(osioId, kohtaIndex, jarjestys) {
  return `${kuvaEtuliite(osioId)}-k${kohtaIndex + 1}-${jarjestys + 1}.jpg`;
}

/**
 * Kaikki kohteen kuvat vientinimineen: ensin osion omat kuvat, sitten
 * tarkastuskohtien lähikuvat. Yhteinen lähde viennille, tuonnille ja
 * puhelimeen tallennukselle, jottei nimeäminen pääse eriytymään.
 */
export function kaikkiKuvat(kohde) {
  const lista = [];
  for (const osioId of osioJarjestys(kohde)) {
    const o = kohde.osiot?.[osioId] || {};
    (o.kuvat || []).forEach((kuva, i) => {
      lista.push({ osioId, kuva, nimi: kuvatiedostonNimi(osioId, i) });
    });
    for (const avain of Object.keys(o.kohtakuvat || {}).map(Number).sort((a, b) => a - b)) {
      (o.kohtakuvat[avain] || []).forEach((kuva, j) => {
        lista.push({
          osioId, kohtaIndex: avain, kuva, nimi: kohtaKuvatiedostonNimi(osioId, avain, j),
        });
      });
    }
  }
  return lista;
}

// --- muistiinpanot.md --------------------------------------------------------

function lomakeLohko(kohde, maaritys) {
  const arvot = kohde.lomake?.[maaritys.id] || {};
  const rivit = maaritys.kentat.map((k) => `- ${k.nimi}: ${(arvot[k.id] || '').trim()}`);
  return `## ${maaritys.nro}. ${maaritys.nimi}\n${rivit.join('\n')}\n`;
}

/** Havainnot-teksti rasteista, kun AI:ta ei ole ajettu. */
function havainnotRasteista(kohde, osioId) {
  const m = osioMaaritys(osioId);
  const o = kohde.osiot?.[osioId] || {};
  const puutteet = [];
  (m?.kohdat || []).forEach((teksti, i) => {
    const tila = o.tilat?.[i];
    if (tila !== 'ei_kunnossa' && tila !== 'osittain') return;
    const huom = (o.huomautukset?.[i] || '').trim();
    puutteet.push(`${teksti} — ${TILA_NIMI[tila]}${huom ? `: ${huom}` : ''}`);
  });
  if (o.muuta?.trim()) puutteet.push(o.muuta.trim());
  if (!puutteet.length) return 'Ei merkittäviä puutteita.';
  return puutteet.map((p) => `\n  - ${p}`).join('');
}

function osioLohko(kohde, osioId, aiOsio) {
  const m = osioMaaritys(osioId);
  const o = kohde.osiot?.[osioId] || {};
  const rivit = [
    `## ${m.nro}. ${osioNimi(osioId)}`,
    `- Yleiskuvaus: ${aiOsio?.yleiskuvaus?.trim() || ''}`,
    `- Havainnot: ${aiOsio?.havainnot?.trim() || havainnotRasteista(kohde, osioId)}`,
    `- Toimenpide-ehdotukset: ${aiOsio?.toimenpide_ehdotukset?.trim() || ''}`,
  ];

  const mittaukset = o.mittaukset || [];
  if (mittaukset.length) {
    rivit.push(`- Mittaukset:${mittaukset.map((x) => `\n  - ${mittausRivi(x)}`).join('')}`);
  }

  if (m.kuvia > 0) {
    const kuvat = o.kuvat || [];
    if (!kuvat.length) {
      rivit.push('- Kuvat:');
    } else {
      const kuvarivit = kuvat.map((kuva, i) => {
        const teksti = (kuva.teksti || aiOsio?.kuvatekstit?.[i] || '').trim();
        return `\n  - ${kuvatiedostonNimi(osioId, i)}${teksti ? `: ${teksti}` : ''}`;
      });
      rivit.push(`- Kuvat:${kuvarivit.join('')}`);
    }
  }

  // Tarkastuskohtien lähikuvat omana listanaan. Kuvatekstin sijasta mukaan
  // tulee tarkastuskohdan teksti, tila ja huomautus — se on raportin
  // kuvatekstiä varten parempi lähtötieto kuin erikseen kirjoitettu teksti.
  const kohtakuvarivit = [];
  for (const avain of Object.keys(o.kohtakuvat || {}).map(Number).sort((a, b) => a - b)) {
    const kuvat = o.kohtakuvat[avain] || [];
    if (!kuvat.length) continue;
    const teksti = m.kohdat[avain] || `Tarkastuskohta ${avain + 1}`;
    const tila = o.tilat?.[avain];
    const huom = (o.huomautukset?.[avain] || '').trim();
    const konteksti = `${teksti}${tila ? ` — ${TILA_NIMI[tila]}` : ''}${huom ? `: ${huom}` : ''}`;
    kuvat.forEach((kuva, j) => {
      kohtakuvarivit.push(`\n  - ${kohtaKuvatiedostonNimi(osioId, avain, j)}: ${konteksti}`);
    });
  }
  if (kohtakuvarivit.length) {
    rivit.push(`- Tarkastuskohtien kuvat:${kohtakuvarivit.join('')}`);
  }

  return `${rivit.join('\n')}\n`;
}

export function teeMuistiinpanot(kohde) {
  const ai = kohde.ai?.tulos || null;
  const aiOsiot = {};
  for (const o of ai?.osiot || []) aiOsiot[o.osio_id] = o;

  const osat = [
    '# Kohteen muistiinpanot',
    '',
    '> Tuotettu Kuntotarkastus-sovelluksella. Rastit ja huomautukset ovat',
    '> tiedostossa tyomaakirja.md, koko raakadata tiedostossa tarkastus.json.',
    ai
      ? '> Tekstit on laatinut Claude kentällä kirjattujen havaintojen pohjalta —'
        + ' tarkista ne ennen raportin viimeistelyä.'
      : '> HUOM: AI-vaihetta ei ole ajettu, joten Yleiskuvaus- ja'
        + ' Toimenpide-ehdotukset-kohdat ovat tyhjiä.',
    '',
    '---',
    '',
  ];

  osat.push(lomakeLohko(kohde, LOMAKEOSIOT[0]));  // 2. Lähtötiedot

  osat.push(
    '## Huomioitavaa / tarkastusta rajoittavat tekijät',
    (kohde.rajoitukset || '').trim() || '-',
    '',
  );

  osat.push(lomakeLohko(kohde, LOMAKEOSIOT[1]));  // 3. Olosuhteet
  osat.push(lomakeLohko(kohde, LOMAKEOSIOT[2]));  // 5. Rakennustekniset tiedot

  osat.push(
    '## 6. Tiivistelmä',
    (ai?.tiivistelma || kohde.tiivistelma || '').trim() || '-',
    '',
    '---',
    '',
    '> RAKENNUSOSAT JA TILAT',
    '',
  );

  const mukana = [];
  const poisjatetyt = [];
  for (const osioId of osioJarjestys(kohde)) {
    if (osiollaSisaltoa(kohde, osioId)) mukana.push(osioId);
    else poisjatetyt.push(osioNimi(osioId));
  }

  for (const osioId of mukana) {
    osat.push(osioLohko(kohde, osioId, aiOsiot[osioId]));
  }

  if (poisjatetyt.length) {
    osat.push(
      '---',
      '',
      '## Kohteesta puuttuvat / tyhjäksi jääneet osiot',
      '> Nämä poistetaan raportista kokonaan.',
      poisjatetyt.map((n) => `- ${n}`).join('\n'),
      '',
    );
  }

  osat.push(
    '---',
    '',
    '## Allekirjoituksen päiväys',
    `- Raportin päiväys: ${(kohde.paivays || '').trim()}`,
    '',
  );

  return osat.join('\n');
}

// --- tyomaakirja.md ----------------------------------------------------------

export function teeTyomaakirja(kohde) {
  const osat = [
    `# Työmaakirja — ${kohde.nimi || ''}`,
    '',
    `Tarkastuksen ajankohta: ${kohde.lomake?.lahtotiedot?.ajankohta || ''}`,
    `Tarkastaja(t): ${kohde.lomake?.lahtotiedot?.tarkastajat || ''}`,
    '',
  ];

  for (const osioId of osioJarjestys(kohde)) {
    const m = osioMaaritys(osioId);
    const o = kohde.osiot?.[osioId] || {};
    if (!osiollaSisaltoa(kohde, osioId)) continue;

    osat.push(`## ${m.nro}. ${osioNimi(osioId)}`, '');
    if (m.kohdat.length) {
      osat.push('| Tarkastuskohta | Tila | Huomautus |', '| --- | --- | --- |');
      m.kohdat.forEach((teksti, i) => {
        const tila = o.tilat?.[i];
        const huom = (o.huomautukset?.[i] || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
        osat.push(`| ${teksti} | ${tila ? TILA_NIMI[tila] : '—'} | ${huom} |`);
      });
      osat.push('');
    }
    const mittaukset = o.mittaukset || [];
    if (mittaukset.length) {
      osat.push('**Mittaukset**', '',
        '| Paikka | Lukema | Yksikkö | Laite | Huomautus |', '| --- | --- | --- | --- | --- |');
      for (const x of mittaukset) {
        const solu = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
        osat.push(`| ${solu(x.paikka)} | ${solu(x.lukema)} | ${yksikonNimi(x.yksikko)} `
          + `| ${laitteenNimi(x.laite)} | ${solu(x.huom)} |`);
      }
      osat.push('');
    }

    if (o.muuta?.trim()) {
      osat.push(`**Muuta huomioitavaa:** ${o.muuta.trim()}`, '');
    }
  }

  return osat.join('\n');
}

// --- ZIP ---------------------------------------------------------------------

export async function teeVientiPaketti(kohde) {
  const kansio = kansionNimi(kohde);
  const kuvablobit = await haeKohteenKuvat(kohde.id);

  const tiedostot = [
    { nimi: `${kansio}/muistiinpanot.md`, data: teeMuistiinpanot(kohde) },
    { nimi: `${kansio}/tyomaakirja.md`, data: teeTyomaakirja(kohde) },
    { nimi: `${kansio}/tarkastus.json`, data: JSON.stringify(kohde, null, 2) },
  ];

  let puuttuvia = 0;
  for (const { kuva, nimi } of kaikkiKuvat(kohde)) {
    const blob = kuvablobit[kuva.avain];
    if (!blob) { puuttuvia++; continue; }
    tiedostot.push({ nimi: `${kansio}/kuvat/${nimi}`, data: blob });
  }

  // Liitteet menevät lisatiedot/-kansioon, samaan paikkaan johon ne on tähän
  // asti kopioitu käsin koneella.
  const kaytetytNimet = new Set();
  for (const liite of await haeKohteenLiitteet(kohde.id)) {
    let nimi = liite.nimi || 'liite';
    if (kaytetytNimet.has(nimi)) {
      const piste = nimi.lastIndexOf('.');
      const runko = piste > 0 ? nimi.slice(0, piste) : nimi;
      const pate = piste > 0 ? nimi.slice(piste) : '';
      let i = 2;
      while (kaytetytNimet.has(`${runko} (${i})${pate}`)) i++;
      nimi = `${runko} (${i})${pate}`;
    }
    kaytetytNimet.add(nimi);
    tiedostot.push({ nimi: `${kansio}/lisatiedot/${nimi}`, data: liite.blob });
  }

  const zip = await teeZip(tiedostot);
  return { zip, kansio, tiedostoja: tiedostot.length, puuttuvia };
}

/** Jakaa paketin Web Share API:lla tai lataa tiedostona. */
export async function jaaTaiLataa(zip, tiedostonimi) {
  const tiedosto = new File([zip], tiedostonimi, { type: 'application/zip' });

  if (navigator.canShare && navigator.canShare({ files: [tiedosto] })) {
    try {
      await navigator.share({ files: [tiedosto], title: tiedostonimi });
      return 'jaettu';
    } catch (e) {
      if (e.name === 'AbortError') return 'peruttu';
      // Jos jako epäonnistuu muusta syystä, pudotaan lataukseen.
    }
  }

  const url = URL.createObjectURL(zip);
  const a = document.createElement('a');
  a.href = url;
  a.download = tiedostonimi;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'ladattu';
}
