# Kuntotarkastussovellus (puhelin)

Selainpohjainen sovellus, jolla kuntotarkastus kirjataan kerran paikan päällä.
Asennetaan Android-puhelimen kotinäytölle, toimii offline, käyttää kameraa.
Kun tarkastus on valmis, Claude kirjoittaa raporttitekstit ja sovellus vie
aineiston ZIP-pakettina koneelle, jossa nykyinen docx-putki tekee raportin.

```
Puhelin                                    Kone
──────                                     ────
kirjaus → kuvat → Claude API   →  ZIP  →  Kohteet/<kohde>/  →  "Tee raportti"  →  .docx
```

## Käyttö kentällä

1. **Uusi tarkastus** → anna kohteen osoite.
2. **Perustiedot** (2 Lähtötiedot, 3 Olosuhteet, 5 Rakennustekniset tiedot).
3. **Rakennusosat**: jokaisessa osiossa työmaakirjan tarkastuskohdat.
   - Näpäytä `OK` / `Osittain` / `Ei` / `–` (ei koske).
   - `Osittain` ja `Ei` avaavat huomautuslaatikon — kirjoita miksi. Mikrofoni-
     painikkeesta voit sanella kirjoittamisen sijaan.
   - `Kaikki kunnossa` merkitsee koko osion kerralla; poikkeukset muutetaan
     yksitellen.
   - `Ei kohteessa` jättää osion pois raportista (esim. ei saunaa).
   - **Mittaukset**: *+ Lisää mittaus* kirjaa mittauspaikan, lukeman, yksikön
     ja laitteen. Gannin pallopääanturi antaa suhteellisen lukeman ilman
     yksikköä (`–`), Vaisala HM-40 antaa RH %, °C ja g/m³.
   - Enintään 4 kuvaa per osio, kuten raporttipohjassa. **Napauta kuvaa** niin
     voit piirtää siihen nuolen tai ympyröinnin. Alkuperäinen kuva säilyy, joten
     merkinnät voi tehdä uusiksi tai poistaa kumoamalla ne kaikki.
4. **Luo raporttitekstit** kun verkko on käytettävissä. Claude kirjoittaa
   Yleiskuvaus / Havainnot / Toimenpide-ehdotukset ja kuvatekstit. Tekstejä voi
   muokata osionäkymissä ennen vientiä.
5. **Vie paketti** → jaa itsellesi (Drive, sähköposti) tai lataa.

Kaikki tallentuu heti laitteelle. Nettiä tarvitaan vain AI-vaiheessa ja
sanelussa.

## Varmuuskopiot

Sovellus pyytää käynnistyessään **pysyvää tallennustilaa**. Jos selain ei
myönnä sitä, kohdelistassa näkyy varoitus — silloin puhelin voi tyhjentää
tiedot muistin loppuessa. Tilan näkee ja sen voi pyytää uudelleen
**Asetuksista**.

Vietyä pakettia voi käyttää varmuuskopiona: **Tuo paketti** kohdelistan
alapalkissa palauttaa kohteen takaisin sovellukseen — myös toiseen puhelimeen.
Jos sama kohde on jo olemassa, voit korvata sen tai tuoda kopiona. Kohdenäkymä
kertoo milloin kohde on viimeksi viety ja onko sen jälkeen tullut muutoksia.

> Tuonti hyväksyy myös uudelleenpakatut kansiot (Windowsin *Pakattu kansio*
> ja `Compress-Archive`), ei pelkästään sovelluksen omia paketteja.

## Kuvat puhelimeen

Kohdenäkymän **Kuvat puhelimeen** -lohkosta voi tallentaa kaikki kohteen kuvat
puhelimen muistiin yhdellä painalluksella. Kuvat tallentuvat kameran ottamassa
täydessä tarkkuudessa nimillä kuten `Poikkikuja 3_07-julkisivut-1.jpg`.

> **Kuvat menevät Lataukset-kansioon, eivät kamerarullaan.** Selainsovellus ei
> pääse kirjoittamaan Androidin galleriakansioon (DCIM) — se on selaimen
> turvarajoitus. Kuvat näkyvät Galleriassa ja Google Kuvissa omana
> "Download"-kansionaan. Ensimmäisellä kerralla selain kysyy luvan tallentaa
> useita tiedostoja; hyväksy se.

Alkuperäiskuvat vievät moninkertaisesti tilaa raporttiin meneviin 1600 px:n
kuviin verrattuna, joten lohko näyttää niiden koon ja tarjoaa **Vapauta tilaa**
-painikkeen. Raporttiin menevät kuvat säilyvät aina. Säilytyksen voi kytkeä
kokonaan pois **Asetuksista**, jolloin puhelimeen tallentuu sama pienennetty
versio joka menee raporttiin.

## Liitteet

Kohdenäkymän **Liitteet**-lohkoon voi lisätä energiatodistuksen, piirustukset
ja muut dokumentit. Ne menevät pakettiin `lisatiedot/`-kansioon, samaan
paikkaan johon ne on tähän asti kopioitu käsin. Liitteet eivät päädy raporttiin
vaan ovat tarkastajan tausta-aineistoa.

## Paketin purku koneella

Pura ZIP `Kohteet/`-kansioon ja pyydä Claudea:
`Tee raportti kohteesta Kohteet/<kansio>`.

Paketin sisältö:

| Tiedosto | Sisältö |
| --- | --- |
| `muistiinpanot.md` | `Kohteet/_MALLI-kohde/muistiinpanot.md` -rungon mukainen, AI:n täyttämä |
| `tyomaakirja.md` | rastit, huomautukset ja mittaukset taulukkoina |
| `tarkastus.json` | koko raakadata (varmuuskopio, tuonti takaisin sovellukseen) |
| `kuvat/` | `07-julkisivut-1.jpg` jne. — etuliite kertoo raportin osion |
| `lisatiedot/` | liitetiedostot alkuperäisillä nimillään |

### Raporttiin renderöinti

Kun raporttia tehdään koneella:

- **Mittaukset** tulevat osioon omaksi taulukokseen (Paikka | Lukema | Yksikkö |
  Laite) Havainnot-tekstin jälkeen. Lukemia ei tulkita eikä verrata raja-arvoihin
  — Gannin pintakosteudenosoitin antaa vain suhteellisen lukeman.
- **Liitteet** eivät mene raporttiin.
- Kuvat ovat jo merkittyinä, jos niihin on piirretty nuolia tai ympyröintejä.

Tyhjiksi jääneet osiot eivät ole mukana; ne on listattu `muistiinpanot.md`:n
lopussa, jotta näet mitä jätettiin pois.

## Asennus puhelimeen

Sovellus tarvitsee HTTPS-osoitteen (tai localhostin), joten se julkaistaan
staattisena sivustona — esimerkiksi GitHub Pagesiin:

```bash
git init && git add sovellus && git commit -m "Kuntotarkastussovellus"
```

Työnnä repo GitHubiin, ota Settings → Pages käyttöön (haara `main`, kansio
`/sovellus`), ja avaa osoite puhelimen Chromella → valikko → **Lisää
aloitusnäyttöön**.

Ensimmäisellä käynnistyksellä käy **Asetukset** ja syötä Claude API -avain.
Paina *Testaa yhteys* ennen ensimmäistä tarkastusta.

> Avain tallentuu vain puhelimeen eikä ole koodissa, mutta se on laitteella
> luettavissa. Aseta avaimelle kulutusraja Anthropic-konsolissa.

## Kehitys koneella

```bash
powershell -ExecutionPolicy Bypass -File _tyokalut/serve.ps1
```

Avaa `http://localhost:8080/`. Palvelin lähettää `Cache-Control: no-store`,
mutta **service worker välimuistittaa tiedostot** — muutosten näkyminen vaatii
joko välimuistin tyhjennyksen selaimen kehitystyökaluista tai
`sovellus/sw.js`:n version kasvattamisen.

Ikonit luodaan uudelleen komennolla:

```bash
powershell -ExecutionPolicy Bypass -File _tyokalut/tee-ikonit.ps1
```

### Julkaisu

Kasvata `sovellus/sw.js`:n `VALIMUISTI`-versiota (`kuntotarkastus-v1` →
`-v2`) aina kun julkaiset muutoksia. Ilman sitä puhelin voi jäädä käyttämään
vanhaa versiota. Sovellus lataa itsensä automaattisesti uudelleen, kun uusi
service worker ottaa ohjauksen.

## Rakenne

| Tiedosto | Vastuu |
| --- | --- |
| `data/tarkastuskohdat.js` | osiot ja tarkastuskohdat — **muokkaa tätä, kun listat muuttuvat** |
| `app.js` | näkymät, navigaatio, tilanhallinta |
| `lib/db.js` | IndexedDB (kohteet, kuvat, asetukset) |
| `lib/kuva.js` | kuvan skaalaus ja pakkaus |
| `lib/ai.js` | Claude API -kutsu, kehotteet, kustannusarvio |
| `lib/vienti.js` | muistiinpanot.md / tyomaakirja.md / ZIP-paketti |
| `lib/tuonti.js` | paketin palautus takaisin sovellukseen |
| `lib/zip.js` | ZIP-kirjoitin ja -lukija (ei riippuvuuksia) |
| `lib/sanelu.js` | puheentunnistus tekstikenttiin |
| `lib/merkinta.js` | nuolten ja ympyröintien piirto kuviin |
| `sw.js` | offline-välimuisti |

Ei riippuvuuksia, ei käännösvaihetta — tiedostot ajetaan sellaisenaan.

> **Uusi tiedosto?** Lisää se `sw.js`:n `TIEDOSTOT`-listaan ja kasvata
> `VALIMUISTI`-versiota. Muuten offline-tila hajoaa tai puhelin jää vanhaan
> versioon.

### Tarkastuskohtien muokkaus

`data/tarkastuskohdat.js`:n `OSIOT`-taulukko ajaa koko käyttöliittymän.
Tarkastuskohdat tunnistetaan **järjestysnumeron** perusteella, joten kohdan
lisääminen listan keskelle siirtää vanhojen kohteiden rastit. Lisää uudet
kohdat osion listan loppuun, tai luo kohteet uudelleen.

## Tunnetut rajaukset

- **Kodinhoitohuone** ei ole raporttipohjassa omana osionaan. Sovelluksessa se
  on oma osionsa (`15b`) ja päätyy raporttiin heti pesuhuoneen jälkeen.
- **2. WC** luodaan *Lisää toinen WC* -painikkeella; kuvat menevät etuliitteellä
  `17b-wc`.
- **Kellarilla** ei ole työmaakirjassa tarkastuskohtia — vapaa teksti ja kuvat.
- Osiot 20–23 (LVIS) ovat ilman kuvapaikkoja, kuten raporttipohjassa.
