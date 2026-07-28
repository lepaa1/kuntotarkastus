// Minimaalinen ZIP-kirjoitin ja -lukija ilman riippuvuuksia.
//
// Kirjoitus käyttää vain "store"-menetelmää (ei deflatea): kohteen sisällöstä
// 99 % on JPEG-kuvia, jotka ovat jo pakattuja, joten deflate ei toisi hyötyä
// mutta vaatisi ulkoisen kirjaston. Tekstitiedostot ovat muutamia kilotavuja.
//
// Luku osaa sekä "store"- että "deflate"-menetelmän, jotta myös Windowsissa
// uudelleenpakattu kansio voidaan tuoda takaisin sovellukseen. Deflate puretaan
// selaimen omalla DecompressionStreamillä.
//
// Rajoitukset: ei ZIP64, joten yksittäinen tiedosto ja koko arkisto < 4 GB.
// Kohteen koko on käytännössä 10–20 MB.

const CRC_TAULU = (() => {
  const taulu = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    taulu[i] = c >>> 0;
  }
  return taulu;
})();

function crc32(tavut) {
  let c = 0xffffffff;
  for (let i = 0; i < tavut.length; i++) {
    c = CRC_TAULU[(c ^ tavut[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Päivämäärä MS-DOS-muotoon (aika, päivä). */
function dosAika(pvm) {
  const vuosi = Math.max(1980, pvm.getFullYear());
  return {
    aika: (pvm.getHours() << 11) | (pvm.getMinutes() << 5) | (pvm.getSeconds() >> 1),
    pvm: ((vuosi - 1980) << 9) | ((pvm.getMonth() + 1) << 5) | pvm.getDate(),
  };
}

class Kirjoitin {
  constructor(pituus) {
    this.puskuri = new Uint8Array(pituus);
    this.nakyma = new DataView(this.puskuri.buffer);
    this.i = 0;
  }
  u16(v) { this.nakyma.setUint16(this.i, v, true); this.i += 2; }
  u32(v) { this.nakyma.setUint32(this.i, v >>> 0, true); this.i += 4; }
  tavut(t) { this.puskuri.set(t, this.i); this.i += t.length; }
}

/**
 * Rakentaa ZIP-arkiston.
 * @param {Array<{nimi: string, data: Uint8Array|Blob|string}>} tiedostot
 * @returns {Promise<Blob>}
 */
export async function teeZip(tiedostot) {
  const koodain = new TextEncoder();
  const { aika, pvm } = dosAika(new Date());

  // 1. Normalisoi sisällöt tavuiksi ja laske tarkisteet.
  const merkinnat = [];
  for (const t of tiedostot) {
    let data = t.data;
    if (typeof data === 'string') data = koodain.encode(data);
    else if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
    else if (!(data instanceof Uint8Array)) data = new Uint8Array(data);

    const nimi = koodain.encode(t.nimi.replace(/\\/g, '/'));
    merkinnat.push({ nimi, data, crc: crc32(data) });
  }

  // 2. Laske arkiston koko etukäteen, jotta selvitään yhdellä puskurilla.
  const paikallinenKoko = merkinnat.reduce((s, m) => s + 30 + m.nimi.length + m.data.length, 0);
  const keskusKoko = merkinnat.reduce((s, m) => s + 46 + m.nimi.length, 0);
  const k = new Kirjoitin(paikallinenKoko + keskusKoko + 22);

  // 3. Paikalliset otsakkeet + data.
  const siirtymat = [];
  for (const m of merkinnat) {
    siirtymat.push(k.i);
    k.u32(0x04034b50);
    k.u16(20);       // tarvittava versio
    k.u16(0x0800);   // lippu: nimet UTF-8:na
    k.u16(0);        // menetelmä: store
    k.u16(aika); k.u16(pvm);
    k.u32(m.crc);
    k.u32(m.data.length);   // pakattu koko
    k.u32(m.data.length);   // alkuperäinen koko
    k.u16(m.nimi.length);
    k.u16(0);        // ei lisäkenttiä
    k.tavut(m.nimi);
    k.tavut(m.data);
  }

  // 4. Keskushakemisto.
  const keskusAlku = k.i;
  merkinnat.forEach((m, idx) => {
    k.u32(0x02014b50);
    k.u16(20);       // luoneen ohjelman versio
    k.u16(20);       // tarvittava versio
    k.u16(0x0800);
    k.u16(0);
    k.u16(aika); k.u16(pvm);
    k.u32(m.crc);
    k.u32(m.data.length);
    k.u32(m.data.length);
    k.u16(m.nimi.length);
    k.u16(0);        // lisäkentät
    k.u16(0);        // kommentti
    k.u16(0);        // levy
    k.u16(0);        // sisäiset määreet
    k.u32(0);        // ulkoiset määreet
    k.u32(siirtymat[idx]);
    k.tavut(m.nimi);
  });

  // 5. Loppumerkintä.
  k.u32(0x06054b50);
  k.u16(0); k.u16(0);
  k.u16(merkinnat.length);
  k.u16(merkinnat.length);
  k.u32(keskusKoko);
  k.u32(keskusAlku);
  k.u16(0);

  return new Blob([k.puskuri], { type: 'application/zip' });
}

// --- Luku --------------------------------------------------------------------

async function puraDeflate(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Selain ei osaa purkaa pakattua ZIP-tiedostoa');
  }
  const virta = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(virta).arrayBuffer());
}

/** Etsii loppumerkinnän (EOCD) lopusta päin. */
function etsiLoppumerkinta(nakyma, pituus) {
  // Kommentti voi olla enintään 65535 tavua, joten pidemmälle ei tarvitse etsiä.
  const raja = Math.max(0, pituus - 65557);
  for (let i = pituus - 22; i >= raja; i--) {
    if (nakyma.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * Lukee ZIP-arkiston.
 * @param {Blob} blob
 * @returns {Promise<Array<{nimi: string, data: Uint8Array}>>}
 */
export async function lueZip(blob) {
  const tavut = new Uint8Array(await blob.arrayBuffer());
  const n = new DataView(tavut.buffer);
  const purkain = new TextDecoder('utf-8');

  const eocd = etsiLoppumerkinta(n, tavut.length);
  if (eocd < 0) throw new Error('Tiedosto ei ole kelvollinen ZIP-paketti');

  const maara      = n.getUint16(eocd + 10, true);
  const keskusAlku = n.getUint32(eocd + 16, true);

  const tulos = [];
  let p = keskusAlku;
  for (let i = 0; i < maara; i++) {
    if (n.getUint32(p, true) !== 0x02014b50) {
      throw new Error('ZIP-paketin hakemisto on vioittunut');
    }
    const menetelma  = n.getUint16(p + 10, true);
    const pakattuKoko = n.getUint32(p + 20, true);
    const nimiPituus = n.getUint16(p + 28, true);
    const lisaPituus = n.getUint16(p + 30, true);
    const kommPituus = n.getUint16(p + 32, true);
    const paikallinen = n.getUint32(p + 42, true);
    // Nimet luetaan UTF-8:na. Sovelluksen omat paketit merkitsevat sen lipulla;
    // muissa ASCII-nimet toimivat joka tapauksessa.
    //
    // Kenoviivat normalisoidaan: PowerShellin Compress-Archive kirjoittaa
    // polkuerottimeksi "\", vaikka ZIP-standardi vaatii "/".
    const nimi = purkain
      .decode(tavut.subarray(p + 46, p + 46 + nimiPituus))
      .replace(/\\/g, '/');
    p += 46 + nimiPituus + lisaPituus + kommPituus;

    if (nimi.endsWith('/')) continue;   // kansiomerkinta

    // Paikallisen otsakkeen nimi- ja lisakenttien pituudet voivat poiketa
    // keskushakemiston vastaavista, joten ne luetaan uudelleen.
    if (n.getUint32(paikallinen, true) !== 0x04034b50) {
      throw new Error(`Tiedoston ${nimi} otsake on vioittunut`);
    }
    const pNimi = n.getUint16(paikallinen + 26, true);
    const pLisa = n.getUint16(paikallinen + 28, true);
    const alku  = paikallinen + 30 + pNimi + pLisa;
    const raaka = tavut.subarray(alku, alku + pakattuKoko);

    let data;
    if (menetelma === 0) data = raaka;
    else if (menetelma === 8) data = await puraDeflate(raaka);
    else throw new Error(`Tiedosto ${nimi} on pakattu tuntemattomalla menetelmällä`);

    tulos.push({ nimi, data });
  }

  return tulos;
}
