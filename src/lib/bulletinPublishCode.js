// Codice condiviso per pubblicare un bollettino nell'archivio comune.
// Unica fonte per il server (/api/bulletins) e per il prompt della dashboard:
// per cambiarlo basta modificare questa costante e ridistribuire.
// Non è un segreto forte, perché viaggia nel bundle del browser: serve a
// impedire scritture anonime da terzi, non a distinguere gli operatori.
export const DEFAULT_BULLETIN_PUBLISH_CODE = "FirenzePc2026";

// Chiave localStorage in cui la dashboard ricorda il codice confermato.
export const PUBLISH_CODE_STORAGE_KEY = "firenze:bulletin-publish-code:v1";
