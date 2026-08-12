// IndexedDB-kääre. Viisi säiliötä:
//   kohteet     - yksi JSON-dokumentti per tarkastuskohde
//   kuvat       - raporttiin menevät 1600 px:n kuvat erikseen, jottei koko
//                 dokumenttia tarvitse sarjallistaa jokaisen tallennuksen
//                 yhteydessä
//   kamerakuvat - kameran ottamat täysikokoiset alkuperäiset, joita
//                 säilytetään vain puhelimeen tallennusta varten
//   liitteet    - kohteen muut tiedostot (energiatodistus, piirustukset...)
//   asetukset   - API-avain, malli, asetukset (yksi tietue)

const NIMI = 'kuntotarkastus';
const VERSIO = 3;   // 2: liitteet, 3: kamerakuvat

let _db = null;
let _versioVaihtui = null;

/**
 * Rekisteröi kutsun, joka ajetaan kun toinen välilehti päivittää tietokannan
 * uuteen versioon. Tämä yhteys on silloin suljettu eikä tallennus enää toimi,
 * joten sovelluksen on ladattava itsensä uudelleen.
 */
export function kunVersioVaihtuu(fn) {
  _versioVaihtui = fn;
}

function avaa() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const pyynto = indexedDB.open(NIMI, VERSIO);
    pyynto.onupgradeneeded = () => {
      const db = pyynto.result;
      if (!db.objectStoreNames.contains('kohteet')) {
        db.createObjectStore('kohteet', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('kuvat')) {
        const s = db.createObjectStore('kuvat', { keyPath: 'avain' });
        s.createIndex('kohdeId', 'kohdeId', { unique: false });
      }
      if (!db.objectStoreNames.contains('kamerakuvat')) {
        const s = db.createObjectStore('kamerakuvat', { keyPath: 'avain' });
        s.createIndex('kohdeId', 'kohdeId', { unique: false });
      }
      if (!db.objectStoreNames.contains('liitteet')) {
        const s = db.createObjectStore('liitteet', { keyPath: 'avain' });
        s.createIndex('kohdeId', 'kohdeId', { unique: false });
      }
      if (!db.objectStoreNames.contains('asetukset')) {
        db.createObjectStore('asetukset', { keyPath: 'id' });
      }
    };
    // Toinen välilehti pitää vanhaa versiota auki, jolloin päivitys ei etene.
    // Ilman tätä avaus jäisi roikkumaan ikuisesti ja sovellus näyttäisi
    // tyhjää ruutua ilman mitään virheilmoitusta.
    pyynto.onblocked = () => reject(new Error(
      'Sovellus on auki toisessa välilehdessä tai ikkunassa, eikä tietokantaa '
      + 'voitu päivittää. Sulje muut Kuntotarkastus-ikkunat ja avaa uudelleen.'));

    pyynto.onsuccess = () => {
      _db = pyynto.result;
      // Kun jokin toinen välilehti päivittää version, tämä yhteys on
      // suljettava — muuten se estäisi päivityksen samalla tavalla.
      _db.onversionchange = () => {
        _db.close();
        _db = null;
        _versioVaihtui?.();
      };
      resolve(_db);
    };
    pyynto.onerror = () => reject(pyynto.error);
  });
}

function tapahtuma(store, tila, tyo) {
  return avaa().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, tila);
    const s = tx.objectStore(store);
    let tulos;
    try {
      tulos = tyo(s);
    } catch (e) {
      reject(e);
      return;
    }
    // IDBRequestin arvo on .result — myös silloin kun se on undefined
    // (esim. get() jolla ei ole osumaa). Ilman tätä puuttuva tietue
    // palautuisi truthy-oliona ja "löytyisi" aina.
    tx.oncomplete = () => resolve(tulos instanceof IDBRequest ? tulos.result : tulos);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// --- Kohteet ----------------------------------------------------------------

export function haeKohteet() {
  return tapahtuma('kohteet', 'readonly', (s) => s.getAll());
}

export function haeKohde(id) {
  return tapahtuma('kohteet', 'readonly', (s) => s.get(id));
}

/**
 * @param {object} kohde
 * @param {boolean} [paivitaAikaleima] false kun tallennetaan pelkkää
 *   kirjanpitotietoa (esim. vientihetki) eikä sisältöä ole muutettu
 */
export function tallennaKohde(kohde, paivitaAikaleima = true) {
  if (paivitaAikaleima) kohde.muokattu = new Date().toISOString();
  return tapahtuma('kohteet', 'readwrite', (s) => s.put(kohde)).then(() => kohde);
}

export async function poistaKohde(id) {
  await poistaKohteenTiedostot('kuvat', id);
  await poistaKohteenTiedostot('kamerakuvat', id);
  await poistaKohteenTiedostot('liitteet', id);
  return tapahtuma('kohteet', 'readwrite', (s) => s.delete(id));
}

// --- Kuvat ja liitteet ------------------------------------------------------
//
// Molemmat sailiot ovat rakenteeltaan samat: { avain, kohdeId, blob }.
// Liitteilla on lisaksi nimi ja tyyppi, jotta ne saadaan vietya alkuperaisella
// tiedostonimellaan.

function tallennaTiedosto(store, tietue) {
  return tapahtuma(store, 'readwrite', (s) => s.put(tietue));
}

async function haeTiedosto(store, avain) {
  const tietue = await tapahtuma(store, 'readonly', (s) => s.get(avain));
  return tietue || null;
}

function poistaTiedosto(store, avain) {
  return tapahtuma(store, 'readwrite', (s) => s.delete(avain));
}

async function poistaKohteenTiedostot(store, kohdeId) {
  const db = await avaa();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const idx = tx.objectStore(store).index('kohdeId');
    const pyynto = idx.openCursor(IDBKeyRange.only(kohdeId));
    pyynto.onsuccess = () => {
      const kursori = pyynto.result;
      if (!kursori) return;
      kursori.delete();
      kursori.continue();
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function haeKohteenTiedostot(store, kohdeId) {
  const db = await avaa();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const idx = tx.objectStore(store).index('kohdeId');
    const pyynto = idx.getAll(IDBKeyRange.only(kohdeId));
    pyynto.onsuccess = () => resolve(pyynto.result);
    tx.onerror = () => reject(tx.error);
  });
}

export function tallennaKuva(avain, kohdeId, blob) {
  return tallennaTiedosto('kuvat', { avain, kohdeId, blob });
}

export async function haeKuva(avain) {
  const t = await haeTiedosto('kuvat', avain);
  return t ? t.blob : null;
}

export function poistaKuva(avain) {
  return poistaTiedosto('kuvat', avain);
}

/** Kaikki kohteen kuvat kerralla: { avain: Blob }. */
export async function haeKohteenKuvat(kohdeId) {
  const tulos = {};
  for (const t of await haeKohteenTiedostot('kuvat', kohdeId)) tulos[t.avain] = t.blob;
  return tulos;
}

// Kameran täysikokoiset alkuperäiset. Näitä säilytetään vain siihen asti että
// kuvat on tallennettu puhelimeen — ne vievät moninkertaisesti tilaa raporttiin
// meneviin 1600 px:n kuviin verrattuna.

export function tallennaKamerakuva(avain, kohdeId, blob) {
  return tallennaTiedosto('kamerakuvat', { avain, kohdeId, blob, koko: blob.size });
}

export async function haeKamerakuva(avain) {
  const t = await haeTiedosto('kamerakuvat', avain);
  return t ? t.blob : null;
}

export function poistaKamerakuva(avain) {
  return poistaTiedosto('kamerakuvat', avain);
}

export function poistaKohteenKamerakuvat(kohdeId) {
  return poistaKohteenTiedostot('kamerakuvat', kohdeId);
}

/** Montako alkuperäiskuvaa kohteella on tallessa ja paljonko ne vievät tilaa. */
export async function kamerakuvienTila(kohdeId) {
  const tiedostot = await haeKohteenTiedostot('kamerakuvat', kohdeId);
  return {
    maara: tiedostot.length,
    tavuja: tiedostot.reduce((s, t) => s + (t.koko || t.blob?.size || 0), 0),
  };
}

export function tallennaLiite(avain, kohdeId, nimi, blob) {
  return tallennaTiedosto('liitteet', {
    avain, kohdeId, nimi, blob, koko: blob.size, tyyppi: blob.type || '',
  });
}

export function poistaLiite(avain) {
  return poistaTiedosto('liitteet', avain);
}

/** Kohteen liitteet: [{ avain, nimi, koko, tyyppi, blob }] nimen mukaan. */
export async function haeKohteenLiitteet(kohdeId) {
  const tiedostot = await haeKohteenTiedostot('liitteet', kohdeId);
  return tiedostot.sort((a, b) => (a.nimi || '').localeCompare(b.nimi || '', 'fi'));
}

// --- Asetukset --------------------------------------------------------------

const OLETUSASETUKSET = {
  id: 'asetukset',
  apiAvain: '',
  malli: 'claude-opus-5',
  laheteKuvat: true,
  tarkastaja: '',
  sailytaAlkuperaiset: true,
};

export async function haeAsetukset() {
  const tallennettu = await tapahtuma('asetukset', 'readonly', (s) => s.get('asetukset'));
  return { ...OLETUSASETUKSET, ...(tallennettu || {}) };
}

export function tallennaAsetukset(asetukset) {
  return tapahtuma('asetukset', 'readwrite', (s) => s.put({ ...asetukset, id: 'asetukset' }));
}

/** Arvio käytetystä levytilasta, näytetään asetuksissa. */
export async function tilankaytto() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  return { kaytetty: usage || 0, kiintio: quota || 0 };
}

// --- Pysyvä tallennustila ----------------------------------------------------
//
// Ilman tätä selaimen tiedot ovat "best effort": Android voi tyhjentää ne
// muistin loppuessa, jolloin kesken oleva tarkastus katoaa. Chrome myöntää
// oikeuden todennäköisemmin, kun pyyntö tehdään käyttäjän eleestä ja sovellus
// on asennettu kotinäytölle.

export async function onkoTallennusPysyva() {
  if (!navigator.storage || !navigator.storage.persisted) return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

/** Pyytää pysyvää tallennustilaa. Palauttaa true/false, tai null jos ei tuettu. */
export async function pyydaPysyvaTallennus() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
