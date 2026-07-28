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
   - `Osittain` ja `Ei` avaavat huomautuslaatikon — kirjoita miksi.
   - `Kaikki kunnossa` merkitsee koko osion kerralla; poikkeukset muutetaan
     yksitellen.
   - `Ei kohteessa` jättää osion pois raportista (esim. ei saunaa).
   - Enintään 4 kuvaa per osio, kuten raporttipohjassa.
4. **Luo raporttitekstit** kun verkko on käytettävissä. Claude kirjoittaa
   Yleiskuvaus / Havainnot / Toimenpide-ehdotukset ja kuvatekstit. Tekstejä voi
   muokata osionäkymissä ennen vientiä.
5. **Vie paketti** → jaa itsellesi (Drive, sähköposti) tai lataa.

Kaikki tallentuu heti laitteelle. Nettiä tarvitaan vain AI-vaiheessa.

## Paketin purku koneella

Pura ZIP `Kohteet/`-kansioon ja pyydä Claudea:
`Tee raportti kohteesta Kohteet/<kansio>`.

Paketin sisältö:

| Tiedosto | Sisältö |
| --- | --- |
| `muistiinpanot.md` | `Kohteet/_MALLI-kohde/muistiinpanot.md` -rungon mukainen, AI:n täyttämä |
| `tyomaakirja.md` | rastit ja huomautukset taulukkona |
| `tarkastus.json` | koko raakadata (varmuuskopio, uudelleenajo) |
| `kuvat/` | `07-julkisivut-1.jpg` jne. — etuliite kertoo raportin osion |

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
| `lib/zip.js` | ZIP-kirjoitin (store-only, ei riippuvuuksia) |
| `sw.js` | offline-välimuisti |

Ei riippuvuuksia, ei käännösvaihetta — tiedostot ajetaan sellaisenaan.

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
