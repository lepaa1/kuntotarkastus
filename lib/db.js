// IndexedDB-kääre. Kolme säiliötä:
//   kohteet    - yksi JSON-dokumentti per tarkastuskohde
//   kuvat      - kuvablobit erikseen, jottei koko dokumenttia tarvitse
//                sarjallistaa jokaisen tallennuksen yhteydessä
//   asetukset  - API-avain, malli, asetukset (yksi tietue)

const NIMI = 'kuntotarkastus';
const VERSIO = 1;

let _db = null;

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
      if (!db.objectStoreNames.contains('asetukset')) {
        db.createObjectStore('asetukset', { keyPath: 'id' });
      }
    };
    pyynto.onsuccess = () => { _db = pyynto.result; resolve(_db); };
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
    tx.oncomplete = () => resolve(tulos && tulos.result !== undefined ? tulos.result : tulos);
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

export function tallennaKohde(kohde) {
  kohde.muokattu = new Date().toISOString();
  return tapahtuma('kohteet', 'readwrite', (s) => s.put(kohde)).then(() => kohde);
}

export async function poistaKohde(id) {
  await poistaKohteenKuvat(id);
  return tapahtuma('kohteet', 'readwrite', (s) => s.delete(id));
}

// --- Kuvat ------------------------------------------------------------------

export function tallennaKuva(avain, kohdeId, blob) {
  return tapahtuma('kuvat', 'readwrite', (s) => s.put({ avain, kohdeId, blob }));
}

export async function haeKuva(avain) {
  const tietue = await tapahtuma('kuvat', 'readonly', (s) => s.get(avain));
  return tietue ? tietue.blob : null;
}

export function poistaKuva(avain) {
  return tapahtuma('kuvat', 'readwrite', (s) => s.delete(avain));
}

async function poistaKohteenKuvat(kohdeId) {
  const db = await avaa();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kuvat', 'readwrite');
    const idx = tx.objectStore('kuvat').index('kohdeId');
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

/** Kaikki kohteen kuvat kerralla: { avain: Blob }. */
export async function haeKohteenKuvat(kohdeId) {
  const db = await avaa();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kuvat', 'readonly');
    const idx = tx.objectStore('kuvat').index('kohdeId');
    const pyynto = idx.getAll(IDBKeyRange.only(kohdeId));
    pyynto.onsuccess = () => {
      const tulos = {};
      for (const t of pyynto.result) tulos[t.avain] = t.blob;
      resolve(tulos);
    };
    tx.onerror = () => reject(tx.error);
  });
}

// --- Asetukset --------------------------------------------------------------

const OLETUSASETUKSET = {
  id: 'asetukset',
  apiAvain: '',
  malli: 'claude-opus-5',
  laheteKuvat: true,
  tarkastaja: '',
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
