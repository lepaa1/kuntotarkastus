// Service worker: sovellus toimii ilman verkkoyhteyttä.
//
// Strategia: sovelluksen omat tiedostot haetaan verkosta ja tallennetaan
// välimuistiin (stale-while-revalidate). Jos verkkoa ei ole, palautetaan
// välimuistista. API-kutsuja ei koskaan välimuistiteta.

// TÄRKEÄÄ: kasvata versionumeroa aina kun julkaiset muutoksia. Selain asentaa
// service workerin uudelleen vain jos tämä tiedosto muuttuu — muuten puhelin
// voi jäädä käyttämään vanhaa versiota.
const VALIMUISTI = 'kuntotarkastus-v9';

const TIEDOSTOT = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './data/tarkastuskohdat.js',
  './lib/db.js',
  './lib/kuva.js',
  './lib/zip.js',
  './lib/vienti.js',
  './lib/tuonti.js',
  './lib/sanelu.js',
  './lib/merkinta.js',
  './lib/ai.js',
  './icons/ikoni-192.png',
  './icons/ikoni-512.png',
  './icons/ikoni-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VALIMUISTI)
      .then((c) => c.addAll(TIEDOSTOT))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((avaimet) => Promise.all(
        avaimet.filter((a) => a !== VALIMUISTI).map((a) => caches.delete(a))))
      .then(() => self.clients.claim()),
  );
});

// Sovellus kysyy käytössä olevan version, jotta Asetuksista näkee onko
// puhelimessa uusin julkaisu vai vanha välimuistiversio.
self.addEventListener('message', (e) => {
  if (e.data?.tyyppi !== 'versio') return;
  const vastaus = { tyyppi: 'versio', versio: VALIMUISTI };
  if (e.ports?.[0]) e.ports[0].postMessage(vastaus);
  else e.source?.postMessage(vastaus);
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;   // esim. api.anthropic.com

  e.respondWith((async () => {
    const valimuisti = await caches.open(VALIMUISTI);
    const tallennettu = await valimuisti.match(e.request);

    const verkosta = fetch(e.request).then((vastaus) => {
      if (vastaus && vastaus.ok) valimuisti.put(e.request, vastaus.clone());
      return vastaus;
    }).catch(() => null);

    if (tallennettu) {
      verkosta.catch(() => {});    // päivitetään taustalla
      return tallennettu;
    }
    const tuore = await verkosta;
    if (tuore) return tuore;
    return valimuisti.match('./index.html')
      || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
