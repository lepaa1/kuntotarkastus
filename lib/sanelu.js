// Sanelu tekstikenttiin selaimen puheentunnistuksella.
//
// Kentällä kirjoittaminen on hidasta: kylmät sormet, hankalat asennot,
// ahtaat tilat. Sanelu on käytännössä ainoa tapa saada pitkä huomautus
// kirjattua ryömintätilassa.
//
// TIETOSUOJA: Chromen puheentunnistus lähettää äänen Googlen palvelimille.
// Sama koskee Android-näppäimistön sanelutoimintoa, joten tämä ei muuta
// tietosuojaa — se vain tekee sanelusta nopeampaa (iso painike, ei
// näppäimistöä). Asia on kerrottu asetuksissa.

const Tunnistus = window.SpeechRecognition || window.webkitSpeechRecognition;

// Jos tunnistus loppuu heti perakkain nain monta kertaa tuottamatta mitaan,
// lopetetaan — muuten rikkinainen mikrofoni jaisi ikuiseen silmukkaan.
const TYHJIA_UUDELLEENALOITUKSIA = 3;

export function saneluTuettu() {
  return Boolean(Tunnistus);
}

/**
 * Liittää sanelupainikkeen tekstikenttään.
 * @param {HTMLTextAreaElement|HTMLInputElement} kentta
 * @param {(arvo: string) => void} onMuutos kutsutaan kun teksti muuttuu
 * @param {(viesti: string, virhe?: boolean) => void} [ilmoita]
 * @returns {HTMLButtonElement|null} null jos selain ei tue sanelua
 */
export function liitaSanelu(kentta, onMuutos, ilmoita) {
  if (!Tunnistus) return null;

  const nappi = document.createElement('button');
  nappi.type = 'button';
  nappi.className = 'sanelu';
  nappi.title = 'Sanele';
  nappi.setAttribute('aria-label', 'Sanele');
  nappi.textContent = '🎤';

  let tunnistin = null;
  let pohja = '';          // kentan sisalto sanelun alkaessa
  let lopetetaan = false;  // kayttaja painoi painiketta
  let tyhjia = 0;          // perakkaisia tuloksettomia jaksoja

  function yhdista(...osat) {
    return osat.map((o) => o.trim()).filter(Boolean).join(' ');
  }

  function paivita(valmis, alustava) {
    kentta.value = yhdista(pohja, valmis, alustava);
    onMuutos(kentta.value);
  }

  function lopeta() {
    lopetetaan = true;
    const t = tunnistin;
    tunnistin = null;
    nappi.classList.remove('kuuntelee');
    if (t) { try { t.stop(); } catch { /* jo pysahtynyt */ } }
  }

  function aloita() {
    const t = new Tunnistus();
    t.lang = 'fi-FI';
    t.continuous = true;
    t.interimResults = true;

    t.onresult = (e) => {
      // e.results on KUMULATIIVINEN: se sisaltaa koko jakson tulokset joka
      // kerta. Siksi teksti kootaan aina alusta uudelleen — jos tuloksia
      // lisattaisiin kertyvaan muuttujaan, samat sanat tulisivat moneen
      // kertaan sita mukaa kun selain paivittaa jo valmiita osia.
      const valmiit = [];
      let alustava = '';
      for (let i = 0; i < e.results.length; i++) {
        const teksti = e.results[i][0].transcript;
        if (e.results[i].isFinal) valmiit.push(teksti);
        else alustava += teksti;
      }
      if (valmiit.length || alustava.trim()) tyhjia = 0;
      paivita(yhdista(...valmiit), alustava);
    };

    t.onerror = (e) => {
      const viestit = {
        'not-allowed': 'Mikrofonia ei saatu käyttöön. Salli mikrofoni selaimen asetuksista.',
        'service-not-allowed': 'Mikrofonia ei saatu käyttöön.',
        'network': 'Sanelu vaatii verkkoyhteyden.',
      };
      // no-speech tulee normaalisti tauoista, siita ei kannata huomauttaa
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        ilmoita?.(viestit[e.error] || `Sanelu epäonnistui: ${e.error}`, true);
        lopeta();
      }
    };

    t.onend = () => {
      if (lopetetaan || tunnistin !== t) return;
      // Chrome katkaisee jakson tauon jalkeen. Jatketaan automaattisesti,
      // jotta pitkan huomautuksen voi sanella yhteen menoon.
      tyhjia++;
      if (tyhjia > TYHJIA_UUDELLEENALOITUKSIA) { lopeta(); return; }
      // Tahan asti tunnistettu siirtyy pohjaksi, koska uusi jakso aloittaa
      // tyhjasta tuloslistasta.
      pohja = kentta.value;
      tunnistin = null;
      aloita();
    };

    tunnistin = t;
    try {
      t.start();
      nappi.classList.add('kuuntelee');
    } catch (e) {
      tunnistin = null;
      nappi.classList.remove('kuuntelee');
      ilmoita?.(`Sanelua ei voitu aloittaa: ${e.message}`, true);
    }
  }

  nappi.addEventListener('click', () => {
    if (tunnistin) { lopeta(); return; }
    pohja = kentta.value;
    lopetetaan = false;
    tyhjia = 0;
    aloita();
  });

  return nappi;
}
