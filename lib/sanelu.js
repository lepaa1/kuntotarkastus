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
  let pohja = '';       // kentän sisältö sanelun alkaessa
  let valmis = '';      // tunnistetut lopulliset osat

  function paivita(alustava) {
    const valilyonti = pohja && !/\s$/.test(pohja) ? ' ' : '';
    kentta.value = pohja + valilyonti + valmis + alustava;
    onMuutos(kentta.value);
  }

  function lopeta() {
    if (!tunnistin) return;
    const t = tunnistin;
    tunnistin = null;
    nappi.classList.remove('kuuntelee');
    try { t.stop(); } catch { /* jo pysähtynyt */ }
    paivita('');
  }

  nappi.addEventListener('click', () => {
    if (tunnistin) { lopeta(); return; }

    pohja = kentta.value;
    valmis = '';

    tunnistin = new Tunnistus();
    tunnistin.lang = 'fi-FI';
    tunnistin.continuous = true;
    tunnistin.interimResults = true;

    tunnistin.onresult = (e) => {
      let alustava = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const teksti = e.results[i][0].transcript;
        if (e.results[i].isFinal) valmis += teksti;
        else alustava += teksti;
      }
      paivita(alustava);
    };

    tunnistin.onerror = (e) => {
      const viestit = {
        'not-allowed': 'Mikrofonia ei saatu käyttöön. Salli mikrofoni selaimen asetuksista.',
        'no-speech': 'Puhetta ei tunnistettu.',
        'network': 'Sanelu vaatii verkkoyhteyden.',
      };
      ilmoita?.(viestit[e.error] || `Sanelu epäonnistui: ${e.error}`, true);
      lopeta();
    };

    tunnistin.onend = () => { if (tunnistin) lopeta(); };

    try {
      tunnistin.start();
      nappi.classList.add('kuuntelee');
    } catch (e) {
      tunnistin = null;
      ilmoita?.(`Sanelua ei voitu aloittaa: ${e.message}`, true);
    }
  });

  return nappi;
}
