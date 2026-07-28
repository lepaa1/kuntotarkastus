// Kuvien käsittely: kameran/gallerian kuva pienennetään JPEG:ksi ennen
// tallennusta. Puhelimen alkuperäinen 12 Mpix -kuva on ~4 MB; 1600 px
// pitkällä sivulla päästään ~300 kt:iin ilman että raportin kuvalaatu kärsii
// (raporttipohjan kuvapaikka on n. 6,5 cm leveä).

export const TALLENNUS_LEVEYS = 1600;   // pitkä sivu tallennettaessa
export const TALLENNUS_LAATU = 0.82;
export const AI_LEVEYS = 1100;          // pitkä sivu AI:lle (~1600 tokenia/kuva)
export const AI_LAATU = 0.75;

/**
 * Lataa kuvan bittikartaksi EXIF-kierto huomioiden.
 * Vanhempi Safari ei tue imageOrientation-valintaa, jolloin palataan <img>-tagiin.
 */
async function bittikartta(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      /* jatketaan varareitille */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Kuvaa ei voitu lukea'));
      img.src = url;
    });
    return img;
  } finally {
    // URL vapautetaan vasta piirron jälkeen, joten annetaan selaimen hoitaa
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function mitat(kuva) {
  return {
    w: kuva.width || kuva.naturalWidth,
    h: kuva.height || kuva.naturalHeight,
  };
}

/** Skaalaa kuvan niin että pitkä sivu on enintään `maxSivu`, palauttaa JPEG-blobin. */
export async function skaalaa(blob, maxSivu = TALLENNUS_LEVEYS, laatu = TALLENNUS_LAATU) {
  const kuva = await bittikartta(blob);
  const { w, h } = mitat(kuva);
  if (!w || !h) throw new Error('Kuvan mittoja ei saatu luettua');

  const kerroin = Math.min(1, maxSivu / Math.max(w, h));
  const uusiW = Math.round(w * kerroin);
  const uusiH = Math.round(h * kerroin);

  const canvas = document.createElement('canvas');
  canvas.width = uusiW;
  canvas.height = uusiH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(kuva, 0, 0, uusiW, uusiH);
  if (kuva.close) kuva.close();

  const tulos = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', laatu));
  if (!tulos) throw new Error('Kuvan pakkaus epäonnistui');
  return tulos;
}

/** Blob → base64 (ilman data:-etuliitettä), Claude API:n image-lohkoa varten. */
export function base64(blob) {
  return new Promise((resolve, reject) => {
    const lukija = new FileReader();
    lukija.onload = () => {
      const tulos = String(lukija.result);
      resolve(tulos.slice(tulos.indexOf(',') + 1));
    };
    lukija.onerror = () => reject(lukija.error);
    lukija.readAsDataURL(blob);
  });
}

/** Karkea tokenimääräarvio kuvalle (leveys × korkeus / 750). */
export function tokeniarvio(leveys, korkeus) {
  return Math.ceil((leveys * korkeus) / 750);
}

export function muotoileKoko(tavut) {
  if (tavut < 1024) return `${tavut} t`;
  if (tavut < 1024 * 1024) return `${(tavut / 1024).toFixed(0)} kt`;
  return `${(tavut / 1024 / 1024).toFixed(1)} Mt`;
}
