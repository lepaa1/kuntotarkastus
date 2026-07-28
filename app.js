// Kuntotarkastus-sovellus: näkymät, navigaatio ja tilanhallinta.

import * as db from './lib/db.js';
import * as vienti from './lib/vienti.js';
import * as ai from './lib/ai.js';
import { skaalaa, muotoileKoko } from './lib/kuva.js';
import {
  TILAT, LOMAKEOSIOT, OSIOT,
  osioMaaritys, osioNimi, osioJarjestys,
} from './data/tarkastuskohdat.js';

const YLAPALKKI = document.getElementById('ylapalkki');
const OTSIKKO = document.getElementById('otsikko');
const TAKAISIN = document.getElementById('takaisin');
const VALIKKO = document.getElementById('valikko');
const SISALTO = document.getElementById('sisalto');
const ALAPALKKI = document.getElementById('alapalkki');
const ILMOITUS = document.getElementById('ilmoitus');
const DIALOGI = document.getElementById('dialogi');

let asetukset = null;
let kohde = null;               // avoinna oleva kohde
const kuvaUrlit = new Map();    // avain -> object URL, vapautetaan näkymän vaihtuessa
let tallennusAjastin = null;
let tallentamatta = false;      // onko muutoksia, joita ei ole vielä kirjoitettu

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
    kohde.osiot[osioId] = { tilat: {}, huomautukset: {}, muuta: '', kuvat: [], poissa: false };
  }
  return kohde.osiot[osioId];
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
    const kuvia = Object.values(k.osiot || {}).reduce((s, o) => s + (o.kuvat || []).length, 0);
    return h('button', { class: 'kortti kohde-rivi', onclick: () => siirry(`/kohde/${k.id}`) },
      h('span', { class: 'nimi' },
        k.nimi || 'Nimetön kohde',
        h('span', { class: 'meta' },
          `${osioita} osiota · ${kuvia} kuvaa · muokattu ${pvm(k.muokattu)}`),
        k.ai ? h('span', { class: 'meta' }, '✓ raporttitekstit luotu') : null),
      h('span', { class: 'himmea' }, '›'));
  });

  SISALTO.replaceChildren(
    h('h2', null, 'Kohteet'),
    lista.length ? h('div', null, lista)
      : h('div', { class: 'kortti himmea' },
        'Ei vielä kohteita. Aloita uudella tarkastuksella.'),
  );

  ALAPALKKI.hidden = false;
  ALAPALKKI.replaceChildren(
    h('button', { class: 'ensisijainen', onclick: uusiKohde }, '+ Uusi tarkastus'));
}

function pvm(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

async function uusiKohde() {
  const nimi = await kysy('Kohteen osoite tai nimi', '');
  if (nimi === null) return;
  const uusi = {
    id: `k_${Date.now().toString(36)}`,
    nimi: nimi || 'Nimetön kohde',
    luotu: new Date().toISOString(),
    lomake: { lahtotiedot: { katuosoite: nimi, tarkastajat: asetukset.tarkastaja || '' },
      olosuhteet: {}, rakennustiedot: {} },
    tiivistelma: '',
    rajoitukset: '',
    paivays: '',
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

    h('h2', null, 'Kohteen hallinta'),
    h('div', { class: 'kortti' },
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
  for (const kuva of kohde.osiot[osioId]?.kuvat || []) {
    await db.poistaKuva(kuva.avain);
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
  return h('div', { class: 'kentta' },
    h('label', null, nimi),
    h('textarea', {
      rows: rivit, value: arvo || '', placeholder: vihje,
      oninput: (e) => muutos(e.target.value),
    }));
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
    huomautusPaikka.replaceChildren(h('textarea', {
      rows: 2, value: arvo, placeholder: 'Miksi ei ole kunnossa?',
      oninput: (e) => {
        o.huomautukset[i] = e.target.value;
        huomautusPaikka.className = `huomautus${e.target.value.trim() ? '' : ' pakollinen'}`;
        tallennaPian();
      },
    }));
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
  return h('div', { class: 'kohta' },
    h('div', { class: 'teksti' }, teksti),
    h('div', { class: 'tilat' }, napit),
    huomautusPaikka);
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
      ruudukko.append(h('div', null,
        h('div', { class: 'kuvapaikka' },
          url ? h('img', { src: url, alt: `Kuva ${i + 1}` })
            : h('span', { class: 'himmea' }, 'Kuvaa ei löydy'),
          h('button', {
            class: 'poista', 'aria-label': 'Poista kuva',
            onclick: () => poistaKuva(osioId, i),
          }, '×'),
          h('span', { class: 'numero' }, `Kuva ${i + 1}`)),
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
      o.kuvat.push({ avain, teksti: '' });
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
  await db.poistaKuva(kuva.avain);
  const url = kuvaUrlit.get(kuva.avain);
  if (url) { URL.revokeObjectURL(url); kuvaUrlit.delete(kuva.avain); }
  o.kuvat.splice(i, 1);
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
      h('button', { style: 'width:100%', onclick: tallenna }, 'Tallenna')),

    h('h2', null, 'Tallennustila'),
    h('div', { class: 'kortti himmea' },
      tila
        ? `Käytössä ${muotoileKoko(tila.kaytetty)} / ${muotoileKoko(tila.kiintio)}`
        : 'Tallennustilan tietoja ei saatavilla.'),
  );

  ALAPALKKI.hidden = true;
}

// --- Käynnistys --------------------------------------------------------------

TAKAISIN.addEventListener('click', () => history.back());
VALIKKO.addEventListener('click', () => siirry('/asetukset'));
window.addEventListener('hashchange', reititys);
// Kirjoitetaan vain jos jotain on oikeasti jäänyt tallentamatta — muuten
// vanhentunut muistissa oleva kohde voisi ylikirjoittaa tuoreemman tiedon.
window.addEventListener('beforeunload', () => {
  if (kohde && tallentamatta) db.tallennaKohde(kohde);
});

(async function kaynnista() {
  asetukset = await db.haeAsetukset();
  await reititys();
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
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline-tuki valinnainen */ });
  }
})();
