# Pipeline idrometria Toscana

Questo prototipo separa tre famiglie di dati:

- **anagrafica stazioni**: rete ufficiale degli idrometri attivi;
- **misurazioni realtime**: livelli e portate CFR, da trattare come dato operativo non validato;
- **misurazioni storiche**: serie SIR collegate alla scheda OpenData, con flag di qualita quando presenti.

## Fonti usate

| fonte | contenuto | formato | uso applicativo |
| --- | --- | --- | --- |
| Regione Toscana - Idrometri: https://dati.toscana.it/dataset/idrometri | Stazioni idrometriche ATTIVE in telecontrollo | GeoJSON WFS, SHP dalla scheda OpenData | Fonte primaria per elenco idrometri attivi |
| WFS Idrometri: https://geo.sir.toscana.it/geoserver/geo/ows?maxFeatures=300000&outputFormat=application%2Fjson&request=GetFeature&service=WFS&typeName=geo%3Acf_idrometri&version=1.0.0 | FeatureCollection degli idrometri | GeoJSON | Codice stazione, nome, comune, provincia, zona, zero idrometrico |
| Stazioni meteo-idrologiche: https://dati.toscana.it/dataset/stazioni-meteo-idrologiche | Anagrafica completa e consistenza serie disponibili | JSON GeoJSON | Coordinate WGS84 e link SorgenteDati per storico |
| JSON stazioni SIR: https://www.sir.toscana.it/archivio/dati.php?D=json_stations | Stazioni e serie storiche disponibili | JSON | Relazione tra stazione e storico idrometrico |
| JSON report SIR: https://www.sir.toscana.it/archivio/dati.php?D=json_reports | Report/metadati archivio | JSON | Da ispezionare per report storici; non usato come realtime |
| CFR Idrometria: https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro | Pagina livelli e portate realtime | HTML | Contesto operativo e orario dati |
| CFR dettaglio: https://www.cfr.toscana.it/monitoraggio/dettaglio.php?id=CODICE&type=idro | Dati realtime per singola stazione | HTML/JavaScript | Parsing prudente delle righe new Array(...) |

## Campi realmente disponibili osservati

### Dataset Idrometri

Campi osservati nel GeoJSON WFS:

- id_stazione
- nome
- comune
- provincia
- zero_idrometrico
- quota
- gc
- zona
- geometria puntuale in coordinate proiettate nella risorsa WFS

Nota: la risorsa WFS vista espone coordinate non WGS84. Per latitudine/longitudine il prototipo usa il join con json_stations, quando disponibile.

### Dataset Stazioni meteo-idrologiche

Campi osservati:

- Codice
- Nome
- Comune
- Provincia
- Quota mslm
- geometria puntuale WGS84
- Consistenza, con chiavi per tipologia misura e SorgenteDati
- anni disponibili per ogni serie storica

Per idrometria la serie viene cercata filtrando le chiavi Consistenza che contengono IDROMETRIA.

### CFR realtime

La pagina pubblica dichiara livelli in metri e portate in mc/s riferiti a un orario. Il dettaglio stazione viene letto come HTML/JavaScript e normalizzato nei campi:

- station_id
- station_code
- station_name
- river_name
- basin
- latitude
- longitude
- measurement_time
- level_m
- flow_mc_s
- source_type
- source_url
- validated

## Struttura normalizzata

{
  "station_id": "string",
  "station_code": "string",
  "station_name": "string",
  "river_name": "string|null",
  "basin": "string|null",
  "latitude": "number|null",
  "longitude": "number|null",
  "measurement_time": "string|null",
  "level_m": "number|null",
  "flow_mc_s": "number|null",
  "source_type": "opendata_station|cfr_realtime|sir_historical",
  "source_url": "string",
  "validated": "boolean"
}

## Limiti dei dati

- I dati CFR realtime sono **non validati** e devono essere etichettati come tali nella UI.
- Lo storico SIR puo contenere flag: @/-9999 dato mancante, P prevalidato, V validato, R ricostruito.
- Alcune stazioni attive potrebbero non avere una risorsa storica idrometrica collegata.
- La risorsa WFS degli idrometri attivi puo esporre coordinate proiettate; il prototipo usa il dataset json_stations per ottenere coordinate WGS84 quando possibile.
- Il parsing CFR e prudente perche la fonte realtime non espone, nella pagina indicata, una API JSON ufficiale documentata.

## Esecuzione prototipo Node

Richiede Node 18+ con fetch globale.

node scripts/hydrometry-prototype.mjs --province=FI --limit=8

Output: JSON con anagrafica normalizzata e realtime CFR per le prime stazioni selezionate.

## API web app

/api/hydrometry?province=FI&realtime=1&limit=12
/api/hydrometry?province=FI&realtime=1&limit=12&historicalStationId=TOS01004679

La pagina dedicata e: /idrometria

## Pipeline consigliata in produzione

1. OpenData Idrometri come fonte primaria per gli idrometri attivi.
2. Stazioni meteo-idrologiche / SIR json_stations per arricchire anagrafica, coordinate WGS84 e link allo storico.
3. CFR dettaglio stazione per realtime non validato, con cache breve e limiti di concorrenza.
4. SIR storico solo su richiesta o con cache lunga, per evitare download pesanti.
5. Persistenza consigliata: Vercel KV o database leggero per cache anagrafica giornaliera; realtime con TTL 5 minuti.

## Possibili sviluppi futuri

- Cache giornaliera dell anagrafica stazioni.
- Download storico per singola stazione con paginazione.
- Join con bacini idrografici ufficiali se disponibili come layer separato.
- Soglie idrometriche configurabili per stazione.
- Export CSV/GeoJSON normalizzato per uso personale.