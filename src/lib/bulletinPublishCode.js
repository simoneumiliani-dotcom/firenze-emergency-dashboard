// Codice condiviso per pubblicare un bollettino nell'archivio comune.
// Non è un segreto forte: serve a impedire scritture anonime da terzi, non a
// distinguere gli operatori. Il server può sostituirlo con BULLETIN_WRITE_CODE
// (o con il vecchio BULLETIN_WRITE_TOKEN) senza toccare la dashboard.
export const DEFAULT_BULLETIN_PUBLISH_CODE = "FirenzePc2026";

// Chiave localStorage in cui la dashboard ricorda il codice confermato.
export const PUBLISH_CODE_STORAGE_KEY = "firenze:bulletin-publish-code:v1";
