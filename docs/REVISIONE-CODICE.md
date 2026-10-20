# Revisione del codice — Firenze Emergency Dashboard

Data: 20 ottobre 2026 · Commit revisionato: `c021ba5` (`main`)
Ambito: tutto il codice applicativo (49 file tracciati, ~11.700 righe escluse le dipendenze).

## Metodo e limiti

- Lettura integrale di tutte le API route (`src/app/api/**`), delle librerie condivise (`src/lib/**`), delle pagine `dashboard`, `idrometria`, `previsioni`, `webcam` e dei componenti `PdfParser`, `MapDashboard`, `RadarDpcMap`.
- Verifiche runtime sul dev server locale: due endpoint sono stati chiamati realmente (vedi §1.1 e §1.2).
- `npx next lint` eseguito: exit 0, nessun errore, 9 warning `react-hooks/exhaustive-deps` che confermano alcuni problemi descritti in §2.6.
- Il repository **non contiene test** (`package.json` non definisce uno script `test`): nessuna suite automatica è stata eseguita o può essere eseguita.
- Non ho potuto verificare il comportamento in produzione (Vercel + KV): in locale `KV_REST_API_*` non è configurato, quindi la persistenza è disattivata e i problemi che dipendono da KV sono dedotti dal codice, non osservati.

---

## 1. Sicurezza

### 1.1 CRITICO — ~~`POST /api/bulletins` non è autenticato~~ — RISOLTO

> **Risolto il 20/10/2026.** Il `POST` richiede ora `BULLETIN_WRITE_TOKEN` (header
> `x-bulletin-token` o `Authorization: Bearer`), confrontato in tempo costante; senza
> variabile configurata risponde **503** (fail-closed), con token errato **401**, con
> `Origin` estranea **403**, con payload non valido **400**. Verifiche in §5.2.

Situazione precedente: `src/app/api/bulletins/route.js:11` accettava un `POST` arbitrario senza
alcun controllo di identità. Il record diventava `archive.current` (`src/lib/bulletinArchive.js:70`)
e `PdfParser` lo usava per pilotare il banner "Allerta attiva" in testa alla dashboard.

Verificato allora sul server locale:

```
POST /api/bulletins  {"fileName":"bug-review-probe.pdf","level":"Rosso","validTo":"2099-01-01T00:00:00.000Z"}
→ 200 {"current":{"level":"Rosso","validTo":"2099-01-01..."}}
```

In locale non persisteva (KV assente), ma **in produzione con Vercel KV configurato il record
restava in archivio**: la dashboard di un ente pubblico avrebbe mostrato "Allerta attiva: Rosso"
fino al 2099, oppure un attaccante poteva forzare `level: "Verde"` per *nascondere* un'allerta
reale. Era il problema più grave del progetto: integrità dei dati in un sistema di protezione civile.

### 1.2 ALTO — `/api/sync-observations` è *fail-open* quando `CRON_SECRET` non è impostato

`src/app/api/sync-observations/route.js:8-12`:

```js
const secret = process.env.CRON_SECRET;
if (!secret) return true;   // nessun segreto => endpoint pubblico
```

Senza `CRON_SECRET` (situazione attuale, `.env.local` assente) l'endpoint è aperto e ogni chiamata innesca fino a 18 fetch verso CFR Toscana e Open-Meteo, oltre a una scrittura in cache. Verificato: `GET /api/sync-observations?type=pluviometry&batch=0&batchSize=1` → `200`. È un vettore di amplificazione/abuso verso servizi pubblici terzi, da cui il vostro IP risulta l'autore.

**Fix:** `if (!secret) return false` (fail-closed), e accettare il segreto solo via header, non via query string (`?secret=` finisce nei log di accesso).

### 1.3 ALTO — Il PDF viene salvato in base64 dentro il record e rispedito in ogni risposta dell'archivio

`src/components/PdfParser.js:462` allega `pdfUrl: pdfDataUrl` (intero PDF in base64) al payload inviato a `/api/bulletins`; `buildBulletinRecord` lo conserva (`src/lib/bulletinArchive.js:104`) e `getBulletinArchive` lo restituisce in `GET /api/bulletins`.

Conseguenze, tutte silenziose:
- un PDF di 1,5 MB diventa ~2 MB di JSON: oltre i limiti di valore/richiesta di KV e Vercel, il `POST` fallisce e il `.catch(() => null)` (`PdfParser.js:490`) nasconde l'errore → l'archivio remoto perde il bollettino senza dirlo all'utente;
- al ripristino, `writeJsonStorage(LOCAL_ARCHIVE_KEY, remoteArchive)` (`PdfParser.js:393`) copia quei base64 in `localStorage`, superando la quota (~5 MB): `writeJsonStorage` inghiotte l'eccezione (`PdfParser.js:211-213`) e l'archivio locale non viene più ripristinato;
- ogni `GET /api/bulletins` trasferisce megabyte di PDF inutili alla UI.

**Fix:** salvare i PDF come oggetti (blob storage / IndexedDB solo lato client) e mettere nell'archivio server solo metadati + URL. Non serializzare mai il binario nel record.

### 1.4 MEDIO — Worker di pdf.js caricato da CDN di terze parti senza integrità

`src/components/PdfParser.js:313`:

```js
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
```

Esecuzione di codice da unpkg a runtime, senza SRI e senza controllo di versione pinnata nel codice: compromissione della CDN o del pacchetto = esecuzione arbitraria nel contesto dell'app. Inoltre il file è già in `node_modules`: basta copiarlo in `public/` e servirlo in locale.

### 1.5 MEDIO — SSRF latente in due punti

1. `src/lib/hydrometrySources.js:504-508`: `discoverCfrPageLinks()` risolve ogni `href` con `new URL(href, base)` — quindi anche URL assoluti verso host arbitrari — e la pagina successiva li scarica (`fetchBuffer`, `hydrometrySources.js:853`) se il nome contiene `xls`/`excel`. Nessuna allowlist di host.
2. `src/app/api/webcams/status/route.js:19`: il server fa `fetch(webcam.checkUrl || webcam.sourceUrl)` per ogni voce del catalogo a ogni richiesta, senza cache. Le URL vengono da un JSON statico (quindi non input utente), ma la combinazione "endpoint pubblico + N richieste server verso host configurabili" è un amplificatore e va ristretta.

**Fix:** validare lo schema/host (`https`, dominio atteso) e centralizzare la lista di host consentiti.

### 1.6 MEDIO — `next.config.mjs` dichiara come ottimizzabili *tutti* gli host

`next.config.mjs:4-8` usa `{ protocol: "https", hostname: "**" }` (e `http`). Oggi `next/image` non è usato da nessuna pagina (verificato), quindi l'impatto è latente, ma `/_next/image` diventa un proxy d'immagini aperto verso qualunque URL, incluso `169.254.169.254` o host interni, appena qualcuno userà `next/image`.

**Fix:** elencare solo gli host realmente necessari (tile OSM, webcam, ecc.).

### 1.7 BASSO — `.gitignore` non ignora `.env`

`.gitignore` copre `.env*.local` ma non `.env`. `.env.example` documenta `METEOHUB_USERNAME`/`METEOHUB_PASSWORD`: chi crea un `.env` (nome naturale) rischia di committare credenziali. **Fix:** aggiungere `.env` e `.env.*` con `!.env.example`.

### 1.8 BASSO — Contenuti remoti non fidati resi in un iframe

`PdfParser.js:600` rende `pdfUrl` in un `<iframe src>`. Oggi `pdfUrl` arriva da `localStorage`/archivio locale, ma il record dell'archivio remoto è scrivibile da chiunque (§1.1): un `pdfUrl` iniettato viene aperto dalla dashboard. Con URL `data:`/`blob:` l'origine è opaca, quindi non è XSS diretto, ma è phishing nello stesso frame dell'app. Va validato lo schema (`blob:`/`https:` consentiti, `javascript:`/`data:text/html` no).

### 1.9 Nota — Credenziali MeteoHub

`src/app/api/meteohub-data/route.js:76-83` fa login con utente/password da env e **non restituisce mai token o cookie al client** (bene). Il controllo di stato però è errato (vedi §2.4) e il pattern `findSessionId` cerca qualunque chiave che contenga `auth` (`route.js:52`), quindi può estrarre un campo non-sessione e usarlo come cookie: euristica fragile, da sostituire con il contratto documentato dell'API.

---

## 2. Bug e problemi di correttezza

### 2.1 ALTO — ~~Soglie idrometriche inventate presentate come soglie ufficiali~~ — RISOLTO

> **Risolto il 20/10/2026.** Le soglie derivate (livello + 0,8 / + 1,4) sono state rimosse da
> `observationData.js`, `page.js` e `idrometria/page.js`: se CFR non pubblica `warning_m`/`danger_m`
> l'interfaccia scrive "soglia non disponibile" e il grafico non disegna alcuna linea di
> riferimento. Verifiche in §5.1.

Quando CFR non espone `warning_m`/`danger_m`, il codice le **calcolava** come livello attuale + 0,8 / +1,4:

- `src/lib/observationData.js:152` e `:160` (`getWarningThreshold`/`getDangerThreshold`);
- `src/app/page.js:196-200` (`normalizeHydrometryForDashboard`);
- `src/app/idrometria/page.js:64-69`, che le disegnava come `ReferenceLine` gialla e rossa etichettate
  **"Livello 1 → x m"** e **"Livello 2 → y m"**, con la stessa veste grafica delle soglie CFR reali.

In una dashboard di protezione civile questo è fuorviante: un operatore legge come "soglia di
criticità" un numero generato dalla misura stessa. Il valore derivato è sempre sopra la misura
corrente, quindi non produceva falsi allarmi nel banner, ma il grafico poteva mostrare soglie
inesistenti. **Nota di precisione:** con i dati CFR correnti tutte le 34 stazioni pubblicano le
soglie, quindi il difetto era latente, non visibile oggi.

### 2.2 MEDIO — ~~Storia idrometrica sintetica~~ — RISOLTO

`buildHydroHistory` (serie generata con `Math.sin(index * 0.9) * 0.16`) è stata rimossa da
`src/app/page.js` e `src/lib/observationData.js`: era codice morto (nessun componente leggeva
`history`) ma fabbricava dati che sarebbero comparsi al primo grafico collegato.

### 2.3 MEDIO — `null` convertito in `0` e poi trattato come misura valida

In `src/app/idrometria/page.js:43-68`:

```js
const value = Number(realtime?.level_m);        // null -> 0
if (!Number.isFinite(value)) return [];          // 0 è finito → passa
...
{ hoursAgo: 6, delta: Number(realtime?.delta_h6_m) }  // null -> 0
  .filter((point) => Number.isFinite(point.delta))    // 0 passa
```

Una stazione senza dato realetime produce un punto a `0,00 m` e variazioni `0,00 m` invece di "n.d.". Lo stesso schema `Number(x)` + `Number.isFinite` su valori che possono essere `null` ricorre in `page.js:186-200`, `MapDashboard.js:47-55` e `previsioni/page.js`. Il pattern corretto è verificare `value === null || value === undefined` **prima** di convertire.

### 2.4 MEDIO — Login MeteoHub: un redirect 3xx è trattato come successo

`src/app/api/meteohub-data/route.js:92`:

```js
if ((!response.ok && response.status < 300) || response.status >= 400) throw ...
```

Con `redirect: "manual"`, una risposta `301/302/303/307` non è `ok` ma neppure `>= 400`: non solleva eccezione, il body viene parsato (vuoto) e il flusso prosegue come se il login fosse riuscito. Il controllo corretto è `if (!response.ok) throw ...` (i 3xx non sono `ok`).

### 2.5 MEDIO — L'idrometria ufficiale ricevuta dal server viene scartata dal client

`src/app/page.js:88-93` (`normalizeObservationData`): `measurements` viene ricostruito con `{ ...payload.measurements, hydrometry: fallback.hydrometry }`, cioè la chiave `hydrometry` del payload **viene sempre sostituita dal fallback vuoto**. Oggi funziona perché l'idrometria arriva separatamente da `/api/hydrometry` (§2.5 non è quindi un difetto visibile), ma qualunque campo idrometrico aggiunto lato server viene silenziosamente perso. Da rendere esplicito o rimuovere.

### 2.6 MEDIO — Closure stantie negli effetti di polling

`next lint` segnala `loadClientOpenMeteoData`/`loadRadar`/`loadForecast` mancanti nelle dependency array (`src/app/page.js:644`, `:655`, `src/app/previsioni/page.js:988-1000`). In `page.js` l'effetto dipende da `selectedObservationQuery`, che è un *insieme* di `tipo:id`: se i pannelli cambiano ordine o composizione lasciando invariato l'insieme, la stringa non cambia, l'effetto non riparte e il polling continua a usare i `panelConfigs` vecchi. Sintomo: valori della stazione sbagliata dopo un cambio di pannello.

### 2.7 BASSO — Il matching stazione CFR per nome produce falsi positivi

`src/lib/hydrometrySources.js:511-540` abbina le righe alle stazioni con `stationKey.includes(key) || key.includes(stationKey)` sull'intero testo della riga. Con nomi contenuti in altri ("Empoli" ⊂ "Empoli-Pontorme", "Sambuca" presente in due province) il dato può essere attribuito alla stazione sbagliata e, poiché il risultato è indicizzato per `station_id` (`hydrometrySources.js:864-866`), un abbinamento errato sovrascrive quello corretto. Meglio usare solo il codice `TOS…` come chiave primaria e il nome solo come fallback con ambiguità esplicita.

### 2.8 BASSO — Altre imprecisioni

- `src/lib/hydrometrySources.js:681`: `const fallbackValues = positionalValues || (hasUsableHeaders(headers) ? null : getPositionalCfrValues(row, station));` — quando `positionalValues` è nullo il ramo `else` riesegue **la stessa identica chiamata** appena fatta: lavoro doppio e nessun cambio di comportamento.
- `src/app/api/hydrometry/route.js:22`: `historicalLimit` non è validato (accetta `Infinity`, negativi, valori enormi); `province` (`:17`) è una stringa libera usata nei filtri.
- `src/app/api/hydrometry/route.js:84` e `:88` espongono `error.message` al client.
- `src/app/api/weather-data/route.js:27`: `fetch` senza timeout né `AbortController`; se Open-Meteo non risponde la route resta appesa.
- `src/app/api/risk-layers/route.js:55`: i layer configurati sono caricati in serie (`for … await`) invece che in parallelo.
- `src/lib/bulletinArchive.js:33`: `pruneBulletinArchive` confronta `uploadedAt || validTo` come stringhe con `new Date(...)`: se `uploadedAt` manca ma `validTo` c'è, l'ordinamento mescola formati diversi. Funziona per caso, non per costruzione.
- `src/app/api/webcams/status/route.js:20`: `fetch` segue i redirect e non limita la dimensione della risposta: un `checkUrl` che punta a un file grande viene scaricato interamente.

---

## 3. Performance

### 3.1 ALTO — ~~`/api/hydrometry` impiega 18-25 s perché scarica due volte lo stesso JSON, in serie, senza cache~~ — RISOLTO

> **Risolto il 20/10/2026.** Il documento SIR viene ora scaricato una sola volta e
> memorizzato con TTL; le due letture sono in parallelo. Misure sulla stessa macchina:
> prima 18,3 / 15,2 / 13,0 s; dopo, cache calda 0,016-0,024 s (dal browser 38-70 ms),
> prima richiesta ~7,4 s dominata dal singolo download da 1,4 MB. Contatori invariati
> (33 stazioni, 34 realtime, 45 catalogo). Dettagli in §5.

Misurato: `GET /api/hydrometry?province=FI&realtime=1&limit=all` → **18,3 s / 25,3 s / 18,1 s / 17,9 s** su quattro chiamate.

Cause sovrapposte:

1. **Doppio download dello stesso documento.** `src/app/api/hydrometry/route.js:25-26` chiama in sequenza `getHydrometryStations()` e `getHydrometryHistoricalCatalog()`, e **entrambe** scaricano `HYDROMETRY_SOURCES.stationArchive.dataUrl` (`src/lib/hydrometrySources.js:411` e `:394`). Lo stesso grande JSON viene preso due volte, e in serie, non in parallelo.
2. **Payload enorme.** La sorgente attiva è interrogata con `maxFeatures=300000` (`hydrometrySources.js:8`): l'intero dataset WFS viene scaricato e parsato a ogni richiesta.
3. **Nessuna cache.** Ogni chiamata è `force-dynamic` + `headers: {"Cache-Control": "no-store"}` quando `realtime` è attivo (`route.js:75`), e tutte le `fetch` interne usano `cache: "no-store"`. Il costo pieno viene pagato a ogni caricamento di pagina e ogni 5 minuti per ogni utente.
4. **Lavoro ridondante per riga.** `parseCfrHtmlTables` ricostruisce la mappa delle intestazioni **dentro il ciclo sulle righe** (`hydrometrySources.js:786`, `combineHeaderRows(buildHeaderRows(...))` viene ricalcolato per ogni `<td>`), e l'abbinamento stazione usa `Array.find` lineare su tutte le stazioni per ogni riga (`:511-540`) → O(righe × stazioni).
5. `getMapEntryByCode` (`:339`) è una scansione lineare chiamata per ogni stazione del catalogo storico.

**Fix con il miglior rapporto costo/beneficio:** una fetch sola del documento condiviso, `Promise.all` per le due sorgenti, cache in memoria/KV con TTL di 5-15 minuti (le variabili `OBSERVATION_CACHE_*` esistono già in `.env.example` ma non sono sfruttate da questa route), riduzione/parametrizzazione di `maxFeatures`, e spostamento del calcolo delle intestazioni fuori dal ciclo.

### 3.2 ALTO — Ogni tasto digitato in "Previsioni" genera 4 chiamate upstream

`src/app/previsioni/page.js:990-992`: l'effetto dipende da `activeLat`/`activeLng`, che derivano dai campi di input. Digitare `43.7696` esegue 7 render → 7 richieste a `/api/forecast`, e ciascuna richiesta con `profile=recommended` fa **4 fetch in parallelo** verso Open-Meteo (`src/app/api/forecast/route.js:376-381`), tutte `no-store`. Nessun debounce, nessuna cancellazione della richiesta precedente: fino a 28 chiamate esterne per inserire una coordinata.

**Fix:** debounce (400-600 ms) sull'input e `AbortController` per annullare la richiesta precedente; lato server, una cache breve (60-120 s) per `lat/lng/days/profile`.

### 3.3 MEDIO — La dashboard duplica lato browser il lavoro del server

`src/app/page.js:567-600` (`loadClientOpenMeteoData`) esegue **una fetch Open-Meteo per stazione selezionata direttamente dal browser**, in aggiunta a `augmentWithOpenMeteo` che fa lo stesso lavoro lato server (`src/lib/observationData.js:463-520`) e in aggiunta a `/api/observations`. Nel log di rete del primo caricamento si vedono 6 richieste `api.open-meteo.com` partite dal client. Effetti: lavoro triplicato, IP dell'utente esposto a terzi, e nessun beneficio perché i dati erano già disponibili.

**Fix:** eliminare il percorso client e usare solo la risposta di `/api/observations`.

### 3.4 MEDIO — `MapDashboard` ricalcola e ricrea tutto a ogni render

`src/components/MapDashboard.js:99-108`: `mergeStations(stations)` gira a ogni render (non memoizzato) e la prop `stations` è ricreata a ogni render del parent (`src/app/page.js:672`, `Object.values(...).flat()`), quindi il componente si ri-renderizza a ogni aggiornamento di stato (4 polling ogni 5 minuti). Per ogni stazione vengono creati:
- un `Marker` **e** un `CircleMarker` (due layer Leaflet per stazione, ~300 stazioni → ~600 layer);
- `stationIcon(station)` (`:60`) che istanzia un nuovo `L.divIcon` a ogni render, costringendo Leaflet a rigenerare il DOM dell'icona per tutti i marker.

**Fix:** `useMemo` su `mergeStations`, memoizzare le icone per colore/stato, e un solo layer per stazione (marker oppure `CircleMarker`).

### 3.5 BASSO — Altri punti caldi

- `src/app/api/forecast/route.js:189-259`: `normalizeSource` chiama `getArray(payload, "hourly", key)` una volta **per indice e per campo** (ricostruisce l'array a ogni accesso) e `mergeRecommendedSources` (`:290-305`) fa `find` lineari annidati (O(n²) su ~670 righe × 4 sorgenti).
- `src/app/api/radar/route.js:274`: `rawDownload` viene restituito integralmente al client senza limite di dimensione.
- `src/lib/observationData.js:548-556`: `mergeMeasurements` fa `find` lineare per tipo/stazione (O(n²)).
- `src/lib/hydrometrySources.js:757`: `inflateRawSync` decomprime lo zip degli export CFR senza limite di dimensione (rischio zip-bomb su risposta upstream anomala).

---

## 4. Priorità consigliate

| # | Intervento | Impatto | Costo |
|---|---|---|---|
| 1 | ~~Autenticare `POST /api/bulletins`~~ — fatto (§5.2) | Critico | Basso |
| 2 | `CRON_SECRET` fail-closed + segreto solo in header (§1.2) | Alto | Molto basso |
| 3 | Non serializzare i PDF in base64 nel record d'archivio (§1.3) | Alto | Medio |
| 4 | Una sola fetch del documento condiviso + cache TTL su `/api/hydrometry` (§3.1) | Alto (18-25 s → secondi) | Medio |
| 5 | Debounce + abort su `previsioni` (§3.2) | Alto | Basso |
| 6 | Rimuovere soglie inventate e storia sintetica (§2.1, §2.2) | Alto (correttezza) | Basso |
| 7 | Correggere `null → 0` (§2.3) e il controllo 3xx MeteoHub (§2.4) | Medio | Basso |
| 8 | Self-host del worker pdf.js (§1.4) | Medio | Basso |
| 9 | Allowlist host (`next.config` + SSRF) e `.env` in `.gitignore` (§1.5-1.7) | Medio | Basso |
| 10 | Memoizzazione e layer unico nella mappa (§3.4) | Medio | Basso |

## 5. Intervento su `/api/hydrometry` (20/10/2026)

Modifiche:

- `src/lib/hydrometrySources.js`: cache di processo con TTL e deduplica delle richieste
  concorrenti (`cachedValue`), applicata ai documenti OpenData e ai risultati normalizzati;
  i risultati **degradati** (timeout, fonte giù, fallback statico) non vengono memorizzati,
  gli errori solo per 30 s; timeout dedicato di 25 s per il documento SIR (1,4 MB, 7-9 s);
  intestazioni delle tabelle CFR calcolate una volta per tabella invece che per riga.
- `src/app/api/hydrometry/route.js`: `getHydrometryStations` e `getHydrometryHistoricalCatalog`
  in `Promise.all`, così condividono una sola fetch.
- `.env.example`: nuove variabili `HYDROMETRY_CACHE_TTL_SECONDS`,
  `HYDROMETRY_REALTIME_CACHE_TTL_SECONDS`, `HYDROMETRY_SOURCE_FETCH_TIMEOUT_MS`,
  `HYDROMETRY_FAILURE_CACHE_TTL_SECONDS`.

Misure (stessa macchina, `?province=FI&realtime=1&limit=all`):

| Condizione | Prima | Dopo |
|---|---|---|
| Prima richiesta (cache vuota) | 18,3 s | ~7,4-10,7 s |
| Richieste successive | 13,0-15,2 s | 0,016-0,024 s |
| Dal browser (fetch reale) | n/d | 38-70 ms |
| Fonte SIR irraggiungibile | 9 s per richiesta, fallback statico (12 stazioni) | 38 ms (errore memorizzato 30 s) |

Regressione trovata e corretta durante le misure: la prima versione memorizzava anche il
fallback statico, quindi un singolo timeout bloccava il catalogo a 12 stazioni per 15 minuti.
Verificato con `HYDROMETRY_SOURCE_FETCH_TIMEOUT_MS=1`: il fallback resta temporaneo e la
richiesta successiva riprova.

### 5.1 Intervento sulle soglie idrometriche (20/10/2026)

Modifiche:

- `src/app/idrometria/page.js`: `levelOne`/`levelTwo` leggono solo `warning_m`/`danger_m` ufficiali;
  pannello "Soglie operative" con testo "soglia non disponibile" e nota esplicita quando mancano
  entrambe; le `ReferenceLine` non vengono renderizzate.
- `src/app/page.js`: rimossi i fallback `+0,8`/`+1,4` e `buildHydroHistory`; `getStationStatus`
  confronta solo soglie presenti.
- `src/lib/observationData.js`: `getWarningThreshold`/`getDangerThreshold` non derivano più soglie
  idrometriche; rimossa la storia sintetica.
- `src/components/MapDashboard.js`: senza soglie lo stato non è più "Regolare" (verde) ma
  "Soglie non disponibili" (grigio neutro).

**Trappola trovata durante la modifica:** `Number(null)` vale `0`, quindi una soglia assente sarebbe
diventata una soglia a 0 m e `value >= 0` avrebbe marcato **tutte** le stazioni come "Rosso",
colorando di rosso il banner di allerta provinciale. Introdotto `toFiniteNumber()` (che tratta
`null`/`undefined`/`""` come assenza) in `page.js`, `idrometria/page.js` e `MapDashboard.js`.

Verifiche (payload reale e payload forzato senza soglie, in browser):

| Scenario | Soglie nel pannello | Linee nel grafico | Banner | Marker idrometrici |
|---|---|---|---|---|
| Dati CFR reali (34/34 con soglie) | "Livello 1 -> 4 m", "Livello 2 -> 5 m" | 2 (gialla, rossa) | Verde | 21 verdi |
| Payload forzato `warning_m/danger_m = null` | "soglia non disponibile" ×2 + nota | 0 | **Verde** (non Rosso) | 21 grigi neutri |

### 5.2 Intervento sulla scrittura dei bollettini (20/10/2026)

Modifiche:

- `src/app/api/bulletins/route.js`: token obbligatorio con confronto a tempo costante
  (`node:crypto.timingSafeEqual`), **fail-closed** se `BULLETIN_WRITE_TOKEN` non è impostato,
  controllo same-origin per il CSRF, validazione del payload (livello in whitelist, date ISO,
  limiti di lunghezza, liste ripulite) e sanitizzazione di `pdfUrl` (solo `https`, i data URL
  base64 non vengono più salvati). Il `GET` resta pubblico e in sola lettura.
- `src/components/PdfParser.js`: il token lo inserisce l'operatore a runtime e resta **solo in
  memoria** (mai nel bundle, mai in localStorage); senza token il client non invia nulla e il
  bollettino resta sul dispositivo; gli errori del server vengono mostrati all'utente.
- `.env.example`: documentata `BULLETIN_WRITE_TOKEN` con l'istruzione di generarla a caso.

Matrice verificata (server con token configurato):

| Richiesta | Esito |
|---|---|
| `POST` senza token | 401 `Token di scrittura mancante o non valido.` |
| `POST` con token errato | 401 |
| `POST` con token corretto (`x-bulletin-token` o Bearer) | 200, record in `current` |
| `POST` con token corretto ma `Origin: https://evil.example` | 403 |
| `POST` con `level: "Viola"` | 400 |
| `POST` con JSON malformato | 400 |
| `POST` con `pdfUrl` data URL base64 | 200 con `pdfUrl: null` |
| `POST` con `fileName` di 400 caratteri | 200 con nome troncato a 160 |
| Server **senza** `BULLETIN_WRITE_TOKEN` | 503, `GET` sempre 200 |

Verifica end-to-end nella UI: PDF sintetico caricato dal browser → livello rilevato `Giallo`
senza token, nessuna richiesta inviata, avviso "il bollettino resta solo su questo dispositivo";
con token valido → `POST` con header `x-bulletin-token` e risposta 200 (in locale `saved: false`
perché manca KV, e l'interfaccia lo dice).

## 6. Cosa non è stato verificato

- Comportamento con Vercel KV reale (limiti di dimensione, concorrenza sui batch): dedotto dal codice.
- Correttezza dei dati restituiti da CFR Toscana e Open-Meteo: la revisione riguarda il codice, non la qualità delle fonti.
- Accessibilità (axe/Lighthouse), copertura dei test (assenti) e compatibilità browser: fuori ambito.
