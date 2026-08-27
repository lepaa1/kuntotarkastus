// Kohteen palautus vientipaketista.
//
// Vastinpari lib/vienti.js:lle. Lukee sovelluksen tuottaman ZIP-paketin ja
// palauttaa kohteen tietoineen, kuvineen ja liitteineen IndexedDB:hen — joko
// varmuuskopiosta tai toisesta puhelimesta.
//
// Kuvat tunnistetaan tiedostonimen perusteella samalla säännöllä jolla ne
// vietiin (kuvatiedostonNimi), joten paketin ei tarvitse sisältää avaimia.

import * as db from './db.js';
import { lueZip } from './zip.js';
import { kaikkiKuvat } from './vienti.js';

function uusiAvain(kohdeId, laji) {
  return `${kohdeId}/${laji}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Poimii tiedoston polun loppuosan perusteella (kansiotaso voi vaihdella). */
function etsi(tiedostot, loppu) {
  return tiedostot.find((t) => t.nimi === loppu || t.nimi.endsWith(`/${loppu}`)) || null;
}

/**
 * Lukee paketin ja kertoo mitä se sisältää — ilman että mitään tallennetaan.
 * Näin käyttäjälle voidaan näyttää mitä ollaan tuomassa ja onko id jo käytössä.
 */
export async function esikatseleTuonti(blob) {
  const tiedostot = await lueZip(blob);
  const json = etsi(tiedostot, 'tarkastus.json');
  if (!json) {
    throw new Error('Paketista ei löytynyt tarkastus.json-tiedostoa. '
      + 'Onko tämä sovelluksen tuottama paketti?');
  }

  let kohde;
  try {
    kohde = JSON.parse(new TextDecoder('utf-8').decode(json.data));
  } catch {
    throw new Error('tarkastus.json on vioittunut');
  }
  if (!kohde || typeof kohde !== 'object' || !kohde.id) {
    throw new Error('tarkastus.json ei sisällä kelvollista kohdetta');
  }

  const liitteet = tiedostot.filter((t) => /(^|\/)lisatiedot\//.test(t.nimi));
  const kuvia = kaikkiKuvat(kohde).length;

  return {
    tiedostot,
    kohde,
    kuvia,
    liitteita: liitteet.length,
    onJoOlemassa: Boolean(await db.haeKohde(kohde.id)),
  };
}

/**
 * Tallentaa esikatsellun paketin.
 * @param {object} esikatselu esikatseleTuonti():n palauttama olio
 * @param {'korvaa'|'kopio'} tapa mitä tehdään jos kohde on jo olemassa
 */
export async function tuoKohde(esikatselu, tapa = 'korvaa') {
  const { tiedostot } = esikatselu;
  // Kopioidaan, jottei esikatselun kohdetta muokata paikan päällä — käyttäjä
  // voi perua ja yrittää toisella tavalla.
  const kohde = JSON.parse(JSON.stringify(esikatselu.kohde));

  if (esikatselu.onJoOlemassa && tapa === 'kopio') {
    kohde.id = `k_${Date.now().toString(36)}`;
    kohde.nimi = `${kohde.nimi || 'Kohde'} (kopio)`;
  } else if (esikatselu.onJoOlemassa) {
    // Korvataan: vanhat kuvat ja liitteet pois, jottei jää roskaa.
    await db.poistaKohde(kohde.id);
  }

  let puuttuvia = 0;

  // Kuvat: sama nimeämissääntö kuin viennissä, sekä osion omat kuvat että
  // tarkastuskohtien lähikuvat.
  for (const { osioId, kuva, nimi } of kaikkiKuvat(kohde)) {
    const tiedosto = etsi(tiedostot, `kuvat/${nimi}`);
    if (!tiedosto) { puuttuvia++; continue; }
    const avain = uusiAvain(kohde.id, osioId);
    await db.tallennaKuva(avain, kohde.id, new Blob([tiedosto.data], { type: 'image/jpeg' }));
    kuva.avain = avain;
    // Paketissa on vain merkitty versio, ei alkuperäistä. Merkinnät ovat siis
    // jo poltettuina kuvaan — jos ne jätettäisiin talteen, uusi merkintäkerta
    // piirtäisi ne toiseen kertaan päälle.
    delete kuva.alkuperaAvain;
    delete kuva.merkinnat;
    // Kameran taysikokoisia alkuperaisia ei viedä pakettiin.
    delete kuva.kameraAvain;
  }

  // Liitteet.
  let liitteita = 0;
  for (const t of tiedostot) {
    const osuma = t.nimi.match(/(?:^|\/)lisatiedot\/(.+)$/);
    if (!osuma) continue;
    await db.tallennaLiite(
      uusiAvain(kohde.id, 'liite'), kohde.id, osuma[1], new Blob([t.data]));
    liitteita++;
  }

  await db.tallennaKohde(kohde);
  return { kohde, puuttuvia, liitteita };
}
