// Kuvan merkintätyökalu: nuoli, ympyröinti ja vapaa piirto.
//
// Raportissa lukija ei tiedä mihin kuvassa pitäisi katsoa. Nuoli halkeaman
// kohdalla kertoo sen heti, eikä kuvatekstiä tarvitse kirjoittaa auki.
//
// Merkinnät talletetaan suhteellisina koordinaatteina (0..1), jolloin sama
// piirros toimii sekä ruudulla näkyvässä pienennöksessä että tallennettavassa
// täysikokoisessa kuvassa.

const VARI = '#e02020';
const VIIVA_SUHDE = 0.006;   // viivanpaksuus suhteessa kuvan pitkään sivuun

export const TYOKALUT = [
  { id: 'nuoli',   nimi: 'Nuoli' },
  { id: 'ympyra',  nimi: 'Ympyrä' },
  { id: 'vapaa',   nimi: 'Piirto' },
];

function piirraMerkinnat(ctx, merkinnat, leveys, korkeus) {
  const paksuus = Math.max(2, Math.round(Math.max(leveys, korkeus) * VIIVA_SUHDE));
  ctx.strokeStyle = VARI;
  ctx.fillStyle = VARI;
  ctx.lineWidth = paksuus;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const m of merkinnat) {
    const x = (p) => p.x * leveys;
    const y = (p) => p.y * korkeus;

    if (m.tyyppi === 'vapaa') {
      if (m.pisteet.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(x(m.pisteet[0]), y(m.pisteet[0]));
      for (const p of m.pisteet.slice(1)) ctx.lineTo(x(p), y(p));
      ctx.stroke();

    } else if (m.tyyppi === 'ympyra') {
      const [a, b] = m.pisteet;
      ctx.beginPath();
      ctx.ellipse((x(a) + x(b)) / 2, (y(a) + y(b)) / 2,
        Math.abs(x(b) - x(a)) / 2, Math.abs(y(b) - y(a)) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();

    } else if (m.tyyppi === 'nuoli') {
      const [a, b] = m.pisteet;
      const x1 = x(a), y1 = y(a), x2 = x(b), y2 = y(b);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Kärki
      const kulma = Math.atan2(y2 - y1, x2 - x1);
      const pituus = paksuus * 4;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - pituus * Math.cos(kulma - Math.PI / 7),
                 y2 - pituus * Math.sin(kulma - Math.PI / 7));
      ctx.lineTo(x2 - pituus * Math.cos(kulma + Math.PI / 7),
                 y2 - pituus * Math.sin(kulma + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
    }
  }
}

/**
 * Avaa merkintänäkymän.
 * @param {Blob} kuvaBlob alkuperäinen kuva
 * @param {Array} [olemassaolevat] aiemmat merkinnät, jos kuvaa muokataan uudelleen
 * @returns {Promise<{blob: Blob, merkinnat: Array}|null>} null jos peruttiin
 */
export async function avaaMerkinta(kuvaBlob, olemassaolevat = []) {
  const url = URL.createObjectURL(kuvaBlob);
  const kuva = new Image();
  await new Promise((resolve, reject) => {
    kuva.onload = resolve;
    kuva.onerror = () => reject(new Error('Kuvaa ei voitu avata'));
    kuva.src = url;
  });

  const merkinnat = JSON.parse(JSON.stringify(olemassaolevat));
  let tyokalu = 'nuoli';
  let kesken = null;

  // --- Käyttöliittymä --------------------------------------------------------
  const peite = document.createElement('div');
  peite.className = 'merkinta-peite';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const alue = document.createElement('div');
  alue.className = 'merkinta-alue';
  alue.append(canvas);

  const tyokaluPalkki = document.createElement('div');
  tyokaluPalkki.className = 'merkinta-tyokalut';
  const tyokaluNapit = TYOKALUT.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.nimi;
    b.setAttribute('aria-pressed', String(t.id === tyokalu));
    b.addEventListener('click', () => {
      tyokalu = t.id;
      for (const nappi of tyokaluNapit) {
        nappi.setAttribute('aria-pressed', String(nappi === b));
      }
    });
    return b;
  });
  const kumoa = document.createElement('button');
  kumoa.type = 'button';
  kumoa.textContent = 'Kumoa';
  kumoa.addEventListener('click', () => { merkinnat.pop(); piirra(); });
  tyokaluPalkki.append(...tyokaluNapit, kumoa);

  const toiminnot = document.createElement('div');
  toiminnot.className = 'merkinta-toiminnot';
  const peruuta = document.createElement('button');
  peruuta.type = 'button';
  peruuta.textContent = 'Peruuta';
  const tallenna = document.createElement('button');
  tallenna.type = 'button';
  tallenna.className = 'ensisijainen';
  tallenna.textContent = 'Tallenna';
  toiminnot.append(peruuta, tallenna);

  peite.append(tyokaluPalkki, alue, toiminnot);
  document.body.append(peite);

  // --- Piirto ----------------------------------------------------------------
  function sovitaCanvas() {
    const leveys = alue.clientWidth;
    const korkeus = alue.clientHeight;
    const suhde = Math.min(leveys / kuva.width, korkeus / kuva.height);
    canvas.width = Math.round(kuva.width * suhde * devicePixelRatio);
    canvas.height = Math.round(kuva.height * suhde * devicePixelRatio);
    canvas.style.width = `${Math.round(kuva.width * suhde)}px`;
    canvas.style.height = `${Math.round(kuva.height * suhde)}px`;
    piirra();
  }

  function piirra() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(kuva, 0, 0, canvas.width, canvas.height);
    piirraMerkinnat(ctx, kesken ? [...merkinnat, kesken] : merkinnat,
      canvas.width, canvas.height);
  }

  function sijainti(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }

  const alkaa = (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = sijainti(e);
    kesken = { tyyppi: tyokalu, pisteet: [p, p] };
    piirra();
  };
  const liikkuu = (e) => {
    if (!kesken) return;
    e.preventDefault();
    const p = sijainti(e);
    if (kesken.tyyppi === 'vapaa') kesken.pisteet.push(p);
    else kesken.pisteet[1] = p;
    piirra();
  };
  const paattyy = () => {
    if (!kesken) return;
    // Vahingossa tullut napautus ei jätä merkintää.
    const [a, b] = [kesken.pisteet[0], kesken.pisteet[kesken.pisteet.length - 1]];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.01) merkinnat.push(kesken);
    kesken = null;
    piirra();
  };

  canvas.addEventListener('pointerdown', alkaa);
  canvas.addEventListener('pointermove', liikkuu);
  canvas.addEventListener('pointerup', paattyy);
  canvas.addEventListener('pointercancel', paattyy);
  window.addEventListener('resize', sovitaCanvas);

  // Sovitetaan heti (asettelu on luettavissa append():n jälkeen) ja vielä
  // kerran seuraavassa ruudunpiirrossa, jotta osoitepalkin piiloutuminen ja
  // näppäimistön sulkeutuminen eivät jätä canvasia väärän kokoiseksi.
  sovitaCanvas();
  requestAnimationFrame(sovitaCanvas);

  // --- Lopetus ---------------------------------------------------------------
  return new Promise((resolve) => {
    const sulje = (tulos) => {
      window.removeEventListener('resize', sovitaCanvas);
      peite.remove();
      URL.revokeObjectURL(url);
      resolve(tulos);
    };

    peruuta.addEventListener('click', () => sulje(null));

    tallenna.addEventListener('click', async () => {
      // Tallennus tehdään alkuperäisessä tarkkuudessa, ei ruudun koossa.
      const ulos = document.createElement('canvas');
      ulos.width = kuva.width;
      ulos.height = kuva.height;
      const uctx = ulos.getContext('2d');
      uctx.drawImage(kuva, 0, 0);
      piirraMerkinnat(uctx, merkinnat, ulos.width, ulos.height);
      const blob = await new Promise((r) => ulos.toBlob(r, 'image/jpeg', 0.85));
      sulje(blob ? { blob, merkinnat } : null);
    });
  });
}
