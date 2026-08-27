// Kuntotarkastus-sovellus: näkymät, navigaatio ja tilanhallinta.

import * as db from './lib/db.js';
import * as vienti from './lib/vienti.js';
import * as tuonti from './lib/tuonti.js';
import * as ai from './lib/ai.js';
import { skaalaa, muotoileKoko } from './lib/kuva.js';
import { liitaSanelu, saneluTuettu } from './lib/sanelu.js';
import { avaaMerkinta } from './lib/merkinta.js';
import {
  TILAT, LOMAKEOSIOT, OSIOT, MITTALAITTEET, MITTAYKSIKOT, KUVIA_PER_KOHTA,
  osioMaaritys, osioNimi, osioJarjestys, yksikonNimi,
} from './data/tarkastuskohdat.js';

const YLAPALKKI = document.getElementById('ylapalkki');
const OTSIKKO = document.getElementById('otsikko');
const TAKAISIN = document.getElementById('takaisin');
const KOTI = document.getElementById('koti');
const VALIKKO = document.getElementById('valikko');
const SISALTO = document.getElementById('sisalto');
const ALAPALKKI = document.getElementById('alapalkki');
const ILMOITUS = document.getElementById('ilmoitus');
const DIALOGI = document.getElementById('dialogi');

let asetukset = null;
let kohde = null;               // avoinna oleva kohde
let tallennusPysyva = null;     // null = ei tiedossa / ei tuettu
const kuvaUrlit = new Map();    // avain -> object URL, vapautetaan näkymän vaihtuessa
let tallennusAjastin = null;
let tallentamatta = false;      // onko muutoksia, joita ei ole vielä kirjoitettu
let rekisterointi = null;       // service workerin rekisteröinti, päivitystä varten

// --- DOM-apurit --------------------------------------------------------------

function h(tag, props, ...lapset) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'textContent') e[k] = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const lapsi of lapset.flat(Infinity)) {
    if (lapsi == null || lapsi === false) continue;
    e.append(lapsi.nodeType ? lapsi : document.createTextNode(String(lapsi)));
  }
  return e;
}

let ilmoitusAjastin = null;
function ilmoita(teksti, virhe = false) {
  ILMOITUS.textContent = teksti;
  ILMOITUS.className = virhe ? 'virhe' : '';
  ILMOITUS.hidden = false;
  clearTimeout(ilmoitusAjastin);
  ilmoitusAjastin = setTimeout(() => { ILMOITUS.hidden = true; }, virhe ? 6000 : 2800);
}

function vahvista(viesti, vahvistaTeksti = 'Poista') {
  return new Promise((resolve) => {
    const sulje = (tulos) => { DIALOGI.close(); resolve(tulos); };
    DIALOGI.querySelector('#dialogi-sisalto').replaceChildren(
      h('p', null, viesti),
      h('div', { class: 'napit' },
        h('button', { onclick: () => sulje(false) }, 'Peruuta'),
        h('button', { class: 'ensisijainen', onclick: () => sulje(true) }, vahvistaTeksti)),
    );
    DIALOGI.addEventListener('cancel', () => resolve(false), { once: true });
    DIALOGI.showModal();
  });
}

/** Monivalintadialogi. Palauttaa valitun id:n tai null. */
function valitse(viesti, vaihtoehdot) {
  return new Promise((resolve) => {
    const sulje = (tulos) => { DIALOGI.close(); resolve(tulos); };
    DIALOGI.querySelector('#dialogi-sisalto').replaceChildren(
      h('p', null, viesti),
      h('div', { class: 'napit' },
        h('button', { onclick: () => sulje(null) }, 'Peruuta'),
        ...vaihtoehdot.map((v) =>
          h('button', { class: 'ensisijainen', onclick: () => sulje(v.id) }, v.teksti))),
    );
    DIALOGI.addEventListener('cancel', () => resolve(null), { once: true });
    DIALOGI.showModal();
  });
}

function kysy(viesti, oletus = '') {
  return new Promise((resolve) => {
    const kentta = h('input', { value: oletus, autofocus: true });
    const sulje = (tulos) => { DIALOGI.close(); resolve(tulos); };
    DIALOGI.querySelector('#dialogi-sisalto').replaceChildren(
      h('label', null, viesti),
      kentta,
      h('div', { class: 'napit' },
        h('button', { onclick: () => sulje(null) }, 'Peruuta'),
        h('button', { class: 'ensisijainen', onclick: () => sulje(kentta.value.trim()) }, 'OK')),
    );
    kentta.addEventListener('keydown', (e) => { if (e.key === 'Enter') sulje(kentta.value.trim()); });
    DIALOGI.addEventListener('cancel', () => resolve(null), { once: true });
    DIALOGI.showModal();
    setTimeout(() => kentta.focus(), 50);
  });
}

// --- Tallennus ---------------------------------------------------------------

function tallennaPian() {
  tallentamatta = true;
  clearTimeout(tallennusAjastin);
  tallennusAjastin = setTimeout(() => {
    if (!kohde) return;
    tallentamatta = false;
    db.tallennaKohde(kohde).catch((e) => ilmoita(`Tallennus epäonnistui: ${e.message}`, true));
  }, 300);
}

function tallennaHeti() {
  clearTimeout(tallennusAjastin);
  tallentamatta = false;
  return kohde ? db.tallennaKohde(kohde) : Promise.resolve();
}

function osioTila(osioId) {
  if (!kohde.osiot[osioId]) {
    kohde.osiot[osioId] = {
      tilat: {}, huomautukset: {}, muuta: '', kuvat: [], kohtakuvat: {}, poissa: false,
    };
  }
  // Vanhemmilla kohteilla ei ole kohtakuvia; lisätään puuttuva kenttä lennossa.
  if (!kohde.osiot[osioId].kohtakuvat) kohde.osiot[osioId].kohtakuvat = {};
  return kohde.osiot[osioId];
}

/**
 * Yhden tarkastuskohdan kuvat lukemista varten. Ei luo taulukkoa: muuten
 * jokaisesta piirretystä kohdasta jäisi tyhjä taulukko tarkastus.json:iin.
 */
function kohdanKuvat(osioId, i) {
  return osioTila(osioId).kohtakuvat[i] || [];
}

// --- Navigaatio --------------------------------------------------------------

function siirry(polku) { location.hash = polku; }

function vapautaUrlit() {
  for (const url of kuvaUrlit.values()) URL.revokeObjectURL(url);
  kuvaUrlit.clear();
}

async function reititys() {
  vapautaUrlit();
  ALAPALKKI.hidden = true;
  ALAPALKKI.replaceChildren();
  SISALTO.scrollTop = 0;

  const osat = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  TAKAISIN.hidden = osat.length === 0;
  // Kotinappi vie avoinna olevan tarkastuksen etusivulle. Sitä ei näytetä
  // kohdelistassa, asetuksissa eikä kohdenäkymässä itsessään.
  KOTI.hidden = !['lomake', 'osio', 'ai'].includes(osat[0]);

  try {
    if (osat.length === 0) return await naytaKohdelista();
    if (osat[0] === 'asetukset') return await naytaAsetukset();

    const [nakyma, kohdeId, lisa] = osat;
    if (!kohde || kohde.id !== kohdeId) {
      kohde = await db.haeKohde(kohdeId);
      if (!kohde) { siirry('/'); return; }
    }

    if (nakyma === 'kohde') return await naytaKohde();
    if (nakyma === 'lomake') return await naytaLomake(lisa);
    if (nakyma === 'osio') return await naytaOsio(decodeURIComponent(lisa));
    if (nakyma === 'ai') return await naytaAI();
    siirry('/');
  } catch (e) {
    console.error(e);
    SISALTO.replaceChildren(h('div', { class: 'kortti' },
      h('h2', null, 'Virhe'), h('p', null, e.message)));
  }
}

// --- Näkymä: kohdelista ------------------------------------------------------

async function naytaKohdelista() {
  kohde = null;
  OTSIKKO.textContent = 'Kuntotarkastus';
  const kohteet = (await db.haeKohteet())
    .sort((a, b) => (b.muokattu || '').localeCompare(a.muokattu || ''));

  const lista = kohteet.map((k) => {
    const osioita = osioJarjestys(k).filter((id) => vienti.osiollaSisaltoa(k, id)).length;
    const kuvia = vienti.kaikkiKuvat(k).length;
    return h('button', { class: 'kortti kohde-rivi', onclick: () => siirry(`/kohde/${k.id}`) },
      h('span', { class: 'nimi' },
        k.nimi || 'Nimetön kohde',
        h('span', { class: 'meta' },
          `${osioita} osiota · ${kuvia} kuvaa · muokattu ${pvm(k.muokattu)}`),
        k.ai ? h('span', { class: 'meta' }, '✓ raporttitekstit luotu') : null),
      h('span', { class: 'himmea' }, '›'));
  });

  const varoitus = tallennusPysyva === false
    ? h('div', { class: 'kortti varoitus' },
      h('strong', null, 'Tallennustila ei ole pysyvä'),
      h('p', null, 'Puhelin voi tyhjentää sovelluksen tiedot muistin loppuessa. '
        + 'Vie kohde paketiksi heti tarkastuksen jälkeen, niin työ ei ole vain '
        + 'yhden tallennuspaikan varassa.'))
    : null;

  SISALTO.replaceChildren(
    varoitus,
    h('h2', null, 'Kohteet'),
    lista.length ? h('div', null, lista)
      : h('div', { class: 'kortti himmea' },
        'Ei vielä kohteita. Aloita uudella tarkastuksella tai tuo paketti.'),
  );

  const tuontiValitsin = h('input', {
    type: 'file', accept: '.zip,application/zip', style: 'display:none',
    onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) tuoPaketti(f); },
  });

  ALAPALKKI.hidden = false;
  ALAPALKKI.replaceChildren(
    h('button', { onclick: () => tuontiValitsin.click() }, 'Tuo paketti'),
    tuontiValitsin,
    h('button', { class: 'ensisijainen', onclick: uusiKohde }, '+ Uusi tarkastus'));
}

async function tuoPaketti(tiedosto) {
  ilmoita('Luetaan pakettia…');
  let esikatselu;
  try {
    esikatselu = await tuonti.esikatseleTuonti(tiedosto);
  } catch (e) {
    ilmoita(e.message, true);
    return;
  }

  const { kohde: tuotava, kuvia, liitteita, onJoOlemassa } = esikatselu;
  const kuvaus = `${tuotava.nimi || 'Nimetön kohde'} — ${kuvia} kuvaa, ${liitteita} liitettä`;

  let tapa = 'korvaa';
  if (onJoOlemassa) {
    const valinta = await valitse(
      `Kohde "${tuotava.nimi}" on jo sovelluksessa.`,
      [{ id: 'korvaa', teksti: 'Korvaa' }, { id: 'kopio', teksti: 'Tuo kopiona' }]);
    if (!valinta) return;
    tapa = valinta;
  } else if (!await vahvista(`Tuodaanko ${kuvaus}?`, 'Tuo')) {
    return;
  }

  try {
    const { kohde: tuotu, puuttuvia } = await tuonti.tuoKohde(esikatselu, tapa);
    ilmoita(puuttuvia
      ? `Tuotu, mutta ${puuttuvia} kuvaa puuttui paketista.`
      : 'Kohde tuotu.', puuttuvia > 0);
    siirry(`/kohde/${tuotu.id}`);
  } catch (e) {
    ilmoita(`Tuonti epäonnistui: ${e.message}`, true);
  }
}

function pvm(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function tanaan() {
  const d = new Date();
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

async function uusiKohde() {
  const nimi = await kysy('Kohteen osoite tai nimi', '');
  if (nimi === null) return;

  // Pysyvää tallennustilaa kannattaa pyytää käyttäjän eleestä: selain myöntää
  // sen silloin todennäköisemmin kuin sivun latauksen yhteydessä.
  if (tallennusPysyva !== true) {
    tallennusPysyva = await db.pyydaPysyvaTallennus();
  }

  const paiva = tanaan();
  const uusi = {
    id: `k_${Date.now().toString(36)}`,
    nimi: nimi || 'Nimetön kohde',
    luotu: new Date().toISOString(),
    lomake: {
      lahtotiedot: {
        katuosoite: nimi,
        tarkastajat: asetukset.tarkastaja || '',
        ajankohta: paiva,
      },
      olosuhteet: {},
      rakennustiedot: {},
    },
    tiivistelma: '',
    rajoitukset: '',
    paivays: paiva,
    osiot: {},
  };
  await db.tallennaKohde(uusi);
  kohde = uusi;
  siirry(`/kohde/${uusi.id}`);
}

// --- Näkymä: kohteen osiolista -----------------------------------------------

function osioEdistyminen(osioId) {
  const m = osioMaaritys(osioId);
  const o = kohde.osiot?.[osioId] || {};
  const tayttyi = m.kohdat.filter((_, i) => o.tilat?.[i]).length;
  const puutteita = m.kohdat.some((_, i) =>
    o.tilat?.[i] === 'ei_kunnossa' || o.tilat?.[i] === 'osittain');
  return {
    tayttyi,
    yhteensa: m.kohdat.length,
    kuvia: (o.kuvat || []).length,
    puutteita,
    poissa: Boolean(o.poissa),
    aloitettu: vienti.osiollaSisaltoa(kohde, osioId),
  };
}

async function naytaKohde() {
  OTSIKKO.textContent = kohde.nimi || 'Kohde';

  const lomakeRivit = LOMAKEOSIOT.map((m) => {
    const arvot = kohde.lomake?.[m.id] || {};
    const taytetty = m.kentat.filter((k) => (arvot[k.id] || '').trim()).length;
    return h('button', {
      class: `kortti osio-rivi${taytetty === m.kentat.length ? ' valmis' : ''}`,
      onclick: () => siirry(`/lomake/${kohde.id}/${m.id}`),
    },
      h('span', { class: 'nro' }, m.nro),
      h('span', { class: 'nimi' }, m.nimi),
      h('span', { class: 'tila' }, `${taytetty}/${m.kentat.length}`),
      h('span', { class: 'himmea' }, '›'));
  });

  const osioRivit = [];
  for (const osioId of osioJarjestys(kohde)) {
    const m = osioMaaritys(osioId);
    const e = osioEdistyminen(osioId);
    let luokka = 'kortti osio-rivi';
    if (e.puutteita) luokka += ' puutteita';
    else if (e.aloitettu && e.tayttyi === e.yhteensa) luokka += ' valmis';

    let tilaTeksti;
    if (e.poissa) tilaTeksti = 'ei kohteessa';
    else if (!e.aloitettu) tilaTeksti = '—';
    else if (e.puutteita) tilaTeksti = `${e.tayttyi}/${e.yhteensa} · puutteita`;
    else tilaTeksti = `${e.tayttyi}/${e.yhteensa}`;

    osioRivit.push(h('button', {
      class: luokka,
      onclick: () => siirry(`/osio/${kohde.id}/${encodeURIComponent(osioId)}`),
    },
      h('span', { class: 'nro' }, m.nro),
      h('span', { class: 'nimi' }, osioNimi(osioId),
        m.kuvia > 0 ? h('span', { class: 'meta himmea' }, ` ${e.kuvia}/${m.kuvia} kuvaa`) : null),
      h('span', { class: 'tila' }, tilaTeksti),
      h('span', { class: 'himmea' }, '›')));
  }

  const monistettavat = OSIOT.filter((m) => m.monista).map((m) =>
    h('button', { onclick: () => monistaOsio(m.id) }, `+ Lisää toinen ${m.nimi}`));

  SISALTO.replaceChildren(
    h('h2', null, 'Perustiedot'),
    h('div', null, lomakeRivit),

    h('h2', null, 'Rakennusosat ja tilat'),
    h('div', null, osioRivit),
    h('div', { class: 'kortti' }, monistettavat),

    h('h2', null, 'Yhteenveto'),
    kenttaTextarea('Tiivistelmä (voit jättää tyhjäksi — Claude kokoaa ehdotuksen)',
      kohde.tiivistelma, (v) => { kohde.tiivistelma = v; tallennaPian(); }, 4),
    kenttaTextarea('Huomioitavaa / tarkastusta rajoittavat tekijät',
      kohde.rajoitukset, (v) => { kohde.rajoitukset = v; tallennaPian(); }, 3),
    kenttaInput('Raportin päiväys', kohde.paivays,
      (v) => { kohde.paivays = v; tallennaPian(); }, 'text', 'esim. 28.7.2026'),

    h('h2', null, 'Kuvat puhelimeen'),
    await kuvatPuhelimeenLohko(),

    h('h2', null, 'Liitteet'),
    await liiteLohko(),

    h('h2', null, 'Kohteen hallinta'),
    h('div', { class: 'kortti' },
      h('p', { class: viemattaMuutoksia() ? 'varoitusteksti' : 'himmea' }, vientiTila()),
      h('button', { style: 'width:100%;margin-bottom:8px', onclick: nimeaKohde }, 'Nimeä kohde uudelleen'),
      h('button', { class: 'vaarallinen', style: 'width:100%', onclick: poistaNykyKohde },
        'Poista kohde')),
  );

  ALAPALKKI.hidden = false;
  ALAPALKKI.replaceChildren(
    h('button', { onclick: () => siirry(`/ai/${kohde.id}`) },
      kohde.ai ? '✓ Raporttitekstit' : 'Luo raporttitekstit'),
    h('button', { class: 'ensisijainen', onclick: vieKohde }, 'Vie paketti'));
}

/** Onko kohdetta muokattu viimeisimmän viennin jälkeen? */
function viemattaMuutoksia() {
  if (!kohde.viety) return true;
  return (kohde.muokattu || '') > kohde.viety;
}

function vientiTila() {
  if (!kohde.viety) return 'Kohdetta ei ole viety kertaakaan — vie paketti talteen.';
  const viety = `Viimeksi viety ${pvm(kohde.viety)}`;
  return viemattaMuutoksia() ? `${viety}. Sen jälkeen on tullut muutoksia.` : `${viety}.`;
}

// --- Kuvat puhelimeen --------------------------------------------------------
//
// Selain ei pääse kirjoittamaan Androidin kuvagalleriaan (DCIM), joten kuvat
// ladataan tiedostoina Lataukset-kansioon. Ne näkyvät Galleriassa ja Google
// Kuvissa omana kansionaan, eivät kamerarullassa.

function tiedostonimeksi(teksti) {
  return Array.from(teksti)
    .map((m) => ('<>:"/\\|?*'.includes(m) || m.codePointAt(0) < 32 ? '-' : m))
    .join('')
    .trim() || 'kuva';
}

function lataaTiedosto(blob, nimi) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nimi });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function kuvatPuhelimeenLohko() {
  const kuvia = vienti.kaikkiKuvat(kohde).length;
  const tila = await db.kamerakuvienTila(kohde.id);

  if (!kuvia) {
    return h('div', { class: 'kortti himmea' }, 'Kohteessa ei ole vielä kuvia.');
  }

  const kpl = (n, yksikko, monikko) => `${n} ${n === 1 ? yksikko : monikko}`;

  const osat = [];
  if (tila.maara) {
    osat.push(h('p', { class: 'himmea' },
      `${kpl(tila.maara, 'alkuperäiskuva', 'alkuperäiskuvaa')} tallessa, `
      + `${muotoileKoko(tila.tavuja)}. Ne tallentuvat puhelimeen täysikokoisina.`));
  } else {
    osat.push(h('p', { class: 'himmea' },
      'Alkuperäiskuvia ei ole tallessa, joten puhelimeen tallentuu sama '
      + 'pienennetty versio joka menee raporttiin.'));
  }

  if (kohde.kuvatPuhelimeen) {
    osat.push(h('p', { class: 'himmea' },
      `Tallennettu puhelimeen ${pvm(kohde.kuvatPuhelimeen)}.`));
  }

  osat.push(h('button', {
    class: 'ensisijainen', style: 'width:100%',
    onclick: () => tallennaKuvatPuhelimeen(),
  }, `Tallenna ${kpl(kuvia, 'kuva', 'kuvaa')} puhelimeen`));

  if (tila.maara) {
    osat.push(h('button', {
      style: 'width:100%;margin-top:8px',
      onclick: () => vapautaAlkuperaiset(tila),
    }, `Vapauta ${muotoileKoko(tila.tavuja)} tilaa`));
  }

  osat.push(h('p', { class: 'himmea', style: 'margin-bottom:0' },
    'Kuvat menevät Lataukset-kansioon. Selain kysyy ensimmäisellä kerralla '
    + 'luvan tallentaa useita tiedostoja — hyväksy se.'));

  return h('div', { class: 'kortti' }, osat);
}

async function tallennaKuvatPuhelimeen() {
  const kohdeNimi = tiedostonimeksi(kohde.nimi || 'Kohde');
  let tallennettu = 0;
  let puuttuvia = 0;

  ilmoita('Tallennetaan kuvia…');
  for (const { kuva, nimi } of vienti.kaikkiKuvat(kohde)) {
    // Ensisijaisesti kameran alkuperäinen, muuten raporttiin menevä versio.
    const blob = (kuva.kameraAvain && await db.haeKamerakuva(kuva.kameraAvain))
      || await db.haeKuva(kuva.avain);
    if (!blob) { puuttuvia++; continue; }

    lataaTiedosto(blob, `${kohdeNimi}_${nimi}`);
    tallennettu++;
    // Pieni tauko latausten väliin: selain voi muuten hylätä osan.
    await new Promise((r) => setTimeout(r, 250));
  }

  if (tallennettu) {
    kohde.kuvatPuhelimeen = new Date().toISOString();
    await db.tallennaKohde(kohde, false);
  }
  ilmoita(`${tallennettu} ${tallennettu === 1 ? 'kuva' : 'kuvaa'} tallennettu Lataukset-kansioon`
    + (puuttuvia ? ` — ${puuttuvia} puuttui!` : ''), puuttuvia > 0);
  naytaKohde();
}

async function vapautaAlkuperaiset(tila) {
  const kuvaus = `${tila.maara} ${tila.maara === 1 ? 'alkuperäiskuva' : 'alkuperäiskuvaa'}`;
  const varmistus = kohde.kuvatPuhelimeen
    ? `Poistetaanko ${kuvaus} sovelluksesta? Ne on jo tallennettu puhelimeen.`
    : `Kuvia EI ole vielä tallennettu puhelimeen. Poistetaanko silti ${kuvaus}? `
      + 'Raporttiin menevät kuvat säilyvät.';
  if (!await vahvista(varmistus, 'Poista')) return;

  await db.poistaKohteenKamerakuvat(kohde.id);
  for (const { kuva } of vienti.kaikkiKuvat(kohde)) delete kuva.kameraAvain;
  await tallennaHeti();
  ilmoita(`${muotoileKoko(tila.tavuja)} vapautettu.`);
  naytaKohde();
}

// --- Liitteet ----------------------------------------------------------------

async function liiteLohko() {
  const liitteet = await db.haeKohteenLiitteet(kohde.id);
  const valitsin = h('input', {
    type: 'file', multiple: true, style: 'display:none',
    onchange: (e) => { const t = Array.from(e.target.files); e.target.value = ''; lisaaLiitteet(t); },
  });

  const rivit = liitteet.map((l) => h('div', { class: 'liiterivi' },
    h('span', { class: 'nimi' }, l.nimi,
      h('span', { class: 'meta' }, muotoileKoko(l.koko || 0))),
    h('button', {
      class: 'vaarallinen', onclick: () => poistaLiitetiedosto(l),
    }, 'Poista')));

  const yhteensa = liitteet.reduce((s, l) => s + (l.koko || 0), 0);

  return h('div', { class: 'kortti' },
    liitteet.length
      ? h('div', null, rivit,
        h('p', { class: 'himmea' }, `Yhteensä ${muotoileKoko(yhteensa)}`))
      : h('p', { class: 'himmea' },
        'Energiatodistus, piirustukset, isännöitsijäntodistus… '
        + 'Liitteet menevät pakettiin lisatiedot-kansioon, eivät raporttiin.'),
    h('button', { style: 'width:100%', onclick: () => valitsin.click() }, '+ Lisää tiedosto'),
    valitsin);
}

async function lisaaLiitteet(tiedostot) {
  if (!tiedostot.length) return;
  ilmoita(`Tallennetaan ${tiedostot.length} liitettä…`);
  for (const t of tiedostot) {
    const avain = `${kohde.id}/liite/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await db.tallennaLiite(avain, kohde.id, t.name, t);
  }
  await tallennaHeti();
  ilmoita('Liitteet tallennettu.');
  naytaKohde();
}

async function poistaLiitetiedosto(liite) {
  if (!await vahvista(`Poistetaanko liite "${liite.nimi}"?`)) return;
  await db.poistaLiite(liite.avain);
  naytaKohde();
}

async function monistaOsio(perusId) {
  // Perusosio on aina "1.", joten ensimmäinen klooni on numero 2.
  const numerot = Object.keys(kohde.osiot)
    .filter((id) => id.startsWith(`${perusId}#`))
    .map((id) => Number(id.split('#')[1]))
    .filter((n) => n >= 2);
  const uusiId = `${perusId}#${numerot.length ? Math.max(...numerot) + 1 : 2}`;
  osioTila(uusiId);
  await tallennaHeti();
  siirry(`/osio/${kohde.id}/${encodeURIComponent(uusiId)}`);
}

async function poistaKloonattuOsio(osioId) {
  if (!await vahvista(`Poistetaanko osio "${osioNimi(osioId)}" kuvineen?`)) return;
  const o = kohde.osiot[osioId] || {};
  const poistettavat = [...(o.kuvat || []), ...Object.values(o.kohtakuvat || {}).flat()];
  for (const kuva of poistettavat) {
    for (const avain of [kuva.avain, kuva.alkuperaAvain].filter(Boolean)) {
      await db.poistaKuva(avain);
    }
    if (kuva.kameraAvain) await db.poistaKamerakuva(kuva.kameraAvain);
  }
  delete kohde.osiot[osioId];
  await tallennaHeti();
  siirry(`/kohde/${kohde.id}`);
}

async function nimeaKohde() {
  const nimi = await kysy('Kohteen nimi', kohde.nimi);
  if (!nimi) return;
  kohde.nimi = nimi;
  await tallennaHeti();
  naytaKohde();
}

async function poistaNykyKohde() {
  if (!await vahvista(`Poistetaanko "${kohde.nimi}" kuvineen? Tätä ei voi perua.`)) return;
  await db.poistaKohde(kohde.id);
  kohde = null;
  siirry('/');
}

// --- Kenttäapurit ------------------------------------------------------------

function kenttaInput(nimi, arvo, muutos, tyyppi = 'text', vihje = '') {
  return h('div', { class: 'kentta' },
    h('label', null, nimi),
    h('input', {
      type: tyyppi, value: arvo || '', placeholder: vihje,
      oninput: (e) => muutos(e.target.value),
    }));
}

function kenttaTextarea(nimi, arvo, muutos, rivit = 3, vihje = '') {
  const kentta = h('textarea', {
    rows: rivit, value: arvo || '', placeholder: vihje,
    oninput: (e) => muutos(e.target.value),
  });
  return h('div', { class: 'kentta' },
    h('label', null, nimi),
    saneluKaari(kentta, muutos));
}

/** Kietoo tekstikentän ja sanelupainikkeen samaan riviin. */
function saneluKaari(kentta, muutos) {
  const nappi = liitaSanelu(kentta, muutos, ilmoita);
  if (!nappi) return kentta;
  return h('div', { class: 'sanelurivi' }, kentta, nappi);
}

// --- Näkymä: lomakeosio ------------------------------------------------------

async function naytaLomake(lomakeId) {
  const m = LOMAKEOSIOT.find((x) => x.id === lomakeId);
  if (!m) { siirry(`/kohde/${kohde.id}`); return; }
  OTSIKKO.textContent = `${m.nro}. ${m.nimi}`;
  if (!kohde.lomake[m.id]) kohde.lomake[m.id] = {};
  const arvot = kohde.lomake[m.id];

  const kentat = m.kentat.map((k) => {
    const muutos = (v) => { arvot[k.id] = v; tallennaPian(); };
    return k.rivit
      ? kenttaTextarea(k.nimi, arvot[k.id], muutos, k.rivit, k.vihje || '')
      : kenttaInput(k.nimi, arvot[k.id], muutos, k.tyyppi || 'text', k.vihje || '');
  });

  SISALTO.replaceChildren(h('div', { class: 'kortti' }, kentat));
  ALAPALKKI.hidden = false;
  ALAPALKKI.replaceChildren(
    h('button', { class: 'ensisijainen', onclick: () => siirry(`/kohde/${kohde.id}`) }, 'Valmis'));
}

// --- Näkymä: tarkastusosio ---------------------------------------------------

async function naytaOsio(osioId) {
  const m = osioMaaritys(osioId);
  if (!m) { siirry(`/kohde/${kohde.id}`); return; }
  OTSIKKO.textContent = `${m.nro}. ${osioNimi(osioId)}`;
  const o = osioTila(osioId);

  const osat = [];

  // Osio pois kohteesta
  osat.push(h('div', { class: 'kortti' },
    h('label', { style: 'display:flex;align-items:center;gap:10px;font-size:15px;color:inherit' },
      h('input', {
        type: 'checkbox', checked: Boolean(o.poissa), style: 'width:22px;height:22px;min-height:22px',
        onchange: (e) => { o.poissa = e.target.checked; tallennaPian(); naytaOsio(osioId); },
      }),
      'Ei kohteessa — jätetään raportista pois')));

  if (!o.poissa) {
    // Tarkastuskohdat
    if (m.kohdat.length) {
      const kohtaLohkot = m.kohdat.map((teksti, i) => piirraKohta(osioId, teksti, i));
      osat.push(
        h('div', { style: 'display:flex;gap:8px;margin-bottom:10px' },
          h('button', { style: 'flex:1', onclick: () => merkitseKaikki(osioId, 'kunnossa') },
            'Kaikki kunnossa'),
          h('button', { style: 'flex:1', onclick: () => merkitseKaikki(osioId, null) },
            'Tyhjennä')),
        h('div', { class: 'kortti' }, kohtaLohkot));
    }

    // Mittaukset
    osat.push(mittausLohko(osioId));

    osat.push(kenttaTextarea('Muuta huomioitavaa', o.muuta,
      (v) => { o.muuta = v; tallennaPian(); }, 3,
      'Vapaa teksti, jonka Claude ottaa huomioon'));

    // Kuvat
    if (m.kuvia > 0) {
      osat.push(h('h2', null, `Kuvat (${(o.kuvat || []).length}/${m.kuvia})`));
      osat.push(await piirraKuvat(osioId, m.kuvia));
    }

    // AI:n kirjoittamat tekstit, kun ne on luotu
    const aiOsio = (kohde.ai?.tulos?.osiot || []).find((x) => x.osio_id === osioId);
    if (aiOsio) {
      osat.push(
        h('h2', null, 'Raporttitekstit'),
        h('div', { class: 'kortti' },
          h('p', { class: 'himmea' }, 'Claude kirjoitti nämä havaintojesi pohjalta. Muokkaa vapaasti.'),
          kenttaTextarea('Yleiskuvaus', aiOsio.yleiskuvaus,
            (v) => { aiOsio.yleiskuvaus = v; tallennaPian(); }, 3),
          kenttaTextarea('Havainnot', aiOsio.havainnot,
            (v) => { aiOsio.havainnot = v; tallennaPian(); }, 5),
          kenttaTextarea('Toimenpide-ehdotukset', aiOsio.toimenpide_ehdotukset,
            (v) => { aiOsio.toimenpide_ehdotukset = v; tallennaPian(); }, 4)));
    }
  }

  if (osioId.includes('#')) {
    osat.push(h('div', { class: 'kortti' },
      h('button', {
        class: 'vaarallinen', style: 'width:100%',
        onclick: () => poistaKloonattuOsio(osioId),
      }, 'Poista tämä osio')));
  }

  SISALTO.replaceChildren(...osat);

  // Osiosta toiseen ilman välipysähdystä
  const jarjestys = osioJarjestys(kohde);
  const idx = jarjestys.indexOf(osioId);
  ALAPALKKI.hidden = false;
  ALAPALKKI.replaceChildren(
    h('button', {
      disabled: idx <= 0,
      onclick: () => siirry(`/osio/${kohde.id}/${encodeURIComponent(jarjestys[idx - 1])}`),
    }, '‹ Edellinen'),
    h('button', {
      disabled: idx >= jarjestys.length - 1,
      onclick: () => siirry(`/osio/${kohde.id}/${encodeURIComponent(jarjestys[idx + 1])}`),
    }, 'Seuraava ›'));
}

function piirraKohta(osioId, teksti, i) {
  const o = osioTila(osioId);
  const huomautusPaikka = h('div', { class: 'huomautus' });

  function piirraHuomautus() {
    const tila = o.tilat[i];
    const vaatii = TILAT.find((t) => t.id === tila)?.huomautus;
    if (!vaatii) { huomautusPaikka.replaceChildren(); return; }
    const arvo = o.huomautukset[i] || '';
    huomautusPaikka.className = `huomautus${arvo.trim() ? '' : ' pakollinen'}`;
    const muutos = (v) => {
      o.huomautukset[i] = v;
      huomautusPaikka.className = `huomautus${v.trim() ? '' : ' pakollinen'}`;
      tallennaPian();
    };
    const kentta = h('textarea', {
      rows: 2, value: arvo, placeholder: 'Miksi ei ole kunnossa?',
      oninput: (e) => muutos(e.target.value),
    });
    // Sanelu on tarpeellisin juuri tassa: huomautus kirjoitetaan usein
    // ryomintatilassa tai ullakolla, jossa nappaimiston kaytto on hankalaa.
    huomautusPaikka.replaceChildren(saneluKaari(kentta, muutos));
  }

  const napit = TILAT.map((t) => h('button', {
    'data-tila': t.id,
    'aria-pressed': String(o.tilat[i] === t.id),
    onclick: (e) => {
      o.tilat[i] = o.tilat[i] === t.id ? undefined : t.id;
      if (o.tilat[i] === undefined) delete o.tilat[i];
      for (const nappi of e.target.parentElement.children) {
        nappi.setAttribute('aria-pressed', String(o.tilat[i] === nappi.dataset.tila));
      }
      piirraHuomautus();
      tallennaPian();
    },
  }, t.lyhyt));

  piirraHuomautus();
  const kuvaPaikka = h('div', { class: 'kohtakuvat' });
  piirraKohtaKuvat(osioId, i, kuvaPaikka);

  return h('div', { class: 'kohta' },
    h('div', { class: 'teksti' }, teksti),
    h('div', { class: 'tilat' }, napit),
    huomautusPaikka,
    kuvaPaikka);
}

// --- Tarkastuskohdan omat kuvat ---------------------------------------------
//
// Osion neljä raporttikuvaa kuvaavat kokonaisuutta; nämä ovat lähikuvia
// yksittäisestä havainnosta. Rivi piirretään erikseen, jotta kuvan lisäys ei
// piirrä koko osionäkymää uudelleen eikä vieritys hyppää.

async function piirraKohtaKuvat(osioId, i, paikka) {
  const kuvat = kohdanKuvat(osioId, i);
  const osat = [];

  for (let j = 0; j < kuvat.length; j++) {
    const kuva = kuvat[j];
    let url = kuvaUrlit.get(kuva.avain);
    if (!url) {
      const blob = await db.haeKuva(kuva.avain);
      if (blob) { url = URL.createObjectURL(blob); kuvaUrlit.set(kuva.avain, url); }
    }
    osat.push(h('div', { class: 'pikkukuva' },
      url
        ? h('img', {
          src: url, alt: `Kuva ${j + 1}`, title: 'Napauta merkitäksesi',
          onclick: () => merkitseKohtaKuva(osioId, i, j, paikka),
        })
        : h('span', { class: 'himmea' }, '?'),
      h('button', {
        class: 'poista', 'aria-label': 'Poista kuva',
        onclick: () => poistaKohtaKuva(osioId, i, j, paikka),
      }, '×')));
  }

  if (kuvat.length < KUVIA_PER_KOHTA) {
    const valitsin = h('input', {
      type: 'file', accept: 'image/*', capture: 'environment', multiple: true,
      style: 'display:none',
      onchange: (e) => lisaaKohtaKuvia(osioId, i, e.target.files, paikka),
    });
    osat.push(h('button', {
      class: 'kohtakuva-lisaa', onclick: () => valitsin.click(),
      'aria-label': 'Lisää kuva tähän tarkastuskohtaan',
    }, '＋ Kuva'), valitsin);
  }

  paikka.replaceChildren(...osat);
}

async function lisaaKohtaKuvia(osioId, i, tiedostot, paikka) {
  const o = osioTila(osioId);
  if (!o.kohtakuvat[i]) o.kohtakuvat[i] = [];
  const kuvat = o.kohtakuvat[i];
  const lisattavat = Array.from(tiedostot).slice(0, KUVIA_PER_KOHTA - kuvat.length);
  if (!lisattavat.length) {
    ilmoita(`Tarkastuskohtaan mahtuu ${KUVIA_PER_KOHTA} kuvaa.`);
    return;
  }

  ilmoita(`Käsitellään ${lisattavat.length} kuvaa…`);
  for (const tiedosto of lisattavat) {
    try {
      const pieni = await skaalaa(tiedosto);
      const avain = `${kohde.id}/${osioId}/k${i}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await db.tallennaKuva(avain, kohde.id, pieni);
      const merkinta = { avain };
      if (asetukset.sailytaAlkuperaiset) {
        try {
          await db.tallennaKamerakuva(`${avain}-kamera`, kohde.id, tiedosto);
          merkinta.kameraAvain = `${avain}-kamera`;
        } catch (e) {
          console.warn('Alkuperäiskuvaa ei voitu säilöä', e);
        }
      }
      kuvat.push(merkinta);
    } catch (e) {
      ilmoita(`Kuvan käsittely epäonnistui: ${e.message}`, true);
    }
  }
  await tallennaHeti();
  await piirraKohtaKuvat(osioId, i, paikka);
}

async function poistaKohtaKuva(osioId, i, j, paikka) {
  const o = osioTila(osioId);
  const kuvat = o.kohtakuvat[i] || [];
  const kuva = kuvat[j];
  if (!kuva) return;
  if (!await vahvista('Poistetaanko kuva?')) return;
  for (const avain of [kuva.avain, kuva.alkuperaAvain].filter(Boolean)) {
    await db.poistaKuva(avain);
    const url = kuvaUrlit.get(avain);
    if (url) { URL.revokeObjectURL(url); kuvaUrlit.delete(avain); }
  }
  if (kuva.kameraAvain) await db.poistaKamerakuva(kuva.kameraAvain);
  kuvat.splice(j, 1);
  if (!kuvat.length) delete o.kohtakuvat[i];
  await tallennaHeti();
  await piirraKohtaKuvat(osioId, i, paikka);
}

async function merkitseKohtaKuva(osioId, i, j, paikka) {
  const kuva = (osioTila(osioId).kohtakuvat[i] || [])[j];
  if (!kuva) return;
  // Merkinnät piirretään aina alkuperäiseen, jotta ne voi tehdä uusiksi.
  const pohjaAvain = kuva.alkuperaAvain || kuva.avain;
  const pohja = await db.haeKuva(pohjaAvain);
  if (!pohja) { ilmoita('Kuvaa ei löytynyt', true); return; }

  const tulos = await avaaMerkinta(pohja, kuva.merkinnat || []);
  if (!tulos) return;

  if (!tulos.merkinnat.length) {
    if (kuva.alkuperaAvain) {
      await db.poistaKuva(kuva.avain);
      const url = kuvaUrlit.get(kuva.avain);
      if (url) { URL.revokeObjectURL(url); kuvaUrlit.delete(kuva.avain); }
      kuva.avain = kuva.alkuperaAvain;
      delete kuva.alkuperaAvain;
    }
    delete kuva.merkinnat;
  } else {
    if (!kuva.alkuperaAvain) {
      kuva.alkuperaAvain = kuva.avain;
      kuva.avain = `${kuva.alkuperaAvain}-m`;
    }
    await db.tallennaKuva(kuva.avain, kohde.id, tulos.blob);
    const url = kuvaUrlit.get(kuva.avain);
    if (url) { URL.revokeObjectURL(url); kuvaUrlit.delete(kuva.avain); }
    kuva.merkinnat = tulos.merkinnat;
  }
  await tallennaHeti();
  await piirraKohtaKuvat(osioId, i, paikka);
}

// --- Mittaukset --------------------------------------------------------------

function mittausLohko(osioId) {
  const o = osioTila(osioId);
  if (!o.mittaukset) o.mittaukset = [];

  const lisaa = h('button', {
    style: 'width:100%',
    onclick: () => {
      o.mittaukset.push({ paikka: '', lukema: '', yksikko: '', laite: 'gann', huom: '' });
      tallennaPian();
      naytaOsio(osioId);
    },
  }, '+ Lisää mittaus');

  if (!o.mittaukset.length) {
    // Osiot joissa ei mitata pysyvät siisteinä: pelkkä painike, ei taulukkoa.
    return h('div', { class: 'kentta' }, lisaa);
  }

  const rivit = o.mittaukset.map((m, i) => h('div', { class: 'mittaus' },
    h('div', { class: 'mittausotsikko' },
      h('span', null, `Mittaus ${i + 1}`),
      h('button', {
        class: 'vaarallinen',
        onclick: () => {
          o.mittaukset.splice(i, 1);
          tallennaPian();
          naytaOsio(osioId);
        },
      }, 'Poista')),

    kenttaInput('Mittauspaikka', m.paikka,
      (v) => { m.paikka = v; tallennaPian(); }, 'text', 'esim. lattia suihkun edessä'),

    h('div', { class: 'mittausrivi' },
      h('div', { class: 'kentta' },
        h('label', null, 'Lukema'),
        h('input', {
          value: m.lukema || '', inputmode: 'decimal',
          oninput: (e) => { m.lukema = e.target.value; tallennaPian(); },
        })),
      h('div', { class: 'kentta' },
        h('label', null, 'Yksikkö'),
        h('select', {
          onchange: (e) => { m.yksikko = e.target.value; tallennaPian(); },
        }, MITTAYKSIKOT.map((y) =>
          h('option', { value: y, selected: y === (m.yksikko || '') }, yksikonNimi(y)))))),

    h('div', { class: 'kentta' },
      h('label', null, 'Laite'),
      h('select', {
        onchange: (e) => {
          m.laite = e.target.value;
          // Laitteen vaihto esitäyttää yksikön, mutta ei ylikirjoita
          // käyttäjän omaa valintaa jos lukema on jo kirjattu.
          const laite = MITTALAITTEET.find((l) => l.id === m.laite);
          if (laite && !m.lukema) m.yksikko = laite.yksikko;
          tallennaPian();
          naytaOsio(osioId);
        },
      }, MITTALAITTEET.map((l) =>
        h('option', { value: l.id, selected: l.id === m.laite }, l.nimi)))),

    kenttaInput('Huomautus', m.huom,
      (v) => { m.huom = v; tallennaPian(); }, 'text', 'valinnainen')));

  return h('div', null,
    h('h2', null, `Mittaukset (${o.mittaukset.length})`),
    h('div', { class: 'kortti' }, rivit, lisaa));
}

function merkitseKaikki(osioId, tila) {
  const m = osioMaaritys(osioId);
  const o = osioTila(osioId);
  m.kohdat.forEach((_, i) => {
    if (tila) o.tilat[i] = tila;
    else { delete o.tilat[i]; delete o.huomautukset[i]; }
  });
  tallennaPian();
  naytaOsio(osioId);
}

// --- Kuvat -------------------------------------------------------------------

async function piirraKuvat(osioId, maxKuvia) {
  const o = osioTila(osioId);
  const ruudukko = h('div', { class: 'kuvaruudukko' });

  for (let i = 0; i < maxKuvia; i++) {
    const kuva = o.kuvat[i];
    if (kuva) {
      let url = kuvaUrlit.get(kuva.avain);
      if (!url) {
        const blob = await db.haeKuva(kuva.avain);
        if (blob) { url = URL.createObjectURL(blob); kuvaUrlit.set(kuva.avain, url); }
      }
      const merkitty = Boolean(kuva.merkinnat?.length);
      ruudukko.append(h('div', null,
        h('div', { class: 'kuvapaikka' },
          url
            ? h('img', {
              src: url, alt: `Kuva ${i + 1}`, title: 'Napauta merkitäksesi',
              onclick: () => merkitseKuva(osioId, i),
            })
            : h('span', { class: 'himmea' }, 'Kuvaa ei löydy'),
          h('button', {
            class: 'poista', 'aria-label': 'Poista kuva',
            onclick: () => poistaKuva(osioId, i),
          }, '×'),
          h('span', { class: 'numero' },
            `Kuva ${i + 1}`, merkitty ? h('span', { class: 'merkittytunnus' }, 'merkitty') : null)),
        h('div', { class: 'kuvateksti' },
          h('input', {
            value: kuva.teksti || '', placeholder: 'Kuvateksti (Claude täydentää)',
            oninput: (e) => { kuva.teksti = e.target.value; tallennaPian(); },
          }))));
    } else {
      const valitsin = h('input', {
        type: 'file', accept: 'image/*', capture: 'environment', multiple: true,
        style: 'display:none',
        onchange: (e) => lisaaKuvia(osioId, e.target.files, maxKuvia),
      });
      // Tyhjäkin paikka saa kuvatekstin korkuisen välikkeen, jotta
      // ruudukon rivit pysyvät samassa linjassa.
      ruudukko.append(h('div', null,
        h('div', { class: 'kuvapaikka' },
          h('button', { class: 'lisaa', onclick: () => valitsin.click() },
            h('span', { class: 'plus' }, '+'), h('br'), 'Lisää kuva'),
          valitsin),
        h('div', { class: 'kuvateksti valike' }, h('input', { tabindex: '-1' }))));
    }
  }
  return ruudukko;
}

async function lisaaKuvia(osioId, tiedostot, maxKuvia) {
  const o = osioTila(osioId);
  const lisattavat = Array.from(tiedostot).slice(0, maxKuvia - o.kuvat.length);
  if (!lisattavat.length) { ilmoita(`Osioon mahtuu ${maxKuvia} kuvaa.`); return; }

  ilmoita(`Käsitellään ${lisattavat.length} kuvaa…`);
  for (const tiedosto of lisattavat) {
    try {
      const pieni = await skaalaa(tiedosto);
      const avain = `${kohde.id}/${osioId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await db.tallennaKuva(avain, kohde.id, pieni);
      const merkinta = { avain, teksti: '' };

      // Kameran alkuperäinen säilytetään erikseen, jotta kuvat voi tallentaa
      // puhelimeen täysikokoisina. Ne vievät paljon tilaa, joten säilytys on
      // asetuksissa kytkettävissä pois.
      if (asetukset.sailytaAlkuperaiset) {
        try {
          await db.tallennaKamerakuva(`${avain}-kamera`, kohde.id, tiedosto);
          merkinta.kameraAvain = `${avain}-kamera`;
        } catch (e) {
          console.warn('Alkuperäiskuvaa ei voitu säilöä', e);
        }
      }
      o.kuvat.push(merkinta);
    } catch (e) {
      ilmoita(`Kuvan käsittely epäonnistui: ${e.message}`, true);
    }
  }
  await tallennaHeti();
  naytaOsio(osioId);
}

async function poistaKuva(osioId, i) {
  const o = osioTila(osioId);
  const kuva = o.kuvat[i];
  if (!kuva) return;
  if (!await vahvista('Poistetaanko kuva?')) return;
  for (const avain of [kuva.avain, kuva.alkuperaAvain].filter(Boolean)) {
    await db.poistaKuva(avain);
    const url = kuvaUrlit.get(avain);
    if (url) { URL.revokeObjectURL(url); kuvaUrlit.delete(avain); }
  }
  if (kuva.kameraAvain) await db.poistaKamerakuva(kuva.kameraAvain);
  o.kuvat.splice(i, 1);
  await tallennaHeti();
  naytaOsio(osioId);
}

/**
 * Avaa merkintänäkymän. Alkuperäinen kuva säilyy aina omalla avaimellaan,
 * joten merkinnät voi tehdä uusiksi tai poistaa kokonaan.
 */
async function merkitseKuva(osioId, i) {
  const o = osioTila(osioId);
  const kuva = o.kuvat[i];
  if (!kuva) return;

  const alkuperaAvain = kuva.alkuperaAvain || kuva.avain;
  const alkuperainen = await db.haeKuva(alkuperaAvain);
  if (!alkuperainen) { ilmoita('Kuvaa ei löytynyt.', true); return; }

  let tulos;
  try {
    tulos = await avaaMerkinta(alkuperainen, kuva.merkinnat || []);
  } catch (e) {
    ilmoita(`Merkintä epäonnistui: ${e.message}`, true);
    return;
  }
  if (!tulos) return;   // peruttiin

  if (!tulos.merkinnat.length) {
    // Kaikki merkinnät kumottiin: palataan alkuperäiseen kuvaan.
    if (kuva.alkuperaAvain) {
      await db.poistaKuva(kuva.avain);
      kuva.avain = kuva.alkuperaAvain;
      delete kuva.alkuperaAvain;
    }
    delete kuva.merkinnat;
  } else {
    if (!kuva.alkuperaAvain) {
      kuva.alkuperaAvain = kuva.avain;
      kuva.avain = `${kuva.alkuperaAvain}-merkitty`;
    }
    await db.tallennaKuva(kuva.avain, kohde.id, tulos.blob);
    kuva.merkinnat = tulos.merkinnat;
  }

  // Vanha esikatselu-URL pois, jotta merkitty versio näkyy heti.
  const vanha = kuvaUrlit.get(kuva.avain);
  if (vanha) { URL.revokeObjectURL(vanha); kuvaUrlit.delete(kuva.avain); }

  await tallennaHeti();
  naytaOsio(osioId);
}

// --- Näkymä: AI --------------------------------------------------------------

async function naytaAI() {
  OTSIKKO.textContent = 'Raporttitekstit';
  const arvio = ai.kustannusarvio(kohde, asetukset);
  const loki = h('div', { class: 'loki' }, 'Valmis lähetettäväksi.');
  let keskeytys = null;

  const nappi = h('button', { class: 'ensisijainen', style: 'width:100%' },
    kohde.ai ? 'Luo tekstit uudelleen' : 'Luo tekstit');

  nappi.addEventListener('click', async () => {
    if (keskeytys) { keskeytys.abort(); return; }
    if (!asetukset.apiAvain) {
      ilmoita('Lisää ensin API-avain asetuksissa.', true);
      siirry('/asetukset');
      return;
    }
    keskeytys = new AbortController();
    nappi.textContent = 'Keskeytä';
    nappi.classList.remove('ensisijainen');

    const rivit = [];
    const kerro = (viesti) => {
      rivit[rivit.length - 1] = viesti;
      loki.textContent = rivit.join('\n');
      loki.scrollTop = loki.scrollHeight;
    };
    const uusiRivi = (viesti) => { rivit.push(viesti); kerro(viesti); };
    uusiRivi('Aloitetaan…');

    try {
      const alku = Date.now();
      const { tulos, usage, kuviaMukana } = await ai.luoTekstit(
        kohde, asetukset,
        (v) => (rivit.length && rivit[rivit.length - 1].startsWith(v.slice(0, 8))
          ? kerro(v) : uusiRivi(v)),
        keskeytys.signal);

      kohde.ai = {
        tulos,
        ajettu: new Date().toISOString(),
        malli: asetukset.malli,
        kuvia: kuviaMukana,
        usage: usage || null,
      };
      taytaKuvatekstit(tulos);
      if (!kohde.tiivistelma?.trim()) kohde.tiivistelma = tulos.tiivistelma || '';
      await tallennaHeti();

      const sekuntia = Math.round((Date.now() - alku) / 1000);
      const hinta = ai.todellinenHinta(usage, asetukset.malli);
      uusiRivi(`Valmis ${sekuntia} s. ${tulos.osiot.length} osiota kirjoitettu.`);
      if (hinta != null) uusiRivi(`Kulutus: $${hinta.toFixed(3)}`);
      ilmoita('Raporttitekstit luotu.');
      naytaAI();
      return;
    } catch (e) {
      if (e.name === 'AbortError') uusiRivi('Keskeytetty.');
      else { uusiRivi(`VIRHE: ${e.message}`); ilmoita(e.message, true); }
    } finally {
      keskeytys = null;
      nappi.textContent = kohde.ai ? 'Luo tekstit uudelleen' : 'Luo tekstit';
      nappi.classList.add('ensisijainen');
    }
  });

  const tulos = kohde.ai?.tulos;
  const osat = [
    h('div', { class: 'kortti' },
      h('h2', { style: 'margin-top:0' }, 'Lähetettävä aineisto'),
      h('p', null, `${arvio.osioita} osiota, ${arvio.kuvia} kuvaa`),
      h('p', { class: 'himmea' },
        `Arvio: ~${(arvio.sisaanTokenit / 1000).toFixed(0)}k sisään, `
        + `~${(arvio.ulosTokenit / 1000).toFixed(0)}k ulos → noin $${arvio.dollaria.toFixed(2)}`),
      h('p', { class: 'himmea' }, `Malli: ${asetukset.malli}`
        + (asetukset.laheteKuvat ? ' · kuvat mukana' : ' · ilman kuvia')),
      nappi),
    h('div', { class: 'kortti' }, loki),
  ];

  if (tulos) {
    osat.push(
      h('h2', null, 'Tiivistelmä'),
      h('div', { class: 'kortti' },
        h('p', { class: 'himmea' },
          `Luotu ${pvm(kohde.ai.ajettu)} · ${kohde.ai.malli} · ${kohde.ai.kuvia} kuvaa`),
        kenttaTextarea('Tiivistelmä', kohde.tiivistelma,
          (v) => { kohde.tiivistelma = v; tallennaPian(); }, 6)),
      h('h2', null, 'Osiokohtaiset tekstit'),
      h('div', { class: 'kortti himmea' },
        'Muokkaa tekstejä osionäkymissä — jokaisen osion alaosassa on '
        + '"Raporttitekstit"-lohko.'));

    const puuttuvat = ai.mukanaOlevatOsiot(kohde)
      .filter((id) => !tulos.osiot.some((o) => o.osio_id === id));
    if (puuttuvat.length) {
      osat.push(h('div', { class: 'kortti' },
        h('span', { class: 'tunnus ei' }, 'Puuttuu'),
        h('p', null, `Claude ei kirjoittanut tekstejä osioihin: ${puuttuvat.map(osioNimi).join(', ')}.`)));
    }
  }

  SISALTO.replaceChildren(...osat);
  ALAPALKKI.hidden = false;
  ALAPALKKI.replaceChildren(
    h('button', { onclick: () => siirry(`/kohde/${kohde.id}`) }, 'Takaisin kohteeseen'),
    h('button', { class: 'ensisijainen', onclick: vieKohde }, 'Vie paketti'));
}

/** Täyttää tyhjät kuvatekstit AI:n ehdotuksilla. */
function taytaKuvatekstit(tulos) {
  for (const osio of tulos.osiot || []) {
    const kuvat = kohde.osiot?.[osio.osio_id]?.kuvat || [];
    (osio.kuvatekstit || []).forEach((teksti, i) => {
      if (kuvat[i] && !kuvat[i].teksti?.trim()) kuvat[i].teksti = teksti;
    });
  }
}

// --- Vienti ------------------------------------------------------------------

async function vieKohde() {
  await tallennaHeti();
  ilmoita('Kootaan pakettia…');
  try {
    const { zip, kansio, tiedostoja, puuttuvia } = await vienti.teeVientiPaketti(kohde);
    const tulos = await vienti.jaaTaiLataa(zip, `${kansio}.zip`);
    if (tulos === 'peruttu') return;
    // Merkitään vietäväksi juuri se tila joka pakettiin meni: kun viety ja
    // muokattu ovat samat, muutoksia ei ole tullut viennin jälkeen.
    kohde.viety = kohde.muokattu || new Date().toISOString();
    await db.tallennaKohde(kohde, false);
    ilmoita(`${tiedostoja} tiedostoa, ${muotoileKoko(zip.size)}`
      + (puuttuvia ? ` — ${puuttuvia} kuvaa puuttui!` : ''), puuttuvia > 0);
  } catch (e) {
    console.error(e);
    ilmoita(`Vienti epäonnistui: ${e.message}`, true);
  }
}

// --- Näkymä: asetukset -------------------------------------------------------

async function naytaAsetukset() {
  OTSIKKO.textContent = 'Asetukset';
  const tila = await db.tilankaytto();

  const tallenna = async () => {
    await db.tallennaAsetukset(asetukset);
    ilmoita('Asetukset tallennettu.');
  };

  const testinappi = h('button', { style: 'width:100%' }, 'Testaa yhteys');
  testinappi.addEventListener('click', async () => {
    testinappi.disabled = true;
    testinappi.textContent = 'Testataan…';
    try {
      await ai.testaaYhteys(asetukset);
      ilmoita('Yhteys toimii.');
    } catch (e) {
      ilmoita(`Yhteys ei toimi: ${e.message}`, true);
    } finally {
      testinappi.disabled = false;
      testinappi.textContent = 'Testaa yhteys';
    }
  });

  SISALTO.replaceChildren(
    h('h2', null, 'Claude API'),
    h('div', { class: 'kortti' },
      kenttaInput('API-avain', asetukset.apiAvain,
        (v) => { asetukset.apiAvain = v.trim(); }, 'password', 'sk-ant-...'),
      h('div', { class: 'kentta' },
        h('label', null, 'Malli'),
        h('select', {
          onchange: (e) => { asetukset.malli = e.target.value; tallenna(); },
        }, ai.MALLIT.map((m) =>
          h('option', { value: m.id, selected: m.id === asetukset.malli }, m.nimi)))),
      h('label', { style: 'display:flex;align-items:center;gap:10px;font-size:15px;color:inherit;margin-bottom:12px' },
        h('input', {
          type: 'checkbox', checked: asetukset.laheteKuvat,
          style: 'width:22px;height:22px;min-height:22px',
          onchange: (e) => { asetukset.laheteKuvat = e.target.checked; tallenna(); },
        }),
        'Lähetä kuvat AI:lle (parempi kuvatekstit, hieman kalliimpaa)'),
      h('button', { class: 'ensisijainen', style: 'width:100%;margin-bottom:8px', onclick: tallenna },
        'Tallenna'),
      testinappi),
    h('div', { class: 'kortti himmea' },
      'Avain tallennetaan vain tähän laitteeseen. Se on laitteella luettavissa, '
      + 'joten aseta sille kulutusraja Anthropic-konsolissa.'),

    h('h2', null, 'Oletukset'),
    h('div', { class: 'kortti' },
      kenttaInput('Tarkastaja(t)', asetukset.tarkastaja,
        (v) => { asetukset.tarkastaja = v; }, 'text', 'Esitäytetään uusiin kohteisiin'),
      h('label', { style: 'display:flex;align-items:center;gap:10px;font-size:15px;color:inherit;margin-bottom:12px' },
        h('input', {
          type: 'checkbox', checked: asetukset.sailytaAlkuperaiset,
          style: 'width:22px;height:22px;min-height:22px',
          onchange: (e) => { asetukset.sailytaAlkuperaiset = e.target.checked; tallenna(); },
        }),
        'Säilytä kameran alkuperäiskuvat, jotta ne voi tallentaa puhelimeen '
        + 'täysikokoisina (vie huomattavasti tilaa)'),
      h('button', { style: 'width:100%', onclick: tallenna }, 'Tallenna')),

    h('h2', null, 'Tallennustila'),
    h('div', { class: 'kortti' },
      h('p', { class: 'himmea' },
        tila
          ? `Käytössä ${muotoileKoko(tila.kaytetty)} / ${muotoileKoko(tila.kiintio)}`
          : 'Tallennustilan tietoja ei saatavilla.'),
      h('p', { class: tallennusPysyva === true ? 'himmea' : 'varoitusteksti' },
        tallennusPysyva === true
          ? 'Tallennustila on pysyvä — puhelin ei poista tietoja itsestään.'
          : 'Tallennustila EI ole pysyvä. Puhelin voi tyhjentää tiedot muistin '
            + 'loppuessa, joten vie kohteet paketiksi talteen.'),
      tallennusPysyva === true ? null : h('button', {
        style: 'width:100%',
        onclick: async () => {
          tallennusPysyva = await db.pyydaPysyvaTallennus();
          ilmoita(tallennusPysyva === true
            ? 'Pysyvä tallennustila myönnetty.'
            : 'Selain ei myöntänyt pysyvää tallennustilaa. Se onnistuu usein, '
              + 'kun sovellus on asennettu kotinäytölle ja sitä on käytetty hetken.',
          tallennusPysyva !== true);
          naytaAsetukset();
        },
      }, 'Pyydä pysyvää tallennustilaa')),

    h('h2', null, 'Sanelu'),
    h('div', { class: 'kortti himmea' },
      saneluTuettu()
        ? 'Tekstikenttien mikrofonipainikkeella voit sanella kirjoittamisen sijaan. '
          + 'Selain lähettää äänen Googlen palvelimille tunnistettavaksi — sama '
          + 'koskee puhelimen näppäimistön sanelua.'
        : 'Tämä selain ei tue sanelua.'),

    h('h2', null, 'Sovellusversio'),
    versioLohko(),
  );

  ALAPALKKI.hidden = true;
}

/**
 * Näyttää käytössä olevan version ja tarjoaa painikkeen päivityksen
 * hakemiseen. Puhelin voi jäädä vanhaan välimuistiversioon, eikä sitä muuten
 * näe mistään — tämä tekee siitä tarkistettavan asian.
 */
function versioLohko() {
  const teksti = h('p', { class: 'himmea' }, 'Selvitetään…');
  const nappi = h('button', { style: 'width:100%' }, 'Tarkista päivitykset');

  const kysyVersio = () => {
    const ohjain = navigator.serviceWorker?.controller;
    if (!ohjain) {
      teksti.textContent = 'Offline-tuki ei ole käytössä tässä selaimessa. '
        + 'Sovellus toimii, mutta vaatii verkkoyhteyden.';
      return;
    }
    const kanava = new MessageChannel();
    kanava.port1.onmessage = (e) => {
      teksti.textContent = `Käytössä: ${e.data?.versio || 'tuntematon'}`;
    };
    ohjain.postMessage({ tyyppi: 'versio' }, [kanava.port2]);
    // Vanha service worker ei osaa vastata versiokyselyyn — silloin
    // puhelimessa on varmuudella vanha versio.
    setTimeout(() => {
      if (teksti.textContent === 'Selvitetään…') {
        teksti.textContent = 'Käytössä on vanha versio, joka ei tunne '
          + 'versiokyselyä. Hae päivitys alta.';
      }
    }, 1200);
  };

  nappi.addEventListener('click', async () => {
    if (!rekisterointi) { ilmoita('Offline-tuki ei ole käytössä.'); return; }
    nappi.disabled = true;
    nappi.textContent = 'Tarkistetaan…';
    try {
      await rekisterointi.update();
      // Jos uusi versio löytyi, se ottaa ohjauksen ja sovellus latautuu
      // uudelleen itsestään. Muuten kerrotaan, että versio on jo uusin.
      await new Promise((r) => setTimeout(r, 2500));
      ilmoita('Sovellus on ajan tasalla.');
    } catch (e) {
      ilmoita(`Päivitystä ei voitu hakea: ${e.message}`, true);
    } finally {
      nappi.disabled = false;
      nappi.textContent = 'Tarkista päivitykset';
    }
  });

  kysyVersio();
  return h('div', { class: 'kortti' }, teksti, nappi);
}

// --- Käynnistys --------------------------------------------------------------

TAKAISIN.addEventListener('click', () => history.back());
// Kotinappi hyppää suoraan kohteen etusivulle riippumatta siitä, kuinka monen
// osion kautta on kuljettu. history.back() ei tähän kelpaa.
KOTI.addEventListener('click', () => { if (kohde) siirry(`/kohde/${kohde.id}`); });
VALIKKO.addEventListener('click', () => siirry('/asetukset'));
window.addEventListener('hashchange', reititys);
// Kirjoitetaan vain jos jotain on oikeasti jäänyt tallentamatta — muuten
// vanhentunut muistissa oleva kohde voisi ylikirjoittaa tuoreemman tiedon.
window.addEventListener('beforeunload', () => {
  if (kohde && tallentamatta) db.tallennaKohde(kohde);
});

/** Käynnistys epäonnistui — näytetään syy, ei tyhjää ruutua. */
function naytaKaynnistysvirhe(viesti) {
  OTSIKKO.textContent = 'Kuntotarkastus';
  ALAPALKKI.hidden = true;
  SISALTO.replaceChildren(h('div', { class: 'kortti varoitus' },
    h('strong', null, 'Sovellus ei käynnistynyt'),
    h('p', null, viesti),
    h('button', {
      class: 'ensisijainen', style: 'width:100%;margin-top:12px',
      onclick: () => location.reload(),
    }, 'Yritä uudelleen')));
}

(async function kaynnista() {
  // Service worker rekisteröidään ENSIMMÄISENÄ, ennen tietokantaa. Jos
  // käynnistys kaatuisi tietokantaan ennen tätä, sovellus ei enää koskaan
  // saisi päivitystä — eikä siis myöskään korjausta siihen vikaan.
  if ('serviceWorker' in navigator) {
    // Uusi versio ottaa ohjauksen heti (sw.js kutsuu skipWaiting + claim).
    // Ladataan sivu kerran uudelleen, jotta puhelin saa päivityksen käyttöön
    // ilman että sovellus pitää poistaa ja asentaa uudelleen.
    const oliOhjain = Boolean(navigator.serviceWorker.controller);
    let paivitetty = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!oliOhjain || paivitetty) return;   // ensiasennus ei vaadi latausta
      paivitetty = true;
      location.reload();
    });
    // updateViaCache: 'none' — selaimen HTTP-välimuisti ei saa tarjoilla
    // vanhaa sw.js:ää, muuten päivitys voi jäädä huomaamatta.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        rekisterointi = reg;
        reg.update().catch(() => {});
        // Kotinäytöltä avattu sovellus jää usein taustalle eikä tee uutta
        // navigaatiota, jolloin selain ei tarkista sw.js:ää lainkaan.
        // Tarkistetaan aina kun sovellus palaa näkyviin.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => { /* offline-tuki valinnainen */ });
  }

  db.kunVersioVaihtuu(() => {
    // Toinen ikkuna päivitti tietokannan; tämä yhteys on suljettu eikä
    // tallennus enää toimisi, joten ladataan sovellus uudelleen.
    location.reload();
  });

  try {
    asetukset = await db.haeAsetukset();
    tallennusPysyva = await db.onkoTallennusPysyva();
    await reititys();
  } catch (e) {
    console.error(e);
    naytaKaynnistysvirhe(e.message);
    return;
  }

  // Pysyvää tallennustilaa pyydetään vasta rekisteröinnin jälkeen eikä sitä
  // odoteta: persist() voi jäädä roikkumaan lupapäätöstä odottaessaan.
  if (tallennusPysyva === false) {
    db.pyydaPysyvaTallennus().then((tulos) => {
      if (tulos === tallennusPysyva) return;
      tallennusPysyva = tulos;
      if (!location.hash || location.hash === '#/') reititys();
    });
  }
})();
