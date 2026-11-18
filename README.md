# 🎁 Gaveplanlegger

Ønskeliste der venner kan reservere gaver i hemmelighet, med vennelister, gaveplanlegger med lister (jul, bryllup, konfirmasjon …), ønskelister for bryllup, bryllupsdag og jubileum, bursdagsvarsler og annonser fra Google AdSense.

## Funksjoner

| Område | Hva den gjør |
|---|---|
| **Konto** | Registrering med navn, e-post og passord (minst 8 tegn). Fødselsdato, kjønn og mobilnummer er valgfritt – uten fødselsdato får vennene ikke bursdagsvarsel. Brukeren bekrefter at hen er 13 år eller eldre, og godtar personvernerklæringen. Passord lagres kryptert (scrypt). Innlogging holder i 30 dager. Brukeren kan endre profil, bytte passord og slette kontoen. |
| **Mine ønsker** | Legg til ønsker med tittel, lenke, pris, kommentar og prioritet. Endre, marker som «Fått den», eller fjern. **Eieren ser aldri om noe er reservert.** |
| **Hent navn og pris fra lenke** | Når du limer inn en produktlenke (i «Mine ønsker», gaveplanleggeren og julelisten), henter appen navn og pris fra butikkens side og fyller ut feltene som er tomme. «Hent» henter på nytt og overskriver. Appen leser de strukturerte produktdataene butikkene legger inn for Google og Facebook (JSON-LD, Open Graph og microdata). Mangler de, brukes produktoverskriften og den synlige prisen på siden (beløp merket «Spar», «Førpris», «Veil.» og månedspriser hoppes over). Finner den ingenting, eller blokkerer butikken henting, fyller du ut selv som før. |
| **Deling** | Personlig delingslenke med knapper for e-post, SMS og telefonens egen deling. Den som åpner lenken og logger inn (eller registrerer seg) blir automatisk venn. Lenken kan byttes ut hvis den kommer på avveie. |
| **Venner** | Legg til venner via e-post (venneforespørsel som må godtas). Har vennen ikke konto, får du knapper for å invitere på e-post eller SMS. Venner kan fjernes – da mister begge tilgang til hverandres lister. |
| **Reservasjoner** | Venner trykker «Jeg kjøper denne». Andre venner ser at ønsket er «Allerede tatt», men ikke av hvem. Egen side «Reservert av meg» fungerer som huskeliste. Hvis eieren fjerner eller markerer et reservert ønske som mottatt, får den som reserverte beskjed. |
| **Bursdagsvarsler** | Oversikten viser venner med bursdag de neste 30 dagene, og et tydelig banner når noen har bursdag innen en uke. Varsler (🔔) opprettes 14, 7 og 1 dag før, og på selve dagen. E-post sendes også hvis du kobler til en e-posttjeneste (se under). |
| **Gaveplanlegger** | En privat liste over folk du skal gi gave til som ikke har ønskeliste her: navn, relasjon, bursdag (år er valgfritt), e-post og notater. Personene vises som en kompakt liste med bursdag, antall ideer og hva som er kjøpt. Trykk på en person for å se gaveideene, eller bruk «Vis alle» / «Skjul alle». Under hver person samler du gaveideer med lenke, pris og anledning, og markerer dem som *Idé → Kjøpt → Gitt*. Bursdagene kommer med på oversikten og i varslene. Knappen «Inviter» lar deg sende personen en invitasjon til å lage sin egen ønskeliste. |
| **Lister i gaveplanleggeren** | Lag lister for juleklapper, bryllup du skal i, konfirmasjoner og annet, f.eks. «Juleliste 2026». Hver liste har en **frist**. Den vises som aktiv frem til 7 dager etter fristen, så flyttes den automatisk til **historikk**. Fra historikken lager du en ny liste med samme personer og budsjett, f.eks. neste års juleliste. Legg til venner med konto: da ser du **ønskelisten deres rett i listen** og kan reservere derfra. Du kan også legge til personer uten konto eller nye navn, og lage egne gaveideer, budsjett og status per person. Du får varsel 7 dager og 1 dag før fristen hvis noen mangler gave. |
| **Ønskelister 🎉** | Ønskeliste for en anledning: bryllup, bryllupsdag, jubileum, bursdag, konfirmasjon eller annet. Kan ha en medeier, f.eks. partneren. Gavene kan ha **antall** (f.eks. 12 tallerkener som flere deler på) eller **spleis** (bidrag til en dyr gave, med fremdriftsmåler). **Synlig for alle vennene dine** i appen (kan slås av): de får beskjed når listen lages, og ser den på oversikten, på siden din og under Ønskelister. Lenken kan i tillegg sendes til **hvem som helst uten konto**: de skriver navn og eventuelt e-post, og får en lenke for å angre. Eierne ser ikke hva som er reservert før etter dagen. Da vises **hvem som ga hva**, til takkekortene. Gamle bryllupslenker (`#/bryllupsliste/…`) virker fortsatt. |
| **Annonser** | Google AdSense-annonser på oversikten, vennenes ønskelister, gaveplanleggeren og «Reservert av meg». Alle er merket «Annonse». Lenker til gaver går rett til butikken. Ingen affiliate-koder. |

## Kom i gang

Krever **Node.js 22.5 eller nyere** – ingen andre pakker trengs (databasen er innebygd SQLite).

```bash
cd gaveliste
npm start          # starter på http://localhost:3000
npm test           # kjører 82 automatiske tester (hele flyten, lister, bryllup og lenkehenting)
```

Dataene lagres i `data/gaveliste.db`. Ta sikkerhetskopi av denne filen.

## Innstillinger

### `config.json`
- `baseUrl` – adressen nettsiden ligger på (brukes i delingslenkene). Sett til f.eks. `https://gaveliste.no` i produksjon.
- `adminEmails` – hvem som får se klikkstatistikken.
- `reminderDays` / `upcomingWindowDays` – når bursdagsvarsler sendes og hvor langt frem oversikten ser.
- `ads.client` – AdSense-ID-en din (`ca-pub-…`). Så lenge den er tom, vises grå plassholdere der annonsene skal stå.
- `ads.slots` – ID-er for annonseenhetene du lager i AdSense: `onskeliste`, `oversikt`, `planlegger`, `reservasjoner` og `onskeliste`. En tom plass vises ikke. Du kan i stedet slå på «Automatiske annonser» i AdSense, så velger Google plasseringene selv.
- `ads.showPlaceholders` – sett til `false` for å skjule plassholderne mens AdSense ikke er koblet til.

### Miljøvariabler
| Variabel | Bruk |
|---|---|
| `PORT` | Port serveren lytter på (standard 3000) |
| `BASE_URL` | Overstyrer `baseUrl` |
| `DB_FILE` | Hvor databasen ligger |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Send e-post fra en vanlig e-postkonto, f.eks. hos Domene.no: `mail.gaveplanlegger.no`, port `465` (SSL) eller `587` (STARTTLS), hele e-postadressen og passordet. Brukes foran Resend når den er satt. `SMTP_SECURE` (`ssl`/`starttls`) og `SMTP_TLS_SERVERNAME` kan overstyre. |
| `RESEND_API_KEY` | Send e-post via Resend i stedet for egen e-postkonto. |
| `MAIL_FROM` | Avsender, f.eks. `Gaveplanlegger <jorn@gaveplanlegger.no>`. Med egen e-postkonto må adressen være den samme som `SMTP_USER`. |
| `ADMIN_EMAILS` | Kommaseparert liste, overstyrer `adminEmails` |
| `ADSENSE_CLIENT` | Overstyrer `ads.client` |
| `TRUST_PROXY` | Sett til `1` når appen kjører bak Render/Railway, så bremsene mot misbruk ser riktig IP-adresse |
| `BETA` | `0` skrur av testversjon-merkingen uten å endre `config.json` (eller `1` for å skru den på) |
| `CONTACT_EMAIL` | Support-adressen, f.eks. `support@gaveplanlegger.no`. Vises på «Kontakt oss» og i personvernerklæringen, og tilbakemeldinger sendes hit (med «Svar til» satt til avsenderen). |

## Slik kobler du til Google AdSense

1. Legg appen ut på et eget domene først. AdSense godkjenner bare nettsteder som er tilgjengelige på nett.
2. Søk om AdSense-konto på adsense.google.com og legg til domenet ditt.
3. Lim inn ID-en (`ca-pub-…`) i `config.json` under `ads.client`, og start appen på nytt. Da legges AdSense-koden inn på alle sider, og `/ads.txt` lages automatisk med riktig innhold.
4. **Samtykke (påkrevd i Norge/EØS):** Google krever en *sertifisert* samtykkeløsning (CMP) for å vise personlig tilpassede annonser i EØS. Det enkleste er å slå på Googles egen under **Personvern og meldinger → GDPR** i AdSense – den kommer med AdSense-koden og krever ingen endringer i appen.
5. Lag annonseenheter (Annonser → Etter annonseenhet → Display) og lim ID-ene inn i `ads.slots`, eller slå på Automatiske annonser.
6. Siden appen krever innlogging, ser Googles robot bare forsiden. Annonsene vil derfor ikke være knyttet til hvert enkelt ønske, men til innholdet på nettstedet og til hva den enkelte besøkende er interessert i (når de har samtykket). Du kan legge inn en egen testkonto under **Konto → Tilgang og autorisasjon → Robottilgang** i AdSense.

## Testversjon (beta)
Så lenge `beta.enabled` er `true` i `config.json`, vises en liten «Beta»-merking ved logoen og en gul stripe øverst på alle sider med teksten fra `beta.message` og en knapp til tilbakemeldingsskjemaet. Stripen kan lukkes (den holder seg borte mens nettleserfanen er åpen), merkingen ved logoen blir stående. Personvernerklæringen nevner også at tjenesten er i testversjon. Sett `enabled` til `false`, eller `BETA=0` hos Render, ved full lansering.

## Glemt passord
- **«Glemt passord?»** på innloggingssiden sender en engangslenke på e-post (krever Resend). Lenken virker i 2 timer og bare én gang. Når passordet byttes, logges brukeren ut alle andre steder.
- Svaret er det samme om e-posten finnes eller ikke, så ingen kan bruke skjemaet til å finne ut hvem som har konto.
- **Uten e-post:** i Admin-fanen kan du under «Hjelp en bruker inn igjen» lage en lenke (virker i 24 timer) og sende den selv på SMS eller e-post.

## Kontakt oss og tilbakemeldinger
- Knappen **«Tilbakemelding»** nederst til høyre på alle sider lar brukere (også uten konto) melde feil, forbedringsønsker og spørsmål. Siden de var på og nettlesertype sendes med automatisk.
- **«Kontakt oss»** og **«Personvern»** ligger i bunnen av alle sider. Fyll inn `owner` i `config.json` (navn, org.nr., e-post, adresse, dato) – feltene vises med gul markering til de er fylt ut.
- Administratorer (`ADMIN_EMAILS`) får en **Admin**-fane med antall nye saker, kan svare på e-post med ett klikk og markere saker som behandlet. De får også varsel i appen, og e-post når Resend er satt opp.
- Skjemaene har innebygd vern mot spam-roboter og maks 8 meldinger per kvarter per IP-adresse.
- I Admin-fanen kan du **sende en test-e-post til deg selv** for å sjekke e-postoppsettet, og feilmeldingen vises der hvis noe er galt.
- I Admin-fanen kan du **laste ned en sikkerhetskopi** av hele databasen (én fil). Ta en kopi jevnlig og lagre den kryptert.

## Legge den ut på nett (kort)
Se den egne lanseringsguiden for detaljer. Kort: last opp koden til et privat GitHub-repo, velg «New → Blueprint» hos Render og pek på repoet. `render.yaml` setter opp Frankfurt-region, Starter-plan, 1 GB disk på `/var/data`, helsesjekk på `/healthz` og miljøvariablene. Koble så domenet under «Settings → Custom Domains».

## Legge den ut på nett

Appen er én Node-prosess og én databasefil, så den kan kjøres hos de fleste leverandører som støtter Node.js med **varig disk** (databasefilen må ikke slettes ved omstart), eller på en egen liten VPS. Husk:
1. Sett `BASE_URL` til den ekte adressen med `https://` – da blir innloggingscookien også sikker.
2. Pek `DB_FILE` til den varige disken.
3. Sett opp sikkerhetskopi av databasen.

## Oppgradering fra tidligere versjon
Fødselsdato og kjønn ble gjort valgfrie i v8. Brukertabellen bygges da automatisk om første gang appen starter, med alle data og koblinger intakte.

Eksisterende julelister flyttes automatisk til gaveplanleggeren første gang den nye versjonen starter. Navnet blir «Juleliste ÅÅÅÅ» med frist 24. desember, og personer, budsjett og julegaver blir med. Ta likevel en kopi av `data/gaveliste.db` før du oppgraderer.

## Om lenkehenting
- Serveren henter siden selv. Adresser på interne nettverk (localhost, 10.x, 192.168.x osv.) blokkeres, slik at ingen kan bruke funksjonen til å se inn i nettverket der appen kjører.
- Maks 60 hentinger per bruker per kvarter. Svar caches i én time.
- Noen store butikker blokkerer automatisk henting. Da får brukeren en melding og fyller inn selv.

### Når «Hent» ikke virker
Kjør feilsøkingsverktøyet med lenken som ikke virker:
```bash
npm run sjekk-lenke -- https://www.butikk.no/produktet
```
Det viser steg for steg om nettsiden ble funnet, om den kunne hentes, og om navn og pris ble funnet. Vanlige årsaker:
- **«Sikkerhetssertifikatet … ble ikke godtatt»**: et antivirusprogram (f.eks. Avast, ESET eller Kaspersky) eller et bedriftsnettverk sjekker nettrafikken. Start appen med `npm run start:systemsertifikat`, så bruker den de samme sertifikatene som nettleseren. (Krever Node.js 22.15 eller nyere.)
- **«Butikken avbrøt forbindelsen»** eller **tidsavbrudd**: butikken blokkerer automatisk henting. Da må navn og pris fylles inn for hånd.
- **«Fant ikke nettsiden»**: feil i lenken, eller ingen internettforbindelse.

Appen skriver også den tekniske feilkoden i terminalvinduet der den kjører (linjer som starter med `[lenkehenting]`).

## Før lansering – sjekkliste

- **Personvern (GDPR):** Skriv en personvernerklæring og vilkår, og lenk til dem i registreringen. Fødselsdato og kjønn er personopplysninger – oppgi formålet.
- **Reklame:** Markedsføringsloven krever at reklame merkes tydelig. Annonsene er merket «Annonse», og bunnteksten sier at tjenesten finansieres av annonser fra Google.
- **Cookies:** Personvernerklæringen må nevne at Google bruker informasjonskapsler til annonser.
- **SMS:** Deling via SMS bruker telefonens egen meldingsapp (gratis). Automatiske SMS-varsler krever en betalt SMS-tjeneste og er ikke lagt inn.
- **Glemt passord:** Ikke laget ennå, fordi det krever e-postutsending. Neste naturlige steg når e-post er koblet til.

## Filer

```
server.js          Server, database og API
config.json        Innstillinger og annonseoppsett
public/            Nettsiden (index.html, app.js, style.css)
preview.js         Henting av navn og pris fra produktlenker
verktoy/sjekk-lenke.js  Feilsøking av lenkehenting
render.yaml        Oppsett for Render (region, plan, disk, miljøvariabler)
.node-version      Node.js-versjonen Render skal bruke
test/flyt.test.js  Ende-til-ende-test (57 tester)
test/lenke.test.js Tester av lenkehenting mot eksempelsider (14 tester)
test/epost.test.js Tester av e-post via egen e-postkonto (11 tester)
smtp.js            Sending av e-post via egen e-postkonto (SMTP)
```
